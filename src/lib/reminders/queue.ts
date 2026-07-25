/**
 * The reminder queue. BUILD_SPEC §6.5.
 *
 * *"Visible and cancellable. The dashboard shows a queue of upcoming reminders
 * with dates and recipients. David can cancel or reschedule any of them,
 * individually or in bulk, up until they send."*
 *
 * Two halves:
 *
 *   - **Building the queue.** `refreshQueue` creates the rows §6.5 asks for and
 *     removes the ones that should no longer exist — an investor who has since
 *     responded, an offer that has since been blocked. It never deletes a
 *     reminder that has already gone out and never resurrects a cancelled one.
 *   - **Reading it.** `loadQueue` returns every row with the reason it will or
 *     will not send, evaluated now rather than when it was queued, so what the
 *     operator sees is what the scheduler would decide this minute.
 *
 * "In bulk" here means cancelling several *queued* reminders, which removes
 * messages rather than creating them. There is no bulk anything that sends.
 */

import { asc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import {
  investorAccounts,
  offers,
  reminderEvents,
  reminderSchedules,
  rounds,
} from '@/db/schema'
import { audit, systemActor, type Actor } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { isoToday } from '@/lib/money'
import {
  evaluateEligibility,
  type EligibilityDecision,
  type ReminderCandidate,
  type ReminderContext,
} from './eligibility'
import { planReminders } from './schedule'

export const REMINDERS_PATH = '/reminders'

export interface QueueRow {
  id: string
  offerId: string
  accountId: string
  recipientName: string
  recipientEmail: string
  scheduledFor: Date
  sequence: number
  sentAt: Date | null
  cancelledAt: Date | null
  skippedReason: string | null
  responseDeadline: string
  /** Evaluated now, not when the row was written. */
  eligibility: EligibilityDecision
  state: 'QUEUED' | 'SENT' | 'CANCELLED' | 'SKIPPED' | 'HELD'
}

/** The round's schedule, or null when none is configured. */
export async function loadSchedule(roundId: string) {
  return db.query.reminderSchedules.findFirst({
    where: eq(reminderSchedules.roundId, roundId),
  })
}

export async function currentRound() {
  return db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
}

/**
 * Everything needed to decide, for every offer in the round.
 *
 * `remindersSent` counts only rows that actually went out. A cancelled or
 * skipped reminder is not a reminder anybody received, and counting it against
 * the cap would let a cancellation quietly use up somebody's allowance.
 */
async function loadCandidates(roundId: string): Promise<
  Array<ReminderCandidate & { accountId: string; name: string; email: string }>
> {
  const rows = await db
    .select({
      offerId: offers.id,
      accountId: offers.accountId,
      responseChoice: offers.responseChoice,
      blocked: offers.blocked,
      emailStatus: offers.emailStatus,
      responseDeadline: offers.responseDeadline,
      accountStatus: investorAccounts.status,
      name: investorAccounts.name,
      email: investorAccounts.email,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .where(eq(offers.roundId, roundId))

  const out: Array<ReminderCandidate & { accountId: string; name: string; email: string }> = []

  for (const row of rows) {
    const actuallySent = await db
      .select({ id: reminderEvents.id, sentAt: reminderEvents.sentAt })
      .from(reminderEvents)
      .where(eq(reminderEvents.offerId, row.offerId))

    out.push({
      offerId: row.offerId,
      accountId: row.accountId,
      name: row.name,
      email: row.email,
      accountStatus: row.accountStatus as ReminderCandidate['accountStatus'],
      responseChoice: row.responseChoice as ReminderCandidate['responseChoice'],
      blocked: row.blocked,
      emailStatus: row.emailStatus as ReminderCandidate['emailStatus'],
      responseDeadline: row.responseDeadline,
      remindersSent: actuallySent.filter((event) => event.sentAt !== null).length,
    })
  }

  return out
}

export async function reminderContext(roundId: string): Promise<ReminderContext> {
  const config = await readServiceConfig()
  const schedule = await loadSchedule(roundId)

  return {
    serviceMode: config.serviceMode,
    scheduleEnabled: schedule?.enabled ?? false,
    maxPerRecipient: schedule?.maxPerRecipient ?? 0,
    today: isoToday(),
  }
}

// ---------------------------------------------------------------------------
// Building the queue
// ---------------------------------------------------------------------------

export interface RefreshOutcome {
  created: number
  removed: number
  /** Offers that have no queued reminders because they are not eligible. */
  ineligible: number
}

/**
 * Bring the queue into line with the current state of the round.
 *
 * Creating a row is not a decision to send — the scheduler re-checks every
 * constraint immediately before it sends. A queued row is a plan, and the plan
 * is visible so the operator can cancel it.
 *
 * Never touches a row that has already been sent, and never un-cancels one: a
 * cancellation is an instruction from a person and outranks a recomputation.
 */
export async function refreshQueue(input: {
  roundId: string
  actor?: Actor
  now?: Date
}): Promise<RefreshOutcome> {
  const now = input.now ?? new Date()
  const context = await reminderContext(input.roundId)
  const schedule = await loadSchedule(input.roundId)
  const candidates = await loadCandidates(input.roundId)

  const outcome: RefreshOutcome = { created: 0, removed: 0, ineligible: 0 }

  for (const candidate of candidates) {
    const existing = await db
      .select()
      .from(reminderEvents)
      .where(eq(reminderEvents.offerId, candidate.offerId))

    const pending = existing.filter(
      (event) => event.sentAt === null && event.cancelledAt === null,
    )

    // Eligibility is evaluated ignoring the service mode when deciding whether
    // to hold a plan: a read-only week should not delete next week's reminders,
    // it should stop them going out. `SERVICE_MODE_NOT_ACTIVE` is checked again
    // at send time, where it belongs.
    const decision = evaluateEligibility(candidate, { ...context, serviceMode: 'ACTIVE' })

    if (!decision.eligible) {
      outcome.ineligible += 1

      // Remove plans that should no longer exist. Deleting rather than
      // cancelling, because nobody instructed this — it is a recomputation, and
      // a "cancelled" row would misattribute it to the operator.
      for (const event of pending) {
        await db.delete(reminderEvents).where(eq(reminderEvents.id, event.id))
        outcome.removed += 1
      }
      continue
    }

    if (!schedule) continue

    const alreadySent = existing.filter((event) => event.sentAt !== null).length
    const remaining = Math.max(0, context.maxPerRecipient - alreadySent)

    const planned = planReminders({
      responseDeadline: candidate.responseDeadline,
      daysBefore: schedule.daysBefore,
      maxPerRecipient: remaining,
      now,
    })

    const plannedTimes = new Set(planned.map((row) => row.scheduledFor.getTime()))
    const existingTimes = new Set(
      pending.map((event) => event.scheduledFor.getTime()),
    )
    // A cancelled reminder is never recreated. §6.5 gives the operator the
    // ability to cancel; recomputing it back into existence would take it away.
    const cancelledTimes = new Set(
      existing
        .filter((event) => event.cancelledAt !== null)
        .map((event) => event.scheduledFor.getTime()),
    )

    for (const event of pending) {
      if (!plannedTimes.has(event.scheduledFor.getTime())) {
        await db.delete(reminderEvents).where(eq(reminderEvents.id, event.id))
        outcome.removed += 1
      }
    }

    for (const plan of planned) {
      const time = plan.scheduledFor.getTime()
      if (existingTimes.has(time) || cancelledTimes.has(time)) continue

      await db.insert(reminderEvents).values({
        offerId: candidate.offerId,
        scheduledFor: plan.scheduledFor,
        sequence: alreadySent + plan.sequence,
      })
      outcome.created += 1
    }
  }

  // The scheduled run calls this with no actor. A refresh creates and deletes
  // queued reminders, so an unattended one is exactly the change that most
  // needs a trail — it falls back to the system actor rather than to silence.
  if (outcome.created > 0 || outcome.removed > 0) {
    await audit({
      actor: input.actor ?? systemActor,
      entityType: 'round',
      entityId: input.roundId,
      action: 'reminder.queue_refreshed',
      metadata: outcome as unknown as Record<string, unknown>,
    })
  }

  return outcome
}

// ---------------------------------------------------------------------------
// Reading the queue
// ---------------------------------------------------------------------------

export async function loadQueue(roundId: string): Promise<QueueRow[]> {
  const context = await reminderContext(roundId)
  const candidates = await loadCandidates(roundId)
  const byOffer = new Map(candidates.map((row) => [row.offerId, row]))

  const rows = await db
    .select({
      event: reminderEvents,
      accountId: investorAccounts.id,
      name: investorAccounts.name,
      email: investorAccounts.email,
      responseDeadline: offers.responseDeadline,
    })
    .from(reminderEvents)
    .innerJoin(offers, eq(reminderEvents.offerId, offers.id))
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .where(eq(offers.roundId, roundId))
    .orderBy(asc(reminderEvents.scheduledFor))

  return rows.map((row) => {
    const candidate = byOffer.get(row.event.offerId)
    const eligibility: EligibilityDecision = candidate
      ? evaluateEligibility(candidate, context)
      : { eligible: true }

    const state: QueueRow['state'] =
      row.event.sentAt !== null
        ? 'SENT'
        : row.event.cancelledAt !== null
          ? 'CANCELLED'
          : row.event.skippedReason !== null
            ? 'SKIPPED'
            : eligibility.eligible
              ? 'QUEUED'
              : 'HELD'

    return {
      id: row.event.id,
      offerId: row.event.offerId,
      accountId: row.accountId,
      recipientName: row.name,
      recipientEmail: row.email,
      scheduledFor: row.event.scheduledFor,
      sequence: row.event.sequence,
      sentAt: row.event.sentAt,
      cancelledAt: row.event.cancelledAt,
      skippedReason: row.event.skippedReason,
      responseDeadline: row.responseDeadline,
      eligibility,
      state,
    }
  })
}

// ---------------------------------------------------------------------------
// Cancelling and rescheduling — §6.5
// ---------------------------------------------------------------------------

export type QueueMutation = { ok: true } | { ok: false; message: string }

export async function cancelReminder(input: {
  reminderId: string
  actorUserId: string | null
  actor: Actor
  now?: Date
}): Promise<QueueMutation> {
  const now = input.now ?? new Date()

  const event = await db.query.reminderEvents.findFirst({
    where: eq(reminderEvents.id, input.reminderId),
  })
  if (!event) return { ok: false, message: 'That reminder could not be found.' }
  if (event.sentAt !== null) {
    return {
      ok: false,
      message: 'That reminder has already gone out. Cancelling it now would change nothing.',
    }
  }
  if (event.cancelledAt !== null) return { ok: true }

  await db
    .update(reminderEvents)
    .set({ cancelledAt: now, cancelledById: input.actorUserId })
    .where(eq(reminderEvents.id, input.reminderId))

  await audit({
    actor: input.actor,
    entityType: 'reminder',
    entityId: input.reminderId,
    action: 'reminder.cancelled',
    metadata: {
      offerId: event.offerId,
      scheduledFor: event.scheduledFor.toISOString(),
      sequence: event.sequence,
    },
  })

  return { ok: true }
}

export async function rescheduleReminder(input: {
  reminderId: string
  scheduledFor: Date
  actor: Actor
  now?: Date
}): Promise<QueueMutation> {
  const now = input.now ?? new Date()

  const event = await db.query.reminderEvents.findFirst({
    where: eq(reminderEvents.id, input.reminderId),
  })
  if (!event) return { ok: false, message: 'That reminder could not be found.' }
  if (event.sentAt !== null) {
    return { ok: false, message: 'That reminder has already gone out and cannot be moved.' }
  }
  if (input.scheduledFor.getTime() <= now.getTime()) {
    return {
      ok: false,
      message: 'Choose a time in the future. A reminder cannot be scheduled for the past.',
    }
  }

  const offer = await db.query.offers.findFirst({ where: eq(offers.id, event.offerId) })
  if (offer && input.scheduledFor.toISOString().slice(0, 10) > offer.responseDeadline) {
    return {
      ok: false,
      message:
        `That is after their response deadline of ${offer.responseDeadline}. A reminder to ` +
        'respond by a date that has already passed asks for something impossible.',
    }
  }

  await db
    .update(reminderEvents)
    .set({ scheduledFor: input.scheduledFor, cancelledAt: null, cancelledById: null })
    .where(eq(reminderEvents.id, input.reminderId))

  await audit({
    actor: input.actor,
    entityType: 'reminder',
    entityId: input.reminderId,
    action: 'reminder.rescheduled',
    metadata: {
      offerId: event.offerId,
      from: event.scheduledFor.toISOString(),
      to: input.scheduledFor.toISOString(),
    },
  })

  return { ok: true }
}

/**
 * Cancel several queued reminders at once.
 *
 * This is the "in bulk" §6.5 allows, and it is worth being explicit about why
 * it does not contradict §14: it removes messages. There is no counterpart that
 * sends several, and there is not going to be one.
 */
export async function cancelMany(input: {
  reminderIds: string[]
  actorUserId: string | null
  actor: Actor
  now?: Date
}): Promise<{ cancelled: number }> {
  let cancelled = 0
  for (const reminderId of input.reminderIds) {
    const result = await cancelReminder({
      reminderId,
      actorUserId: input.actorUserId,
      actor: input.actor,
      now: input.now,
    })
    if (result.ok) cancelled += 1
  }
  return { cancelled }
}
