import { useState, useEffect, useCallback, useRef } from 'react'
import { initApp } from '@freeappstore/sdk'
import type { User, Room, ConnectionState } from '@freeappstore/sdk'
import { Shell } from './components/Shell.tsx'
import { VideoTile } from './components/VideoTile.tsx'
import { useWebRTC } from './hooks/useWebRTC.ts'
import { generateRoomId, getRoomIdFromUrl, getMeetingLink } from './lib/room.ts'
import { createRawRoom } from './lib/raw-room.ts'

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

  /** Start the WebRTC call once the signaling room is open. */
  useEffect(() => {
    if (roomState === 'open' && callState === 'idle' && activeRoomId) {
      startCall()
    }
  }, [roomState, callState, activeRoomId, startCall])

  /** End the meeting and clean up. */
  const handleEndMeeting = useCallback(() => {
    endCall()
    if (roomRef.current) {
      roomRef.current.close()
      roomRef.current = null
    }
    setRoom(null)
    setActiveRoomId(null)
    setRoomState('closed')
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

  // Active meeting
  if (activeRoomId) {
    return (
      <Shell user={user} onSignIn={(p) => fas.auth.signIn(p)} onSignOut={() => fas.auth.signOut()}>
        <div className="flex flex-1 flex-col gap-4 py-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="display-font text-xl font-bold text-[var(--ink)]">Meeting</h1>
              <span className="rounded-lg bg-[var(--glass)] px-2 py-0.5 font-mono text-xs text-[var(--muted)]">{activeRoomId}</span>
              <ConnectionBadge state={roomState} />
            </div>
            <div className="flex items-center gap-2">
              {callState !== 'idle' && (
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  callState === 'error' || callState === 'peer-left'
                    ? 'bg-[var(--error)]/15 text-[var(--error)]'
                    : callState === 'connected'
                    ? 'bg-[var(--success)]/15 text-[var(--success)]'
                    : 'bg-[var(--warning)]/15 text-[var(--warning)]'
                }`}>
                  {callState === 'waiting' ? 'Waiting for peer...' :
                   callState === 'connecting' ? 'Connecting...' :
                   callState === 'error' ? 'Camera/mic error' :
                   callState === 'peer-left' ? 'Peer disconnected' :
                   'Connected'}
                </span>
              )}
              <button
                onClick={copyLink}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  copied
                    ? 'border-[var(--success)]/30 bg-[var(--success)]/15 text-[var(--success)]'
                    : 'border-[var(--line-strong)] bg-[var(--glass)] text-[var(--muted)] hover:text-[var(--ink)]'
                }`}
                title={getMeetingLink(activeRoomId)}
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          </div>

          {/* Error / peer-left banner */}
          {callState === 'error' && (
            <div className="flex items-center justify-between rounded-xl border border-[var(--error)]/30 bg-[var(--error)]/10 px-4 py-3">
              <span className="text-sm text-[var(--error)]">Could not access camera or microphone. Check browser permissions.</span>
              <button
                onClick={startCall}
                className="shrink-0 rounded-lg bg-[var(--error)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Retry
              </button>
            </div>
          )}
          {callState === 'peer-left' && (
            <div className="flex items-center justify-center rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3">
              <span className="text-sm text-[var(--warning)]">The other person disconnected. They can rejoin using the same link.</span>
            </div>
          )}

          {/* Video grid */}
          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
            <VideoTile
              stream={localStream}
              muted
              mirrored
              label="You"
            />
            <VideoTile
              stream={remoteStream}
              label={callState === 'peer-left' ? 'Disconnected' : 'Peer'}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-3 py-2">
            <button
              onClick={toggleAudio}
              className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors ${
                audioEnabled
                  ? 'border-[var(--line-strong)] bg-[var(--glass)] text-[var(--ink)] hover:bg-[var(--glass-hover)]'
                  : 'border-[var(--error)]/30 bg-[var(--error)]/15 text-[var(--error)]'
              }`}
              title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
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

            <button
              onClick={toggleVideo}
              className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors ${
                videoEnabled
                  ? 'border-[var(--line-strong)] bg-[var(--glass)] text-[var(--ink)] hover:bg-[var(--glass-hover)]'
                  : 'border-[var(--error)]/30 bg-[var(--error)]/15 text-[var(--error)]'
              }`}
              title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
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

            <button
              onClick={handleEndMeeting}
              className="flex h-12 w-20 items-center justify-center rounded-full bg-[var(--error)] text-sm font-semibold text-white hover:opacity-90"
            >
              End
            </button>
          </div>

          {/* Debug log */}
          {logs.length > 0 && (
            <details open className="rounded-xl border border-[var(--line)] bg-[var(--panel)]">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                Debug log ({logs.length})
              </summary>
              <div className="flex justify-end px-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(logs.join('\n'))
                    alert('Logs copied!')
                  }}
                  className="rounded border border-[var(--line)] px-2 py-0.5 text-[0.6rem] font-medium text-[var(--muted)] hover:text-[var(--ink)]"
                >
                  Copy logs
                </button>
              </div>
              <div className="px-3 py-1 font-mono text-[0.6rem] text-[var(--ink)] border-b border-[var(--line)]">
                room: meet-{activeRoomId} | role: {isHost ? 'HOST' : 'GUEST'} | myRoom: {myRoomId} | urlRoom: {urlRoomId ?? 'none'} | ws: {roomState}
              </div>
              <div className="max-h-40 overflow-y-auto px-3 pb-2">
                {logs.map((line, i) => (
                  <div key={i} className="font-mono text-[0.6rem] leading-tight text-[var(--muted)]">{line}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      </Shell>
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

            {/* Start meeting button */}
            <button
              onClick={handleStartMeeting}
              disabled={!myRoomId}
              className="w-full max-w-sm rounded-xl bg-[var(--accent)] px-6 py-4 text-lg font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start Meeting
            </button>
          </>
        )}
      </div>
    </Shell>
  )
}
