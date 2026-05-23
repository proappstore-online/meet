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
interface SignalChat { type: 'chat'; text: string }
interface SignalHandRaise { type: 'hand-raise'; raised: boolean }
interface SignalReaction { type: 'reaction'; emoji: string }
type SignalMessage = SignalOffer | SignalAnswer | SignalCandidate | SignalRequestOffer | SignalChat | SignalHandRaise | SignalReaction

export interface ChatMessage { from: string; text: string; at: number; isMine: boolean }
export interface Reaction { id: string; emoji: string; at: number }

export type CallState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'error' | 'peer-left'

export function useWebRTC(isHost: boolean) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [callState, setCallState] = useState<CallState>('idle')
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [peerHandRaised, setPeerHandRaised] = useState(false)
  const [myHandRaised, setMyHandRaised] = useState(false)
  const [reactions, setReactions] = useState<Reaction[]>([])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const localStreamRef = useRef<MediaStream | null>(null)
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null)
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
        } else if (data.type === 'chat') {
          setChatMessages(prev => [...prev.slice(-99), { from: msg.from.login, text: data.text, at: Date.now(), isMine: false }])
        } else if (data.type === 'hand-raise') {
          setPeerHandRaised(data.raised)
        } else if (data.type === 'reaction') {
          const r: Reaction = { id: Math.random().toString(36).slice(2, 8), emoji: data.emoji, at: Date.now() }
          setReactions(prev => [...prev, r])
          setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000)
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

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !localStreamRef.current) return

    if (screenSharing) {
      // Stop screen share, restore camera
      const screenTrack = localStreamRef.current.getVideoTracks()[0]
      if (screenTrack) screenTrack.stop()

      if (cameraTrackRef.current) {
        // Replace screen track with camera track on the peer connection
        const sender = pc.getSenders().find(s => s.track?.kind === 'video' || (s.track === null && s !== pc.getSenders().find(ss => ss.track?.kind === 'audio')))
        if (sender) await sender.replaceTrack(cameraTrackRef.current)

        // Update local stream
        localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0])
        localStreamRef.current.addTrack(cameraTrackRef.current)
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      }
      setScreenSharing(false)
      log('stopped screen share, restored camera')
    } else {
      // Start screen share
      let screenStream: MediaStream
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      } catch {
        log('screen share cancelled or denied')
        return
      }

      const screenTrack = screenStream.getVideoTracks()[0]
      if (!screenTrack) return

      // Save camera track for later restoration
      const currentVideoTrack = localStreamRef.current.getVideoTracks()[0]
      if (currentVideoTrack) cameraTrackRef.current = currentVideoTrack

      // Replace camera track with screen track on the peer connection
      const sender = pc.getSenders().find(s => s.track?.kind === 'video')
      if (sender) await sender.replaceTrack(screenTrack)

      // Update local stream
      if (currentVideoTrack) localStreamRef.current.removeTrack(currentVideoTrack)
      localStreamRef.current.addTrack(screenTrack)
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))

      // When user stops sharing via browser UI, auto-restore camera
      screenTrack.onended = () => {
        toggleScreenShare()
      }

      setScreenSharing(true)
      log('started screen share')
    }
  }, [screenSharing, log])

  const sendChat = useCallback((text: string) => {
    const room = roomRef.current
    if (!room) return
    room.send<SignalMessage>({ type: 'chat', text })
    setChatMessages(prev => [...prev.slice(-99), { from: 'You', text, at: Date.now(), isMine: true }])
  }, [])

  const toggleHandRaise = useCallback(() => {
    setMyHandRaised(prev => {
      const next = !prev
      const room = roomRef.current
      if (room) room.send<SignalMessage>({ type: 'hand-raise', raised: next })
      return next
    })
  }, [])

  const sendReaction = useCallback((emoji: string) => {
    const room = roomRef.current
    if (room) room.send<SignalMessage>({ type: 'reaction', emoji })
    const r: Reaction = { id: Math.random().toString(36).slice(2, 8), emoji, at: Date.now() }
    setReactions(prev => [...prev, r])
    setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000)
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
    cameraTrackRef.current = null
    setCallState('idle')
    setAudioEnabled(true)
    setVideoEnabled(true)
    setScreenSharing(false)
    setLogs([])
    setChatMessages([])
    setPeerHandRaised(false)
    setMyHandRaised(false)
    setReactions([])
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
    screenSharing,
    chatMessages,
    peerHandRaised,
    myHandRaised,
    reactions,
    startCall,
    endCall,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    sendChat,
    toggleHandRaise,
    sendReaction,
    setRoom,
    log,
  }
}
