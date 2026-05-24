/** Generate a cryptographically random room ID (10 chars, a-z0-9). */
export function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  let id = ''
  for (const b of bytes) {
    id += chars[b % chars.length]
  }
  return id
}

/** Validate a room ID: must be 1-20 lowercase alphanumeric chars. */
export function isValidRoomId(id: string): boolean {
  return /^[a-z0-9]{1,20}$/.test(id)
}

/** Read ?room= from the current URL. Returns null if missing or invalid. */
export function getRoomIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const id = params.get('room')
  if (!id) return null
  return isValidRoomId(id) ? id : null
}

/** Build a meeting link for a given room ID. */
export function getMeetingLink(roomId: string): string {
  return `${window.location.origin}?room=${roomId}`
}

/** Read ?friend= from the current URL. Returns null if missing. */
export function getFriendIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('friend') || null
}

/** Read ?fn= (friend name) from the current URL. Returns null if missing. */
export function getFriendNameFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('fn') || null
}

/** Build a friend invite link for the current user. */
export function getFriendLink(userId: string, login: string): string {
  return `${window.location.origin}?friend=${encodeURIComponent(userId)}&fn=${encodeURIComponent(login)}`
}
