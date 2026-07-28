/**
 * Database-backed verification of the acknowledgement checkboxes.
 * BUILD_SPEC §13, §8.2.
 *
 * The unit tests pin the wording gate, the standing line and the source-level
 * rules. This runs the real reads and writes against real Postgres and checks
 * the one thing that only exists once there are rows: **editing approved
 * wording does not rewrite what anybody already agreed to.**
 *
 * It creates its own data under an obvious prefix and deletes it at the end.
 *
 *   pnpm verify:acknowledgements
 */

import 'dotenv/config'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  acknowledgementItems,
  investorAccounts,
  offers,
  responseAcknowledgements,
} from '@/db/schema'
import {
  acknowledgementHistory,
  activeAcknowledgementItems,
  currentAcknowledgements,
  recordAcknowledgements,
} from '@/lib/portal/acknowledgements-data'
import { forbiddenWordsInAcknowledgement } from '@/lib/portal/acknowledgements'
import { everyOf, noneOf } from '@/lib/verify/vacuous'

const PREFIX = 'wp-ack-verify'

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
    .where(like(investorAccounts.email, `%${PREFIX}%`))

  for (const account of accounts) {
    const rows = await db
      .select({ id: offers.id })
      .from(offers)
      .where(eq(offers.accountId, account.id))
    for (const row of rows) {
      await db
        .delete(responseAcknowledgements)
        .where(eq(responseAcknowledgements.offerId, row.id))
      await db.delete(offers).where(eq(offers.id, row.id))
    }
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(acknowledgementItems).where(like(acknowledgementItems.label, `%${PREFIX}%`))
}

async function main(): Promise<void> {
  await cleanup()

  const round = await db.query.rounds.findFirst()
  if (!round) throw new Error('No round. Run `pnpm db:seed` first.')

  const [account] = await db
    .insert(investorAccounts)
    .values({
      email: `alex.${PREFIX}@example.com`,
      name: 'Alex Doe',
      status: 'ACTIVE',
    })
    .returning({ id: investorAccounts.id })

  const [other] = await db
    .insert(investorAccounts)
    .values({ email: `bea.${PREFIX}@example.com`, name: 'Bea Stone', status: 'ACTIVE' })
    .returning({ id: investorAccounts.id })

  const [offer] = await db
    .insert(offers)
    .values({
      roundId: round.id,
      accountId: account.id,
      proposedAmountUsd: '5000',
      spvPercentage: '2.5',
      indirectPercentage: '0.5',
      responseDeadline: '2026-12-31',
    })
    .returning({ id: offers.id })

  const [otherOffer] = await db
    .insert(offers)
    .values({
      roundId: round.id,
      accountId: other.id,
      proposedAmountUsd: '9000',
      spvPercentage: '4',
      indirectPercentage: '0.8',
      responseDeadline: '2026-12-31',
    })
    .returning({ id: offers.id })

  console.log('\nThe configured wording')

  const originalWords = `I have read and understood that this is a private invitation. ${PREFIX}`
  const [item] = await db
    .insert(acknowledgementItems)
    .values({ label: originalWords, required: true, sortOrder: 0 })
    .returning()

  const [optional] = await db
    .insert(acknowledgementItems)
    .values({
      label: `I understand no payment is requested at this stage. ${PREFIX}`,
      required: false,
      sortOrder: 1,
    })
    .returning()

  const [archived] = await db
    .insert(acknowledgementItems)
    .values({
      label: `Wording that has been withdrawn. ${PREFIX}`,
      required: true,
      sortOrder: 2,
      archivedAt: new Date(),
    })
    .returning()

  const active = await activeAcknowledgementItems()
  const activeMine = active.filter((row) => row.label.includes(PREFIX))
  check('live wording is offered', activeMine.length === 2)
  check(
    'archived wording is not',
    noneOf(activeMine, (row) => row.id === archived.id),
  )
  check(
    'and it comes back in the configured order',
    activeMine[0]?.id === item.id && activeMine[1]?.id === optional.id,
  )
  check('every live item starts at revision 1', everyOf(activeMine, (row) => row.revision === 1))

  console.log('\nWhat an investor ticked')

  const firstResponse = new Date('2026-07-01T10:00:00Z')
  await recordAcknowledgements({
    offerId: offer.id,
    ticked: activeMine,
    at: firstResponse,
  })

  let ticked = await currentAcknowledgements(offer.id)
  check('both boxes are recorded', ticked.size === 2)
  check('and come back as ticked on the form', ticked.has(item.id) && ticked.has(optional.id))

  const history = await acknowledgementHistory(offer.id)
  check(
    'the words are stored, not a pointer to them',
    history.some((row) => row.label === originalWords),
  )

  console.log('\nEditing approved wording does not rewrite what was agreed')

  const newWords = `I have read and understood that this is a private invitation and not an offer to the public. ${PREFIX}`
  await db
    .update(acknowledgementItems)
    .set({ label: newWords, revision: item.revision + 1, updatedAt: new Date() })
    .where(eq(acknowledgementItems.id, item.id))

  const after = await acknowledgementHistory(offer.id)
  check(
    'the acknowledgement still carries the words as shown',
    after.some((row) => row.label === originalWords),
  )
  check(
    'and does not carry the new words',
    // The words as shown are the control: a history that had stopped returning
    // anything would satisfy the negative on its own.
    noneOf(
      after,
      (row) => row.label === newWords,
      (row) => row.label === originalWords,
    ),
  )
  check(
    'and still carries the revision it was ticked under',
    after.some((row) => row.label === originalWords && row.revision === 1),
  )

  const live = (await activeAcknowledgementItems()).filter((r) => r.label.includes(PREFIX))
  check(
    'while the portal now shows the new words at revision 2',
    live.some((row) => row.id === item.id && row.label === newWords && row.revision === 2),
  )

  console.log('\nChanging a response replaces the set without destroying the old one')

  const secondResponse = new Date('2026-07-02T11:00:00Z')
  await recordAcknowledgements({
    offerId: offer.id,
    ticked: live.filter((row) => row.id === item.id),
    at: secondResponse,
  })

  ticked = await currentAcknowledgements(offer.id)
  check('the current set is the newer one', ticked.size === 1 && ticked.has(item.id))
  check(
    'the earlier set is still on the record',
    (await acknowledgementHistory(offer.id)).length === 3,
  )
  check(
    'and the earlier one is still readable with its own words',
    (await acknowledgementHistory(offer.id)).some(
      (row) => row.label === originalWords && row.revision === 1,
    ),
  )

  console.log('\nNothing reaches another investor')

  check(
    "another investor's offer has no acknowledgements",
    (await currentAcknowledgements(otherOffer.id)).size === 0,
  )
  check(
    'and no history',
    (await acknowledgementHistory(otherOffer.id)).length === 0,
  )

  console.log('\nArchiving keeps the evidence')

  await db
    .update(acknowledgementItems)
    .set({ archivedAt: new Date() })
    .where(eq(acknowledgementItems.id, optional.id))

  check(
    'the archived item is off the portal',
    noneOf(await activeAcknowledgementItems(), (row) => row.id === optional.id),
  )
  check(
    'and what was ticked under it is still on the record',
    (await acknowledgementHistory(offer.id)).some((row) => row.label.includes('no payment')),
  )

  console.log('\nThe wording gate, against real stored values')

  check(
    'every seeded item would pass the gate it is stored behind',
    [originalWords, newWords, optional.label].every(
      (label) => forbiddenWordsInAcknowledgement(label).length === 0,
    ),
  )
  check(
    'and wording that undertakes would not',
    forbiddenWordsInAcknowledgement('I agree to subscribe for the amount shown.').length > 0,
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
