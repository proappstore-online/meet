import { useRef, useState, useCallback, useEffect } from 'react'
import type { Room, RoomMessage } from '@proappstore/sdk'

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

interface SignalOffer { type: 'offer'; sdp: string }
interface SignalAnswer { type: 'answer'; sdp: string }
interface SignalCandidate { type: 'candidate'; candidate: RTCIceCandidateInit }
interface SignalRequestOffer { type: 'request-offer' }
type SignalMessage = SignalOffer | SignalAnswer | SignalCandidate | SignalRequestOffer

export type CallState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'error' | 'peer-left'

export function useWebRTC(isHost: boolean) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [callState, setCallState] = useState<CallState>('idle')
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [logs, setLogs] = useState<string[]>([])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const localStreamRef = useRef<MediaStream | null>(null)
  const startingRef = useRef(false)
  const offerRetryRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const roomRef = useRef<Room | null>(null)
  const unsubMessageRef = useRef<(() => void) | null>(null)
  const unsubPeersRef = useRef<(() => void) | null>(null)
  const isHostRef = useRef(isHost)
  isHostRef.current = isHost

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 1 })
    const entry = `[${ts}] ${msg}`
    console.log(`[meet] ${msg}`)
    setLogs(prev => [...prev.slice(-49), entry])
  }, [])

  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) return
    const count = pendingCandidatesRef.current.length
    for (const c of pendingCandidatesRef.current) {
      await pc.addIceCandidate(new RTCIceCandidate(c))
    }
    pendingCandidatesRef.current = []
    if (count > 0) log(`flushed ${count} queued ICE candidates`)
  }, [log])

  const acquireMedia = useCallback(async (): Promise<MediaStream> => {
    log('requesting camera+mic...')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      log(`got media: ${s.getTracks().map(t => t.kind).join(', ')}`)
      return s
    } catch (e) {
      if (e instanceof DOMException && e.name !== 'NotAllowedError') {
        log(`camera failed (${e.name}), trying audio-only...`)
        const s = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
        log('got audio-only stream')
        return s
      }
      throw e
    }
  }, [log])

  const createPeerConnection = useCallback(() => {
    if (pcRef.current) {
      log('closing previous PC')
      pcRef.current.close()
    }

    const pc = new RTCPeerConnection(ICE_SERVERS)
    pcRef.current = pc
    log('created RTCPeerConnection')

    pc.onicecandidate = (e) => {
      if (e.candidate && roomRef.current) {
        roomRef.current.send<SignalMessage>({ type: 'candidate', candidate: e.candidate.toJSON() })
      }
    }

    pc.oniceconnectionstatechange = () => {
      log(`ICE state: ${pc.iceConnectionState}`)
    }

    const remote = new MediaStream()
    setRemoteStream(remote)
    pc.ontrack = (e) => {
      log(`got remote track: ${e.track.kind}`)
      remote.addTrack(e.track)
      setRemoteStream(new MediaStream(remote.getTracks()))
    }

    pc.onconnectionstatechange = () => {
      log(`PC state: ${pc.connectionState}`)
      if (pc.connectionState === 'connected') {
        setCallState('connected')
      } else if (pc.connectionState === 'failed') {
        setCallState('error')
      } else if (pc.connectionState === 'disconnected') {
        setTimeout(() => {
          if (pc.connectionState === 'disconnected') {
            setCallState('peer-left')
          }
        }, 3000)
      }
    }

    pc.onsignalingstatechange = () => {
      log(`signaling state: ${pc.signalingState}`)
    }

    return pc
  }, [log])

  /** Handle an incoming signaling message. Called synchronously from Room subscription. */
  const handleMessage = useCallback((msg: RoomMessage<SignalMessage>) => {
    const data = msg.data
    const room = roomRef.current
    if (!room) return
    log(`recv: ${data.type} from ${msg.from.login}`)
    ;(async () => {
      try {
        if (data.type === 'offer') {
          if (offerRetryRef.current) {
            clearInterval(offerRetryRef.current)
            offerRetryRef.current = null
          }
          let pc = pcRef.current
          if (!pc || pc.signalingState === 'closed') {
            log('no PC or closed — creating new one for offer')
            if (!localStreamRef.current) {
              try {
                const stream = await acquireMedia()
                localStreamRef.current = stream
                setLocalStream(stream)
                setVideoEnabled(stream.getVideoTracks().length > 0)
              } catch (e) {
                log(`getUserMedia failed in offer handler: ${e}`)
                setCallState('error')
                return
              }
            }
            pc = createPeerConnection()
            for (const track of localStreamRef.current!.getTracks()) {
              pc.addTrack(track, localStreamRef.current!)
            }
            log(`added ${localStreamRef.current!.getTracks().length} tracks to new PC`)
          }
          log(`setting remote desc (offer), signalingState=${pc.signalingState}`)
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
          await flushCandidates()
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          room.send<SignalMessage>({ type: 'answer', sdp: answer.sdp! })
          log('sent answer')
          setCallState('connecting')
        } else if (data.type === 'answer') {
          const pc = pcRef.current
          if (!pc) { log('recv answer but no PC'); return }
          log(`setting remote desc (answer), signalingState=${pc.signalingState}`)
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
          await flushCandidates()
          log('answer applied')
          setCallState('connecting')
        } else if (data.type === 'request-offer') {
          const pc = pcRef.current
          if (!pc) { log('recv request-offer but no PC — ignoring'); return }
          if (pc.connectionState === 'connected') { log('recv request-offer but already connected'); return }
          log(`responding to request-offer, signalingState=${pc.signalingState}`)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          room.send<SignalMessage>({ type: 'offer', sdp: offer.sdp! })
          log('sent offer (in response to request)')
        } else if (data.type === 'candidate') {
          const pc = pcRef.current
          if (!pc) { log('recv candidate but no PC'); return }
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
          } else {
            pendingCandidatesRef.current.push(data.candidate)
            log(`queued ICE candidate (${pendingCandidatesRef.current.length} pending)`)
          }
        }
      } catch (e) {
        log(`signaling error: ${e}`)
      }
    })()
  }, [createPeerConnection, flushCandidates, acquireMedia, log])

  /** Set the room and subscribe to messages IMMEDIATELY (no React state delay). */
  const setRoom = useCallback((room: Room | null) => {
    // Cleanup old subscriptions
    if (unsubMessageRef.current) { unsubMessageRef.current(); unsubMessageRef.current = null }
    if (unsubPeersRef.current) { unsubPeersRef.current(); unsubPeersRef.current = null }

    roomRef.current = room
    if (!room) { log('room cleared'); return }

    log(`setRoom: subscribing (state=${room.state})`)

    // Subscribe SYNCHRONOUSLY — no waiting for React render
    unsubMessageRef.current = room.onMessage<SignalMessage>((msg) => {
      handleMessage(msg)
    })

    unsubPeersRef.current = room.onPeers((peers) => {
      log(`peers: [${peers.map(p => p.login).join(', ')}]`)
    })

    log('setRoom: subscribed to messages + peers')
  }, [handleMessage, log])

  const startCall = useCallback(async () => {
    const room = roomRef.current
    if (!room || startingRef.current) return
    startingRef.current = true
    log(`startCall as ${isHostRef.current ? 'HOST' : 'GUEST'}`)

    setCallState('waiting')

    let stream: MediaStream
    try {
      stream = await acquireMedia()
    } catch (e) {
      log(`getUserMedia failed: ${e}`)
      setCallState('error')
      startingRef.current = false
      return
    }
    localStreamRef.current = stream
    setLocalStream(stream)
    setVideoEnabled(stream.getVideoTracks().length > 0)

    const pc = createPeerConnection()

    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream)
    }
    log(`added ${stream.getTracks().length} local tracks to PC`)

    if (isHostRef.current) {
      log('host ready, waiting for guest request-offer')
      setCallState('waiting')
    } else {
      room.send<SignalMessage>({ type: 'request-offer' })
      log('sent request-offer')
      if (offerRetryRef.current) clearInterval(offerRetryRef.current)
      offerRetryRef.current = setInterval(() => {
        const r = roomRef.current
        if (!r || pcRef.current?.remoteDescription) {
          if (offerRetryRef.current) clearInterval(offerRetryRef.current)
          offerRetryRef.current = null
          log('stopped request-offer retry (got remote desc)')
          return
        }
        r.send<SignalMessage>({ type: 'request-offer' })
        log('retried request-offer')
      }, 2000)
      setCallState('connecting')
    }
    startingRef.current = false
  }, [createPeerConnection, acquireMedia, log])

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setAudioEnabled(audioTrack.enabled)
      }
    }
  }, [])

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setVideoEnabled(videoTrack.enabled)
      }
    }
  }, [])

  const endCall = useCallback(() => {
    startingRef.current = false
    if (offerRetryRef.current) {
      clearInterval(offerRetryRef.current)
      offerRetryRef.current = null
    }
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop()
      }
      localStreamRef.current = null
    }
    pendingCandidatesRef.current = []
    setLocalStream(null)
    setRemoteStream(null)
    setCallState('idle')
    setAudioEnabled(true)
    setVideoEnabled(true)
    setLogs([])
  }, [])

  // Warn before closing tab during active call
  useEffect(() => {
    if (callState !== 'connected' && callState !== 'waiting' && callState !== 'connecting') return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [callState])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (offerRetryRef.current) clearInterval(offerRetryRef.current)
      if (unsubMessageRef.current) unsubMessageRef.current()
      if (unsubPeersRef.current) unsubPeersRef.current()
      if (pcRef.current) pcRef.current.close()
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          track.stop()
        }
      }
    }
  }, [])

  return {
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
    log,
  }
}
