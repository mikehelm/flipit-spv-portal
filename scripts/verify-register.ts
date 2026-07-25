/**
 * Database-backed verification of WP10. BUILD_SPEC §5.2.
 *
 * The unit tests pin the ordering and the copy. This runs the real flow against
 * a real Postgres and checks the two things that only exist once there are rows:
 *
 *   - **No investor sees any position.** §5.2.2. Checked by serialising the
 *     investor-facing view with several other people on the register and
 *     asserting nothing about any of them appears in it.
 *   - **An offer issued from the register is blocked by the jurisdiction gate
 *     exactly as an original offer would be.** §5.2.4. Checked by recording a
 *     real approval covering GB only and issuing to somebody in the US.
 *
 * It creates its own data under an obvious prefix and deletes it at the end.
 *
 *   pnpm tsx scripts/verify-register.ts
 */

import 'dotenv/config'
import { and, eq, isNull, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  commitments,
  complianceApprovals,
  fundsReceipts,
  interestRegisterEntries,
  investorAccounts,
  offers,
  recipients,
  rounds,
  users,
} from '@/db/schema'
import { portalAccess } from '@/lib/portal/access'
import { readServiceConfig } from '@/lib/auth/service-config'
import { loadInvestorRegisterView, loadOperatorRegister } from '@/lib/register/data'
import {
  addToRegisterManually,
  clearOrderOverride,
  issueOfferFromRegister,
  joinRegister,
  leaveRegister,
  setOrderOverride,
} from '@/lib/register/service'

const PREFIX = 'wp10-verify'
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

async function cleanup(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    const rows = await db
      .select({ id: offers.id, recipientId: offers.recipientId })
      .from(offers)
      .where(eq(offers.accountId, account.id))

    for (const row of rows) {
      await db.delete(commitments).where(eq(commitments.offerId, row.id))
      await db.delete(fundsReceipts).where(eq(fundsReceipts.offerId, row.id))
    }
    await db.delete(offers).where(eq(offers.accountId, account.id))
    for (const row of rows) {
      if (row.recipientId) {
        await db.delete(recipients).where(eq(recipients.id, row.recipientId))
      }
    }
    await db
      .delete(interestRegisterEntries)
      .where(eq(interestRegisterEntries.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(recipients).where(like(recipients.email, `${PREFIX}%`))
  await db
    .delete(complianceApprovals)
    .where(like(complianceApprovals.evidenceReference, `${PREFIX}%`))
}

async function makeAccount(slug: string, name: string) {
  const [account] = await db
    .insert(investorAccounts)
    .values({ email: `${PREFIX}-${slug}@example.test`, name, status: 'ACTIVE' })
    .returning()
  return account!
}

async function main(): Promise<void> {
  await cleanup()

  const round = await db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
  if (!round) throw new Error('No open round. Run `pnpm db:seed` first.')

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) throw new Error('No operator user. Run `pnpm db:seed` first.')
  actor = { kind: 'user', id: operator.id, label: operator.email }

  const config = await readServiceConfig()
  const access = portalAccess({
    accountStatus: 'ACTIVE',
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })

  const settled = await makeAccount('settled', 'Settled Sam')
  const committed = await makeAccount('committed', 'Committed Chris')
  const plain = await makeAccount('plain', 'Plain Pat')

  // Give the first two a participation history, so the bands are real.
  const [settledOffer] = await db
    .insert(offers)
    .values({
      roundId: round.id,
      accountId: settled.id,
      proposedAmountUsd: '5000.00',
      spvPercentage: '16.666667',
      indirectPercentage: '5.000000',
      responseDeadline: '2026-08-10',
      receivedAmountUsd: '5000.00',
      stage: 'FUNDS_RECEIVED',
    })
    .returning()

  await db.insert(fundsReceipts).values({
    offerId: settledOffer!.id,
    amount: '5000.00',
    valueDate: '2026-07-05',
    reference: `${PREFIX}-ref`,
  })

  const [committedOffer] = await db
    .insert(offers)
    .values({
      roundId: round.id,
      accountId: committed.id,
      proposedAmountUsd: '3000.00',
      spvPercentage: '10.000000',
      indirectPercentage: '3.000000',
      responseDeadline: '2026-08-10',
      committedAmountUsd: '3000.00',
      stage: 'COMMITMENT_AGREED',
    })
    .returning()

  await db.insert(commitments).values({
    offerId: committedOffer!.id,
    amountUsd: '3000.00',
    spvPercentage: '10.000000',
    agreedAt: new Date('2026-07-08T00:00:00Z'),
  })

  console.log('\nJoining and leaving (§5.2.3)')

  // Deliberately out of the order the computation will produce.
  check(
    'a plain investor joins',
    (await joinRegister({ accountId: plain.id, actor, now: new Date('2026-07-02T00:00:00Z') })).ok,
  )
  check(
    'an investor who has settled joins later',
    (await joinRegister({ accountId: settled.id, actor, now: new Date('2026-07-20T00:00:00Z') })).ok,
  )
  check(
    'an investor who has committed joins',
    (await joinRegister({
      accountId: committed.id,
      indicativeAmount: '$2,500',
      actor,
      now: new Date('2026-07-21T00:00:00Z'),
    })).ok,
  )

  const committedRow = await db.query.interestRegisterEntries.findFirst({
    where: eq(interestRegisterEntries.accountId, committed.id),
  })
  check(
    'an indicative figure is stored as an exact decimal string',
    committedRow?.indicativeAmountUsd === '2500.00',
    String(committedRow?.indicativeAmountUsd),
  )

  const badFigure = await joinRegister({
    accountId: plain.id,
    indicativeAmount: 'about a lot',
    actor,
  })
  check('an unreadable indicative figure is refused, kindly', !badFigure.ok)

  console.log('\nWhat the investor sees (§5.2.2)')

  const plainView = await loadInvestorRegisterView(plain.id, access)
  check('they can see that they are on the register', plainView.onRegister)
  check(
    'the view has exactly three fields',
    JSON.stringify(Object.keys(plainView).sort()) ===
      JSON.stringify(['canChange', 'indicativeAmount', 'onRegister']),
    Object.keys(plainView).join(','),
  )

  const serialised = JSON.stringify(plainView)
  check('no position appears', !/position|rank|order/i.test(serialised))
  check('no count appears', !/\d+\s*(of|people|others)/i.test(serialised))
  check("no other member's name appears", !serialised.includes('Settled Sam'))
  check("no other member's address appears", !serialised.includes(settled.email))

  const leftAndBack = await leaveRegister({ accountId: plain.id, actor })
  check('an investor can remove themselves', leftAndBack.ok)
  const afterLeaving = await loadInvestorRegisterView(plain.id, access)
  check('and the portal reflects it immediately', !afterLeaving.onRegister)
  check(
    'leaving twice is not an error',
    (await leaveRegister({ accountId: plain.id, actor })).ok,
  )
  check(
    'and they can add their name again',
    (await joinRegister({ accountId: plain.id, actor, now: new Date('2026-07-22T00:00:00Z') })).ok,
  )

  console.log('\nThe computed order (§5.2.2)')

  let register = await loadOperatorRegister()
  check('everyone on the register appears', register.length === 3)
  check(
    'settled funds come first, then commitment, then the rest',
    register.map((row) => row.name).join(' | ') ===
      'Settled Sam | Committed Chris | Plain Pat',
    register.map((row) => row.name).join(' | '),
  )
  check(
    'the bands are labelled',
    register[0]?.band === 'FUNDS_RECEIVED' && register[2]?.band === 'ON_THE_REGISTER',
  )
  check(
    'the history carries formatted strings, never numbers',
    typeof register[0]?.history.receivedAmount === 'string' &&
      typeof register[1]?.history.committedAmount === 'string',
  )

  console.log('\nOverrides (§5.2.2)')

  const noReason = await setOrderOverride({
    accountId: plain.id,
    position: 1,
    reason: 'because',
    actorUserId: operator.id,
    actor,
  })
  check('an override with a thin reason is refused', !noReason.ok)

  const withReason = await setOrderOverride({
    accountId: plain.id,
    position: 1,
    reason: 'Agreed with the owner on the call of 24 July 2026.',
    actorUserId: operator.id,
    actor,
  })
  check('an override with a recorded reason is applied', withReason.ok)

  register = await loadOperatorRegister()
  check('the overridden person moves to the top', register[0]?.name === 'Plain Pat')
  check('the override is flagged', register[0]?.overridden === true)
  check('the reason is shown', (register[0]?.overrideReason ?? '').includes('24 July'))
  check(
    'where the computation put them is still visible',
    register[0]?.computedPosition === 3,
    String(register[0]?.computedPosition),
  )

  await clearOrderOverride({ accountId: plain.id, actor })
  register = await loadOperatorRegister()
  check('clearing the override restores the computed order', register[0]?.name === 'Settled Sam')

  console.log('\nAdding somebody who was never a recipient (§5.2.3)')

  const added = await addToRegisterManually({
    name: 'Newcomer Nina',
    email: `${PREFIX}-nina@example.test`,
    indicativeAmount: '1000',
    actor,
  })
  check('a stranger can be added', added.ok)
  if (!added.ok) throw new Error(added.message)
  check('an account was created for them', added.createdAccount)

  const nina = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, added.accountId),
  })
  check('the new account is INVITED, not ACTIVE', nina?.status === 'INVITED')

  register = await loadOperatorRegister()
  check('they appear on the register', register.some((row) => row.name === 'Newcomer Nina'))
  check(
    'and are marked as added by the operator',
    register.find((row) => row.name === 'Newcomer Nina')?.addedByOperator === true,
  )

  console.log('\nIssuing an offer from the register (§5.2.3, §5.2.4)')

  // A real approval, covering Great Britain only.
  await db.insert(complianceApprovals).values({
    approverName: 'A. Lawyer',
    approverRole: 'Partner',
    approvedAt: new Date('2026-07-20T00:00:00Z'),
    evidenceReference: `${PREFIX} letter`,
    approvedJurisdictions: ['GB'],
    approvedTemplateHash: 'f'.repeat(64),
    templateKind: 'INVITATION',
    recordedById: operator.id,
  })

  const cleared = await issueOfferFromRegister({
    accountId: added.accountId,
    jurisdiction: 'GB',
    investmentAmountUsd: '$2,000',
    spvPercentage: '6.5%',
    responseDeadline: '2026-12-31',
    actor,
  })
  check('an offer can be issued to a cleared jurisdiction', cleared.ok)
  if (!cleared.ok) throw new Error(cleared.message)
  check('and it is not blocked', !cleared.blocked)

  const clearedOffer = await db.query.offers.findFirst({ where: eq(offers.id, cleared.offerId) })
  check('it is an ordinary offer row', clearedOffer !== undefined)
  check('it carries a recipient row for the gate to read', clearedOffer?.recipientId !== null)
  check('its email status is DRAFT — nothing was sent', clearedOffer?.emailStatus === 'DRAFT')
  check(
    'the indirect percentage was computed, not typed',
    clearedOffer?.indirectPercentage === '1.950000',
    String(clearedOffer?.indirectPercentage),
  )
  check(
    'the amount is an exact decimal string',
    clearedOffer?.proposedAmountUsd === '2000.00',
    String(clearedOffer?.proposedAmountUsd),
  )

  const blocked = await issueOfferFromRegister({
    accountId: plain.id,
    jurisdiction: 'US',
    investmentAmountUsd: '2000',
    spvPercentage: '6.5',
    responseDeadline: '2026-12-31',
    actor,
  })
  check('an offer to an uncleared jurisdiction is still created', blocked.ok)
  if (!blocked.ok) throw new Error(blocked.message)
  check('and is blocked individually by the gate', blocked.blocked)
  check(
    'with a reason naming the country',
    (blocked.blockDetail ?? '').includes('United States'),
    blocked.blockDetail ?? '(none)',
  )

  const blockedOffer = await db.query.offers.findFirst({ where: eq(offers.id, blocked.offerId) })
  check('the blocked offer records the jurisdiction reason', blockedOffer?.blockReason === 'JURISDICTION_NOT_APPROVED')
  check('and its email status is BLOCKED', blockedOffer?.emailStatus === 'BLOCKED')

  const stillCleared = await db.query.offers.findFirst({ where: eq(offers.id, cleared.offerId) })
  check(
    'the block stopped one recipient, not the batch',
    stillCleared?.blocked === false && stillCleared?.emailStatus === 'DRAFT',
  )

  const badCountry = await issueOfferFromRegister({
    accountId: committed.id,
    jurisdiction: 'ZZ',
    investmentAmountUsd: '1000',
    spvPercentage: '3',
    responseDeadline: '2026-12-31',
    actor,
  })
  check('an invalid country code creates nothing at all', !badCountry.ok)

  const pastDeadline = await issueOfferFromRegister({
    accountId: committed.id,
    jurisdiction: 'GB',
    investmentAmountUsd: '1000',
    spvPercentage: '3',
    responseDeadline: '2020-01-01',
    actor,
  })
  check('a past deadline is refused', !pastDeadline.ok)

  await leaveRegister({ accountId: committed.id, actor })
  const afterLeave = await issueOfferFromRegister({
    accountId: committed.id,
    jurisdiction: 'GB',
    investmentAmountUsd: '1000',
    spvPercentage: '3',
    responseDeadline: '2026-12-31',
    actor,
  })
  check('somebody who has left the register cannot be issued from it', !afterLeave.ok)

  console.log('\nAn issued offer does not remove them from the register')

  register = await loadOperatorRegister()
  check(
    'the person who was issued an offer is still on the register',
    register.some((row) => row.name === 'Newcomer Nina'),
  )

  await cleanup()

  const orphans = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(and(like(investorAccounts.email, `${PREFIX}%`)))
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
