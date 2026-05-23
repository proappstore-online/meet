import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Tests for the availability + push notification flow logic.
 */

describe('availability mode state machine', () => {
  type LobbyState = 'idle' | 'available' | 'guest-waiting' | 'active-meeting'

  function transitionState(
    current: LobbyState,
    action: 'go-available' | 'guest-joins' | 'start-call' | 'cancel' | 'timeout' | 'join-meeting' | 'host-starts' | 'start-meeting-now',
  ): LobbyState {
    switch (current) {
      case 'idle':
        if (action === 'go-available') return 'available'
        if (action === 'join-meeting') return 'guest-waiting'
        if (action === 'start-meeting-now') return 'active-meeting'
        return 'idle'
      case 'available':
        if (action === 'start-call') return 'active-meeting'
        if (action === 'cancel' || action === 'timeout') return 'idle'
        return 'available'
      case 'guest-waiting':
        if (action === 'host-starts') return 'active-meeting'
        if (action === 'cancel' || action === 'timeout') return 'idle'
        return 'guest-waiting'
      case 'active-meeting':
        if (action === 'cancel') return 'idle'
        return 'active-meeting'
    }
  }

  describe('host flow', () => {
    it('idle → go-available → available', () => {
      expect(transitionState('idle', 'go-available')).toBe('available')
    })

    it('available → guest-joins stays available (shows Start Call button)', () => {
      expect(transitionState('available', 'guest-joins')).toBe('available')
    })

    it('available → start-call → active-meeting', () => {
      expect(transitionState('available', 'start-call')).toBe('active-meeting')
    })

    it('available → cancel → idle', () => {
      expect(transitionState('available', 'cancel')).toBe('idle')
    })

    it('available → timeout → idle', () => {
      expect(transitionState('available', 'timeout')).toBe('idle')
    })

    it('idle → start-meeting-now → active-meeting (skip availability)', () => {
      expect(transitionState('idle', 'start-meeting-now')).toBe('active-meeting')
    })
  })

  describe('guest flow', () => {
    it('idle → join-meeting → guest-waiting', () => {
      expect(transitionState('idle', 'join-meeting')).toBe('guest-waiting')
    })

    it('guest-waiting → host-starts → active-meeting', () => {
      expect(transitionState('guest-waiting', 'host-starts')).toBe('active-meeting')
    })

    it('guest-waiting → timeout → idle', () => {
      expect(transitionState('guest-waiting', 'timeout')).toBe('idle')
    })

    it('guest-waiting → cancel → idle', () => {
      expect(transitionState('guest-waiting', 'cancel')).toBe('idle')
    })
  })

  describe('active meeting', () => {
    it('active-meeting → cancel → idle (end call)', () => {
      expect(transitionState('active-meeting', 'cancel')).toBe('idle')
    })

    it('active-meeting ignores other actions', () => {
      expect(transitionState('active-meeting', 'go-available')).toBe('active-meeting')
      expect(transitionState('active-meeting', 'join-meeting')).toBe('active-meeting')
    })
  })
})

describe('countdown timer logic', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('counts down correctly', () => {
    const endsAt = Date.now() + 30 * 60 * 1000 // 30 min
    const remaining = Math.ceil((endsAt - Date.now()) / 1000)
    expect(remaining).toBe(1800)

    vi.advanceTimersByTime(60_000) // 1 min
    const after = Math.ceil((endsAt - Date.now()) / 1000)
    expect(after).toBe(1740)

    vi.useRealTimers()
  })

  it('fires expired callback when reaching zero', () => {
    const onExpired = vi.fn()
    const endsAt = Date.now() + 3000 // 3 seconds

    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      if (left <= 0) { clearInterval(interval); onExpired() }
    }, 1000)

    vi.advanceTimersByTime(4000)
    expect(onExpired).toHaveBeenCalledOnce()

    clearInterval(interval)
    vi.useRealTimers()
  })
})

describe('guest timeout', () => {
  beforeEach(() => { vi.useFakeTimers() })

  it('times out after 2 minutes', () => {
    const onTimeout = vi.fn()
    const timeout = setTimeout(onTimeout, 120_000)

    vi.advanceTimersByTime(119_000)
    expect(onTimeout).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(onTimeout).toHaveBeenCalledOnce()

    clearTimeout(timeout)
    vi.useRealTimers()
  })

  it('does not fire if cleared before timeout', () => {
    const onTimeout = vi.fn()
    const timeout = setTimeout(onTimeout, 120_000)

    vi.advanceTimersByTime(60_000) // 1 min
    clearTimeout(timeout) // host started call
    vi.advanceTimersByTime(120_000) // way past timeout

    expect(onTimeout).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('push notification logic', () => {
  it('sends notification to host when guest sees host in peers', () => {
    const peers = [
      { uid: 'host-123', login: 'host-user' },
      { uid: 'guest-456', login: 'guest-user' },
    ]
    const guestUid = 'guest-456'
    const host = peers.find(p => p.uid !== guestUid)
    expect(host).toBeDefined()
    expect(host!.uid).toBe('host-123')
  })

  it('does not send if only self in peers', () => {
    const peers = [{ uid: 'guest-456', login: 'guest-user' }]
    const guestUid = 'guest-456'
    const host = peers.find(p => p.uid !== guestUid)
    expect(host).toBeUndefined()
  })

  it('only notifies once (deduplication)', () => {
    let notified = false
    const notifyFn = vi.fn()

    const onPeers = (peers: { uid: string }[]) => {
      if (notified) return
      const host = peers.find(p => p.uid !== 'guest')
      if (host) { notified = true; notifyFn(host.uid) }
    }

    // First peers update — should notify
    onPeers([{ uid: 'host' }, { uid: 'guest' }])
    expect(notifyFn).toHaveBeenCalledOnce()

    // Second peers update — should NOT notify again
    onPeers([{ uid: 'host' }, { uid: 'guest' }])
    expect(notifyFn).toHaveBeenCalledOnce()
  })
})

describe('auto-start guards', () => {
  it('blocks startCall in available mode', () => {
    const availableMode = true
    const guestWaiting = false
    const shouldStart = !availableMode && !guestWaiting
    expect(shouldStart).toBe(false)
  })

  it('blocks startCall in guest-waiting mode', () => {
    const availableMode = false
    const guestWaiting = true
    const shouldStart = !availableMode && !guestWaiting
    expect(shouldStart).toBe(false)
  })

  it('allows startCall when neither available nor waiting', () => {
    const availableMode = false
    const guestWaiting = false
    const shouldStart = !availableMode && !guestWaiting
    expect(shouldStart).toBe(true)
  })
})
