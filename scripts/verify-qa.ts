/**
 * Database-backed verification of WP9. BUILD_SPEC §6.7.
 *
 * The unit tests pin the pure rules. This runs the real flow against a real
 * Postgres, with **a second investor present throughout**, and checks the
 * things that only exist once there are rows: that the shared page carries
 * nothing identifying, that one investor's thread never contains another's,
 * that saving an answer sends nothing, and that publishing and emailing are
 * genuinely independent.
 *
 * It creates its own data under an obvious prefix and deletes it at the end.
 * Run it against a development database only:
 *
 *   pnpm tsx scripts/verify-qa.ts
 */

import 'dotenv/config'
import { and, eq, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  investorAccounts,
  offers,
  qaEntries,
  qaThreadMessages,
  serviceConfig,
  users,
} from '@/db/schema'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { loadInvestorQa, loadQaEntry, loadQaQueue, loadSharedQa } from '@/lib/qa/data'
import { portalAccess } from '@/lib/portal/access'
import {
  askQuestion,
  createSeededEntry,
  moveEntry,
  notifyOperatorOfQuestion,
  recordAnswer,
  sendAnswerReply,
  setPinned,
  unpublishEntry,
} from '@/lib/qa/service'
import { everyOf, noneOf } from '@/lib/verify/vacuous'

const PREFIX = 'wp9-verify'

/**
 * The audit log has a real foreign key to `users`, so this runs as the seeded
 * operator rather than as an invented id. That is also the honest test: the
 * audit entry a real answer would write is the one this writes.
 */
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
    const entries = await db
      .select({ id: qaEntries.id })
      .from(qaEntries)
      .where(eq(qaEntries.askedByAccountId, account.id))
    for (const entry of entries) {
      await db.delete(qaThreadMessages).where(eq(qaThreadMessages.entryId, entry.id))
    }
    await db.delete(qaEntries).where(eq(qaEntries.askedByAccountId, account.id))
    await db.delete(offers).where(eq(offers.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  const seeded = await db
    .select({ id: qaEntries.id })
    .from(qaEntries)
    .where(like(qaEntries.questionOriginal, `${PREFIX}%`))
  for (const entry of seeded) {
    await db.delete(qaThreadMessages).where(eq(qaThreadMessages.entryId, entry.id))
    await db.delete(qaEntries).where(eq(qaEntries.id, entry.id))
  }
}

async function main(): Promise<void> {
  await cleanup()

  const round = await db.query.rounds.findFirst()
  if (!round) throw new Error('No round. Run `pnpm db:seed` first.')

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) throw new Error('No operator user. Run `pnpm db:seed` first.')
  actor = { kind: 'user', id: operator.id, label: operator.email }

  const [alice] = await db
    .insert(investorAccounts)
    .values({ email: `${PREFIX}-alice@example.test`, name: 'Alice Verify', status: 'ACTIVE' })
    .returning()

  const [bob] = await db
    .insert(investorAccounts)
    .values({ email: `${PREFIX}-bob@example.test`, name: 'Bob Verify', status: 'ACTIVE' })
    .returning()

  for (const account of [alice!, bob!]) {
    await db.insert(offers).values({
      roundId: round.id,
      accountId: account.id,
      proposedAmountUsd: '5000.00',
      spvPercentage: '16.666667',
      indirectPercentage: '5.000000',
      responseDeadline: '2026-08-10',
    })
  }

  const config = await db.query.serviceConfig.findFirst({
    where: eq(serviceConfig.id, SERVICE_CONFIG_ID),
  })
  const access = portalAccess({
    accountStatus: 'ACTIVE',
    closedAccountAccess: config!.closedAccountAccess,
    serviceMode: config!.serviceMode,
  })

  console.log('\nAsking (§6.7.1)')

  const asked = await askQuestion({
    accountId: alice!.id,
    body: `${PREFIX} As we discussed on Tuesday, can I increase my allocation beyond the 5% you offered me?`,
  })
  check('a question is recorded', asked.ok)
  if (!asked.ok) throw new Error(asked.message)

  // §6.7.1 — the notification is attempted after the question is recorded and
  // is never allowed to fail it. There is no mail credential here, so this
  // exercises the failure path, which is the one that matters: the question
  // must survive and the operator must be told the email did not get out.
  const notified = await notifyOperatorOfQuestion(asked.entryId)
  check('a notification that cannot be sent does not lose the question', !notified.sent)
  check(
    'and the refusal names the actual problem',
    (notified.detail ?? '').length > 40,
  )

  const bobAsked = await askQuestion({
    accountId: bob!.id,
    body: `${PREFIX} What is the SPV, exactly?`,
  })
  check('a second investor can ask independently', bobAsked.ok)
  if (!bobAsked.ok) throw new Error(bobAsked.message)

  const threadRows = await db
    .select()
    .from(qaThreadMessages)
    .where(eq(qaThreadMessages.entryId, asked.entryId))
  check('the question is on the thread', threadRows.length === 1)
  check('the thread message is from the investor', threadRows[0]?.direction === 'FROM_INVESTOR')

  const followUp = await askQuestion({
    accountId: alice!.id,
    body: `${PREFIX} And if the round does not fill?`,
    entryId: asked.entryId,
  })
  check('a follow-up joins the existing thread', followUp.ok && followUp.isFollowUp)

  const crossAccount = await askQuestion({
    accountId: bob!.id,
    body: 'trying someone else’s thread',
    entryId: asked.entryId,
  })
  check(
    'one investor cannot append to another’s thread',
    !crossAccount.ok,
    crossAccount.ok ? 'it was allowed' : undefined,
  )
  check(
    'and the refusal does not confirm the thread exists',
    !crossAccount.ok &&
      !/belongs to|another|someone else|not yours/i.test(crossAccount.message),
  )

  console.log('\nAnswering (§6.7.2)')

  const withoutRewrite = await recordAnswer({
    entryId: asked.entryId,
    answer: 'Allocations are fixed for this round.',
    questionPublic: null,
    publish: true,
    acknowledgedIdentifyingDetail: true,
    actor,
    actorUserId: null,
  })
  check(
    'publishing an investor question without a rewrite is refused',
    !withoutRewrite.ok,
  )

  // A rewrite that still carries a percentage. This is the case §6.7.3 is
  // written about: the wording looks general until you notice the figure.
  const unacknowledged = await recordAnswer({
    entryId: asked.entryId,
    answer: 'Allocations are fixed for this round.',
    questionPublic: 'Can an investor increase their allocation beyond 5%?',
    publish: true,
    acknowledgedIdentifyingDetail: false,
    actor,
    actorUserId: null,
  })
  check(
    'publishing wording containing a percentage needs an acknowledgement',
    !unacknowledged.ok && unacknowledged.needsAcknowledgement === true,
    unacknowledged.ok ? 'it published unacknowledged' : undefined,
  )

  const privateAnswer = await recordAnswer({
    entryId: asked.entryId,
    answer: 'Allocations are fixed for this round.',
    questionPublic: 'Can an investor increase their allocation after the invitation?',
    publish: false,
    acknowledgedIdentifyingDetail: false,
    actor,
    actorUserId: null,
  })
  check('an answer saves without publishing', privateAnswer.ok && !privateAnswer.published)

  let entry = await db.query.qaEntries.findFirst({ where: eq(qaEntries.id, asked.entryId) })
  check('saving does not publish', entry?.isPublished === false)
  check('saving does not send', entry?.answerEmailSentAt === null)
  check(
    'the original question is untouched',
    entry?.questionOriginal.includes('As we discussed on Tuesday') === true,
  )

  console.log('\nThe investor’s own view')

  const aliceView = await loadInvestorQa(alice!.id, access)
  check('the asker sees their own question', aliceView.own.length === 1)
  check(
    'an unpublished, unsent answer is not shown to them',
    aliceView.own[0]?.answer === null,
  )

  const bobView = await loadInvestorQa(bob!.id, access)
  const bobSerialised = JSON.stringify(bobView)
  check('a second investor sees only their own thread', bobView.own.length === 1)
  check("no other investor's name appears", !bobSerialised.includes('Alice Verify'))
  check("no other investor's address appears", !bobSerialised.includes(alice!.email))
  check('no other account id appears', !bobSerialised.includes(alice!.id))

  console.log('\nPublishing (§6.7.3)')

  const published = await recordAnswer({
    entryId: asked.entryId,
    answer: 'Allocations are fixed for this round.',
    questionPublic: 'Can an investor increase their allocation after the invitation?',
    publish: true,
    acknowledgedIdentifyingDetail: false,
    actor,
    actorUserId: null,
  })
  check('publishing succeeds once the wording is clean', published.ok)

  const shared = await loadSharedQa()
  const sharedSerialised = JSON.stringify(shared)
  check('the entry is on the shared page', shared.some((item) => item.id === asked.entryId))
  check('the shared page carries no asker name', !sharedSerialised.includes('Alice Verify'))
  check('the shared page carries no address', !sharedSerialised.includes(alice!.email))
  check('the shared page carries no account id', !sharedSerialised.includes(alice!.id))
  check(
    'the shared page carries the rewrite, not the original',
    !sharedSerialised.includes('As we discussed on Tuesday'),
  )
  check(
    'the shared page has no exact date',
    !/\d{4}-\d{2}-\d{2}/.test(sharedSerialised),
  )

  const bobAfter = await loadInvestorQa(bob!.id, access)
  check(
    'the other investor sees the shared entry without knowing who asked',
    bobAfter.shared.some((item) => item.id === asked.entryId) &&
      !JSON.stringify(bobAfter.shared).includes('Alice'),
  )

  // --- The belt, with the braces cut ---------------------------------------
  //
  // `publishBlock` is enforced twice on purpose. `recordAnswer` refuses to
  // publish an investor's question that has not been rewritten — the checks
  // above drive that — and `toPublicEntry` refuses to *render* one, which its
  // own comment calls "a filter a future caller can forget to write".
  //
  // Nothing tested the second one, and `pnpm verify:mutants` is what said so:
  // the guard inside `toPublicEntry` was removed and every check in this file
  // still passed, because nothing here can put a row into the state that guard
  // exists for. The service will not write it.
  //
  // So this writes it directly. A published entry, with an answer, asked by an
  // investor, with no public rewrite — exactly the row a hand-run UPDATE, a
  // migration, or a future code path that forgets the service could leave
  // behind. The shared page must still refuse it, and must not carry a word of
  // the original wording.
  const smuggled = await createSeededEntry({
    question: `${PREFIX} A seeded question that will be tampered with.`,
    answer: 'An answer that is perfectly publishable on its own.',
    publish: true,
    actor,
    actorUserId: null,
  })
  if (!smuggled.ok) throw new Error('could not seed the tampering fixture')

  await db
    .update(qaEntries)
    .set({
      askedByAccountId: alice!.id,
      questionOriginal: `${PREFIX} As we discussed on Tuesday, can I go above my allocation?`,
      questionPublic: null,
    })
    .where(eq(qaEntries.id, smuggled.entryId))

  const tampered = await loadSharedQa()
  check(
    'a published row with no rewrite is refused by the page, not only by the form',
    !tampered.some((item) => item.id === smuggled.entryId),
    JSON.stringify(tampered.map((item) => item.id)),
  )
  check(
    'and not a word of the original wording reaches it',
    !JSON.stringify(tampered).includes('As we discussed on Tuesday'),
  )
  check(
    'while the entries that are properly rewritten are still there',
    tampered.some((item) => item.id === asked.entryId),
  )

  console.log('\nOrdering and unpublishing')

  const seeded = await createSeededEntry({
    question: `${PREFIX} What is an SPV?`,
    answer: 'A company formed to hold a single asset on behalf of its members.',
    publish: true,
    actor,
    actorUserId: null,
  })
  check('the operator can write an entry directly (§6.7.4)', seeded.ok)
  if (!seeded.ok) throw new Error(seeded.message)

  const pinResult = await setPinned({ entryId: seeded.entryId, pinned: true, actor })
  check('an entry can be pinned', pinResult.ok)

  const afterPin = await loadSharedQa()
  check('a pinned entry sorts first', afterPin[0]?.id === seeded.entryId)

  const move = await moveEntry({ entryId: asked.entryId, direction: 'UP', actor })
  check('an entry can be reordered', move.ok)

  const unpublished = await unpublishEntry({ entryId: seeded.entryId, actor })
  check('an entry can be unpublished', unpublished.ok)
  const afterUnpublish = await loadSharedQa()
  check(
    'an unpublished entry leaves the shared page',
    // The control is the other published entry: a shared page that has stopped
    // returning anything at all would satisfy the negative on its own.
    noneOf(
      afterUnpublish,
      (item) => item.id === seeded.entryId,
      (item) => item.id === asked.entryId,
    ),
  )

  console.log('\nThe reply email (§6.7.2)')

  const send = await sendAnswerReply({ entryId: asked.entryId, actor })
  check(
    'sending is refused here, with a specific reason from the gate',
    !send.ok && send.message.length > 40,
    send.ok ? 'it sent' : undefined,
  )
  if (!send.ok) console.log(`        reason: ${send.message.slice(0, 110)}…`)

  entry = await db.query.qaEntries.findFirst({ where: eq(qaEntries.id, asked.entryId) })
  check('a refused send does not stamp the entry as replied', entry?.answerEmailSentAt === null)
  check('a refused send leaves the publication intact', entry?.isPublished === true)

  const seededEntry = await loadQaEntry(seeded.entryId)
  const seededSend = await sendAnswerReply({ entryId: seeded.entryId, actor })
  check(
    'a seeded entry has nobody to reply to and says so',
    !seededSend.ok && seededSend.message.includes('written directly'),
  )
  check('a seeded entry has no asker in the queue', seededEntry?.asker === null)

  console.log('\nThe operator queue (§6.7.2)')

  const queue = await loadQaQueue('ALL')
  const aliceEntry = queue.find((item) => item.id === asked.entryId)
  check('the queue names who asked', aliceEntry?.asker?.name === 'Alice Verify')
  check('the queue carries their offer detail', aliceEntry?.offerSummary !== null)
  check(
    'the offer figures are formatted strings, never numbers',
    typeof aliceEntry?.offerSummary?.proposedAmount === 'string' &&
      typeof aliceEntry?.offerSummary?.spvPercentage === 'string',
  )
  check('the queue carries their account status', aliceEntry?.asker?.status === 'ACTIVE')
  check(
    'a follow-up after a reply re-opens the thread',
    aliceEntry?.awaitingAnswer === true,
  )
  check(
    'a failed notification is visible rather than silent',
    typeof aliceEntry?.notifyFailure === 'string' && aliceEntry.notifyFailure.length > 0,
  )

  const open = await loadQaQueue('OPEN')
  check(
    'the open filter excludes answered entries',
    everyOf(open, (item) => item.answer === null),
  )

  console.log('\nSuspension')

  await db
    .update(investorAccounts)
    .set({ status: 'SUSPENDED' })
    .where(eq(investorAccounts.id, alice!.id))

  const suspendedAccess = portalAccess({
    accountStatus: 'SUSPENDED',
    closedAccountAccess: config!.closedAccountAccess,
    serviceMode: config!.serviceMode,
  })
  const suspendedView = await loadInvestorQa(alice!.id, suspendedAccess)
  check('a suspended account cannot ask', suspendedView.canAsk === false)
  check('a suspended account sees no shared entries', suspendedView.shared.length === 0)
  check('a suspended account sees no thread', suspendedView.own.length === 0)

  await cleanup()

  const orphans = await db
    .select({ id: qaEntries.id })
    .from(qaEntries)
    .where(and(like(qaEntries.questionOriginal, `${PREFIX}%`)))
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
