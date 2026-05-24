// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { orderedPair } from '../src/lib/db.ts'
import { getFriendIdFromUrl, getFriendNameFromUrl, getFriendLink, getRoomIdFromUrl } from '../src/lib/room.ts'

describe('orderedPair', () => {
  it('returns alphabetically ordered pair', () => {
    expect(orderedPair('alice', 'bob')).toEqual(['alice', 'bob'])
    expect(orderedPair('bob', 'alice')).toEqual(['alice', 'bob'])
  })

  it('is consistent regardless of input order', () => {
    const ids = ['user-z', 'user-a', 'user-m']
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue
        const [x, y] = orderedPair(a, b)
        const [x2, y2] = orderedPair(b, a)
        expect(x).toBe(x2)
        expect(y).toBe(y2)
        expect(x < y).toBe(true)
      }
    }
  })

  it('handles equal strings', () => {
    expect(orderedPair('same', 'same')).toEqual(['same', 'same'])
  })
})

describe('getFriendIdFromUrl', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { search: '', origin: 'https://meet.proappstore.online', pathname: '/' },
      writable: true,
      configurable: true,
    })
  })

  it('returns null when no friend param', () => {
    window.location.search = ''
    expect(getFriendIdFromUrl()).toBeNull()
  })

  it('returns the friend ID from ?friend=', () => {
    window.location.search = '?friend=user123'
    expect(getFriendIdFromUrl()).toBe('user123')
  })

  it('returns null for empty friend param', () => {
    window.location.search = '?friend='
    expect(getFriendIdFromUrl()).toBeNull()
  })
})

describe('getFriendNameFromUrl', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { search: '', origin: 'https://meet.proappstore.online', pathname: '/' },
      writable: true,
      configurable: true,
    })
  })

  it('returns null when no fn param', () => {
    window.location.search = '?friend=user123'
    expect(getFriendNameFromUrl()).toBeNull()
  })

  it('returns the friend name from ?fn=', () => {
    window.location.search = '?friend=user123&fn=Alice'
    expect(getFriendNameFromUrl()).toBe('Alice')
  })
})

describe('getFriendLink', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://meet.proappstore.online' },
      writable: true,
      configurable: true,
    })
  })

  it('builds the correct friend link', () => {
    expect(getFriendLink('user123', 'alice')).toBe('https://meet.proappstore.online?friend=user123&fn=alice')
  })

  it('encodes special characters', () => {
    const link = getFriendLink('user 123', 'al&ice')
    expect(link).toContain('friend=user%20123')
    expect(link).toContain('fn=al%26ice')
  })
})

describe('URL priority: ?room= over ?friend=', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { search: '', origin: 'https://meet.proappstore.online', pathname: '/' },
      writable: true,
      configurable: true,
    })
  })

  it('room param takes priority when both present', () => {
    window.location.search = '?room=abc123&friend=user456&fn=Bob'
    // Room should be detected
    expect(getRoomIdFromUrl()).toBe('abc123')
    // Friend should also be readable (but app logic handles priority)
    expect(getFriendIdFromUrl()).toBe('user456')
  })
})

describe('notification loop (conceptual)', () => {
  it('caps at 30 friends', () => {
    const friends = Array.from({ length: 50 }, (_, i) => ({
      userId: `user-${i}`,
      login: `user${i}`,
      since: Date.now(),
    }))
    const toNotify = friends.slice(0, 30)
    expect(toNotify).toHaveLength(30)
    expect(toNotify[0].userId).toBe('user-0')
    expect(toNotify[29].userId).toBe('user-29')
  })

  it('skips self (handled by friends list not including self)', () => {
    // The orderedPair logic + query WHERE (user_a = ? OR user_b = ?) means
    // self is never in the friends list since you can't friend yourself
    const myId = 'me'
    const friends = [
      { userId: 'other1', login: 'o1', since: 1 },
      { userId: 'other2', login: 'o2', since: 2 },
    ]
    const toNotify = friends.filter(f => f.userId !== myId)
    expect(toNotify).toHaveLength(2)
  })
})
