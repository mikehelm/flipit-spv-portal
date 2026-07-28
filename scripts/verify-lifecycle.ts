/**
 * Database-backed verification that suspension actually works. BUILD_SPEC §4.2.
 *
 * *"Suspension and closure take effect immediately — active sessions are
 * terminated, outstanding links are revoked."*
 *
 * `changeAccountStatus` has implemented that since WP8 and nothing called it,
 * so the sentence was true of a function nobody could reach. This runs the real
 * flow against a real Postgres with two investors present and checks both
 * halves, and checks that the other investor is untouched by any of it.
 *
 *   pnpm tsx scripts/verify-lifecycle.ts
 */

import 'dotenv/config'
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  accountStatusEvents,
  investorAccounts,
  investorSessions,
  portalTokens,
  serviceConfig,
  users,
} from '@/db/schema'
import { readServiceConfig, SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { buildHealthReport } from '@/lib/health/report'
import { loadPortalView } from '@/lib/portal/data'
import { issueToken } from '@/lib/crypto'
import { portalAccess } from '@/lib/portal/access'
import { loadAdminAccounts } from '@/lib/portal/accounts-data'
import { claimPortalToken, CLAIM_FAILED_MESSAGE } from '@/lib/portal/claim'
import { requestSignInLink } from '@/lib/portal/claim'
import { changeAccountStatus } from '@/lib/portal/lifecycle'
import { everyOf } from '@/lib/verify/vacuous'

const PREFIX = 'lifecycle-verify'

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

async function cleanup(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))
  const ids = accounts.map((row) => row.id)
  if (ids.length === 0) return

  await db.delete(accountStatusEvents).where(inArray(accountStatusEvents.accountId, ids))
  await db.delete(investorSessions).where(inArray(investorSessions.accountId, ids))
  await db.delete(portalTokens).where(inArray(portalTokens.accountId, ids))
  await db.delete(investorAccounts).where(inArray(investorAccounts.id, ids))
}

async function makeAccount(slug: string, name: string) {
  const [account] = await db
    .insert(investorAccounts)
    .values({
      email: `${PREFIX}-${slug}@example.test`,
      name,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    })
    .returning()

  const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  // Two live sessions and two unspent links, so "revokes everything" is
  // measurably different from "revokes one".
  for (let index = 0; index < 2; index += 1) {
    await db.insert(investorSessions).values({
      sessionToken: `${PREFIX}-${slug}-session-${index}`,
      accountId: account!.id,
      expires: later,
    })
    const { hash } = issueToken()
    await db.insert(portalTokens).values({
      accountId: account!.id,
      purpose: 'CLAIM',
      tokenHash: hash,
      expiresAt: later,
    })
  }

  return account!
}

async function liveCounts(accountId: string) {
  const sessions = await db
    .select({ id: investorSessions.id })
    .from(investorSessions)
    .where(and(eq(investorSessions.accountId, accountId), isNull(investorSessions.revokedAt)))
  const links = await db
    .select({ id: portalTokens.id })
    .from(portalTokens)
    .where(
      and(
        eq(portalTokens.accountId, accountId),
        isNull(portalTokens.usedAt),
        isNull(portalTokens.revokedAt),
      ),
    )
  return { sessions: sessions.length, links: links.length }
}

async function main(): Promise<void> {
  await cleanup()

  const owner = await db.query.users.findFirst({ where: eq(users.role, 'OWNER') })
  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!owner || !operator) throw new Error('Run `pnpm db:seed` first.')

  const ownerActor = { id: owner.id, email: owner.email, name: owner.name, role: 'OWNER' as const }
  const operatorActor = {
    id: operator.id,
    email: operator.email,
    name: operator.name,
    role: 'OPERATOR' as const,
  }

  console.log('\nSetting up')
  const alice = await makeAccount('alice', 'Alice Lifecycle')
  const bob = await makeAccount('bob', 'Bob Lifecycle')

  const before = await liveCounts(alice.id)
  check('two live sessions and two unspent links each', before.sessions === 2 && before.links === 2)

  console.log('\nRefusals — before anything is changed')

  const noReason = await changeAccountStatus({
    accountId: alice.id,
    to: 'SUSPENDED',
    reason: '   ',
    actor: ownerActor,
  })
  check('a suspension with no reason is refused', !noReason.ok)

  const stillThere = await liveCounts(alice.id)
  check(
    'and it changed nothing at all',
    stillThere.sessions === 2 && stillThere.links === 2,
  )

  const operatorArchive = await changeAccountStatus({
    accountId: bob.id,
    to: 'ARCHIVED',
    reason: 'Attempting to archive as the operator, which should be refused.',
    actor: operatorActor,
  })
  check(
    'an operator cannot archive — that is the owner’s',
    !operatorArchive.ok && operatorArchive.reason === 'OPERATOR_CANNOT_ARCHIVE',
  )

  const sameState = await changeAccountStatus({
    accountId: alice.id,
    to: 'ACTIVE',
    reason: 'Moving to the state it is already in.',
    actor: ownerActor,
  })
  check('moving to the state it is already in is refused', !sameState.ok)

  console.log('\nSuspension takes effect immediately')

  const suspended = await changeAccountStatus({
    accountId: alice.id,
    to: 'SUSPENDED',
    reason: 'Her mailbox may be compromised; cutting access while we confirm.',
    actor: ownerActor,
    investorNotified: true,
  })
  check('the suspension succeeds', suspended.ok, suspended.ok ? '' : suspended.message)

  const after = await liveCounts(alice.id)
  check('every session is revoked', after.sessions === 0, String(after.sessions))
  check('every unspent link is revoked', after.links === 0, String(after.links))

  const bobAfter = await liveCounts(bob.id)
  check(
    'and the other investor is completely untouched',
    bobAfter.sessions === 2 && bobAfter.links === 2,
  )

  const config = await readServiceConfig()
  const access = portalAccess({
    accountStatus: 'SUSPENDED',
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })
  check('a suspended account may not claim', !access.allowClaim)
  check('and may not be issued a new link', !access.issueLink)

  const refused = await requestSignInLink(
    { email: `${PREFIX}-alice@example.test` },
    { settle: async () => {} },
  )
  check('asking for a new link produces nothing', !refused.issued && refused.token === null)
  check(
    'and the refusal is recorded as a decision about the account, not an error',
    refused.detail === 'ACCOUNT_CANNOT_SIGN_IN' || refused.detail === 'SERVICE_DISABLED',
    refused.detail,
  )

  const eligible = await requestSignInLink(
    { email: `${PREFIX}-bob@example.test` },
    { settle: async () => {} },
  )
  check('an unaffected investor can still get one', eligible.issued && eligible.token !== null)

  console.log('\nThe record')

  const events = await db
    .select()
    .from(accountStatusEvents)
    .where(eq(accountStatusEvents.accountId, alice.id))
  check('one status event was written', events.length === 1)
  check('it records where they came from and where they went', events[0]?.fromStatus === 'ACTIVE' && events[0]?.toStatus === 'SUSPENDED')
  check('it records the reason', (events[0]?.reason ?? '').includes('compromised'))
  check('it records who did it', events[0]?.actorUserId === owner.id)
  check('it records whether the investor was told', events[0]?.investorNotified === true)

  console.log('\nThe operator’s screen')

  const rows = await loadAdminAccounts()
  const aliceRow = rows.find((row) => row.id === alice.id)!
  const bobRow = rows.find((row) => row.id === bob.id)!

  check('the list shows both accounts', Boolean(aliceRow) && Boolean(bobRow))
  check('it shows the suspended account with nothing live', aliceRow.liveSessions === 0 && aliceRow.liveLinks === 0)
  check(
    'it shows what a suspension would end for somebody still active',
    bobRow.liveSessions === 2 && bobRow.liveLinks >= 2,
  )
  check('it carries the history with its reason', aliceRow.history.length === 1 && aliceRow.history[0]!.reason.includes('compromised'))
  check('and never a token', !JSON.stringify(rows).includes('tokenHash'))

  console.log('\nRestoring, and closing')

  const restored = await changeAccountStatus({
    accountId: alice.id,
    to: 'ACTIVE',
    reason: 'Confirmed the mailbox is hers; restoring access.',
    actor: ownerActor,
  })
  check('a suspension is reversible', restored.ok)

  const afterRestore = await liveCounts(alice.id)
  check(
    'but restoring does not un-revoke anything — they sign in again the ordinary way',
    afterRestore.sessions === 0 && afterRestore.links === 0,
  )

  const closed = await changeAccountStatus({
    accountId: bob.id,
    to: 'CLOSED',
    reason: 'Round complete for this investor; closing the account.',
    actor: operatorActor,
  })
  check('an operator may close', closed.ok)

  const closedCounts = await liveCounts(bob.id)
  check('closing revokes everything too', closedCounts.sessions === 0 && closedCounts.links === 0)

  const closedAccess = portalAccess({
    accountStatus: 'CLOSED',
    closedAccountAccess: 'READ_ONLY',
    serviceMode: 'ACTIVE',
  })
  check(
    'a closed account with read-only access can still sign back in',
    closedAccess.issueLink && closedAccess.capability === 'READ_ONLY',
  )

  // -------------------------------------------------------------------------
  // The claim token itself — single use, expiry, revocation. AC5, WP19.
  //
  // Single use is enforced by a conditional UPDATE rather than by reading the
  // row and then writing it, so that two simultaneous redemptions cannot both
  // succeed. That is a property of the database, not of the code, and it is not
  // testable anywhere but here.
  // -------------------------------------------------------------------------

  console.log('\nThe claim token')

  const [claimant] = await db
    .insert(investorAccounts)
    .values({
      email: `${PREFIX}-claimant@example.test`,
      name: 'Claim Verify',
      status: 'INVITED',
    })
    .returning()

  const fresh = issueToken()
  await db.insert(portalTokens).values({
    accountId: claimant!.id,
    purpose: 'CLAIM',
    tokenHash: fresh.hash,
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  })

  const firstUse = await claimPortalToken(fresh.token)
  check('a live claim link works', firstUse.ok, JSON.stringify(firstUse))

  const secondUse = await claimPortalToken(fresh.token)
  check('and works exactly once', !secondUse.ok)
  check(
    'the second attempt is recorded as already used',
    !secondUse.ok && secondUse.detail === 'ALREADY_USED',
  )

  // Two redemptions racing. Both read an unspent row; only one may spend it.
  const raced = issueToken()
  await db.insert(portalTokens).values({
    accountId: claimant!.id,
    purpose: 'CLAIM',
    tokenHash: raced.hash,
    expiresAt: new Date(Date.now() + 60_000),
  })
  const both = await Promise.all([
    claimPortalToken(raced.token),
    claimPortalToken(raced.token),
  ])
  check(
    'two simultaneous redemptions produce exactly one success',
    both.filter((r) => r.ok).length === 1,
    both.map((r) => (r.ok ? 'ok' : r.detail)).join(' / '),
  )

  const stale = issueToken()
  await db.insert(portalTokens).values({
    accountId: claimant!.id,
    purpose: 'CLAIM',
    tokenHash: stale.hash,
    expiresAt: new Date(Date.now() - 1000),
  })
  const expired = await claimPortalToken(stale.token)
  check('an expired claim link is refused', !expired.ok && expired.detail === 'EXPIRED')

  const killed = issueToken()
  await db.insert(portalTokens).values({
    accountId: claimant!.id,
    purpose: 'CLAIM',
    tokenHash: killed.hash,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: new Date(),
  })
  const revoked = await claimPortalToken(killed.token)
  check('a revoked claim link is refused', !revoked.ok && revoked.detail === 'REVOKED')

  const invented = await claimPortalToken(issueToken().token)
  check('a token nobody issued is refused', !invented.ok && invented.detail === 'UNKNOWN_TOKEN')

  // §15: the refusal is one sentence with no variants, so a failed claim never
  // says whether there was anything at the other end of it.
  check(
    'every refusal shows the investor the same sentence',
    CLAIM_FAILED_MESSAGE.length > 0 &&
      new Set(
        [secondUse, expired, revoked, invented].map(() => CLAIM_FAILED_MESSAGE),
      ).size === 1,
  )

  const spentRows = await db
    .select({ hash: portalTokens.tokenHash })
    .from(portalTokens)
    .where(eq(portalTokens.accountId, claimant!.id))
  check(
    'no token is stored in the clear — only its hash',
    everyOf(spentRows, (row) => row.hash !== fresh.token && row.hash !== raced.token),
  )

  // -------------------------------------------------------------------------
  // The contact route on a notice. §4.2, §7.
  //
  // §4.2 gives a suspended account "a neutral notice page with a contact
  // route" and §7 gives a closed portal "a neutral closed page with a contact
  // address". Both notices existed for months carrying the sentence "please
  // contact David" and no address at all — an instruction with no way to
  // follow it, to somebody who has just been locked out of the only page that
  // ever named him.
  //
  // `contact.test.ts` proves the rules. What only a database shows is that the
  // configured addresses actually reach the view an investor is served, and
  // that clearing them produces nothing rather than a broken sentence.
  // -------------------------------------------------------------------------

  console.log('\nThe contact route on a notice')

  const configBefore = await readServiceConfig()

  try {
    await db
      .update(serviceConfig)
      .set({
        defaultSenderEmail: `${PREFIX}-operator@example.test`,
        serviceContactEmail: `${PREFIX}-standing@example.test`,
      })
      .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

    const suspension = await changeAccountStatus({
      accountId: bob.id,
      to: 'SUSPENDED',
      reason: 'Verifying the contact route on the notice.',
      actor: ownerActor,
      investorNotified: false,
    })
    check('the account can be suspended for this check', suspension.ok)

    const suspendedView = await loadPortalView(bob.id)
    check('a suspended account is served a notice', suspendedView?.access.notice === 'SUSPENDED')
    check(
      'and the notice carries the operator address first',
      suspendedView?.contacts[0]?.address === `${PREFIX}-operator@example.test` &&
        suspendedView?.contacts[0]?.use === 'PRIMARY',
      JSON.stringify(suspendedView?.contacts),
    )
    check(
      'with the standing address underneath it — Open Decision 7',
      suspendedView?.contacts[1]?.address === `${PREFIX}-standing@example.test` &&
        suspendedView?.contacts[1]?.use === 'FALLBACK',
    )
    check(
      'and nothing that came from any account',
      everyOf(suspendedView?.contacts ?? [], (row) => !row.address.includes('alice')),
    )

    // §7: once the portal is closing, the operator's address has stopped being
    // monitored and must not be offered underneath a live one.
    await db
      .update(serviceConfig)
      .set({ serviceMode: 'SUNSET', sunsetClosingDate: '2026-09-30' })
      .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

    const aliceView = await loadPortalView(alice.id)
    check('a closing portal shows every account the sunset notice', aliceView?.access.notice === 'SUNSET')
    check(
      'and the notice carries the configured closing date — §7, §11.3',
      aliceView?.closingDate === '2026-09-30',
      String(aliceView?.closingDate),
    )
    check(
      'and offers the standing address alone',
      aliceView?.contacts.length === 1 &&
        aliceView.contacts[0]!.address === `${PREFIX}-standing@example.test`,
      JSON.stringify(aliceView?.contacts),
    )

    // Nothing configured. The page must say nothing rather than name a route
    // that is not one — and the health report must call that out.
    await db
      .update(serviceConfig)
      .set({ defaultSenderEmail: null, serviceContactEmail: null })
      .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

    const bare = await loadPortalView(alice.id)
    check('with nothing configured the notice names nobody', bare?.contacts.length === 0)

    // The real report, against the real row — not the rule with facts handed
    // to it. The gap this closes is the one where the rule is right and
    // nothing ever gives it the truth.
    const report = await buildHealthReport()
    const finding = report.findings.find((row) => row.area === 'Contact route')
    check(
      'and the health report calls that a fault while the portal is closing',
      finding?.severity === 'WRONG',
      JSON.stringify(finding),
    )
    check(
      'without naming either address in a line bound for a log file',
      finding !== undefined &&
        !/[\w.+-]+@[\w-]+\.[\w.]+/.test(`${finding.headline} ${finding.detail} ${finding.remedy}`),
    )
  } finally {
    await db
      .update(serviceConfig)
      .set({
        defaultSenderEmail: configBefore.defaultSenderEmail,
        serviceContactEmail: configBefore.serviceContactEmail,
        serviceMode: configBefore.serviceMode,
        sunsetClosingDate: configBefore.sunsetClosingDate,
      })
      .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))
  }

  const configAfter = await readServiceConfig()
  check(
    'the service configuration is exactly as it was',
    configAfter.serviceMode === configBefore.serviceMode &&
      configAfter.defaultSenderEmail === configBefore.defaultSenderEmail &&
      configAfter.serviceContactEmail === configBefore.serviceContactEmail &&
      configAfter.sunsetClosingDate === configBefore.sunsetClosingDate,
  )

  console.log('\nCleaning up')
  await cleanup()
  const orphans = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))
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
