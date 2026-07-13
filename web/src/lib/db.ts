import { app } from './app.ts'
import { q, x } from './actions.ts'

export interface Friend {
  userId: string
  login: string
  since: number
}

export interface FriendRequest {
  fromUserId: string
  fromLogin: string
  sentAt: number
}

const MIGRATIONS = [
  {
    name: '0001_friends',
    sql: `
      CREATE TABLE IF NOT EXISTS friendships (
        user_a      TEXT NOT NULL,
        user_b      TEXT NOT NULL,
        requester   TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        a_login     TEXT NOT NULL,
        b_login     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        accepted_at INTEGER,
        PRIMARY KEY (user_a, user_b)
      );
      CREATE INDEX IF NOT EXISTS idx_friends_a ON friendships(user_a, status);
      CREATE INDEX IF NOT EXISTS idx_friends_b ON friendships(user_b, status);
    `,
  },
]

let migrated = false

/**
 * Apply pending migrations. Raw `db.migrate` is restricted to the app's team
 * since the platform's cross-tenant SQL lockdown, so regular users get a 403
 * here — that's fine: the schema is already migrated (a team member's visit
 * applies anything new), so swallow the 403 and continue. Every user-facing
 * read/write goes through registered actions, not raw SQL.
 */
export async function ensureMigrated(): Promise<void> {
  if (migrated) return
  try {
    await app.db.migrate(MIGRATIONS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('403')) throw err
  }
  migrated = true
}

export async function sendFriendRequest(
  _myId: string,
  myLogin: string,
  targetId: string,
  targetLogin: string,
): Promise<void> {
  await x('send_friend_request', {
    target_id: targetId,
    my_login: myLogin,
    target_login: targetLogin,
  })
}

export async function getFriendRequests(_myId: string): Promise<FriendRequest[]> {
  const rows = await q<{
    user_a: string
    user_b: string
    requester: string
    a_login: string
    b_login: string
    created_at: number
  }>('list_friend_requests')
  return rows.map((r) => {
    const fromUserId = r.requester
    const fromLogin = r.user_a === fromUserId ? r.a_login : r.b_login
    return { fromUserId, fromLogin, sentAt: r.created_at }
  })
}

export async function acceptFriendRequest(_myId: string, otherId: string): Promise<void> {
  await x('accept_friend_request', { other_id: otherId })
}

export async function declineFriendRequest(_myId: string, otherId: string): Promise<void> {
  await x('decline_friend_request', { other_id: otherId })
}

export async function getFriends(myId: string): Promise<Friend[]> {
  const rows = await q<{
    user_a: string
    user_b: string
    a_login: string
    b_login: string
    accepted_at: number
  }>('list_friends')
  return rows.map((r) => {
    const isA = r.user_a === myId
    return {
      userId: isA ? r.user_b : r.user_a,
      login: isA ? r.b_login : r.a_login,
      since: r.accepted_at,
    }
  })
}

export async function removeFriend(_myId: string, otherId: string): Promise<void> {
  await x('remove_friend', { other_id: otherId })
}
