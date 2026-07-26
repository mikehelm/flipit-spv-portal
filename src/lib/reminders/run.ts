/**
 * The scheduled job. BUILD_SPEC §6.5.
 *
 * *"This is the one place in the app that sends without a human clicking send
 * at that moment."*
 *
 * Everything in this file is written on that basis. The order of checks is the
 * design, so it is written out:
 *
 *   1. **Re-evaluate eligibility, now.** Not when the row was queued. An
 *      investor who responded this morning is not chased this afternoon
 *      because a row was written last week. This is the check that makes a
 *      queue safe to build in advance.
 *   2. **Staleness.** A reminder that came due days ago is skipped, not sent
 *      late — a nudge about a deadline that has since moved closer reads as
 *      wrong rather than helpful.
 *   3. **The compliance gate, against the REMINDER approval.** §6.5: "Its own
 *      approved template. The reminder body is a separate template with its own
 *      hash and its own compliance approval. Reminders do not send under the
 *      invitation email's approval." The approval and drift passed to
 *      `sendInvitation` are loaded for `REMINDER` and nothing else.
 *   4. **The claim.** One atomic UPDATE that takes the row, requiring
 *      `claimed_at` to still be null. Two runs racing here means one of them
 *      updates no rows and stops. It is the last thing before the send and the
 *      first thing that is not reversible, which is where it belongs. See
 *      `lock.ts` for why there are two defences rather than one.
 *   5. **The transport gate**, inside `sendOneEmail`: credential, service mode,
 *      production deployment. A separate authority from the compliance gate;
 *      both apply.
 *   6. **Record**, whatever happened. §6.5: "Every reminder — sent, cancelled,
 *      skipped, failed — is written to the audit log."
 *
 * One recipient per call to `sendOne`. The runner loops over due reminders, but
 * every send is an independent decision with its own gate evaluation, and one
 * refusal cannot reach another (§14, checklist 3).
 */

import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import { db } from '@/db'
import { offers, reminderEvents } from '@/db/schema'
import { audit, systemActor, type Actor } from '@/lib/audit'
import { loadGateContext } from '@/lib/compliance'
import { loadSendTarget } from '@/lib/sending/data'
import { loadSenderDefaults } from '@/lib/email/variables'
import { sendInvitation } from '@/lib/sending/send-invitation'
import { withRunLock } from './lock'
import { currentRound, loadQueue, refreshQueue } from './queue'
import { isStale, STALE_SKIP_REASON } from './schedule'

/**
 * What a run says when another run already holds the row.
 *
 * Distinct from `RUN_IN_PROGRESS_MESSAGE`, which is about a whole run that never
 * started. This one is about one reminder that somebody else is sending right
 * now, and the correct response to it is to leave it alone.
 */
export const ALREADY_CLAIMED_REASON =
  'Another run took this reminder first and is sending it now. This run left it alone rather ' +
  'than sending the same message twice.'

export type ReminderOutcome =
  | { kind: 'SENT'; reminderId: string; offerId: string; messageId: string }
  | { kind: 'SKIPPED'; reminderId: string; offerId: string; reason: string }
  | { kind: 'BLOCKED'; reminderId: string; offerId: string; reason: string }
  | { kind: 'FAILED'; reminderId: string; offerId: string; reason: string }

export interface RunSummary {
  /**
   * False when another run held the lock and this one did nothing at all — no
   * queue refresh, no reads, no sends. Every count below is zero in that case,
   * and zero-because-nothing-was-due and zero-because-nothing-ran are different
   * facts that the operator needs to be able to tell apart.
   */
  ran: boolean
  considered: number
  sent: number
  skipped: number
  blocked: number
  failed: number
  outcomes: ReminderOutcome[]
}

/**
 * Send one queued reminder, or record why it did not go.
 *
 * `skippedReason` is written for anything that will never be sent, so the row
 * stops being due and the queue stops showing it as pending. A transient
 * transport failure deliberately does NOT set it: the row stays due and the
 * next run tries again, up to the point where it goes stale.
 */
export async function sendOne(input: {
  reminderId: string
  actor?: Actor
  now?: Date
}): Promise<ReminderOutcome> {
  const now = input.now ?? new Date()
  const actor = input.actor ?? systemActor

  const event = await db.query.reminderEvents.findFirst({
    where: eq(reminderEvents.id, input.reminderId),
  })
  if (!event) {
    return {
      kind: 'SKIPPED',
      reminderId: input.reminderId,
      offerId: '',
      reason: 'The reminder no longer exists.',
    }
  }
  if (event.sentAt !== null || event.cancelledAt !== null) {
    return {
      kind: 'SKIPPED',
      reminderId: event.id,
      offerId: event.offerId,
      reason: 'Already sent or cancelled.',
    }
  }

  const offer = await db.query.offers.findFirst({ where: eq(offers.id, event.offerId) })
  if (!offer) {
    return {
      kind: 'SKIPPED',
      reminderId: event.id,
      offerId: event.offerId,
      reason: 'The offer no longer exists.',
    }
  }

  // --- 1. Eligibility, now ------------------------------------------------
  // `loadQueue` re-evaluates every §6.5 constraint against the current state of
  // the database, so this is the check that makes queueing in advance safe.
  const queue = await loadQueue(offer.roundId)
  const row = queue.find((entry) => entry.id === event.id)

  if (row && !row.eligibility.eligible) {
    const reason = row.eligibility.message

    // A service-mode hold is temporary and must not consume the row: the
    // service may be active again tomorrow, and §6.5 says reminders respect the
    // mode, not that they are destroyed by it.
    if (row.eligibility.reason === 'SERVICE_MODE_NOT_ACTIVE') {
      await audit({
        actor,
        entityType: 'reminder',
        entityId: event.id,
        action: 'reminder.held',
        metadata: { offerId: event.offerId, reason: row.eligibility.reason },
      })
      return { kind: 'SKIPPED', reminderId: event.id, offerId: event.offerId, reason }
    }

    await skip(event.id, reason, actor, row.eligibility.reason)
    return { kind: 'SKIPPED', reminderId: event.id, offerId: event.offerId, reason }
  }

  // --- 2. Staleness -------------------------------------------------------
  if (isStale(event.scheduledFor, now)) {
    await skip(event.id, STALE_SKIP_REASON, actor, 'STALE')
    return {
      kind: 'SKIPPED',
      reminderId: event.id,
      offerId: event.offerId,
      reason: STALE_SKIP_REASON,
    }
  }

  // --- 3. The compliance gate, for the REMINDER template -------------------
  const target = await loadSendTarget(event.offerId)
  if (!target) {
    const reason =
      'This recipient could not be loaded for sending — most likely their recipient record is ' +
      'missing, which also means the jurisdiction gate has nothing to check.'
    await skip(event.id, reason, actor, 'TARGET_MISSING')
    return { kind: 'SKIPPED', reminderId: event.id, offerId: event.offerId, reason }
  }

  const { approval, drift } = await loadGateContext('REMINDER')
  const defaults = await loadSenderDefaults()

  // --- 4. The claim -------------------------------------------------------
  // Everything above this line is a read of state that another run is reading
  // at the same time and reaching the same conclusion about. This is the line
  // that only one of them can cross. `claimedAt: null` in the WHERE clause is
  // the whole mechanism: Postgres serialises the two updates and the loser
  // matches no rows.
  const claimed = await db
    .update(reminderEvents)
    .set({ claimedAt: now })
    .where(
      and(
        eq(reminderEvents.id, event.id),
        isNull(reminderEvents.claimedAt),
        isNull(reminderEvents.sentAt),
        isNull(reminderEvents.cancelledAt),
        isNull(reminderEvents.skippedReason),
      ),
    )
    .returning({ id: reminderEvents.id })

  if (claimed.length === 0) {
    // No skip is written and no audit entry either: this run did not decide
    // anything about this reminder, and the run that did will record what it did
    // with it. Writing a skip here would overwrite the winner's outcome.
    return {
      kind: 'SKIPPED',
      reminderId: event.id,
      offerId: event.offerId,
      reason: ALREADY_CLAIMED_REASON,
    }
  }

  // --- 5 and 6. Send, and record ------------------------------------------
  const result = await sendInvitation({
    target,
    defaults,
    approval,
    drift,
    actor,
    actorUserId: null,
    kind: 'REMINDER',
    // A failed reminder must not mark the invitation as failed. The invitation
    // arrived a week ago; this column is about that message, not this one.
    updateOfferEmailStatus: false,
    now,
  })

  if (result.outcome === 'BLOCKED') {
    await skip(event.id, result.message, actor, 'COMPLIANCE_BLOCKED')
    return {
      kind: 'BLOCKED',
      reminderId: event.id,
      offerId: event.offerId,
      reason: result.message,
    }
  }

  if (result.outcome === 'FAILED') {
    // Permanent failures stop the row. A transient one is left due so the next
    // run retries it, until staleness catches it.
    if (result.permanent) {
      await skip(event.id, result.message, actor, 'PERMANENT_FAILURE')
    } else {
      // Release the claim. A transient failure is the one outcome where the row
      // must stay available, and a claim that outlived the attempt that took it
      // would turn "the next run tries again" into "nothing ever tries again".
      await db
        .update(reminderEvents)
        .set({ claimedAt: null })
        .where(eq(reminderEvents.id, event.id))

      await audit({
        actor,
        entityType: 'reminder',
        entityId: event.id,
        action: 'reminder.failed',
        metadata: { offerId: event.offerId, permanent: false },
      })
    }

    return {
      kind: 'FAILED',
      reminderId: event.id,
      offerId: event.offerId,
      reason: result.message,
    }
  }

  await db
    .update(reminderEvents)
    .set({ sentAt: now })
    .where(eq(reminderEvents.id, event.id))

  await audit({
    actor,
    entityType: 'reminder',
    entityId: event.id,
    action: 'reminder.sent',
    // The Message-ID and the sequence. Never the body, never the deadline.
    metadata: {
      offerId: event.offerId,
      sequence: event.sequence,
      messageId: result.messageId,
    },
  })

  return {
    kind: 'SENT',
    reminderId: event.id,
    offerId: event.offerId,
    messageId: result.messageId,
  }
}

async function skip(
  reminderId: string,
  reason: string,
  actor: Actor,
  code: string,
): Promise<void> {
  // The claim is released alongside the skip. Nothing was sent, so the row must
  // not go on counting against the recipient's cap or reading as in flight; and
  // `skippedReason` is what stops it being picked up again, not the claim.
  await db
    .update(reminderEvents)
    .set({ skippedReason: reason, claimedAt: null })
    .where(eq(reminderEvents.id, reminderId))

  await audit({
    actor,
    entityType: 'reminder',
    entityId: reminderId,
    action: 'reminder.skipped',
    metadata: { code },
  })
}

/**
 * The job itself. Refresh the queue, then work through what is due.
 *
 * Bounded by `limit` so a first run against a long-neglected queue cannot turn
 * into an unbounded burst of mail. What was left is reported rather than
 * silently dropped — the next run picks it up.
 *
 * The whole of it runs under the advisory lock in `lock.ts`. A run that cannot
 * take the lock returns `ran: false` having touched nothing: it does not refresh
 * the queue, it does not read the due rows, and it certainly does not send. See
 * that file for why the lock is not the only defence.
 */
export async function runDueReminders(options: {
  now?: Date
  limit?: number
  actor?: Actor
} = {}): Promise<RunSummary> {
  const attempt = await withRunLock(() => runDueRemindersUnderLock(options))

  if (!attempt.acquired) {
    return {
      ran: false,
      considered: 0,
      sent: 0,
      skipped: 0,
      blocked: 0,
      failed: 0,
      outcomes: [],
    }
  }

  return attempt.result
}

async function runDueRemindersUnderLock(options: {
  now?: Date
  limit?: number
  actor?: Actor
}): Promise<RunSummary> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? 50
  const actor = options.actor ?? systemActor

  const summary: RunSummary = {
    ran: true,
    considered: 0,
    sent: 0,
    skipped: 0,
    blocked: 0,
    failed: 0,
    outcomes: [],
  }

  const round = await currentRound()
  if (!round) return summary

  await refreshQueue({ roundId: round.id, now })

  const due = await db
    .select({ id: reminderEvents.id })
    .from(reminderEvents)
    .innerJoin(offers, eq(reminderEvents.offerId, offers.id))
    .where(
      and(
        eq(offers.roundId, round.id),
        lte(reminderEvents.scheduledFor, now),
        isNull(reminderEvents.sentAt),
        isNull(reminderEvents.cancelledAt),
        isNull(reminderEvents.skippedReason),
        // A claimed row belongs to somebody else. `sendOne` would refuse it
        // anyway; leaving it out here means it is not even counted as
        // considered, which is what the operator would expect to read.
        isNull(reminderEvents.claimedAt),
      ),
    )
    .orderBy(asc(reminderEvents.scheduledFor))
    .limit(limit)

  for (const entry of due) {
    summary.considered += 1
    // One recipient, one gate evaluation, one outcome. Nothing that happens
    // here can affect the next iteration.
    const outcome = await sendOne({ reminderId: entry.id, actor, now })
    summary.outcomes.push(outcome)

    if (outcome.kind === 'SENT') summary.sent += 1
    else if (outcome.kind === 'SKIPPED') summary.skipped += 1
    else if (outcome.kind === 'BLOCKED') summary.blocked += 1
    else summary.failed += 1
  }

  await audit({
    actor,
    entityType: 'round',
    entityId: round.id,
    action: 'reminder.run_completed',
    metadata: {
      considered: summary.considered,
      sent: summary.sent,
      skipped: summary.skipped,
      blocked: summary.blocked,
      failed: summary.failed,
      limit,
    },
  })

  return summary
}
