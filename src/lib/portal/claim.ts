/**
 * Claiming a portal link, and asking for a fresh one. BUILD_SPEC §4.1, §4.2.
 *
 * Two entry points, one rule underneath both: **nothing observable from outside
 * distinguishes one kind of failure from another.**
 *
 *   - A claim token that was never valid, one already spent, one expired, one
 *     revoked, and one belonging to a suspended account all produce the same
 *     refusal.
 *   - A sign-in request for an unknown address, a suspended account, a closed
 *     one with access set to none, and an archived one all produce the same
 *     sentence, and the same work is done in each case.
 *
 * That is not politeness. The list of people invited into a private securities
 * round is itself confidential, and a portal that answers "no such address"
 * publishes it one guess at a time.
 *
 * Single use is enforced by a conditional UPDATE, not by reading the row and
 * then writing it, so two simultaneous redemptions cannot both succeed.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, investorSessions, portalTokens } from '@/db/schema'
import { audit } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { hashToken, issueToken, tokensMatch } from '@/lib/crypto'
import { portalAccess, type AccountStatus } from './access'

/**
 * Forty-five minutes. A sign-in link is requested and used within a couple of
 * minutes in the ordinary case; anything longer is a link sitting in an inbox.
 * Shorter than the claim link's fourteen days because the claim link arrives
 * unrequested and may reasonably be read days later, whereas this one was asked
 * for just now.
 */
export const SIGN_IN_TOKEN_TTL_MINUTES = 45

/** Never returned to the caller. For the audit log only. */
export type ClaimDetail =
  | 'OK'
  | 'UNKNOWN_TOKEN'
  | 'ALREADY_USED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'ACCOUNT_NOT_CLAIMABLE'
  | 'SERVICE_DISABLED'

export type ClaimResult =
  | { ok: true; accountId: string; offerId: string | null }
  | { ok: false; detail: ClaimDetail }

/**
 * The one sentence a failed claim produces. There is deliberately no variant.
 *
 * It offers the way forward — request a fresh link — without confirming that
 * there is anything at the other end to get back into.
 */
export const CLAIM_FAILED_MESSAGE =
  'This link cannot be used. It may have already been used, or it may have expired — ' +
  'these links work once. If you were expecting to reach a private record, request a ' +
  'fresh link below and we will email one to the address the invitation was sent to.'

export async function claimPortalToken(rawToken: string): Promise<ClaimResult> {
  const token = rawToken.trim()
  if (token === '') return { ok: false, detail: 'UNKNOWN_TOKEN' }

  const config = await readServiceConfig()

  const row = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.tokenHash, hashToken(token)),
  })

  // Constant-time comparison as well as the hash lookup. Belt and braces, but a
  // timing side channel on a securities portal is not a thing to leave lying
  // around.
  if (!row || !tokensMatch(token, row.tokenHash)) {
    return { ok: false, detail: 'UNKNOWN_TOKEN' }
  }

  if (row.purpose !== 'CLAIM' && row.purpose !== 'SIGN_IN') {
    return { ok: false, detail: 'UNKNOWN_TOKEN' }
  }

  if (row.revokedAt !== null) return { ok: false, detail: 'REVOKED' }
  if (row.usedAt !== null) return { ok: false, detail: 'ALREADY_USED' }
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, detail: 'EXPIRED' }

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, row.accountId),
  })
  if (!account) return { ok: false, detail: 'UNKNOWN_TOKEN' }

  const access = portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })

  // A CLAIM token needs a claimable account; a SIGN_IN token needs an account
  // that may still be issued links, which is the same question asked of the
  // state it is in now rather than the state it was in when the link was sent.
  const permitted = row.purpose === 'CLAIM' ? access.allowClaim : access.issueLink
  if (!permitted) {
    return {
      ok: false,
      detail: config.serviceMode === 'DISABLED' ? 'SERVICE_DISABLED' : 'ACCOUNT_NOT_CLAIMABLE',
    }
  }

  // Single use, enforced here rather than by the read above.
  const [spent] = await db
    .update(portalTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(portalTokens.id, row.id),
        isNull(portalTokens.usedAt),
        isNull(portalTokens.revokedAt),
      ),
    )
    .returning({ id: portalTokens.id })

  if (!spent) return { ok: false, detail: 'ALREADY_USED' }

  // §4.1: "On claim, the account's email is marked verified and the account
  // transitions to active." Only from invited — a closed account signing back
  // in through a read-only link must not be quietly reopened.
  if (account.status === 'INVITED') {
    await db
      .update(investorAccounts)
      .set({
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        lastSignInAt: new Date(),
      })
      .where(eq(investorAccounts.id, account.id))
  } else {
    await db
      .update(investorAccounts)
      .set({ lastSignInAt: new Date() })
      .where(eq(investorAccounts.id, account.id))
  }

  await audit({
    actor: { kind: 'investor', id: account.id, label: 'investor' },
    entityType: 'investor_account',
    entityId: account.id,
    action: row.purpose === 'CLAIM' ? 'portal.claimed' : 'portal.signed_in',
    // No token, no address.
    metadata: { purpose: row.purpose, wasInvited: account.status === 'INVITED' },
  })

  return { ok: true, accountId: account.id, offerId: row.offerId }
}

export interface SignInLinkRequest {
  email: string
  now?: Date
}

/**
 * The floor every sign-in-link request is padded to.
 *
 * It has to exceed the slowest legitimate path, or the padding does nothing for
 * the request that overruns it. A hundred and fifty milliseconds covers four
 * round trips to a local or same-region Postgres with room to spare, and is
 * short enough that nobody waiting for the confirmation notices it.
 */
export const SIGN_IN_LINK_FLOOR_MS = 150

export interface SignInLinkDeps {
  /** Injected in tests so the floor does not make the suite wait. */
  sleep?: (ms: number) => Promise<void>
  monotonicNow?: () => number
  /** Replaces the padding wholesale. Tests only. */
  settle?: () => Promise<void>
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Pad to a fixed elapsed time, measured from the moment this is built.
 *
 * Padding to a floor rather than equalising the work is the conservative
 * choice: equal work has to be re-established every time somebody adds a query,
 * and nothing fails when they forget. A floor keeps holding.
 */
function settleTo(floorMs: number, deps: SignInLinkDeps): () => Promise<void> {
  const clock = deps.monotonicNow ?? (() => Date.now())
  const sleep = deps.sleep ?? realSleep
  const started = clock()
  return async () => {
    const remaining = floorMs - (clock() - started)
    if (remaining > 0) await sleep(remaining)
  }
}

/**
 * What the server should do about a sign-in request.
 *
 * `issued` is never shown to the visitor — the response is
 * `SIGN_IN_ACCEPTED_MESSAGE` either way. It is returned so the caller can
 * actually send the email when there is one to send, and so a test can assert
 * that a suspended account gets nothing.
 */
export interface SignInLinkOutcome {
  issued: boolean
  /** Present only when `issued`. Never logged. */
  token: string | null
  accountId: string | null
  detail:
    | 'ISSUED'
    | 'NO_SUCH_ACCOUNT'
    | 'ACCOUNT_CANNOT_SIGN_IN'
    | 'SERVICE_DISABLED'
}

export async function requestSignInLink(
  input: SignInLinkRequest,
  deps: SignInLinkDeps = {},
): Promise<SignInLinkOutcome> {
  const email = input.email.trim().toLowerCase()
  const now = input.now ?? new Date()
  const config = await readServiceConfig()

  // Every path out of this function is padded to the same elapsed time. The
  // sentence returned is already identical for every address (§4.1); the work
  // done was not, and that is the same leak wearing a different hat.
  //
  //   unknown address        one SELECT
  //   known but suspended    one SELECT, one audit INSERT
  //   known and eligible     one SELECT, one UPDATE, two INSERTs
  //
  // The response body cannot tell a stranger whether Bob is on the recipient
  // list. Three distinct latency bands, sampled freely because this form is
  // public and unauthenticated, can — and a list of who received a private
  // securities invitation is exactly what §15 exists to protect. The admin
  // sign-in path has solved this since WP2 by always verifying a hash, real or
  // dummy, and sleeping to a floor; this is the same idea, applied where the
  // work differs by row count rather than by hashing.
  const settle = deps.settle ?? settleTo(SIGN_IN_LINK_FLOOR_MS, deps)

  const nothing = async (
    detail: SignInLinkOutcome['detail'],
  ): Promise<SignInLinkOutcome> => {
    await settle()
    return { issued: false, token: null, accountId: null, detail }
  }

  if (email === '') return nothing('NO_SUCH_ACCOUNT')

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.email, email),
  })
  if (!account) return nothing('NO_SUCH_ACCOUNT')

  const access = portalAccess({
    accountStatus: account.status as AccountStatus,
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })

  if (!access.issueLink) {
    // §4.2: "requesting a sign-in link is accepted silently but no link is
    // issued". Audited, so the owner can see it happened, and silent outward.
    await audit({
      actor: { kind: 'investor', id: account.id, label: 'investor' },
      entityType: 'investor_account',
      entityId: account.id,
      action: 'portal.sign_in_link_refused',
      metadata: { accountStatus: account.status, serviceMode: config.serviceMode },
    })
    return nothing(
      config.serviceMode === 'DISABLED' ? 'SERVICE_DISABLED' : 'ACCOUNT_CANNOT_SIGN_IN',
    )
  }

  // Any outstanding sign-in link for this account is revoked first, so asking
  // twice does not leave two live ways in.
  await db
    .update(portalTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(portalTokens.accountId, account.id),
        eq(portalTokens.purpose, 'SIGN_IN'),
        isNull(portalTokens.usedAt),
        isNull(portalTokens.revokedAt),
      ),
    )

  const { token, hash } = issueToken()

  await db.insert(portalTokens).values({
    accountId: account.id,
    purpose: 'SIGN_IN',
    tokenHash: hash,
    expiresAt: new Date(now.getTime() + SIGN_IN_TOKEN_TTL_MINUTES * 60 * 1000),
  })

  await audit({
    actor: { kind: 'investor', id: account.id, label: 'investor' },
    entityType: 'investor_account',
    entityId: account.id,
    action: 'portal.sign_in_link_issued',
    // The token is not in here, and never will be.
    metadata: { expiresInMinutes: SIGN_IN_TOKEN_TTL_MINUTES },
  })

  await settle()
  return { issued: true, token, accountId: account.id, detail: 'ISSUED' }
}

/**
 * Ends every session and revokes every unspent link for an account.
 *
 * §4.2: "Suspension and closure take effect immediately — active sessions are
 * terminated, outstanding links are revoked." Both halves, in one place, so a
 * future caller cannot do one and forget the other.
 */
export async function revokeAllPortalAccess(accountId: string): Promise<void> {
  const now = new Date()

  await db
    .update(investorSessions)
    .set({ revokedAt: now })
    .where(and(eq(investorSessions.accountId, accountId), isNull(investorSessions.revokedAt)))

  await db
    .update(portalTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(portalTokens.accountId, accountId),
        isNull(portalTokens.usedAt),
        isNull(portalTokens.revokedAt),
      ),
    )
}
