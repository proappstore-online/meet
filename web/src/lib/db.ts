import { app } from './app.ts'

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
export async function ensureMigrated(): Promise<void> {
  if (migrated) return
  await app.db.migrate(MIGRATIONS)
  migrated = true
}

export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export async function sendFriendRequest(
  myId: string,
  myLogin: string,
  targetId: string,
  targetLogin: string,
): Promise<void> {
  await ensureMigrated()
  const [userA, userB] = orderedPair(myId, targetId)
  const aLogin = userA === myId ? myLogin : targetLogin
  const bLogin = userB === myId ? myLogin : targetLogin
  await app.db.execute(
    `INSERT OR IGNORE INTO friendships (user_a, user_b, requester, status, a_login, b_login, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    [userA, userB, myId, aLogin, bLogin, Date.now()],
  )
}

export async function getFriendRequests(myId: string): Promise<FriendRequest[]> {
  await ensureMigrated()
  const { rows } = await app.db.query<{
    user_a: string
    user_b: string
    requester: string
    a_login: string
    b_login: string
    created_at: number
  }>(
    `SELECT user_a, user_b, requester, a_login, b_login, created_at FROM friendships
     WHERE (user_a = ? OR user_b = ?) AND status = 'pending' AND requester != ?`,
    [myId, myId, myId],
  )
  return rows.map((r) => {
    const fromUserId = r.requester
    const fromLogin = r.user_a === fromUserId ? r.a_login : r.b_login
    return { fromUserId, fromLogin, sentAt: r.created_at }
  })
}

export async function acceptFriendRequest(myId: string, otherId: string): Promise<void> {
  await ensureMigrated()
  const [userA, userB] = orderedPair(myId, otherId)
  await app.db.execute(
    `UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ? AND status = 'pending'`,
    [Date.now(), userA, userB],
  )
}

export async function declineFriendRequest(myId: string, otherId: string): Promise<void> {
  await ensureMigrated()
  const [userA, userB] = orderedPair(myId, otherId)
  await app.db.execute(
    `DELETE FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'pending'`,
    [userA, userB],
  )
}

export async function getFriends(myId: string): Promise<Friend[]> {
  await ensureMigrated()
  const { rows } = await app.db.query<{
    user_a: string
    user_b: string
    a_login: string
    b_login: string
    accepted_at: number
  }>(
    `SELECT user_a, user_b, a_login, b_login, accepted_at FROM friendships
     WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'`,
    [myId, myId],
  )
  return rows.map((r) => {
    const isA = r.user_a === myId
    return {
      userId: isA ? r.user_b : r.user_a,
      login: isA ? r.b_login : r.a_login,
      since: r.accepted_at,
    }
  })
}

export async function removeFriend(myId: string, otherId: string): Promise<void> {
  await ensureMigrated()
  const [userA, userB] = orderedPair(myId, otherId)
  await app.db.execute(
    `DELETE FROM friendships WHERE user_a = ? AND user_b = ?`,
    [userA, userB],
  )
}
