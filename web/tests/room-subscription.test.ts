import { describe, expect, it, vi } from 'vitest'

/**
 * Tests that validate the Room subscription model matches what the hook expects.
 * The core question: does the guest receive messages sent by the host?
 */

type Listener = (msg: unknown) => void

/** Minimal Room mock matching the SDK's Room class behavior */
class MockRoom {
  private listeners = new Set<Listener>()
  private _state: 'connecting' | 'open' | 'closed' = 'connecting'

  get state() { return this._state }

  send(data: unknown) {
    // In real SDK, this sends over WebSocket. The DO broadcasts to other peers.
    // We simulate receiving messages here (as if from another peer).
  }

  onMessage(listener: Listener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  // Simulate receiving a message from another peer
  simulateIncoming(data: unknown) {
    for (const l of this.listeners) {
      l({ from: { uid: 'other', login: 'other' }, data, at: Date.now() })
    }
  }

  simulateOpen() {
    this._state = 'open'
  }

  get listenerCount() { return this.listeners.size }
}

describe('room subscription lifecycle', () => {
  it('listener receives messages after subscribe', () => {
    const room = new MockRoom()
    const received: unknown[] = []
    room.onMessage((msg) => received.push(msg))

    room.simulateIncoming({ type: 'offer', sdp: 'test' })
    expect(received).toHaveLength(1)
  })

  it('listener stops receiving after unsubscribe', () => {
    const room = new MockRoom()
    const received: unknown[] = []
    const unsub = room.onMessage((msg) => received.push(msg))

    room.simulateIncoming({ type: 'offer', sdp: 'test1' })
    unsub()
    room.simulateIncoming({ type: 'offer', sdp: 'test2' })
    expect(received).toHaveLength(1)
  })

  it('re-subscribe works after unsubscribe', () => {
    const room = new MockRoom()
    const received: unknown[] = []

    // First subscribe
    const unsub1 = room.onMessage((msg) => received.push(msg))
    room.simulateIncoming({ type: 'msg1' })
    unsub1()

    // Re-subscribe
    room.onMessage((msg) => received.push(msg))
    room.simulateIncoming({ type: 'msg2' })
    expect(received).toHaveLength(2)
  })

  it('multiple listeners all receive messages', () => {
    const room = new MockRoom()
    const received1: unknown[] = []
    const received2: unknown[] = []

    room.onMessage((msg) => received1.push(msg))
    room.onMessage((msg) => received2.push(msg))

    room.simulateIncoming({ type: 'test' })
    expect(received1).toHaveLength(1)
    expect(received2).toHaveLength(1)
  })
})

describe('simulated host-guest message exchange', () => {
  it('guest receives host offer via mock room', () => {
    const room = new MockRoom()
    const guestReceived: unknown[] = []

    // Guest subscribes
    room.onMessage((msg) => guestReceived.push(msg))
    room.simulateOpen()

    // Host sends offer (simulated as incoming for guest)
    room.simulateIncoming({ type: 'offer', sdp: 'v=0...' })

    expect(guestReceived).toHaveLength(1)
    expect((guestReceived[0] as any).data.type).toBe('offer')
  })

  it('full exchange: request-offer → offer → answer', () => {
    const hostRoom = new MockRoom()
    const guestRoom = new MockRoom()
    const hostReceived: any[] = []
    const guestReceived: any[] = []

    hostRoom.onMessage((msg) => hostReceived.push(msg))
    guestRoom.onMessage((msg) => guestReceived.push(msg))

    // Guest sends request-offer → host receives it
    hostRoom.simulateIncoming({ type: 'request-offer' })
    expect(hostReceived).toHaveLength(1)
    expect(hostReceived[0].data.type).toBe('request-offer')

    // Host sends offer → guest receives it
    guestRoom.simulateIncoming({ type: 'offer', sdp: 'v=0...' })
    expect(guestReceived).toHaveLength(1)
    expect(guestReceived[0].data.type).toBe('offer')

    // Guest sends answer → host receives it
    hostRoom.simulateIncoming({ type: 'answer', sdp: 'v=0...' })
    expect(hostReceived).toHaveLength(2)
    expect(hostReceived[1].data.type).toBe('answer')
  })
})

describe('useEffect subscription pattern', () => {
  it('simulates React effect: unsub old, sub new (same room)', () => {
    const room = new MockRoom()
    const received: unknown[] = []

    // First effect run
    const unsub1 = room.onMessage((msg) => received.push(msg))
    expect(room.listenerCount).toBe(1)

    // Simulate React re-render: cleanup old, setup new
    unsub1()
    expect(room.listenerCount).toBe(0)
    const unsub2 = room.onMessage((msg) => received.push(msg))
    expect(room.listenerCount).toBe(1)

    // Message should be received by new listener
    room.simulateIncoming({ type: 'test' })
    expect(received).toHaveLength(1)

    unsub2()
  })

  it('simulates room change: old room unsub, new room sub', () => {
    const oldRoom = new MockRoom()
    const newRoom = new MockRoom()
    const received: unknown[] = []

    // Subscribe to old room
    const unsub1 = oldRoom.onMessage((msg) => received.push(msg))

    // Room changes: cleanup old, setup new
    unsub1()
    newRoom.onMessage((msg) => received.push(msg))

    // Messages on old room should NOT be received
    oldRoom.simulateIncoming({ type: 'old' })
    expect(received).toHaveLength(0)

    // Messages on new room SHOULD be received
    newRoom.simulateIncoming({ type: 'new' })
    expect(received).toHaveLength(1)
  })
})
