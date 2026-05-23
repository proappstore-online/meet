import { useState, useEffect, useCallback, useRef } from 'react'
import { initApp } from '@freeappstore/sdk'
import type { User, Room, RoomPeer, ConnectionState } from '@freeappstore/sdk'
import { Shell } from './components/Shell.tsx'
import { VideoTile } from './components/VideoTile.tsx'
import { useWebRTC } from './hooks/useWebRTC.ts'
import { generateRoomId, getRoomIdFromUrl, getMeetingLink } from './lib/room.ts'
import { createRawRoom } from './lib/raw-room.ts'

declare const __BUILD_HASH__: string

const fas = initApp({ appId: 'meet' })

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const color =
    state === 'open' ? 'bg-[var(--success)]' :
    state === 'connecting' ? 'bg-[var(--warning)]' :
    state === 'error' ? 'bg-[var(--error)]' :
    'bg-[var(--muted)]'

  const label =
    state === 'open' ? 'Connected' :
    state === 'connecting' ? 'Connecting...' :
    state === 'error' ? 'Error' :
    'Disconnected'

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--glass)] px-3 py-1.5">
      <div className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs text-[var(--muted)]">{label}</span>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)

  // Room state
  const [myRoomId, setMyRoomId] = useState<string | null>(null)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [roomState, setRoomState] = useState<ConnectionState>('closed')
  const [copied, setCopied] = useState(false)
  const [isHost, setIsHost] = useState(false)

  // Availability mode state
  const [availableMode, setAvailableMode] = useState(false)
  const [availableUntil, setAvailableUntil] = useState<number | null>(null)
  const [availableDuration, setAvailableDuration] = useState(10) // minutes
  const [guestWaiting, setGuestWaiting] = useState(false)
  const [peerNames, setPeerNames] = useState<string[]>([])
  const [countdown, setCountdown] = useState('')
  const [guestWaitingForHost, setGuestWaitingForHost] = useState(false)
  const [guestTimedOut, setGuestTimedOut] = useState(false)
  const peerUnsubRef = useRef<(() => void) | null>(null)
  const guestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifiedRef = useRef(false)

  const roomRef = useRef<Room | null>(null)

  // WebRTC — pass room via ref so subscription is immediate (no React state delay)
  const {
    localStream,
    remoteStream,
    callState,
    audioEnabled,
    videoEnabled,
    logs,
    startCall,
    endCall,
    toggleAudio,
    toggleVideo,
    setRoom,
  } = useWebRTC(isHost)

  // Initialize auth
  useEffect(() => {
    fas.auth.init().then(() => setAuthReady(true))
    const unsub = fas.auth.onChange(setUser)
    return unsub
  }, [])

  // Load or create the user's personal room ID from KV
  useEffect(() => {
    if (!user) {
      setMyRoomId(null)
      return
    }
    const controller = new AbortController()
    fas.kv.get<string>('my-room-id', { signal: controller.signal }).then((id) => {
      if (controller.signal.aborted) return
      if (id) {
        setMyRoomId(id)
      } else {
        const newId = generateRoomId()
        fas.kv.set('my-room-id', newId).then(() => {
          if (!controller.signal.aborted) setMyRoomId(newId)
        })
      }
    })
    return () => controller.abort()
  }, [user])

  // Check if we arrived with a ?room= parameter (joining someone else's meeting)
  const urlRoomId = getRoomIdFromUrl()

  /** Regenerate the user's personal meeting link. */
  const regenerateLink = useCallback(async () => {
    if (!user) return
    const newId = generateRoomId()
    await fas.kv.set('my-room-id', newId)
    setMyRoomId(newId)
    setCopied(false)
  }, [user])

  /** Copy the meeting link to clipboard. */
  const copyLink = useCallback(async () => {
    const id = activeRoomId ?? myRoomId
    if (!id) return
    await navigator.clipboard.writeText(getMeetingLink(id))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [myRoomId, activeRoomId])

  /** Join a signaling room and start the call. */
  const joinRoom = useCallback((roomId: string, asHost: boolean) => {
    // Close any existing room
    if (roomRef.current) {
      roomRef.current.close()
    }

    setIsHost(asHost)
    setActiveRoomId(roomId)

    const roomName = `meet-${roomId}`
    const token = fas.auth.token
    if (!token) { console.log('[meet] no auth token!'); return }

    // Use raw WebSocket instead of SDK Room — full logging, no SDK black box
    const logFn = (msg: string) => console.log(`[meet] ${msg}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = createRawRoom('meet', roomName, token, logFn) as any
    roomRef.current = r

    // Subscribe to signaling IMMEDIATELY
    setRoom(r)

    r.onConnectionState((state: ConnectionState) => {
      setRoomState(state)
    })
  }, [])

  /** Start a meeting as host. */
  const handleStartMeeting = useCallback(() => {
    if (!myRoomId || !user) return
    joinRoom(myRoomId, true)
  }, [myRoomId, user, joinRoom])

  /** Join a meeting as guest. */
  const handleJoinMeeting = useCallback(() => {
    if (!urlRoomId || !user) return
    joinRoom(urlRoomId, false)
  }, [urlRoomId, user, joinRoom])

  /** Go available as host — join room but don't start cameras. */
  const handleGoAvailable = useCallback(() => {
    if (!myRoomId || !user) return

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    setAvailableMode(true)
    setGuestWaiting(false)
    setPeerNames([])
    notifiedRef.current = false
    setAvailableUntil(Date.now() + availableDuration * 60 * 1000)

    joinRoom(myRoomId, true)
  }, [myRoomId, user, availableDuration, joinRoom])

  /** Host starts the actual call from available mode. */
  const handleStartFromAvailable = useCallback(() => {
    setAvailableMode(false)
    setAvailableUntil(null)
    setGuestWaiting(false)
    if (peerUnsubRef.current) {
      peerUnsubRef.current()
      peerUnsubRef.current = null
    }
    startCall()
  }, [startCall])

  /** Cancel availability and leave room. */
  const handleCancelAvailable = useCallback(() => {
    setAvailableMode(false)
    setAvailableUntil(null)
    setGuestWaiting(false)
    setPeerNames([])
    if (peerUnsubRef.current) {
      peerUnsubRef.current()
      peerUnsubRef.current = null
    }
    endCall()
    if (roomRef.current) {
      roomRef.current.close()
      roomRef.current = null
    }
    setRoom(null)
    setActiveRoomId(null)
    setRoomState('closed')
  }, [endCall, setRoom])

  /** Guest joins and waits for host to start cameras. */
  const handleGuestJoinAvailable = useCallback(() => {
    if (!urlRoomId || !user) return
    setGuestWaitingForHost(true)
    setGuestTimedOut(false)
    joinRoom(urlRoomId, false)

    // Start 2 minute timeout
    if (guestTimeoutRef.current) clearTimeout(guestTimeoutRef.current)
    guestTimeoutRef.current = setTimeout(() => {
      setGuestTimedOut(true)
    }, 2 * 60 * 1000)
  }, [urlRoomId, user, joinRoom])

  // Track peers in available mode (host) — subscribe to room's onPeers directly
  useEffect(() => {
    if (!availableMode || !roomRef.current) return
    const room = roomRef.current
    notifiedRef.current = false
    const unsub = room.onPeers((peers: RoomPeer[]) => {
      // Filter out self (the host)
      const others = peers.filter(p => p.uid !== user?.id)
      const names = others.map(p => p.login)
      setPeerNames(names)

      if (others.length > 0) {
        setGuestWaiting(true)
        if (!notifiedRef.current) {
          notifiedRef.current = true
          // Browser notification
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Meet', { body: 'Someone wants to talk!' })
          }
        }
      } else {
        setGuestWaiting(false)
        notifiedRef.current = false
      }
    })
    peerUnsubRef.current = unsub
    return () => { unsub(); peerUnsubRef.current = null }
  }, [availableMode, roomState, user?.id]) // re-run when roomState changes to 'open'

  // Guest: detect when host starts cameras (receiving an offer triggers callState change)
  useEffect(() => {
    if (!guestWaitingForHost) return
    if (callState === 'connecting' || callState === 'connected') {
      setGuestWaitingForHost(false)
      if (guestTimeoutRef.current) {
        clearTimeout(guestTimeoutRef.current)
        guestTimeoutRef.current = null
      }
    }
  }, [guestWaitingForHost, callState])

  // Countdown timer for available mode
  useEffect(() => {
    if (!availableUntil) { setCountdown(''); return }
    const tick = () => {
      const remaining = availableUntil - Date.now()
      if (remaining <= 0) {
        handleCancelAvailable()
        return
      }
      const mins = Math.floor(remaining / 60000)
      const secs = Math.floor((remaining % 60000) / 1000)
      setCountdown(`${mins}:${secs.toString().padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [availableUntil, handleCancelAvailable])

  // Cleanup guest timeout on unmount
  useEffect(() => {
    return () => {
      if (guestTimeoutRef.current) clearTimeout(guestTimeoutRef.current)
    }
  }, [])

  /** Start the WebRTC call once the signaling room is open (skip in available mode). */
  useEffect(() => {
    if (roomState === 'open' && callState === 'idle' && activeRoomId && !availableMode && !guestWaitingForHost) {
      startCall()
    }
  }, [roomState, callState, activeRoomId, availableMode, guestWaitingForHost, startCall])

  /** End the meeting and clean up. */
  const handleEndMeeting = useCallback(() => {
    endCall()
    if (roomRef.current) {
      roomRef.current.close()
      roomRef.current = null
    }
    if (peerUnsubRef.current) {
      peerUnsubRef.current()
      peerUnsubRef.current = null
    }
    if (guestTimeoutRef.current) {
      clearTimeout(guestTimeoutRef.current)
      guestTimeoutRef.current = null
    }
    setRoom(null)
    setActiveRoomId(null)
    setRoomState('closed')
    setAvailableMode(false)
    setAvailableUntil(null)
    setGuestWaiting(false)
    setPeerNames([])
    setGuestWaitingForHost(false)
    setGuestTimedOut(false)
    // Remove ?room= from URL if present
    if (urlRoomId) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [endCall, urlRoomId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.close()
      }
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

  // Not signed in
  if (!user) {
    return (
      <Shell user={null} onSignIn={(p) => fas.auth.signIn(p)}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5">
          <h1 className="display-font text-4xl font-bold text-[var(--ink)]">Meet</h1>
          <p className="max-w-xs text-center text-[var(--muted)]">
            Instant 1-on-1 video meetings. Sign in to create your personal meeting link.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => fas.auth.signIn('github')}
              className="rounded-full bg-[var(--ink)] px-6 py-2.5 text-sm font-semibold text-[var(--paper)] hover:opacity-90"
            >
              Sign in with GitHub
            </button>
            <button
              onClick={() => fas.auth.signIn('google')}
              className="rounded-full border border-[var(--line-strong)] bg-[var(--glass)] px-6 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--glass-hover)]"
            >
              Sign in with Google
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // Host: available mode screen — room is open but cameras are not started
  if (activeRoomId && availableMode) {
    return (
      <Shell user={user} onSignIn={(p) => fas.auth.signIn(p)} onSignOut={() => fas.auth.signOut()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--success)]/15">
              <div className="h-4 w-4 animate-pulse rounded-full bg-[var(--success)]" />
            </div>
            <h2 className="display-font text-2xl font-bold text-[var(--ink)]">You're Available</h2>
            <p className="text-sm text-[var(--muted)]">Waiting for someone to join...</p>
          </div>

          {/* Countdown */}
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono text-3xl font-bold text-[var(--ink)]">{countdown}</span>
            <span className="text-xs text-[var(--muted)]">remaining</span>
          </div>

          {/* Connection status */}
          <ConnectionBadge state={roomState} />

          {/* Guest waiting alert */}
          {guestWaiting && (
            <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border-2 border-[var(--success)] bg-[var(--success)]/10 p-6">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 animate-pulse rounded-full bg-[var(--success)]" />
                <span className="text-base font-bold text-[var(--ink)]">
                  {peerNames.length === 1 ? `${peerNames[0]} wants to talk` : 'Someone wants to talk'}
                </span>
              </div>
              <button
                onClick={handleStartFromAvailable}
                className="w-full rounded-xl bg-[var(--success)] px-6 py-4 text-lg font-bold text-white hover:opacity-90"
              >
                Start Call
              </button>
            </div>
          )}

          {/* Copy link + Cancel */}
          <div className="flex w-full max-w-sm flex-col gap-3">
            <button
              onClick={copyLink}
              className={`w-full rounded-xl border border-[var(--line)] px-6 py-3 text-sm font-semibold transition-colors ${
                copied
                  ? 'border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]'
                  : 'bg-[var(--glass)] text-[var(--ink)] hover:bg-[var(--glass-hover)]'
              }`}
            >
              {copied ? 'Link Copied!' : 'Copy Meeting Link'}
            </button>
            <button
              onClick={handleCancelAvailable}
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--glass)] px-6 py-3 text-sm font-semibold text-[var(--muted)] hover:border-[var(--error)] hover:text-[var(--error)]"
            >
              Cancel
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // Guest: waiting for host to start cameras
  if (activeRoomId && guestWaitingForHost) {
    return (
      <Shell user={user} onSignIn={(p) => fas.auth.signIn(p)} onSignOut={() => fas.auth.signOut()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
          {guestTimedOut ? (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--error)]/15">
                <svg className="h-8 w-8 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <h2 className="display-font text-xl font-bold text-[var(--ink)]">Host didn't respond</h2>
              <p className="max-w-xs text-center text-sm text-[var(--muted)]">
                Try again later or ask the host to start a meeting.
              </p>
              <button
                onClick={handleEndMeeting}
                className="rounded-xl border border-[var(--line)] bg-[var(--glass)] px-6 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--glass-hover)]"
              >
                Go Back
              </button>
            </>
          ) : (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)]/15">
                <div className="h-4 w-4 animate-pulse rounded-full bg-[var(--accent)]" />
              </div>
              <h2 className="display-font text-xl font-bold text-[var(--ink)]">Host has been notified</h2>
              <p className="max-w-xs text-center text-sm text-[var(--muted)]">
                Please wait while the host starts the call...
              </p>
              <ConnectionBadge state={roomState} />
              <button
                onClick={handleEndMeeting}
                className="rounded-xl border border-[var(--line)] bg-[var(--glass)] px-6 py-3 text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Leave
              </button>
            </>
          )}
        </div>
      </Shell>
    )
  }

  // Active meeting — full-screen on mobile, no shell chrome
  if (activeRoomId) {
    return (
      <div className="relative flex h-[100dvh] flex-col bg-black">
        {/* Video area */}
        <div className="relative flex-1">
          {/* Remote video — full area */}
          <VideoTile
            stream={remoteStream}
            label={callState === 'peer-left' ? 'Disconnected' : 'Peer'}
            fill
          />

          {/* Local video — PIP overlay */}
          <div className="absolute right-3 top-3 z-10 w-24 overflow-hidden rounded-xl border-2 border-white/20 shadow-lg sm:w-36">
            <VideoTile stream={localStream} muted mirrored label="You" />
          </div>

          {/* Status bar */}
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
            <ConnectionBadge state={roomState} />
            {callState !== 'idle' && callState !== 'connected' && (
              <span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-medium backdrop-blur-sm ${
                callState === 'error' || callState === 'peer-left'
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-yellow-500/20 text-yellow-300'
              }`}>
                {callState === 'waiting' ? 'Waiting...' :
                 callState === 'connecting' ? 'Connecting...' :
                 callState === 'error' ? 'Camera error' :
                 'Peer left'}
              </span>
            )}
          </div>

          {/* Error banner */}
          {callState === 'error' && (
            <div className="absolute inset-x-3 top-14 z-10 flex items-center justify-between rounded-xl bg-red-500/90 px-4 py-2 backdrop-blur-sm">
              <span className="text-xs text-white">Camera/mic blocked</span>
              <button onClick={startCall} className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold text-white">Retry</button>
            </div>
          )}
        </div>

        {/* Controls bar */}
        <div className="flex items-center justify-center gap-4 bg-black/80 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl">
          {/* Mute */}
          <button
            onClick={toggleAudio}
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              audioEnabled ? 'bg-white/10 text-white' : 'bg-red-500/80 text-white'
            }`}
          >
            {audioEnabled ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m18.364 18.364-2.172-2.172M15.536 15.536 12 12m0 0L8.464 8.464M12 12l3.536-3.536M12 12 8.464 15.536m-2.172 2.172L4.93 19.07M12 18.75a6 6 0 0 0 4.243-1.757M12 18.75a6 6 0 0 1-4.243-1.757M12 18.75v3.75m-3.75 0h7.5M3 3l18 18" />
              </svg>
            )}
          </button>

          {/* Camera */}
          <button
            onClick={toggleVideo}
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              videoEnabled ? 'bg-white/10 text-white' : 'bg-red-500/80 text-white'
            }`}
          >
            {videoEnabled ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9.75a2.25 2.25 0 0 0 2.25-2.25V7.5a2.25 2.25 0 0 0-2.25-2.25H4.5A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-.409L12 15.75M2.25 9V7.5a2.25 2.25 0 0 1 2.25-2.25h9.75M3 3l18 18" />
              </svg>
            )}
          </button>

          {/* Copy link */}
          <button
            onClick={copyLink}
            className={`flex h-12 w-12 items-center justify-center rounded-full ${
              copied ? 'bg-green-500/80 text-white' : 'bg-white/10 text-white'
            }`}
          >
            {copied ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.556a4.5 4.5 0 0 0-1.242-7.244l-4.5-4.5a4.5 4.5 0 0 0-6.364 6.364L4.5 8.813" />
              </svg>
            )}
          </button>

          {/* End call */}
          <button
            onClick={handleEndMeeting}
            className="flex h-12 w-16 items-center justify-center rounded-full bg-red-500 text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 3.75 18 6m0 0 2.25 2.25M18 6l2.25-2.25M18 6l-2.25 2.25m1.5 13.5c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 0 1 6.75 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 0 0-.38 1.21 12.035 12.035 0 0 0 7.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 0 1 1.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 0 1-2.25 2.25h-2.25Z" />
            </svg>
          </button>
        </div>

        {/* Debug log — collapsed by default */}
        {logs.length > 0 && (
          <details className="absolute bottom-20 left-2 right-2 z-20 rounded-xl border border-white/10 bg-black/90 backdrop-blur-xl">
            <summary className="cursor-pointer px-3 py-1.5 text-[0.6rem] font-semibold text-white/50">
              {__BUILD_HASH__} | {isHost ? 'H' : 'G'} | {roomState}
            </summary>
            <div className="flex justify-end px-3">
              <button
                onClick={() => { navigator.clipboard.writeText(logs.join('\n')); alert('Copied!') }}
                className="rounded border border-white/20 px-2 py-0.5 text-[0.6rem] text-white/50"
              >
                Copy
              </button>
            </div>
            <div className="max-h-32 overflow-y-auto px-3 pb-2">
              {logs.map((line, i) => (
                <div key={i} className="font-mono text-[0.55rem] leading-tight text-white/40">{line}</div>
              ))}
            </div>
          </details>
        )}
      </div>
    )
  }

  // Lobby — user is signed in, no active meeting
  // Show join flow whenever ?room= is present (even if it's your own link)
  const isJoining = !!urlRoomId

  return (
    <Shell user={user} onSignIn={(p) => fas.auth.signIn(p)} onSignOut={() => fas.auth.signOut()}>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8">
        <h1 className="display-font text-4xl font-bold text-[var(--ink)]">Meet</h1>

        {isJoining ? (
          /* Guest join flow */
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-6">
            <p className="text-center text-sm text-[var(--muted)]">
              You have been invited to a meeting
            </p>
            <span className="rounded-lg bg-[var(--paper)] px-3 py-1 font-mono text-sm text-[var(--ink)]">{urlRoomId}</span>
            <button
              onClick={handleJoinMeeting}
              className="w-full rounded-xl bg-[var(--success)] px-6 py-3.5 text-base font-bold text-white hover:opacity-90"
            >
              Join Meeting
            </button>
            <button
              onClick={handleGuestJoinAvailable}
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--glass)] px-6 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--glass-hover)]"
            >
              Join &amp; Wait for Host
            </button>
          </div>
        ) : (
          /* Host flow */
          <>
            {/* Meeting link card */}
            <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Your meeting link
                </span>
                <button
                  onClick={regenerateLink}
                  className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[0.65rem] font-medium text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                  title="Generate a new link"
                >
                  Regenerate
                </button>
              </div>

              {myRoomId ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)]">
                    {getMeetingLink(myRoomId)}
                  </div>
                  <button
                    onClick={copyLink}
                    className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                      copied
                        ? 'bg-[var(--success)]/15 text-[var(--success)]'
                        : 'bg-[var(--ink)] text-[var(--paper)] hover:opacity-90'
                    }`}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              ) : (
                <div className="h-10 animate-pulse rounded-lg bg-[var(--glass)]" />
              )}

              <p className="text-xs text-[var(--muted)]">
                Share this link with anyone to invite them to a video meeting.
              </p>
            </div>

            {/* Duration selector for Go Available */}
            <div className="flex w-full max-w-sm items-center justify-center gap-2">
              <span className="text-xs text-[var(--muted)]">Available for</span>
              {[10, 30, 60].map((mins) => (
                <button
                  key={mins}
                  onClick={() => setAvailableDuration(mins)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    availableDuration === mins
                      ? 'bg-[var(--success)]/15 text-[var(--success)] border border-[var(--success)]'
                      : 'border border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]'
                  }`}
                >
                  {mins < 60 ? `${mins}m` : '1hr'}
                </button>
              ))}
            </div>

            {/* Go Available button */}
            <button
              onClick={handleGoAvailable}
              disabled={!myRoomId}
              className="w-full max-w-sm rounded-xl bg-[var(--success)] px-6 py-4 text-lg font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Go Available
            </button>

            {/* Start meeting button — secondary */}
            <button
              onClick={handleStartMeeting}
              disabled={!myRoomId}
              className="w-full max-w-sm rounded-xl border border-[var(--line)] bg-[var(--glass)] px-6 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--glass-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start Meeting Now
            </button>
          </>
        )}
      </div>
    </Shell>
  )
}
