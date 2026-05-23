// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { generateRoomId, isValidRoomId, getRoomIdFromUrl, getMeetingLink } from '../src/lib/room.ts'

describe('generateRoomId', () => {
  it('returns a 10-character string', () => {
    const id = generateRoomId()
    expect(id).toHaveLength(10)
  })

  it('contains only lowercase alphanumeric chars', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateRoomId()
      expect(id).toMatch(/^[a-z0-9]{10}$/)
    }
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRoomId()))
    // With 36^10 possible IDs, collisions in 100 tries are astronomically unlikely
    expect(ids.size).toBe(100)
  })
})

describe('isValidRoomId', () => {
  it('accepts valid room IDs', () => {
    expect(isValidRoomId('abc123')).toBe(true)
    expect(isValidRoomId('a')).toBe(true)
    expect(isValidRoomId('abcdefghij1234567890')).toBe(true) // 20 chars max
  })

  it('rejects empty string', () => {
    expect(isValidRoomId('')).toBe(false)
  })

  it('rejects IDs over 20 chars', () => {
    expect(isValidRoomId('a'.repeat(21))).toBe(false)
  })

  it('rejects uppercase', () => {
    expect(isValidRoomId('ABC123')).toBe(false)
  })

  it('rejects special characters', () => {
    expect(isValidRoomId('abc-123')).toBe(false)
    expect(isValidRoomId('abc_123')).toBe(false)
    expect(isValidRoomId('abc 123')).toBe(false)
    expect(isValidRoomId('../etc')).toBe(false)
  })

  it('rejects script injection attempts', () => {
    expect(isValidRoomId('<script>')).toBe(false)
    expect(isValidRoomId("'; DROP TABLE")).toBe(false)
  })
})

describe('getRoomIdFromUrl', () => {
  beforeEach(() => {
    // Reset URL
    Object.defineProperty(window, 'location', {
      value: { search: '', origin: 'https://meet.freeappstore.online' },
      writable: true,
      configurable: true,
    })
  })

  it('returns null when no room param', () => {
    window.location.search = ''
    expect(getRoomIdFromUrl()).toBeNull()
  })

  it('returns the room ID from ?room=', () => {
    window.location.search = '?room=abc123def0'
    expect(getRoomIdFromUrl()).toBe('abc123def0')
  })

  it('returns null for invalid room IDs', () => {
    window.location.search = '?room=INVALID'
    expect(getRoomIdFromUrl()).toBeNull()
  })

  it('returns null for empty room param', () => {
    window.location.search = '?room='
    expect(getRoomIdFromUrl()).toBeNull()
  })

  it('rejects room IDs with special chars', () => {
    window.location.search = '?room=../../../etc'
    expect(getRoomIdFromUrl()).toBeNull()
  })

  it('handles multiple query params', () => {
    window.location.search = '?foo=bar&room=test123&baz=qux'
    expect(getRoomIdFromUrl()).toBe('test123')
  })
})

describe('getMeetingLink', () => {
  it('builds the correct meeting link', () => {
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://meet.freeappstore.online' },
      writable: true,
      configurable: true,
    })
    expect(getMeetingLink('abc123')).toBe('https://meet.freeappstore.online?room=abc123')
  })

  it('works on localhost', () => {
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:5173' },
      writable: true,
      configurable: true,
    })
    expect(getMeetingLink('test')).toBe('http://localhost:5173?room=test')
  })
})
