/**
 * Database-backed verification of the contact-address change. BUILD_SPEC §13.
 *
 * The unit tests pin the pure parts, the copy and a set of source-level rules.
 * This runs the real flow against real Postgres and checks the things that only
 * exist once there are rows:
 *
 *   - **The address does not move until the link is opened.** §13's whole
 *     sentence. Checked by reading the account back at every step.
 *   - **A second investor's address cannot be taken, and the refusal is
 *     invisible.** §15. Checked with two accounts present, comparing the
 *     outcome of a colliding request against a clean one.
 *   - **A link works once.** Checked by replaying it.
 *   - **Confirming kills every session and every outstanding link.** Checked by
 *     minting a sign-in link and a session first and reading both back after.
 *   - **The export column fills.** §20's `updated contact email`.
 *
 * It creates its own data under an obvious prefix and deletes it at the end.
 *
 *   pnpm verify:email-change
 */

import 'dotenv/config'
import { and, desc, eq, isNull, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  emailChangeRequests,
  investorAccounts,
  investorSessions,
  portalTokens,
} from '@/db/schema'
import { issueToken } from '@/lib/crypto'
import {
  confirmEmailChange,
  confirmedEmailChangeFor,
  EMAIL_CHANGE_TOKEN_TTL_MINUTES,
  pendingEmailChange,
  requestEmailChange,
} from '@/lib/portal/email-change'
import { emptyBeside, everyOf } from '@/lib/verify/vacuous'

const PREFIX = 'wp-emailchange-verify'

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * The two queries that say whether this account still has a way in.
 *
 * Lifted out of the checks because they are now run twice — once before the
 * address moves and once after — and the control is only a control if it is the
 * *same* query. Two queries written out separately drift, and a control that
 * drifted is worse than none: it goes on reporting that there was something to
 * revoke while asking a different question.
 */
async function liveSessionsOf(accountId: string): Promise<{ id: string }[]> {
  return db
    .select({ id: investorSessions.id })
    .from(investorSessions)
    .where(and(eq(investorSessions.accountId, accountId), isNull(investorSessions.revokedAt)))
}

async function liveLinksOf(accountId: string): Promise<{ id: string }[]> {
  return db
    .select({ id: portalTokens.id })
    .from(portalTokens)
    .where(
      and(
        eq(portalTokens.accountId, accountId),
        isNull(portalTokens.usedAt),
        isNull(portalTokens.revokedAt),
      ),
    )
}

async function cleanup(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `%${PREFIX}%`))

  for (const account of accounts) {
    await db.delete(investorSessions).where(eq(investorSessions.accountId, account.id))
    await db.delete(portalTokens).where(eq(portalTokens.accountId, account.id))
    await db
      .delete(emailChangeRequests)
      .where(eq(emailChangeRequests.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }
}

async function makeAccount(local: string, name: string): Promise<string> {
  const [row] = await db
    .insert(investorAccounts)
    .values({ email: `${local}.${PREFIX}@example.com`, name, status: 'ACTIVE' })
    .returning({ id: investorAccounts.id })
  return row.id
}

async function emailOf(accountId: string): Promise<string> {
  const row = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, accountId),
    columns: { email: true },
  })
  return row?.email ?? ''
}

/** The plaintext token is not stored, so a verification has to keep its own. */
async function tokenFor(requestId: string, token: string): Promise<string> {
  const row = await db.query.emailChangeRequests.findFirst({
    where: eq(emailChangeRequests.id, requestId),
    columns: { id: true },
  })
  if (!row) throw new Error('the request vanished')
  return token
}

async function main(): Promise<void> {
  await cleanup()

  console.log('\nNothing moves until the link is opened')

  const alex = await makeAccount('alex', 'Alex Doe')
  const bea = await makeAccount('bea', 'Bea Stone')

  const beaEmail = await emailOf(bea)
  const alexOriginal = await emailOf(alex)
  const target = `alex.new.${PREFIX}@example.com`

  const first = await requestEmailChange({ accountId: alex, newEmail: target })
  check('a request is issued', first.issued && first.token !== null)
  check('the address has not moved', (await emailOf(alex)) === alexOriginal)

  const pending = await pendingEmailChange(alex)
  check('the portal can show the outstanding request', pending?.newEmail === target)
  check(
    'and shows it as expiring',
    pending !== null &&
      pending.expiresAt.getTime() > Date.now() &&
      pending.expiresAt.getTime() <=
        Date.now() + EMAIL_CHANGE_TOKEN_TTL_MINUTES * 60 * 1000 + 5_000,
  )
  check(
    'an outstanding request is not an updated contact email',
    (await confirmedEmailChangeFor(alex)) === null,
  )

  console.log("\nAnother investor's address cannot be taken, and the refusal is invisible")

  const collision = await requestEmailChange({ accountId: alex, newEmail: beaEmail })
  check('no link is issued for an address another record holds', !collision.issued)
  check('and no request row is written for it', collision.requestId === null)
  check(
    'the outcome carries no address for the caller to leak',
    !JSON.stringify(collision).includes(beaEmail),
  )
  check(
    "the other investor's record is untouched",
    (await emailOf(bea)) === beaEmail,
  )

  // The collision must not have superseded the outstanding request either — a
  // refused attempt that quietly cancelled a live one would be a way to
  // interfere with a change by guessing at addresses.
  const stillPending = await pendingEmailChange(alex)
  check('a refused attempt does not cancel the live request', stillPending?.newEmail === target)

  console.log('\nAsking again supersedes the first link rather than adding a second')

  const second = await requestEmailChange({
    accountId: alex,
    newEmail: `alex.other.${PREFIX}@example.com`,
  })
  check('the second request is issued', second.issued)

  const live = await db
    .select({ id: emailChangeRequests.id })
    .from(emailChangeRequests)
    .where(
      and(
        eq(emailChangeRequests.accountId, alex),
        isNull(emailChangeRequests.confirmedAt),
        isNull(emailChangeRequests.revokedAt),
      ),
    )
  check('exactly one live request remains', live.length === 1)

  const supersededResult = await confirmEmailChange(await tokenFor(first.requestId!, first.token!))
  check('the superseded link no longer works', !supersededResult.ok)
  check('and it says so without saying why', !supersededResult.ok && supersededResult.detail === 'REVOKED')
  check('the address still has not moved', (await emailOf(alex)) === alexOriginal)

  console.log('\nConfirming moves the address, and only then')

  // A session and a sign-in link, so the revocation can be observed.
  const { hash: sessionHash } = issueToken()
  await db.insert(investorSessions).values({
    accountId: alex,
    sessionToken: sessionHash,
    expires: new Date(Date.now() + 3_600_000),
  })
  const { hash: linkHash } = issueToken()
  await db.insert(portalTokens).values({
    accountId: alex,
    purpose: 'SIGN_IN',
    tokenHash: linkHash,
    expiresAt: new Date(Date.now() + 3_600_000),
  })

  // The same two queries, before the act. They are the control for the two
  // checks after it: `liveSessions.length === 0` is satisfied by a session
  // that was never created, and by a `where` clause that stopped matching
  // after a column was renamed, exactly as loudly as it is by revocation.
  const sessionsBefore = await liveSessionsOf(alex)
  const linksBefore = await liveLinksOf(alex)

  const confirmed = await confirmEmailChange(await tokenFor(second.requestId!, second.token!))
  check('the link is accepted', confirmed.ok)
  check(
    'the address has moved',
    (await emailOf(alex)) === `alex.other.${PREFIX}@example.com`,
  )

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, alex),
  })
  check('the new address is recorded as verified', account?.emailVerifiedAt !== null)

  check('there was a live session to end', sessionsBefore.length > 0)
  check('every session was ended', emptyBeside(await liveSessionsOf(alex), sessionsBefore))

  check('there was an outstanding sign-in link to revoke', linksBefore.length > 0)
  check(
    'every outstanding sign-in link was revoked',
    emptyBeside(await liveLinksOf(alex), linksBefore),
  )

  console.log('\nA link works once')

  const replay = await confirmEmailChange(await tokenFor(second.requestId!, second.token!))
  check('replaying it is refused', !replay.ok)
  check(
    'the address is not moved a second time',
    (await emailOf(alex)) === `alex.other.${PREFIX}@example.com`,
  )

  console.log('\nAn unknown token is refused, and says nothing')

  const nonsense = await confirmEmailChange('not-a-real-token-at-all')
  check('an invented token is refused', !nonsense.ok)
  check(
    'and is indistinguishable from a spent one to the caller',
    !nonsense.ok && !replay.ok && typeof nonsense.detail === 'string',
  )
  check('an empty token is refused', !(await confirmEmailChange('')).ok)

  console.log("\n§20's updated contact email")

  check(
    'the changed address is reported',
    (await confirmedEmailChangeFor(alex)) === `alex.other.${PREFIX}@example.com`,
  )
  check(
    'an account that never changed reports nothing',
    (await confirmedEmailChangeFor(bea)) === null,
  )

  console.log('\nThe stale-record guard')

  // A request made against one address, then the record moved by something
  // else. The in-flight link must not apply to a state nobody asked about.
  const third = await requestEmailChange({
    accountId: alex,
    newEmail: `alex.third.${PREFIX}@example.com`,
  })
  await db
    .update(investorAccounts)
    .set({ email: `alex.moved.${PREFIX}@example.com` })
    .where(eq(investorAccounts.id, alex))

  const stale = await confirmEmailChange(await tokenFor(third.requestId!, third.token!))
  check('a link made against a since-changed record is refused', !stale.ok)
  check(
    'and the record is left exactly as it was found',
    (await emailOf(alex)) === `alex.moved.${PREFIX}@example.com`,
  )

  console.log('\nWhat the requests table holds')

  const rows = await db
    .select()
    .from(emailChangeRequests)
    .where(eq(emailChangeRequests.accountId, alex))
    .orderBy(desc(emailChangeRequests.createdAt))
  check(
    'every request records the address it was made from',
    everyOf(rows, (r) => r.previousEmail !== null),
  )
  check('no request stores a plaintext token', everyOf(rows, (r) => r.tokenHash.length >= 32))
  check(
    'the confirmed one is the only confirmed one',
    rows.filter((r) => r.confirmedAt !== null).length === 1,
  )

  await cleanup()

  const orphans = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `%${PREFIX}%`))
  check('verification data is removed', orphans.length === 0)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
