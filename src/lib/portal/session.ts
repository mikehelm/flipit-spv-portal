/**
 * Investor sessions. BUILD_SPEC §4.1, §4.2, §15.
 *
 * A separate table and a separate cookie from the administrator's, because they
 * are a different kind of thing with different rules — an investor session is
 * revoked wholesale when an account is suspended, and an administrator's never
 * is. Sharing one table would have made "kill every session for this account"
 * a query that could reach the owner's session by mistake.
 *
 * Only a hash of the token is stored. The column is named `session_token` for
 * consistency with the administrator table; it holds `hashToken(token)` and
 * never the token. A database leak yields no usable session.
 */

import { and, eq, gt, isNull } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { investorAccounts, investorSessions } from '@/db/schema'
import { hashToken, issueToken } from '@/lib/crypto'
import { env } from '@/lib/env'

export const INVESTOR_SESSION_COOKIE = 'spv.portal_session'

/**
 * Thirty days. Longer than the administrator's twelve hours, deliberately: an
 * investor visits occasionally, over months, and forcing a fresh emailed link
 * every visit turns a private record into a chore and trains people to expect
 * unprompted "sign in" emails — which is exactly the habit §15.1 is written
 * against. Suspension kills the session immediately regardless of its age.
 */
export const INVESTOR_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

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

export async function createInvestorSession(accountId: string): Promise<void> {
  const { token, hash } = issueToken()
  const expires = new Date(Date.now() + INVESTOR_SESSION_MAX_AGE_SECONDS * 1000)

  await db.insert(investorSessions).values({ sessionToken: hash, accountId, expires })

  const jar = await cookies()
  jar.set(INVESTOR_SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: INVESTOR_SESSION_MAX_AGE_SECONDS,
  })
}

/**
 * The signed-in account, or null.
 *
 * A revoked row is as good as absent — the check is in the query, so a session
 * revoked by a suspension one second ago is refused on the very next request
 * rather than at its next natural expiry.
 */
export async function readInvestorAccount() {
  const jar = await cookies()
  const token = jar.get(INVESTOR_SESSION_COOKIE)?.value
  if (!token) return null

  const session = await db.query.investorSessions.findFirst({
    where: and(
      eq(investorSessions.sessionToken, hashToken(token)),
      gt(investorSessions.expires, new Date()),
      isNull(investorSessions.revokedAt),
    ),
  })
  if (!session) return null

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, session.accountId),
  })
  return account ?? null
}

export async function destroyInvestorSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(INVESTOR_SESSION_COOKIE)?.value

  if (token) {
    await db
      .update(investorSessions)
      .set({ revokedAt: new Date() })
      .where(eq(investorSessions.sessionToken, hashToken(token)))
  }

  jar.delete({ name: INVESTOR_SESSION_COOKIE, path: cookieOptions().path })
}
