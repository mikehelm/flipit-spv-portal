import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { sessions, users } from '@/db/schema'
import { hashToken, issueToken } from '@/lib/crypto'
import { env } from '@/lib/env'

/**
 * Administrator sessions. BUILD_SPEC §2.2, §15.
 *
 * "Sessions are server-side, revocable, and expire. Changing a password ends
 * every other session immediately."
 *
 * That requirement is why these are rows in `sessions` and a cookie holding
 * nothing but an opaque token, rather than a JWT. A signed token cannot be
 * withdrawn; a row can be deleted, and the next request is signed out.
 *
 * **Only a hash of the token is stored.** The column is `session_token` for
 * historical reasons — it holds `hashToken(token)`, never the token itself, so
 * a database leak yields no usable session. Lookup is by exact hash, so this
 * costs nothing.
 *
 * Investors have their own table, `investor_sessions`, and their own rules
 * (§4.2). Nothing here touches them.
 */

export const ADMIN_SESSION_COOKIE = 'spv.admin_session'

/**
 * Twelve hours. Shorter than any framework default on purpose: this session
 * reaches every investor's personal and financial record, and an unattended
 * laptop should not still be signed in tomorrow. The spec is silent on a
 * duration, so this is the conservative reading.
 */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60

function cookieOptions() {
  const config = env()
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Asked of the canonical origin, never of APP_URL. APP_URL is held at
    // localhost before launch so the send guard refuses, and deriving `Secure`
    // from it meant an administrator's session cookie went out without it
    // behind an HTTPS tunnel — sent in the clear on any http:// request before
    // the redirect. See `env.ts`, PUBLIC_ORIGIN.
    secure: config.isHttpsOrigin,
    path: config.BASE_PATH === '' ? '/' : config.BASE_PATH,
  }
}

export interface AdminSession {
  userId: string
  expires: Date
  /**
   * When the second factor was satisfied, or null. BUILD_SPEC §2.2.
   *
   * Null on an account with no TOTP enrolled means the session is complete;
   * null on an account that has enrolled means it is **pending** and reaches
   * the second-factor form and nothing else. `currentAdmin()` in guards.ts
   * resolves which, and that is the only place that should.
   */
  secondFactorAt: Date | null
}

/**
 * Issues a session and sets the cookie. Callers must already have established
 * that the sign-in was valid — this function authenticates nobody.
 *
 * `secondFactorSatisfied` defaults to **false**, which is the conservative
 * direction: a caller that forgets to pass it produces a session that reaches
 * the second-factor form rather than one that reaches the investor records. A
 * setup link, which proves possession of the mailbox and nothing else, passes
 * nothing and gets exactly that.
 */
export async function createAdminSession(
  userId: string,
  options: { secondFactorSatisfied?: boolean } = {},
): Promise<void> {
  const { token, hash } = issueToken()
  const expires = new Date(Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000)

  await db.insert(sessions).values({
    sessionToken: hash,
    userId,
    expires,
    secondFactorAt: options.secondFactorSatisfied ? new Date() : null,
  })

  const jar = await cookies()
  jar.set(ADMIN_SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  })
}

/**
 * Marks the current session as having passed the second factor.
 *
 * It stamps **this session only**, by its own token hash. Elevating by user id
 * would elevate every other session that user holds, including one an attacker
 * had opened with a stolen password and left waiting.
 */
export async function markSecondFactorSatisfied(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get(ADMIN_SESSION_COOKIE)?.value
  if (!token) return false

  const updated = await db
    .update(sessions)
    .set({ secondFactorAt: new Date() })
    .where(
      and(
        eq(sessions.sessionToken, hashToken(token)),
        gt(sessions.expires, new Date()),
        isNull(sessions.secondFactorAt),
      ),
    )
    .returning({ id: sessions.id })

  return updated.length > 0
}

/**
 * Resolves the cookie to a live session, or null.
 *
 * An expired row is deleted on sight rather than merely ignored, so a stale
 * session cannot be resurrected by a clock change and the table does not grow
 * without bound.
 */
export async function readAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies()
  const token = jar.get(ADMIN_SESSION_COOKIE)?.value
  if (!token) return null

  const hash = hashToken(token)
  const now = new Date()

  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.sessionToken, hash), gt(sessions.expires, now)),
  })

  if (!row) {
    // Either unknown or expired. Clean up the expired case; say nothing either way.
    await db
      .delete(sessions)
      .where(and(eq(sessions.sessionToken, hash), lt(sessions.expires, now)))
    return null
  }

  return { userId: row.userId, expires: row.expires, secondFactorAt: row.secondFactorAt }
}

export async function readAdminSessionUser() {
  const session = await readAdminSession()
  if (!session) return null

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) })
  if (!user) return null

  return { user, session }
}

/** Ends this session only. */
export async function destroyAdminSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(ADMIN_SESSION_COOKIE)?.value

  if (token) {
    await db.delete(sessions).where(eq(sessions.sessionToken, hashToken(token)))
  }

  jar.delete({ name: ADMIN_SESSION_COOKIE, path: cookieOptions().path })
}

/**
 * Ends every session for a user. Called on a password change (§2.2) and
 * available to the owner for revoking access outright.
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id })

  return removed.length
}
