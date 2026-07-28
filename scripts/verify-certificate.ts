/**
 * Database-backed verification of WP13 and WP8's deferred status advancement.
 * BUILD_SPEC §5, §5.1.
 *
 *   pnpm tsx scripts/verify-certificate.ts
 */

import 'dotenv/config'
import { eq, isNull, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  fundsReceipts,
  investorAccounts,
  offers,
  participationCertificates,
  recipients,
  rounds,
  serviceConfig,
  users,
} from '@/db/schema'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import {
  certificateDataFor,
  issueCertificate,
  listCertificates,
  renderCertificate,
} from '@/lib/certificate/issue'
import { advanceStage, correctStage, recordFundsReceived } from '@/lib/portal/advance'
import { loadPortalView } from '@/lib/portal/data'
import { everyOf } from '@/lib/verify/vacuous'

const PREFIX = 'wp13-verify'
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
      await db
        .delete(participationCertificates)
        .where(eq(participationCertificates.offerId, row.id))
      await db.delete(fundsReceipts).where(eq(fundsReceipts.offerId, row.id))
    }
    await db.delete(offers).where(eq(offers.accountId, account.id))
    for (const row of rows) {
      if (row.recipientId) {
        await db.delete(recipients).where(eq(recipients.id, row.recipientId))
      }
    }
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The signatory name as this script found it, put back on every path out.
 *
 * At module scope rather than inside `main` so the `finally` below can reach it.
 * See the note where it is read: the restore used to sit at the end of the happy
 * path, which meant one failure left the name configured and every subsequent
 * run failed on a database this script had broken itself.
 */
let signatoryBefore: string | null | undefined

async function restoreTheSignatory(): Promise<void> {
  if (signatoryBefore === undefined) return
  await db
    .update(serviceConfig)
    .set({ defaultSenderName: signatoryBefore })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))
}

async function main(): Promise<void> {
  await cleanup()

  const round = await db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
  if (!round) throw new Error('No open round. Run `pnpm db:seed` first.')

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) throw new Error('No operator user. Run `pnpm db:seed` first.')
  actor = { kind: 'user', id: operator.id, label: operator.email }

  const [account] = await db
    .insert(investorAccounts)
    .values({ email: `${PREFIX}-jane@example.test`, name: 'Jane Verify', status: 'ACTIVE' })
    .returning()

  const [other] = await db
    .insert(investorAccounts)
    .values({ email: `${PREFIX}-bob@example.test`, name: 'Bob Verify', status: 'ACTIVE' })
    .returning()

  const [offer] = await db
    .insert(offers)
    .values({
      roundId: round.id,
      accountId: account!.id,
      proposedAmountUsd: '5000.00',
      spvPercentage: '16.666667',
      indirectPercentage: '5.000000',
      responseDeadline: '2026-12-31',
      emailStatus: 'SENT',
    })
    .returning()

  const [otherOffer] = await db
    .insert(offers)
    .values({
      roundId: round.id,
      accountId: other!.id,
      proposedAmountUsd: '3000.00',
      spvPercentage: '10.000000',
      indirectPercentage: '3.000000',
      responseDeadline: '2026-12-31',
      emailStatus: 'SENT',
    })
    .returning()

  console.log('\nAdvancing the timeline (§5)')

  const skip = await advanceStage({
    offerId: offer!.id,
    toStage: 'COMMITMENT_AGREED',
    actor,
    actorUserId: operator.id,
  })
  check('a step cannot be skipped', !skip.ok)

  const straightToFunds = await advanceStage({
    offerId: offer!.id,
    toStage: 'FUNDS_RECEIVED',
    actor,
    actorUserId: operator.id,
  })
  check(
    'funds received cannot be reached by the ordinary advance',
    !straightToFunds.ok && straightToFunds.message.includes('re-type'),
  )

  for (const stage of [
    'RESPONSE_RECORDED',
    'DOCUMENTS_ISSUED',
    'COMMITMENT_AGREED',
    'ALLOCATION_ACCEPTED',
    'PAYMENT_INSTRUCTIONS_ISSUED',
  ] as const) {
    const result = await advanceStage({
      offerId: offer!.id,
      toStage: stage,
      actor,
      actorUserId: operator.id,
    })
    check(`advances to ${stage.toLowerCase().replace(/_/g, ' ')}`, result.ok)
  }

  const backwards = await correctStage({
    offerId: offer!.id,
    toStage: 'DOCUMENTS_ISSUED',
    reason: 'short',
    actor,
    actorUserId: operator.id,
  })
  check('a correction with a thin reason is refused', !backwards.ok)

  const corrected = await correctStage({
    offerId: offer!.id,
    toStage: 'PAYMENT_INSTRUCTIONS_ISSUED',
    reason: 'Re-asserted after the documents were reissued on 25 July.',
    actor,
    actorUserId: operator.id,
  })
  check('a correction with a recorded reason is applied', corrected.ok)

  console.log('\nFunds received — two steps (§5)')

  const noTick = await recordFundsReceived({
    offerId: offer!.id,
    amount: '5000',
    amountConfirmation: '5000',
    currency: 'USD',
    valueDate: today(),
    reference: 'FLIPIT-0007',
    confirmed: false,
    actor,
    actorUserId: operator.id,
  })
  check('without the confirmation tick, nothing is recorded', !noTick.ok)

  const mismatch = await recordFundsReceived({
    offerId: offer!.id,
    amount: '5000',
    amountConfirmation: '500',
    currency: 'USD',
    valueDate: today(),
    reference: 'FLIPIT-0007',
    confirmed: true,
    actor,
    actorUserId: operator.id,
  })
  check('a mismatched re-typed amount records nothing', !mismatch.ok)

  const stillNothing = await db.query.fundsReceipts.findFirst({
    where: eq(fundsReceipts.offerId, offer!.id),
  })
  check('and truly nothing was written', stillNothing === undefined)

  const futureDate = await recordFundsReceived({
    offerId: offer!.id,
    amount: '5000',
    amountConfirmation: '5000',
    currency: 'USD',
    valueDate: '2099-01-01',
    reference: 'FLIPIT-0007',
    confirmed: true,
    actor,
    actorUserId: operator.id,
  })
  check('a future value date is refused', !futureDate.ok)

  const noReference = await recordFundsReceived({
    offerId: offer!.id,
    amount: '5000',
    amountConfirmation: '5000',
    currency: 'USD',
    valueDate: today(),
    reference: '   ',
    confirmed: true,
    actor,
    actorUserId: operator.id,
  })
  check('a missing payment reference is refused', !noReference.ok)

  const recorded = await recordFundsReceived({
    offerId: offer!.id,
    // Typed differently but the same amount. Compared as decimals, not strings.
    amount: '$5,000',
    amountConfirmation: '5000.00',
    currency: 'usd',
    valueDate: today(),
    reference: 'FLIPIT-0007',
    confirmed: true,
    actor,
    actorUserId: operator.id,
  })
  check('two spellings of the same amount are accepted', recorded.ok)
  check('and it is not treated as a correction', recorded.ok && !recorded.corrected)

  const stored = await db.query.fundsReceipts.findFirst({
    where: eq(fundsReceipts.offerId, offer!.id),
  })
  check('the amount is stored as an exact decimal string', stored?.amount === '5000.00')
  check('the currency is normalised', stored?.currency === 'USD')

  const offerAfter = await db.query.offers.findFirst({ where: eq(offers.id, offer!.id) })
  check('the stage moved to funds received', offerAfter?.stage === 'FUNDS_RECEIVED')
  check(
    'the received amount is separate from the proposed one',
    offerAfter?.receivedAmountUsd === '5000.00' && offerAfter?.proposedAmountUsd === '5000.00',
  )

  console.log('\nThe certificate (§5.1)')

  /*
   * The certificate is signed off by the operator in his stated role, and the
   * refusal while no name is configured is itself worth asserting.
   *
   * **The precondition is arranged, not assumed, and that is a fix rather than a
   * tidy-up.** This used to rely on the seed configuring no name, which made it
   * a check on the *starting state of the database* wearing the name of a check
   * on the application. Two things went wrong with that, and the second one is
   * nasty:
   *
   *   - anything else that had configured a sender — the operator's own
   *     onboarding form, or `verify:viewport`'s email-preview fixture mid-run —
   *     turned this into a silent false pass or a confusing failure.
   *   - the restore at the end of `main` was **not in a `finally`**. So the
   *     first time this script failed for any reason at all, the name stayed
   *     set, and every run afterwards failed here — on a machine where the
   *     application was perfectly correct, with an error about a certificate
   *     that "already states these figures". A verification that poisons the
   *     database it verifies, using its own failure as the poison, is worse than
   *     no verification. Found by running `pnpm verify:all` twice.
   *
   * So: whatever was there is remembered, the name is cleared, the refusal is
   * asserted against a state this script created, and the `finally` in `main`
   * puts the original value back on every path out.
   */
  signatoryBefore = (await db.query.serviceConfig.findFirst())?.defaultSenderName ?? null

  await db
    .update(serviceConfig)
    .set({ defaultSenderName: null })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  const unsigned = await issueCertificate({ offerId: offer!.id, actor })
  check(
    'issuing is refused while no signatory name is configured',
    !unsigned.ok && unsigned.message.includes('signed off by the operator'),
    unsigned.ok ? 'a certificate was issued with nobody signing it' : unsigned.message,
  )

  await db
    .update(serviceConfig)
    .set({ defaultSenderName: 'David Serene' })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  const beforeFunds = await certificateDataFor(otherOffer!.id)
  check(
    'no certificate exists before funds are received',
    'error' in beforeFunds && beforeFunds.error.includes('has not reached that step'),
  )

  const issued = await issueCertificate({ offerId: offer!.id, actor })
  check('a certificate is issued', issued.ok)
  if (!issued.ok) throw new Error(issued.message)
  check('it is version 1', issued.version === 1)

  const again = await issueCertificate({ offerId: offer!.id, actor })
  check('reissuing an identical certificate is refused', !again.ok)

  const pdf = await renderCertificate({
    certificateId: issued.certificateId,
    offerId: offer!.id,
  })
  check('it renders to a PDF', pdf !== null && pdf.length > 1000)
  check('which is a real PDF', pdf!.toString('latin1').startsWith('%PDF-'))

  const text = pdf!.toString('latin1')
  check('carrying the investor’s name', text.includes('Jane Verify'))
  check('the amount received', text.includes('USD 5000.00'))
  check('their SPV percentage', text.includes('16.666667'))
  check('the indirect percentage', text.includes('5.000000'))
  check('the payment reference', text.includes('FLIPIT-0007'))
  check(
    'and the footer saying it is not a share certificate',
    text.includes('NOT a share certificate') && text.includes('NOT a title document'),
  )

  const notTheirs = await renderCertificate({
    certificateId: issued.certificateId,
    offerId: otherOffer!.id,
  })
  check(
    'a certificate cannot be rendered against another investor’s offer',
    notTheirs === null,
  )

  console.log('\nCorrecting a figure reissues it (§5.1)')

  const correctedFunds = await recordFundsReceived({
    offerId: offer!.id,
    amount: '4950.00',
    amountConfirmation: '4950.00',
    currency: 'USD',
    valueDate: today(),
    reference: 'FLIPIT-0007-B',
    confirmed: true,
    actor,
    actorUserId: operator.id,
  })
  check('a re-recording is accepted', correctedFunds.ok)
  check('and is flagged as a correction', correctedFunds.ok && correctedFunds.corrected)

  const reissued = await issueCertificate({ offerId: offer!.id, actor })
  check('the certificate is reissued', reissued.ok)
  if (!reissued.ok) throw new Error(reissued.message)
  check('as version 2', reissued.version === 2)
  check('superseding exactly one earlier version', reissued.superseded === 1)

  const versions = await listCertificates(offer!.id)
  check('both versions are retained', versions.length === 2)
  check(
    'the old one is marked superseded and the new one is not',
    versions.find((row) => row.version === 1)?.supersededAt !== null &&
      versions.find((row) => row.version === 2)?.supersededAt === null,
  )

  const oldPdf = await renderCertificate({
    certificateId: versions.find((row) => row.version === 1)!.id,
    offerId: offer!.id,
  })
  check(
    'the superseded version still states its own original figures',
    oldPdf!.toString('latin1').includes('USD 5000.00'),
  )
  check(
    'and not the corrected ones',
    !oldPdf!.toString('latin1').includes('USD 4950.00'),
  )

  const newPdf = await renderCertificate({
    certificateId: versions.find((row) => row.version === 2)!.id,
    offerId: offer!.id,
  })
  check(
    'the current version states the corrected figures',
    newPdf!.toString('latin1').includes('USD 4950.00'),
  )

  console.log('\nWhat the investor sees')

  const view = await loadPortalView(account!.id)
  const portalOffer = view!.offers.find((row) => row.offerId === offer!.id)
  check('both versions appear on their portal', portalOffer?.certificates.length === 2)
  check(
    'the superseded one is labelled as such',
    portalOffer?.certificates.some((certificate) => certificate.superseded) === true,
  )

  /**
   * §5 step 7: "Amount, currency, value date, reference".
   *
   * All four were recorded and only two reached the timeline — and the currency
   * that did was the literal 'USD' rather than the one the operator entered.
   * The value date and the reference are what an investor checks their own bank
   * record against, which is the whole use of that step.
   */
  const fundsStep = portalOffer?.timeline.find((step) => step.number === 7)
  check(
    'the funds-received step names the amount and its currency',
    fundsStep?.explanation.includes('USD 4,950.00') === true,
    fundsStep?.explanation,
  )
  check(
    'and the value date it was received on',
    fundsStep?.explanation.includes(today()) === true,
    fundsStep?.explanation,
  )
  check(
    'and the payment reference',
    fundsStep?.explanation.includes('FLIPIT-0007-B') === true,
    fundsStep?.explanation,
  )

  /**
   * §5 step 6: "Date issued and how instructions were delivered".
   *
   * The date is taken from the status event that moved the offer into the
   * stage — the most recent one, so a correction that re-issued instructions
   * shows the date the investor should actually be working from. *How* they
   * were delivered is still not captured anywhere; see PROGRESS.md.
   */
  const instructionsStep = portalOffer?.timeline.find((step) => step.number === 6)
  check(
    'the payment-instructions step names the date they were issued',
    instructionsStep?.explanation.includes(today()) === true,
    instructionsStep?.explanation,
  )
  check(
    'and still carries the payment-safety warning',
    instructionsStep?.explanation.includes('verify payment details directly') === true,
  )

  const otherView = await loadPortalView(other!.id)
  check(
    'another investor sees none of them',
    everyOf(otherView!.offers, (row) => row.certificates.length === 0),
  )
  check(
    "and no certificate id of theirs appears in the other investor's view",
    !JSON.stringify(otherView).includes(issued.certificateId),
  )

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
  // Before the exit, and awaited: `process.exit` in the next link would cut a
  // pending write off mid-flight.
  .finally(restoreTheSignatory)
  .finally(() => process.exit(process.exitCode ?? 0))
