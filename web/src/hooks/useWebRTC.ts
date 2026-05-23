import { useRef, useState, useCallback, useEffect } from 'react'
import type { Room, RoomMessage } from '@freeappstore/sdk'

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

/** Signaling message types sent through the SDK room. */
interface SignalOffer {
  type: 'offer'
  sdp: string
}

interface SignalAnswer {
  type: 'answer'
  sdp: string
}

interface SignalCandidate {
  type: 'candidate'
  candidate: RTCIceCandidateInit
}

type SignalMessage = SignalOffer | SignalAnswer | SignalCandidate

export type CallState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'error'

export function useWebRTC(room: Room | null, isHost: boolean) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [callState, setCallState] = useState<CallState>('idle')
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const localStreamRef = useRef<MediaStream | null>(null)
  const startingRef = useRef(false)

  /** Flush any ICE candidates queued before remote description was set. */
  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !pc.remoteDescription) return
    for (const c of pendingCandidatesRef.current) {
      await pc.addIceCandidate(new RTCIceCandidate(c))
    }
    pendingCandidatesRef.current = []
  }, [])

  /** Create the RTCPeerConnection and wire its events. */
  const createPeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close()
    }

    const pc = new RTCPeerConnection(ICE_SERVERS)
    pcRef.current = pc

    // Send ICE candidates to the other peer via the signaling room.
    pc.onicecandidate = (e) => {
      if (e.candidate && room) {
        room.send<SignalMessage>({ type: 'candidate', candidate: e.candidate.toJSON() })
      }
    }

    // Receive remote tracks.
    const remote = new MediaStream()
    setRemoteStream(remote)
    pc.ontrack = (e) => {
      remote.addTrack(e.track)
      // Force a re-render when the remote stream changes.
      setRemoteStream(new MediaStream(remote.getTracks()))
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setCallState('connected')
      } else if (pc.connectionState === 'failed') {
        setCallState('error')
      }
    }

    return pc
  }, [room])

  /** Acquire camera+mic with audio-only fallback. */
  const acquireMedia = useCallback(async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    } catch (e) {
      // Camera might be unavailable — try audio-only.
      if (e instanceof DOMException && e.name !== 'NotAllowedError') {
        return await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
      }
      throw e
    }
  }, [])

  /** Start the call: acquire media, create PC, and if host send an offer. */
  const startCall = useCallback(async () => {
    if (!room || startingRef.current) return
    startingRef.current = true

    setCallState('waiting')

    let stream: MediaStream
    try {
      stream = await acquireMedia()
    } catch {
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

    if (isHost) {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      room.send<SignalMessage>({ type: 'offer', sdp: offer.sdp! })
      setCallState('waiting')
    } else {
      setCallState('connecting')
    }
    startingRef.current = false
  }, [room, isHost, createPeerConnection, acquireMedia])

  /** Handle incoming signaling messages from the room. */
  useEffect(() => {
    if (!room) return

    const unsub = room.onMessage<SignalMessage>((msg: RoomMessage<SignalMessage>) => {
      const data = msg.data
      ;(async () => {
        try {
          if (data.type === 'offer') {
            let pc = pcRef.current
            if (!pc || pc.signalingState === 'closed') {
              if (!localStreamRef.current) {
                try {
                  const stream = await acquireMedia()
                  localStreamRef.current = stream
                  setLocalStream(stream)
                  setVideoEnabled(stream.getVideoTracks().length > 0)
                } catch {
                  setCallState('error')
                  return
                }
              }
              pc = createPeerConnection()
              for (const track of localStreamRef.current!.getTracks()) {
                pc.addTrack(track, localStreamRef.current!)
              }
            }
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
            await flushCandidates()
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            room.send<SignalMessage>({ type: 'answer', sdp: answer.sdp! })
            setCallState('connecting')
          } else if (data.type === 'answer') {
            const pc = pcRef.current
            if (!pc) return
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
            await flushCandidates()
            setCallState('connecting')
          } else if (data.type === 'candidate') {
            const pc = pcRef.current
            if (!pc) return
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
            } else {
              pendingCandidatesRef.current.push(data.candidate)
            }
          }
        } catch {
          // Swallow WebRTC errors from stale/closed peer connections.
          // A new offer will arrive and re-establish.
        }
      })()
    })

    return unsub
  }, [room, createPeerConnection, flushCandidates, acquireMedia])

  /** When peers join (>1 peer in the room), the host re-sends the offer. */
  useEffect(() => {
    if (!room || !isHost) return

    const unsub = room.onPeers((peers) => {
      if (peers.length > 1 && pcRef.current && localStreamRef.current) {
        ;(async () => {
          try {
            const pc = pcRef.current
            if (!pc || pc.signalingState === 'closed') return
            if (pc.connectionState === 'connected') return
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            room.send<SignalMessage>({ type: 'offer', sdp: offer.sdp! })
          } catch {
            // Stale PC — next peer join will retry.
          }
        })()
      }
    })

    return unsub
  }, [room, isHost])

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
  }, [])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (pcRef.current) {
        pcRef.current.close()
      }
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
    startCall,
    endCall,
    toggleAudio,
    toggleVideo,
  }
}
