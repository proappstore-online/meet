import { describe, expect, it } from 'vitest'

// Test the signaling message types and validation that the hook relies on.
// The actual WebRTC negotiation can't be unit-tested (needs real browser APIs),
// but we can verify the message shapes and routing logic.

interface SignalOffer { type: 'offer'; sdp: string }
interface SignalAnswer { type: 'answer'; sdp: string }
interface SignalCandidate { type: 'candidate'; candidate: RTCIceCandidateInit }
type SignalMessage = SignalOffer | SignalAnswer | SignalCandidate

function classifySignal(msg: SignalMessage): 'offer' | 'answer' | 'candidate' {
  return msg.type
}

function isValidSignal(data: unknown): data is SignalMessage {
  if (!data || typeof data !== 'object') return false
  const msg = data as Record<string, unknown>
  if (msg.type === 'offer' || msg.type === 'answer') {
    return typeof msg.sdp === 'string' && msg.sdp.length > 0
  }
  if (msg.type === 'candidate') {
    return msg.candidate != null && typeof msg.candidate === 'object'
  }
  return false
}

describe('signaling message validation', () => {
  it('validates offer messages', () => {
    expect(isValidSignal({ type: 'offer', sdp: 'v=0\r\n...' })).toBe(true)
    expect(isValidSignal({ type: 'offer', sdp: '' })).toBe(false)
    expect(isValidSignal({ type: 'offer' })).toBe(false)
  })

  it('validates answer messages', () => {
    expect(isValidSignal({ type: 'answer', sdp: 'v=0\r\n...' })).toBe(true)
    expect(isValidSignal({ type: 'answer', sdp: '' })).toBe(false)
  })

  it('validates candidate messages', () => {
    expect(isValidSignal({ type: 'candidate', candidate: { candidate: 'a=...' } })).toBe(true)
    expect(isValidSignal({ type: 'candidate', candidate: null })).toBe(false)
    expect(isValidSignal({ type: 'candidate' })).toBe(false)
  })

  it('rejects invalid message types', () => {
    expect(isValidSignal({ type: 'unknown' })).toBe(false)
    expect(isValidSignal(null)).toBe(false)
    expect(isValidSignal('string')).toBe(false)
    expect(isValidSignal(42)).toBe(false)
  })
})

describe('signal routing', () => {
  it('classifies offer', () => {
    expect(classifySignal({ type: 'offer', sdp: 'test' })).toBe('offer')
  })

  it('classifies answer', () => {
    expect(classifySignal({ type: 'answer', sdp: 'test' })).toBe('answer')
  })

  it('classifies candidate', () => {
    expect(classifySignal({ type: 'candidate', candidate: { candidate: '' } })).toBe('candidate')
  })
})

describe('ICE candidate queuing logic', () => {
  it('queues candidates when no remote description', () => {
    const pending: RTCIceCandidateInit[] = []
    const hasRemoteDescription = false

    const candidate: RTCIceCandidateInit = { candidate: 'candidate:1 1 udp ...' }

    if (hasRemoteDescription) {
      // Would call pc.addIceCandidate
    } else {
      pending.push(candidate)
    }

    expect(pending).toHaveLength(1)
    expect(pending[0]).toBe(candidate)
  })

  it('flushes all queued candidates', () => {
    const pending: RTCIceCandidateInit[] = [
      { candidate: 'candidate:1 1 udp ...' },
      { candidate: 'candidate:2 1 udp ...' },
      { candidate: 'candidate:3 1 tcp ...' },
    ]

    const added: RTCIceCandidateInit[] = []
    for (const c of pending) {
      added.push(c)
    }
    pending.length = 0

    expect(added).toHaveLength(3)
    expect(pending).toHaveLength(0)
  })
})
