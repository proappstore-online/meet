import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import type { User, Room, ConnectionState, RoomPeer } from '@proappstore/sdk'
import { Shell } from './components/Shell.tsx'
import { VideoTile } from './components/VideoTile.tsx'
import { useWebRTC, type ChatMessage } from './hooks/useWebRTC.ts'
import { generateRoomId, getRoomIdFromUrl, getMeetingLink, getFriendIdFromUrl, getFriendNameFromUrl, getFriendLink } from './lib/room.ts'
import { createRawRoom } from './lib/raw-room.ts'
import { ensureMigrated, sendFriendRequest, getFriendRequests, acceptFriendRequest, declineFriendRequest, getFriends, removeFriend, type Friend, type FriendRequest } from './lib/db.ts'
import { app } from './lib/app.ts'

declare const __BUILD_HASH__: string

type AvailabilityDuration = 10 | 30 | 60

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const color =
    state === 'open' ? 'bg-[var(--success)]' :
    state === 'connecting' ? 'bg-[var(--warning)]' :
    state === 'error' ? 'bg-[var(--error)]' :
    'bg-[var(--muted)]'

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--glass)] px-3 py-1.5">
      <div className={`h-2 w-2 rounded-full ${color}`} />
    </div>
  )
}

function ChatPanel({ messages, onSend, onClose, chatEndRef }: {
  messages: ChatMessage[]
  onSend: (text: string) => void
  onClose: () => void
  chatEndRef: React.RefObject<HTMLDivElement | null>
}) {
  const [input, setInput] = useState('')
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    onSend(text)
    setInput('')
  }
  return (
    <div className="absolute inset-x-0 bottom-[4.5rem] z-30 flex max-h-[50vh] flex-col rounded-t-2xl bg-gray-900/95 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-sm font-semibold text-white">Chat</span>
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {messages.length === 0 && <p className="py-4 text-center text-xs text-white/30">No messages yet</p>}
        {messages.map((m, i) => (
          <div key={i} className={`mb-2 flex flex-col ${m.isMine ? 'items-end' : 'items-start'}`}>
            <span className="mb-0.5 text-[0.6rem] font-medium text-white/40">{m.from}</span>
            <div className={`max-w-[75%] rounded-xl px-3 py-1.5 text-sm ${m.isMine ? 'bg-blue-500/80 text-white' : 'bg-white/10 text-white'}`}>{m.text}</div>
            <span className="mt-0.5 text-[0.5rem] text-white/20">{new Date(m.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-white/10 px-3 py-2">
        <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..." className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:ring-1 focus:ring-blue-500/50" />
        <button type="submit" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/80 text-white hover:bg-blue-500">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>
        </button>
      </form>
    </div>
  )
}

function CountdownTimer({ endsAt, onExpired }: { endsAt: number; onExpired: () => void }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))

  useEffect(() => {
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0) { clearInterval(interval); onExpired() }
    }, 1000)
    return () => clearInterval(interval)
  }, [endsAt, onExpired])

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  return (
    <span className="font-mono text-2xl font-bold text-[var(--ink)]">
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </span>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)

  const [myRoomId, setMyRoomId] = useState<string | null>(null)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [roomState, setRoomState] = useState<ConnectionState>('closed')
  const [copied, setCopied] = useState(false)
  const [isHost, setIsHost] = useState(false)

  // Availability mode
  const [availableMode, setAvailableMode] = useState(false)
  const [availabilityDuration, setAvailabilityDuration] = useState<AvailabilityDuration>(30)
  const [availabilityEndsAt, setAvailabilityEndsAt] = useState<number | null>(null)
  const [guestJoined, setGuestJoined] = useState(false)

  // Guest waiting mode
  const [guestWaiting, setGuestWaiting] = useState(false)
  const [guestTimedOut, setGuestTimedOut] = useState(false)

  // Friends state
  const [friends, setFriends] = useState<Friend[]>([])
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [friendLinkCopied, setFriendLinkCopied] = useState(false)
  const [friendInviteDismissed, setFriendInviteDismissed] = useState(false)

  // Chat/reactions state
  const [chatOpen, setChatOpen] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatOpenRef = useRef(chatOpen)
  chatOpenRef.current = chatOpen
  const prevChatLenRef = useRef(0)

  const roomRef = useRef<Room | null>(null)
  const peerUnsubRef = useRef<(() => void) | null>(null)
  const guestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    localStream, remoteStream, callState,
    audioEnabled, videoEnabled, screenSharing,
    chatMessages, peerHandRaised, myHandRaised, reactions,
    startCall, endCall, toggleAudio, toggleVideo, toggleScreenShare,
    sendChat, toggleHandRaise, sendReaction, setRoom,
  } = useWebRTC(isHost)

  useEffect(() => {
    if (chatMessages.length > prevChatLenRef.current && !chatOpenRef.current) {
      setUnreadCount(prev => prev + (chatMessages.length - prevChatLenRef.current))
    }
    prevChatLenRef.current = chatMessages.length
  }, [chatMessages.length])

  useEffect(() => {
    if (chatOpen) {
      setUnreadCount(0)
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [chatOpen, chatMessages.length])

  useEffect(() => {
    app.auth.init().then(() => setAuthReady(true))
    const unsub = app.auth.onChange(setUser)
    return unsub
  }, [])

  useEffect(() => {
    if (!user) { setMyRoomId(null); return }
    const controller = new AbortController()
    app.kv.get<string>('my-room-id', { signal: controller.signal }).then((id) => {
      if (controller.signal.aborted) return
      if (id) {
        setMyRoomId(id)
      } else {
        const newId = generateRoomId()
        app.kv.set('my-room-id', newId).then(() => {
          if (!controller.signal.aborted) setMyRoomId(newId)
        })
      }
    })
    return () => controller.abort()
  }, [user])

  // Load friends on login
  useEffect(() => {
    if (!user) { setFriends([]); setFriendRequests([]); return }
    let cancelled = false
    setFriendsLoading(true)
    ensureMigrated().then(async () => {
      const [f, r] = await Promise.all([getFriends(user.id), getFriendRequests(user.id)])
      if (!cancelled) { setFriends(f); setFriendRequests(r); setFriendsLoading(false) }
    }).catch(() => { if (!cancelled) setFriendsLoading(false) })
    return () => { cancelled = true }
  }, [user])

  const urlRoomId = getRoomIdFromUrl()
  const urlFriendId = getFriendIdFromUrl()
  const urlFriendName = getFriendNameFromUrl()

  const regenerateLink = useCallback(async () => {
    if (!user) return
    const newId = generateRoomId()
    await app.kv.set('my-room-id', newId)
    setMyRoomId(newId)
    setCopied(false)
  }, [user])

  const copyLink = useCallback(async () => {
    const id = activeRoomId ?? myRoomId
    if (!id) return
    await navigator.clipboard.writeText(getMeetingLink(id))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [myRoomId, activeRoomId])

  /** Create a raw room connection (shared by all flows). */
  const connectRoom = useCallback((roomId: string) => {
    if (roomRef.current) roomRef.current.close()
    const roomName = `meet-${roomId}`
    const token = app.auth.token
    if (!token) return null
    const logFn = (msg: string) => console.log(`[meet] ${msg}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = createRawRoom('meet', roomName, token, logFn) as any
    roomRef.current = r
    r.onConnectionState((state: ConnectionState) => setRoomState(state))
    return r
  }, [])

  const cleanup = useCallback(() => {
    if (peerUnsubRef.current) { peerUnsubRef.current(); peerUnsubRef.current = null }
    if (guestTimeoutRef.current) { clearTimeout(guestTimeoutRef.current); guestTimeoutRef.current = null }
    if (roomRef.current) { roomRef.current.close(); roomRef.current = null }
    endCall()
    setRoom(null)
    setActiveRoomId(null)
    setRoomState('closed')
    setAvailableMode(false)
    setAvailabilityEndsAt(null)
    setGuestJoined(false)
    setGuestWaiting(false)
    setGuestTimedOut(false)
    if (urlRoomId) window.history.replaceState({}, '', window.location.pathname)
  }, [endCall, urlRoomId, setRoom])

  // === Friends ===
  const handleAddFriend = useCallback(async (targetId: string, targetLogin: string) => {
    if (!user) return
    await sendFriendRequest(user.id, user.login || '', targetId, targetLogin)
    // Clear URL params
    window.history.replaceState({}, '', window.location.pathname)
    // Reload requests
    const [f, r] = await Promise.all([getFriends(user.id), getFriendRequests(user.id)])
    setFriends(f); setFriendRequests(r)
  }, [user])

  const handleAcceptFriend = useCallback(async (otherId: string) => {
    if (!user) return
    await acceptFriendRequest(user.id, otherId)
    const [f, r] = await Promise.all([getFriends(user.id), getFriendRequests(user.id)])
    setFriends(f); setFriendRequests(r)
  }, [user])

  const handleDeclineFriend = useCallback(async (otherId: string) => {
    if (!user) return
    await declineFriendRequest(user.id, otherId)
    const r = await getFriendRequests(user.id)
    setFriendRequests(r)
  }, [user])

  const handleRemoveFriend = useCallback(async (otherId: string) => {
    if (!user) return
    await removeFriend(user.id, otherId)
    setFriends(prev => prev.filter(f => f.userId !== otherId))
  }, [user])

  const handleCopyFriendLink = useCallback(async () => {
    if (!user) return
    await navigator.clipboard.writeText(getFriendLink(user.id, user.login || ''))
    setFriendLinkCopied(true)
    setTimeout(() => setFriendLinkCopied(false), 2000)
  }, [user])

  // === HOST: Go Available ===
  const handleGoAvailable = useCallback(async () => {
    if (!myRoomId || !user) return

    try { await app.notifications.subscribe('/push-sw.js') } catch {
      console.warn('[meet] Push subscription failed or denied')
    }

    const r = connectRoom(myRoomId)
    if (!r) return

    setIsHost(true)
    setAvailableMode(true)
    setAvailabilityEndsAt(Date.now() + availabilityDuration * 60 * 1000)
    setGuestJoined(false)

    // Watch for guests joining
    peerUnsubRef.current = r.onPeers((peers: RoomPeer[]) => {
      const others = peers.filter((p: RoomPeer) => p.uid !== user.id)
      if (others.length > 0) setGuestJoined(true)
    })

    // Notify all friends (fire-and-forget, cap at 30)
    const meetingLink = getMeetingLink(myRoomId)
    const toNotify = friends.slice(0, 30)
    if (friends.length > 30) console.warn(`[meet] ${friends.length} friends, only notifying first 30`)
    Promise.allSettled(
      toNotify.map((friend) =>
        app.notifications.notifyUser(friend.userId, {
          title: 'Meet',
          body: `${user.login || 'Someone'} is available to talk!`,
          url: meetingLink,
          tag: `meet-available-${myRoomId}`,
        }).catch((e) => console.warn('[meet] Failed to notify friend:', friend.userId, e))
      )
    )
  }, [myRoomId, user, availabilityDuration, connectRoom, friends])

  // === HOST: Start call from available mode ===
  const handleStartCallFromAvailable = useCallback(() => {
    if (!myRoomId || !roomRef.current) return
    if (peerUnsubRef.current) { peerUnsubRef.current(); peerUnsubRef.current = null }

    setAvailableMode(false)
    setAvailabilityEndsAt(null)
    setActiveRoomId(myRoomId)

    // Wire up WebRTC signaling on the existing room connection
    setRoom(roomRef.current)
    // startCall will be triggered by the auto-start useEffect below
  }, [myRoomId, setRoom])

  // === HOST: Instant meeting — one click: start + copy link ===
  const handleStartMeeting = useCallback(async () => {
    if (!myRoomId || !user) return
    const r = connectRoom(myRoomId)
    if (!r) return
    setIsHost(true)
    setActiveRoomId(myRoomId)
    setRoom(r)
    // Auto-copy link so host can paste it immediately
    try {
      await navigator.clipboard.writeText(getMeetingLink(myRoomId))
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch { /* clipboard might fail on some browsers */ }
  }, [myRoomId, user, connectRoom, setRoom])

  // === GUEST: Join meeting ===
  const handleJoinMeeting = useCallback(async () => {
    if (!urlRoomId || !user) return

    const r = connectRoom(urlRoomId)
    if (!r) return

    setIsHost(false)
    setGuestWaiting(true)
    setGuestTimedOut(false)

    // Send push notification to host when we see them in peers
    let notified = false
    peerUnsubRef.current = r.onPeers(async (peers: RoomPeer[]) => {
      if (notified) return
      const host = peers.find((p: RoomPeer) => p.uid !== user.id)
      if (host) {
        notified = true
        try {
          await app.notifications.notifyUser(host.uid, {
            title: 'Meet',
            body: `${user.login || 'Someone'} wants to talk!`,
            url: getMeetingLink(urlRoomId),
            tag: `meet-${urlRoomId}`,
          })
        } catch (e) {
          console.warn('[meet] Push notification failed:', e)
        }
      }
    })

    // Wire up WebRTC signaling — when host starts call, offer will arrive
    setRoom(r)
    setActiveRoomId(urlRoomId)

    // 2-minute timeout
    guestTimeoutRef.current = setTimeout(() => setGuestTimedOut(true), 120_000)
  }, [urlRoomId, user, connectRoom, setRoom])

  // Auto-start call when room is open (skip in available/waiting modes)
  useEffect(() => {
    if (roomState === 'open' && callState === 'idle' && activeRoomId && !availableMode && !guestWaiting) {
      startCall()
    }
  }, [roomState, callState, activeRoomId, availableMode, guestWaiting, startCall])

  // Guest: detect when host starts cameras (callState changes from idle)
  useEffect(() => {
    if (guestWaiting && (callState === 'connecting' || callState === 'connected')) {
      setGuestWaiting(false)
      setGuestTimedOut(false)
      if (peerUnsubRef.current) { peerUnsubRef.current(); peerUnsubRef.current = null }
      if (guestTimeoutRef.current) { clearTimeout(guestTimeoutRef.current); guestTimeoutRef.current = null }
    }
  }, [guestWaiting, callState])

  // When host starts from available, trigger guest's startCall via the auto-start effect
  // The room is already open, activeRoomId is set, availableMode is false → startCall fires
  // For the guest: guestWaiting prevents auto-start. When the host sends an offer,
  // the hook processes it and callState changes → guestWaiting clears → auto-start fires.
  // But wait — the guest needs to also startCall. Let me handle this:
  useEffect(() => {
    if (guestWaiting && roomState === 'open' && callState === 'idle' && activeRoomId) {
      // Guest is waiting but room is open — start the WebRTC layer (it will
      // send request-offer and wait for the host). When the host's offer arrives,
      // callState will change and guestWaiting will clear.
      startCall()
    }
  }, [guestWaiting, roomState, callState, activeRoomId, startCall])

  useEffect(() => {
    return () => {
      if (peerUnsubRef.current) peerUnsubRef.current()
      if (guestTimeoutRef.current) clearTimeout(guestTimeoutRef.current)
      if (roomRef.current) roomRef.current.close()
    }
  }, [])

  // --- Render ---

  if (!authReady) {
    return (
      <Shell>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[var(--muted)]">Loading...</p>
        </div>
      </Shell>
    )
  }

  if (!user) {
    return (
      <Shell user={null} onSignIn={(p) => app.auth.signIn(p)}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5">
          <h1 className="display-font text-4xl font-bold text-[var(--ink)]">Meet</h1>
          <p className="max-w-xs text-center text-[var(--muted)]">
            Instant 1-on-1 video meetings with push notifications. Sign in to get started.
          </p>
          <div className="flex flex-col gap-3">
            <button onClick={() => app.auth.signIn('github')} className="rounded-full bg-[var(--ink)] px-6 py-2.5 text-sm font-semibold text-[var(--paper)] hover:opacity-90">Sign in with GitHub</button>
            <button onClick={() => app.auth.signIn('google')} className="rounded-full border border-[var(--line-strong)] bg-[var(--glass)] px-6 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--glass-hover)]">Sign in with Google</button>
          </div>
        </div>
      </Shell>
    )
  }

  // Active meeting — fullscreen (not in available or guest-waiting mode)
  if (activeRoomId && !availableMode && !guestWaiting) {
    return (
      <div className="relative flex h-[100dvh] flex-col bg-black">
        <div className="relative flex-1">
          <VideoTile stream={remoteStream} label={callState === 'peer-left' ? 'Disconnected' : 'Peer'} fill />
          {peerHandRaised && (
            <div className="absolute right-3 top-[4.5rem] z-20 flex h-8 w-8 items-center justify-center rounded-full bg-yellow-400/90 text-lg shadow-lg sm:right-[10.5rem]">✋</div>
          )}
          {reactions.map(r => (
            <div key={r.id} className="pointer-events-none absolute z-20 text-3xl" style={{ left: `${15 + Math.random() * 70}%`, bottom: '20%', animation: 'reaction-float 3s ease-out forwards' }}>{r.emoji}</div>
          ))}
          <style>{`@keyframes reaction-float { 0% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-200px) scale(1.4); } }`}</style>
          <div className="absolute right-3 top-3 z-10 w-24 overflow-hidden rounded-xl border-2 border-white/20 shadow-lg sm:w-36">
            <VideoTile stream={localStream} muted mirrored label="You" />
            {myHandRaised && <div className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400/90 text-sm shadow">✋</div>}
          </div>
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
            <ConnectionBadge state={roomState} />
            {callState !== 'idle' && callState !== 'connected' && (
              <span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-medium backdrop-blur-sm ${callState === 'error' || callState === 'peer-left' ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                {callState === 'waiting' ? 'Waiting...' : callState === 'connecting' ? 'Connecting...' : callState === 'error' ? 'Camera error' : 'Peer left'}
              </span>
            )}
          </div>
          {callState === 'error' && (
            <div className="absolute inset-x-3 top-14 z-10 flex items-center justify-between rounded-xl bg-red-500/90 px-4 py-2 backdrop-blur-sm">
              <span className="text-xs text-white">Camera/mic blocked</span>
              <button onClick={startCall} className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold text-white">Retry</button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-center gap-3 bg-black/80 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl">
          <button onClick={toggleAudio} className={`flex h-12 w-12 items-center justify-center rounded-full ${audioEnabled ? 'bg-white/10 text-white' : 'bg-red-500/80 text-white'}`}>
            {audioEnabled ? (<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>) : (<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="m18.364 18.364-2.172-2.172M15.536 15.536 12 12m0 0L8.464 8.464M12 12l3.536-3.536M12 12 8.464 15.536m-2.172 2.172L4.93 19.07M12 18.75a6 6 0 0 0 4.243-1.757M12 18.75a6 6 0 0 1-4.243-1.757M12 18.75v3.75m-3.75 0h7.5M3 3l18 18" /></svg>)}
          </button>
          <button onClick={toggleVideo} className={`flex h-12 w-12 items-center justify-center rounded-full ${videoEnabled ? 'bg-white/10 text-white' : 'bg-red-500/80 text-white'}`}>
            {videoEnabled ? (<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9.75a2.25 2.25 0 0 0 2.25-2.25V7.5a2.25 2.25 0 0 0-2.25-2.25H4.5A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>) : (<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-.409L12 15.75M2.25 9V7.5a2.25 2.25 0 0 1 2.25-2.25h9.75M3 3l18 18" /></svg>)}
          </button>
          <button onClick={toggleScreenShare} className={`flex h-12 w-12 items-center justify-center rounded-full ${screenSharing ? 'bg-blue-500/80 text-white' : 'bg-white/10 text-white'}`}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a9 9 0 1 1-18 0V5.25" /></svg>
          </button>
          <button onClick={toggleHandRaise} className={`flex h-12 w-12 items-center justify-center rounded-full ${myHandRaised ? 'bg-yellow-500/80 text-white' : 'bg-white/10 text-white'}`}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3.15m3.15-3.15v-1.05a1.575 1.575 0 0 1 3.15 0v1.05m-3.15 0v3.15m3.15-4.2a1.575 1.575 0 0 1 3.15 0v4.2m0 0a1.575 1.575 0 0 1 3.15 0v1.575M6.9 7.725v1.875a5.25 5.25 0 0 0 5.25 5.25h1.35a5.25 5.25 0 0 0 5.25-5.25V9.75M6.9 7.725A1.575 1.575 0 0 0 5.325 9.3v.75" /></svg>
          </button>
          <div className="relative">
            <button onClick={() => setEmojiPickerOpen(p => !p)} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" /></svg>
            </button>
            {emojiPickerOpen && (
              <div className="absolute bottom-14 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-xl bg-gray-900/95 px-2 py-1.5 shadow-xl backdrop-blur-sm">
                {['👍', '❤️', '😂', '👏', '🎉', '🤔'].map(emoji => (
                  <button key={emoji} onClick={() => { sendReaction(emoji); setEmojiPickerOpen(false) }} className="flex h-10 w-10 items-center justify-center rounded-lg text-xl hover:bg-white/10">{emoji}</button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setChatOpen(p => !p)} className={`relative flex h-12 w-12 items-center justify-center rounded-full ${chatOpen ? 'bg-blue-500/80 text-white' : 'bg-white/10 text-white'}`}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
            {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[0.6rem] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          <button onClick={cleanup} className="flex h-12 w-16 items-center justify-center rounded-full bg-red-500 text-white">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 3.75 18 6m0 0 2.25 2.25M18 6l2.25-2.25M18 6l-2.25 2.25m1.5 13.5c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 0 1 6.75 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 0 0-.38 1.21 12.035 12.035 0 0 0 7.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 0 1 1.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 0 1-2.25 2.25h-2.25Z" /></svg>
          </button>
        </div>
        {chatOpen && <ChatPanel messages={chatMessages} onSend={sendChat} onClose={() => setChatOpen(false)} chatEndRef={chatEndRef} />}
        <div className="absolute bottom-20 right-2 z-20 rounded-full bg-black/60 px-2 py-0.5 backdrop-blur-sm">
          <span className="font-mono text-[0.5rem] text-white/30">{__BUILD_HASH__}</span>
        </div>
      </div>
    )
  }

  // Guest waiting screen
  if (guestWaiting && activeRoomId) {
    return (
      <Shell user={user} onSignIn={(p) => app.auth.signIn(p)} onSignOut={() => app.auth.signOut()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
          <h1 className="display-font text-3xl font-bold text-[var(--ink)]">Joining Meeting</h1>
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-6">
            {guestTimedOut ? (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--error)]/15">
                  <svg className="h-8 w-8 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                </div>
                <p className="text-center text-sm text-[var(--muted)]">The host hasn't responded. They may not be available right now.</p>
                <button onClick={cleanup} className="w-full rounded-xl border border-[var(--line-strong)] bg-[var(--glass)] px-6 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--glass-hover)]">Go Back</button>
              </>
            ) : (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)]/15">
                  <svg className="h-8 w-8 animate-pulse text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>
                </div>
                <p className="text-center text-sm font-medium text-[var(--ink)]">Host has been notified</p>
                <p className="text-center text-xs text-[var(--muted)]">Please wait while the host starts the call...</p>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0ms]" />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:150ms]" />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:300ms]" />
                </div>
              </>
            )}
          </div>
        </div>
      </Shell>
    )
  }

  // Host available screen
  if (availableMode && availabilityEndsAt && myRoomId) {
    return (
      <Shell user={user} onSignIn={(p) => app.auth.signIn(p)} onSignOut={() => app.auth.signOut()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
          <h1 className="display-font text-3xl font-bold text-[var(--ink)]">Available</h1>
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-6">
            {guestJoined ? (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--success)]/15">
                  <svg className="h-8 w-8 text-[var(--success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                </div>
                <p className="text-center text-sm font-medium text-[var(--ink)]">Someone is waiting to talk!</p>
                <button onClick={handleStartCallFromAvailable} className="w-full rounded-xl bg-[var(--success)] px-6 py-3.5 text-base font-bold text-white hover:opacity-90">Start Call</button>
              </>
            ) : (
              <>
                <CountdownTimer endsAt={availabilityEndsAt} onExpired={cleanup} />
                <p className="text-center text-xs text-[var(--muted)]">Share your link. You'll be notified when someone joins.</p>
                <div className="flex w-full items-center gap-2">
                  <div className="flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]">{getMeetingLink(myRoomId)}</div>
                  <button onClick={copyLink} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${copied ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--ink)] text-[var(--paper)] hover:opacity-90'}`}>{copied ? 'Copied!' : 'Copy'}</button>
                </div>
              </>
            )}
            <button onClick={cleanup} className="w-full rounded-xl border border-[var(--line-strong)] bg-[var(--glass)] px-6 py-3 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--glass-hover)] hover:text-[var(--ink)]">Cancel</button>
          </div>
        </div>
      </Shell>
    )
  }

  // Lobby
  const isJoining = !!urlRoomId
  const isFriendInvite = !urlRoomId && !!urlFriendId && urlFriendId !== user?.id && !friendInviteDismissed

  // Friend request intercept — show before lobby
  if (isFriendInvite) {
    return (
      <Shell user={user} onSignIn={(p) => app.auth.signIn(p)} onSignOut={() => app.auth.signOut()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
          <h1 className="display-font text-3xl font-bold text-[var(--ink)]">Friend Request</h1>
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)]/15">
              <svg className="h-8 w-8 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" /></svg>
            </div>
            <p className="text-center text-sm text-[var(--ink)]">
              Add <span className="font-semibold">{urlFriendName || 'this user'}</span> as a friend?
            </p>
            <p className="text-center text-xs text-[var(--muted)]">They'll be able to notify you when they go available.</p>
            <button onClick={() => handleAddFriend(urlFriendId!, urlFriendName || '')} className="w-full rounded-xl bg-[var(--accent)] px-6 py-3.5 text-base font-bold text-white hover:opacity-90">Add Friend</button>
            <button onClick={() => { window.history.replaceState({}, '', window.location.pathname); setFriendInviteDismissed(true) }} className="w-full rounded-xl border border-[var(--line-strong)] bg-[var(--glass)] px-6 py-3 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--glass-hover)] hover:text-[var(--ink)]">Skip</button>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell user={user} onSignIn={(p) => app.auth.signIn(p)} onSignOut={() => app.auth.signOut()}>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8">
        <h1 className="display-font text-4xl font-bold text-[var(--ink)]">Meet</h1>

        {isJoining ? (
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-6">
            <p className="text-center text-sm text-[var(--muted)]">You have been invited to a meeting</p>
            <span className="rounded-lg bg-[var(--paper)] px-3 py-1 font-mono text-sm text-[var(--ink)]">{urlRoomId}</span>
            <button onClick={handleJoinMeeting} className="w-full rounded-xl bg-[var(--success)] px-6 py-3.5 text-base font-bold text-white hover:opacity-90">Join Meeting</button>
          </div>
        ) : (
          <div className="flex w-full max-w-md flex-col gap-4">
            {/* Instant meeting — one click */}
            <button
              onClick={handleStartMeeting}
              disabled={!myRoomId}
              className="w-full rounded-2xl bg-[var(--accent)] px-6 py-5 text-center hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-lg font-bold text-white">Start Meeting</span>
              <span className="block text-xs text-white/70">Link copied automatically</span>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-[var(--line)]" />
              <span className="text-xs text-[var(--muted)]">or</span>
              <div className="flex-1 border-t border-[var(--line)]" />
            </div>

            {/* Go Available mode */}
            <div className="flex w-full flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--ink)]">Go Available</span>
                <div className="flex items-center gap-1.5">
                  {([10, 30, 60] as AvailabilityDuration[]).map((d) => (
                    <button key={d} onClick={() => setAvailabilityDuration(d)} className={`rounded-md px-2 py-1 text-[0.65rem] font-semibold transition-colors ${availabilityDuration === d ? 'bg-[var(--accent)] text-white' : 'border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]'}`}>
                      {d === 60 ? '1hr' : `${d}m`}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Wait for someone to join.{friends.length > 0 ? ` ${friends.length} friend${friends.length > 1 ? 's' : ''} will be notified.` : ' You\'ll get a push notification.'}
              </p>
              <button onClick={handleGoAvailable} disabled={!myRoomId} className="w-full rounded-xl bg-[var(--success)] px-4 py-3 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">Go Available</button>
            </div>

            {/* Link management */}
            <div className="flex items-center gap-2 px-1">
              {myRoomId ? (
                <>
                  <div className="flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">{getMeetingLink(myRoomId)}</div>
                  <button onClick={copyLink} className={`shrink-0 rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors ${copied ? 'text-[var(--success)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>{copied ? 'Copied!' : 'Copy'}</button>
                  <button onClick={regenerateLink} className="shrink-0 rounded-lg px-2.5 py-2 text-xs text-[var(--muted)] hover:text-[var(--ink)]">New</button>
                </>
              ) : (
                <div className="h-8 flex-1 animate-pulse rounded-lg bg-[var(--glass)]" />
              )}
            </div>

            {/* Friends section */}
            <div className="flex w-full flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-5">
              <div className="flex items-center justify-between">
                <button onClick={() => setFriendsOpen(p => !p)} className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <svg className={`h-3.5 w-3.5 transition-transform ${friendsOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                  Friends{friends.length > 0 && ` (${friends.length})`}
                  {friendRequests.length > 0 && <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[0.6rem] font-bold text-white">{friendRequests.length}</span>}
                </button>
                <button onClick={handleCopyFriendLink} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${friendLinkCopied ? 'text-[var(--success)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>
                  {friendLinkCopied ? 'Link Copied!' : 'Add Friend'}
                </button>
              </div>

              {friendsOpen && (
                <div className="flex flex-col gap-2">
                  {friendsLoading && <p className="text-xs text-[var(--muted)]">Loading...</p>}

                  {friendRequests.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-medium text-[var(--muted)]">Pending requests</p>
                      {friendRequests.map((req) => (
                        <div key={req.fromUserId} className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
                          <span className="text-sm text-[var(--ink)]">{req.fromLogin || req.fromUserId.slice(0, 8)}</span>
                          <div className="flex gap-1.5">
                            <button onClick={() => handleAcceptFriend(req.fromUserId)} className="rounded-md bg-[var(--success)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">Accept</button>
                            <button onClick={() => handleDeclineFriend(req.fromUserId)} className="rounded-md border border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--ink)]">Decline</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {friends.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {friendRequests.length > 0 && <p className="mt-1 text-xs font-medium text-[var(--muted)]">Friends</p>}
                      {friends.map((f) => (
                        <div key={f.userId} className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
                          <span className="text-sm text-[var(--ink)]">{f.login || f.userId.slice(0, 8)}</span>
                          <button onClick={() => handleRemoveFriend(f.userId)} className="text-xs text-[var(--muted)] hover:text-[var(--error)]">Remove</button>
                        </div>
                      ))}
                    </div>
                  ) : !friendsLoading && friendRequests.length === 0 && (
                    <p className="text-xs text-[var(--muted)]">No friends yet. Share your friend link to get started.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}
