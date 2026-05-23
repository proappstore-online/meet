import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Tests for the WebRTC signaling flow logic.
 * Since the actual hook uses browser APIs (RTCPeerConnection, getUserMedia),
 * we test the state machine and message handling logic in isolation.
 */

type CallState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'error' | 'peer-left'
type SignalType = 'offer' | 'answer' | 'candidate' | 'request-offer'

interface MockPC {
  signalingState: RTCSignalingState
  connectionState: RTCPeerConnectionState
  remoteDescription: RTCSessionDescription | null
}

/** Simulate what the message handler does for each signal type */
function handleSignal(
  type: SignalType,
  pc: MockPC | null,
  isHost: boolean,
): { action: string; newCallState?: CallState } {
  if (type === 'offer') {
    if (!pc || pc.signalingState === 'closed') {
      return { action: 'create-pc-and-answer', newCallState: 'connecting' }
    }
    return { action: 'set-remote-and-answer', newCallState: 'connecting' }
  }
  if (type === 'answer') {
    if (!pc) return { action: 'ignore' }
    return { action: 'set-remote-description', newCallState: 'connecting' }
  }
  if (type === 'request-offer') {
    if (!pc) return { action: 'ignore' }
    if (pc.connectionState === 'connected') return { action: 'ignore' }
    return { action: 'create-and-send-offer' }
  }
  if (type === 'candidate') {
    if (!pc) return { action: 'ignore' }
    if (pc.remoteDescription) return { action: 'add-ice-candidate' }
    return { action: 'queue-candidate' }
  }
  return { action: 'unknown' }
}

describe('signal handling', () => {
  const stablePC: MockPC = {
    signalingState: 'stable',
    connectionState: 'new',
    remoteDescription: null,
  }
  const connectedPC: MockPC = {
    signalingState: 'stable',
    connectionState: 'connected',
    remoteDescription: {} as RTCSessionDescription,
  }
  const closedPC: MockPC = {
    signalingState: 'closed',
    connectionState: 'closed',
    remoteDescription: null,
  }

  describe('offer', () => {
    it('creates PC when none exists', () => {
      const r = handleSignal('offer', null, false)
      expect(r.action).toBe('create-pc-and-answer')
      expect(r.newCallState).toBe('connecting')
    })

    it('creates PC when existing one is closed', () => {
      const r = handleSignal('offer', closedPC, false)
      expect(r.action).toBe('create-pc-and-answer')
    })

    it('answers on existing PC', () => {
      const r = handleSignal('offer', stablePC, false)
      expect(r.action).toBe('set-remote-and-answer')
    })
  })

  describe('answer', () => {
    it('ignores when no PC', () => {
      expect(handleSignal('answer', null, true).action).toBe('ignore')
    })

    it('applies remote description', () => {
      const r = handleSignal('answer', stablePC, true)
      expect(r.action).toBe('set-remote-description')
      expect(r.newCallState).toBe('connecting')
    })
  })

  describe('request-offer', () => {
    it('ignores when no PC (host still setting up)', () => {
      expect(handleSignal('request-offer', null, true).action).toBe('ignore')
    })

    it('ignores when already connected', () => {
      expect(handleSignal('request-offer', connectedPC, true).action).toBe('ignore')
    })

    it('sends offer when PC exists but not connected', () => {
      expect(handleSignal('request-offer', stablePC, true).action).toBe('create-and-send-offer')
    })
  })

  describe('candidate', () => {
    it('ignores when no PC', () => {
      expect(handleSignal('candidate', null, false).action).toBe('ignore')
    })

    it('adds when remote description exists', () => {
      expect(handleSignal('candidate', connectedPC, false).action).toBe('add-ice-candidate')
    })

    it('queues when no remote description yet', () => {
      expect(handleSignal('candidate', stablePC, false).action).toBe('queue-candidate')
    })
  })
})

describe('host-guest flow simulation', () => {
  it('complete happy path', () => {
    // 1. Host starts: sends offer
    // 2. Guest joins: sends request-offer
    // 3. Host receives request-offer: re-sends offer
    // 4. Guest receives offer: creates answer
    // 5. Host receives answer: applies it
    // 6. ICE candidates flow
    // 7. Connected

    const messages: { from: 'host' | 'guest'; type: SignalType }[] = []
    const send = (from: 'host' | 'guest', type: SignalType) => messages.push({ from, type })

    // Host starts
    send('host', 'offer') // sent to room, but guest not there yet

    // Guest joins
    send('guest', 'request-offer')

    // Host handles request-offer
    const hostPC: MockPC = { signalingState: 'have-local-offer', connectionState: 'new', remoteDescription: null }
    const rr = handleSignal('request-offer', hostPC, true)
    expect(rr.action).toBe('create-and-send-offer')
    send('host', 'offer')

    // Guest handles offer
    const guestPC: MockPC = { signalingState: 'stable', connectionState: 'new', remoteDescription: null }
    const ro = handleSignal('offer', guestPC, false)
    expect(ro.action).toBe('set-remote-and-answer')
    send('guest', 'answer')

    // Host handles answer
    const ra = handleSignal('answer', hostPC, true)
    expect(ra.action).toBe('set-remote-description')
    expect(ra.newCallState).toBe('connecting')

    // Verify message sequence
    expect(messages.map(m => `${m.from}:${m.type}`)).toEqual([
      'host:offer',           // initial (missed by guest)
      'guest:request-offer',  // guest asks for offer
      'host:offer',           // host re-sends
      'guest:answer',         // guest responds
    ])
  })

  it('guest retries request-offer if host PC not ready', () => {
    // Guest sends request-offer, host has no PC yet
    const r1 = handleSignal('request-offer', null, true)
    expect(r1.action).toBe('ignore')

    // Guest retries after 2s, host now has PC
    const hostPC: MockPC = { signalingState: 'stable', connectionState: 'new', remoteDescription: null }
    const r2 = handleSignal('request-offer', hostPC, true)
    expect(r2.action).toBe('create-and-send-offer')
  })
})

describe('offer retry mechanism', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('retries every 2 seconds', () => {
    const sendFn = vi.fn()
    let retryCount = 0

    // Simulate the retry interval
    const interval = setInterval(() => {
      retryCount++
      sendFn('request-offer')
    }, 2000)

    vi.advanceTimersByTime(6000)
    expect(retryCount).toBe(3)
    expect(sendFn).toHaveBeenCalledTimes(3)

    clearInterval(interval)
    vi.useRealTimers()
  })

  it('stops when remote description is set', () => {
    let hasRemoteDesc = false
    const sendFn = vi.fn()

    const interval = setInterval(() => {
      if (hasRemoteDesc) {
        clearInterval(interval)
        return
      }
      sendFn('request-offer')
    }, 2000)

    vi.advanceTimersByTime(4000) // 2 retries
    hasRemoteDesc = true
    vi.advanceTimersByTime(4000) // should not fire more
    expect(sendFn).toHaveBeenCalledTimes(2)

    clearInterval(interval)
    vi.useRealTimers()
  })
})
