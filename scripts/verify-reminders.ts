/**
 * Database-backed verification of WP12. BUILD_SPEC §6.5.
 *
 * The unit tests pin the eligibility rules and the schedule arithmetic. This
 * runs the real queue against a real Postgres with five recipients in different
 * states and checks the four things §6.5 calls load-bearing:
 *
 *   - a responder is never chased,
 *   - the cap holds,
 *   - a queued reminder can be cancelled and is never recreated,
 *   - nothing sends in a non-active service mode.
 *
 *   pnpm tsx scripts/verify-reminders.ts
 */

import 'dotenv/config'
import { eq, isNull, like } from 'drizzle-orm'
import { db } from '@/db'
import {
  investorAccounts,
  offers,
  recipients,
  reminderEvents,
  reminderSchedules,
  rounds,
  serviceConfig,
  users,
} from '@/db/schema'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { cancelReminder, loadQueue, refreshQueue, rescheduleReminder } from '@/lib/reminders/queue'
import { runDueReminders, sendOne } from '@/lib/reminders/run'

const PREFIX = 'wp12-verify'
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
      await db.delete(reminderEvents).where(eq(reminderEvents.offerId, row.id))
    }
    await db.delete(offers).where(eq(offers.accountId, account.id))
    for (const row of rows) {
      if (row.recipientId) {
        await db.delete(recipients).where(eq(recipients.id, row.recipientId))
      }
    }
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(recipients).where(like(recipients.email, `${PREFIX}%`))
}

/** A deadline far enough out that both default reminders are in the future. */
function futureDeadline(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}

async function main(): Promise<void> {
  await cleanup()

  const round = await db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
  if (!round) throw new Error('No open round. Run `pnpm db:seed` first.')

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) throw new Error('No operator user. Run `pnpm db:seed` first.')
  actor = { kind: 'user', id: operator.id, label: operator.email }

  const schedule = await db.query.reminderSchedules.findFirst({
    where: eq(reminderSchedules.roundId, round.id),
  })
  if (!schedule) throw new Error('No reminder schedule. Run `pnpm db:seed` first.')

  await db
    .update(reminderSchedules)
    .set({ daysBefore: [7, 2], maxPerRecipient: 2, enabled: true })
    .where(eq(reminderSchedules.id, schedule.id))

  const deadline = futureDeadline(30)

  async function makeRecipient(
    slug: string,
    name: string,
    options: {
      accountStatus?: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
      responseChoice?: 'NO_RESPONSE' | 'INTERESTED'
      emailStatus?: 'DRAFT' | 'SENT'
      blocked?: boolean
    } = {},
  ) {
    const [account] = await db
      .insert(investorAccounts)
      .values({
        email: `${PREFIX}-${slug}@example.test`,
        name,
        status: options.accountStatus ?? 'ACTIVE',
      })
      .returning()

    const [recipient] = await db
      .insert(recipients)
      .values({
        roundId: round!.id,
        name,
        email: `${PREFIX}-${slug}@example.test`,
        jurisdiction: 'GB',
      })
      .returning()

    const [offer] = await db
      .insert(offers)
      .values({
        roundId: round!.id,
        accountId: account!.id,
        recipientId: recipient!.id,
        proposedAmountUsd: '5000.00',
        spvPercentage: '16.666667',
        indirectPercentage: '5.000000',
        responseDeadline: deadline,
        emailStatus: options.emailStatus ?? 'SENT',
        responseChoice: options.responseChoice ?? 'NO_RESPONSE',
        blocked: options.blocked ?? false,
        blockReason: options.blocked ? 'JURISDICTION_NOT_APPROVED' : null,
      })
      .returning()

    return { account: account!, offer: offer! }
  }

  const chaseable = await makeRecipient('chaseable', 'Chaseable Chris')
  const responded = await makeRecipient('responded', 'Responded Rita', {
    responseChoice: 'INTERESTED',
  })
  const blocked = await makeRecipient('blocked', 'Blocked Ben', { blocked: true })
  const suspended = await makeRecipient('suspended', 'Suspended Sue', {
    accountStatus: 'SUSPENDED',
  })
  const neverSent = await makeRecipient('neversent', 'Never-sent Ned', {
    emailStatus: 'DRAFT',
  })

  console.log('\nBuilding the queue (§6.5)')

  const refreshed = await refreshQueue({ roundId: round.id, actor })
  check('the queue is built', refreshed.created > 0)

  let queue = await loadQueue(round.id)
  const forOffer = (offerId: string) => queue.filter((row) => row.offerId === offerId)

  check(
    'a chaseable recipient gets two reminders',
    forOffer(chaseable.offer.id).length === 2,
    String(forOffer(chaseable.offer.id).length),
  )
  check(
    'the two are seven and two days before the deadline',
    forOffer(chaseable.offer.id)
      .map((row) => row.scheduledFor.toISOString().slice(0, 10))
      .join(',') ===
      [7, 2]
        .map((days) =>
          new Date(new Date(`${deadline}T00:00:00Z`).getTime() - days * 86400000)
            .toISOString()
            .slice(0, 10),
        )
        .join(','),
  )
  check('a responder is never queued', forOffer(responded.offer.id).length === 0)
  check('a blocked offer is never queued', forOffer(blocked.offer.id).length === 0)
  check('a suspended account is never queued', forOffer(suspended.offer.id).length === 0)
  check(
    'somebody who has not been sent an invitation is never queued',
    forOffer(neverSent.offer.id).length === 0,
  )

  console.log('\nThe cap holds (§6.5 — "Never more.")')

  await db
    .update(reminderSchedules)
    .set({ daysBefore: [21, 14, 7, 2], maxPerRecipient: 2 })
    .where(eq(reminderSchedules.id, schedule.id))

  await refreshQueue({ roundId: round.id, actor })
  queue = await loadQueue(round.id)
  check(
    'four scheduled days with a cap of two produces two reminders',
    forOffer(chaseable.offer.id).length === 2,
    String(forOffer(chaseable.offer.id).length),
  )
  check(
    'and they are the two furthest from the deadline',
    forOffer(chaseable.offer.id)[0]!.scheduledFor <
      forOffer(chaseable.offer.id)[1]!.scheduledFor,
  )

  await db
    .update(reminderSchedules)
    .set({ daysBefore: [7, 2], maxPerRecipient: 2 })
    .where(eq(reminderSchedules.id, schedule.id))
  await refreshQueue({ roundId: round.id, actor })

  console.log('\nResponding empties the queue')

  await db
    .update(offers)
    .set({ responseChoice: 'INTERESTED', responseAt: new Date() })
    .where(eq(offers.id, chaseable.offer.id))

  await refreshQueue({ roundId: round.id, actor })
  queue = await loadQueue(round.id)
  check(
    'answering removes every planned reminder for that person',
    forOffer(chaseable.offer.id).length === 0,
  )

  await db
    .update(offers)
    .set({ responseChoice: 'NO_RESPONSE', responseAt: null })
    .where(eq(offers.id, chaseable.offer.id))
  await refreshQueue({ roundId: round.id, actor })
  queue = await loadQueue(round.id)
  check('and un-answering plans them again', forOffer(chaseable.offer.id).length === 2)

  console.log('\nCancelling and rescheduling (§6.5)')

  const first = forOffer(chaseable.offer.id)[0]!
  const cancelled = await cancelReminder({
    reminderId: first.id,
    actorUserId: operator.id,
    actor,
  })
  check('a queued reminder can be cancelled', cancelled.ok)

  queue = await loadQueue(round.id)
  check(
    'it shows as cancelled',
    queue.find((row) => row.id === first.id)?.state === 'CANCELLED',
  )

  await refreshQueue({ roundId: round.id, actor })
  queue = await loadQueue(round.id)
  check(
    'rebuilding the queue does not resurrect it',
    queue.find((row) => row.id === first.id)?.cancelledAt !== null &&
      forOffer(chaseable.offer.id).filter((row) => row.state === 'QUEUED').length === 1,
  )

  const second = forOffer(chaseable.offer.id).find((row) => row.state === 'QUEUED')!
  const movedBack = await rescheduleReminder({
    reminderId: second.id,
    scheduledFor: new Date(Date.now() - 60_000),
    actor,
  })
  check('a reminder cannot be moved into the past', !movedBack.ok)

  const movedPastDeadline = await rescheduleReminder({
    reminderId: second.id,
    scheduledFor: new Date(`${futureDeadline(60)}T09:00:00Z`),
    actor,
  })
  check('a reminder cannot be moved past the response deadline', !movedPastDeadline.ok)

  const moved = await rescheduleReminder({
    reminderId: second.id,
    scheduledFor: new Date(Date.now() + 3 * 86400000),
    actor,
  })
  check('a reminder can be moved to a sensible time', moved.ok)

  console.log('\nSending, and the gates in front of it')

  // Bring one reminder due by moving it to just now.
  await db
    .update(reminderEvents)
    .set({ scheduledFor: new Date(Date.now() - 60_000) })
    .where(eq(reminderEvents.id, second.id))

  const attempt = await sendOne({ reminderId: second.id, actor })
  check(
    'sending is refused here, and not silently',
    attempt.kind !== 'SENT',
    attempt.kind === 'SENT' ? 'it sent' : undefined,
  )
  if (attempt.kind !== 'SENT') {
    console.log(`        ${attempt.kind}: ${attempt.reason.slice(0, 110)}…`)
  }

  const afterAttempt = await db.query.reminderEvents.findFirst({
    where: eq(reminderEvents.id, second.id),
  })
  check('a refused reminder is not marked as sent', afterAttempt?.sentAt === null)

  const offerAfter = await db.query.offers.findFirst({ where: eq(offers.id, chaseable.offer.id) })
  check(
    'and it does not rewrite the invitation’s email status',
    offerAfter?.emailStatus === 'SENT',
    String(offerAfter?.emailStatus),
  )

  console.log('\nNothing sends outside active service mode (§6.5)')

  const config = await db.query.serviceConfig.findFirst({
    where: eq(serviceConfig.id, SERVICE_CONFIG_ID),
  })

  await db
    .update(reminderEvents)
    .set({ skippedReason: null, sentAt: null, cancelledAt: null })
    .where(eq(reminderEvents.id, second.id))

  await db
    .update(serviceConfig)
    .set({ serviceMode: 'READ_ONLY' })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  const inReadOnly = await sendOne({ reminderId: second.id, actor })
  check('a reminder is refused in read-only mode', inReadOnly.kind === 'SKIPPED')

  const heldRow = await db.query.reminderEvents.findFirst({
    where: eq(reminderEvents.id, second.id),
  })
  check(
    'a service-mode hold does not consume the reminder',
    heldRow?.skippedReason === null && heldRow?.sentAt === null,
  )

  const readOnlyQueue = await loadQueue(round.id)
  check(
    'the queue explains the hold rather than hiding the row',
    readOnlyQueue.find((row) => row.id === second.id)?.state === 'HELD',
  )

  const runInReadOnly = await runDueReminders({ actor })
  check('a whole run in read-only mode sends nothing', runInReadOnly.sent === 0)

  await db
    .update(serviceConfig)
    .set({ serviceMode: config?.serviceMode ?? 'ACTIVE' })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))

  console.log('\nThe schedule switch')

  await db
    .update(reminderSchedules)
    .set({ enabled: false })
    .where(eq(reminderSchedules.id, schedule.id))

  await refreshQueue({ roundId: round.id, actor })
  const disabledQueue = await loadQueue(round.id)
  check(
    'switching reminders off holds every row without deleting the queue',
    disabledQueue.filter((row) => row.state === 'QUEUED').length === 0 &&
      disabledQueue.length > 0,
  )

  const runDisabled = await runDueReminders({ actor })
  check('and a run sends nothing', runDisabled.sent === 0)

  await db
    .update(reminderSchedules)
    .set({ enabled: true, daysBefore: [7, 2], maxPerRecipient: 2 })
    .where(eq(reminderSchedules.id, schedule.id))

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
