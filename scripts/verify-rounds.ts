/**
 * Database-backed verification of WP16. BUILD_SPEC §6.6, §7.
 *
 * The unit tests pin the digest wording and the cadence. This checks the thing
 * §6.6 is emphatic about and that only a database can demonstrate: **a deadline
 * passing closes nothing, and inaction closes nothing.**
 *
 *   pnpm tsx scripts/verify-rounds.ts
 */

import 'dotenv/config'
import { eq, isNull, like } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, offers, rounds, serviceConfig, users } from '@/db/schema'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { canRespond, portalAccess } from '@/lib/portal/access'
import { closeRound, extendDeadline, extendRoundDeadline, reopenRound } from '@/lib/rounds/close'
import { lastDigestAt, sendRoundDigest } from '@/lib/rounds/digest'
import { loadRoundSummary } from '@/lib/rounds/summary'

const PREFIX = 'wp16-verify'
let actor: { kind: 'user'; id: string; label: string }

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

async function cleanup(roundId?: string): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    await db.delete(offers).where(eq(offers.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  if (roundId) {
    await db.update(rounds).set({ closedAt: null, closedById: null }).where(eq(rounds.id, roundId))
  }
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  await cleanup()

  const round = await db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
  if (!round) throw new Error('No open round. Run `pnpm db:seed` first.')

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) throw new Error('No operator user. Run `pnpm db:seed` first.')
  actor = { kind: 'user', id: operator.id, label: operator.email }

  async function makeOffer(
    slug: string,
    name: string,
    deadline: string,
    responseChoice: 'NO_RESPONSE' | 'INTERESTED' = 'NO_RESPONSE',
  ) {
    const [account] = await db
      .insert(investorAccounts)
      .values({ email: `${PREFIX}-${slug}@example.test`, name, status: 'ACTIVE' })
      .returning()

    const [offer] = await db
      .insert(offers)
      .values({
        roundId: round!.id,
        accountId: account!.id,
        proposedAmountUsd: '5000.00',
        committedAmountUsd: responseChoice === 'INTERESTED' ? '5000.00' : null,
        spvPercentage: '16.666667',
        indirectPercentage: '5.000000',
        responseDeadline: deadline,
        originalDeadline: deadline,
        emailStatus: 'SENT',
        responseChoice,
      })
      .returning()

    return { account: account!, offer: offer! }
  }

  // One past their deadline, one still with time, one who answered.
  const late = await makeOffer('late', 'Late Larry', inDays(-3))
  const waiting = await makeOffer('waiting', 'Waiting Wendy', inDays(10))
  const answered = await makeOffer('answered', 'Answered Anna', inDays(-1), 'INTERESTED')

  console.log('\nThe summary (§6.6)')

  let summary = (await loadRoundSummary(round.id))!
  const ours = summary.participants.filter((row) =>
    [late.offer.id, waiting.offer.id, answered.offer.id].includes(row.offerId),
  )

  check('every participant appears', ours.length === 3)
  check(
    'a passed deadline is marked reached',
    ours.find((row) => row.offerId === late.offer.id)?.deadlineReached === true,
  )
  check(
    'a future deadline is not',
    ours.find((row) => row.offerId === waiting.offer.id)?.deadlineReached === false,
  )
  check(
    'the totals are formatted strings, never numbers',
    typeof summary.totals.committed === 'string' &&
      /^[\d,]+\.\d{2}$/.test(summary.totals.committed),
    summary.totals.committed,
  )

  console.log('\nA deadline passing closes nothing (§6.6)')

  const roundNow = await db.query.rounds.findFirst({ where: eq(rounds.id, round.id) })
  check('the round is still open', roundNow?.closedAt === null)

  const access = portalAccess({
    accountStatus: 'ACTIVE',
    closedAccountAccess: 'READ_ONLY',
    serviceMode: 'ACTIVE',
  })
  check('and an investor can still respond', canRespond(access))

  const lateOffer = await db.query.offers.findFirst({ where: eq(offers.id, late.offer.id) })
  check(
    'a passed deadline changes nothing on the offer',
    lateOffer?.stage === 'INVITATION_SENT' && lateOffer?.blocked === false,
  )

  console.log('\nExtending (§6.6)')

  const backwards = await extendDeadline({
    offerId: waiting.offer.id,
    newDeadline: inDays(2),
    actor,
  })
  check('a deadline cannot be brought forward from this screen', !backwards.ok)

  const past = await extendDeadline({
    offerId: late.offer.id,
    newDeadline: inDays(-1),
    actor,
  })
  check('a deadline cannot be extended into the past', !past.ok)

  const extended = await extendDeadline({
    offerId: late.offer.id,
    newDeadline: inDays(14),
    reason: 'Asked for another fortnight on the call of 25 July.',
    actor,
  })
  check('one person can be given longer', extended.ok)

  summary = (await loadRoundSummary(round.id))!
  const lateAfter = summary.participants.find((row) => row.offerId === late.offer.id)!
  check('their new deadline is recorded', lateAfter.responseDeadline === inDays(14))
  check('their original deadline is preserved', lateAfter.originalDeadline === inDays(-3))
  check(
    'and they now count as having asked for more time',
    summary.counts.extended >= 1,
  )

  const globally = await extendRoundDeadline({
    roundId: round.id,
    newDeadline: inDays(30),
    reason: 'Extending the whole round by a month.',
    actor,
  })
  check('everyone who has not responded can be extended at once', globally.ok)

  summary = (await loadRoundSummary(round.id))!
  check(
    'the non-responders moved',
    summary.participants.find((row) => row.offerId === waiting.offer.id)?.responseDeadline ===
      inDays(30),
  )
  check(
    'and somebody who already answered did not',
    summary.participants.find((row) => row.offerId === answered.offer.id)?.responseDeadline ===
      inDays(-1),
  )

  console.log('\nThe digest (§6.6)')

  const before = await lastDigestAt(round.id)
  const digest = await sendRoundDigest({ roundId: round.id, actor, force: true })
  check(
    'sending is refused here, with a reason from the gate',
    !digest.sent && digest.reason.length > 30,
    digest.sent ? 'it sent' : undefined,
  )
  const after = await lastDigestAt(round.id)
  check('a refused digest is not recorded as sent', String(after) === String(before))

  console.log('\nClosing (§6.6)')

  const unconfirmed = await closeRound({
    roundId: round.id,
    confirmed: false,
    actorUserId: operator.id,
    actor,
  })
  check('closing without the confirmation is refused', !unconfirmed.ok)

  const early = await closeRound({
    roundId: round.id,
    confirmed: true,
    actorUserId: operator.id,
    actor,
  })
  check(
    'closing while somebody still has time needs an explicit acknowledgement',
    !early.ok && early.message.includes('time left'),
  )

  const stillOpen = await db.query.rounds.findFirst({ where: eq(rounds.id, round.id) })
  check('and neither refusal closed anything', stillOpen?.closedAt === null)

  const closed = await closeRound({
    roundId: round.id,
    confirmed: true,
    closingEarlyAcknowledged: true,
    actorUserId: operator.id,
    actor,
  })
  check('closing with both confirmations works', closed.ok)

  const closedRound = await db.query.rounds.findFirst({ where: eq(rounds.id, round.id) })
  check('the round is closed', closedRound?.closedAt !== null)
  check('and it records who closed it', closedRound?.closedById === operator.id)

  const twice = await closeRound({
    roundId: round.id,
    confirmed: true,
    closingEarlyAcknowledged: true,
    actorUserId: operator.id,
    actor,
  })
  check('closing twice is refused', !twice.ok)

  const extendClosed = await extendRoundDeadline({
    roundId: round.id,
    newDeadline: inDays(60),
    actor,
  })
  check('a closed round cannot be extended', !extendClosed.ok)

  const digestClosed = await sendRoundDigest({ roundId: round.id, actor })
  check(
    'no digest is due for a closed round',
    !digestClosed.sent && digestClosed.reason.includes('No digest is due'),
  )

  console.log('\nReopening')

  const noReason = await reopenRound({ roundId: round.id, reason: 'oops', actor })
  check('reopening without a real reason is refused', !noReason.ok)

  const reopened = await reopenRound({
    roundId: round.id,
    reason: 'Closed by mistake while testing the confirmation.',
    actor,
  })
  check('reopening with a recorded reason works', reopened.ok)
  check(
    'and the round is open again',
    (await db.query.rounds.findFirst({ where: eq(rounds.id, round.id) }))?.closedAt === null,
  )

  console.log('\nService modes (§7)')

  const config = await db.query.serviceConfig.findFirst({
    where: eq(serviceConfig.id, SERVICE_CONFIG_ID),
  })

  for (const mode of ['ACTIVE', 'READ_ONLY', 'SUNSET', 'DISABLED'] as const) {
    const modeAccess = portalAccess({
      accountStatus: 'ACTIVE',
      closedAccountAccess: 'READ_ONLY',
      serviceMode: mode,
    })
    const expected =
      mode === 'ACTIVE' ? 'FULL' : mode === 'DISABLED' ? 'NONE' : 'READ_ONLY'
    check(`${mode} gives an active investor ${expected}`, modeAccess.capability === expected)
  }

  await db
    .update(serviceConfig)
    .set({ serviceMode: config?.serviceMode ?? 'ACTIVE' })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  await cleanup(round.id)

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
