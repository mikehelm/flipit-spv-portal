/**
 * Closing a round, and extending a deadline. BUILD_SPEC §6.6.
 *
 * The sentence this file exists to enforce is the last one in §6.6:
 *
 *   *"If David does nothing, nothing happens. The round stays open and he is
 *   reminded again on a configurable cadence. **Silence never closes anyone's
 *   opportunity.**"*
 *
 * So there is no scheduled job in this module, nothing that closes on a date,
 * and no function that closes a round without an actor and an explicit
 * confirmation. `closeRound` takes `confirmed: true` and refuses without it —
 * checked here rather than in the form, because a rule enforced only by a form
 * is a rule a future caller routes around.
 *
 * The deadline passing changes exactly one thing: the operator gets an email
 * (§6.6, `digest.ts`). It changes nothing about anybody's ability to respond.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { offers, rounds } from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { isoToday } from '@/lib/money'
import { CLOSE_CONFIRMATION_NOTICE } from './copy'

/** Re-exported for server callers; defined in `./copy`, which has no database. */
export { CLOSE_CONFIRMATION_NOTICE }

export type RoundResult = { ok: true } | { ok: false; message: string }


/**
 * Close the round. §6.6: "an explicit button with a confirmation".
 *
 * Refuses if any deadline is still ahead **without** an explicit acknowledgement
 * that the operator means to close early. Closing while somebody still has time
 * left is a decision he is allowed to make — investors may all have answered —
 * but it is not one to make by accident.
 */
export async function closeRound(input: {
  roundId: string
  confirmed: boolean
  /** Required only when a deadline is still in the future. */
  closingEarlyAcknowledged?: boolean
  actorUserId: string | null
  actor: Actor
  now?: Date
}): Promise<RoundResult> {
  const now = input.now ?? new Date()

  if (!input.confirmed) {
    return {
      ok: false,
      message:
        'Nothing was closed. Closing the round is deliberate — tick the confirmation to do it.',
    }
  }

  const round = await db.query.rounds.findFirst({ where: eq(rounds.id, input.roundId) })
  if (!round) return { ok: false, message: 'That round could not be found.' }
  if (round.closedAt !== null) {
    return { ok: false, message: 'That round is already closed.' }
  }

  const today = isoToday(now)
  const stillOpen = await db
    .select({ id: offers.id, responseDeadline: offers.responseDeadline })
    .from(offers)
    .where(eq(offers.roundId, input.roundId))

  const outstanding = stillOpen.filter((row) => row.responseDeadline > today)

  if (outstanding.length > 0 && !input.closingEarlyAcknowledged) {
    return {
      ok: false,
      message:
        `${outstanding.length} ${outstanding.length === 1 ? 'person still has' : 'people still have'} ` +
        'time left to respond. Closing now ends that. You can still do it — they may all have ' +
        'answered already — but confirm that you mean to close early.',
    }
  }

  await db
    .update(rounds)
    .set({ closedAt: now, closedById: input.actorUserId })
    .where(eq(rounds.id, input.roundId))

  await audit({
    actor: input.actor,
    entityType: 'round',
    entityId: input.roundId,
    action: 'round.closed',
    metadata: {
      offers: stillOpen.length,
      closedEarlyFor: outstanding.length,
      closedOn: today,
    },
  })

  return { ok: true }
}

/**
 * Reopen a closed round.
 *
 * §6.6 does not name this, and where the spec is silent the conservative option
 * wins — so it exists, it is owner-facing, and it requires a reason. The
 * alternative is that a mis-click at the end of a raise is permanent, and a
 * round that was closed by accident is a worse state than one that was reopened
 * with a recorded reason.
 */
export async function reopenRound(input: {
  roundId: string
  reason: string
  actor: Actor
}): Promise<RoundResult> {
  const reason = input.reason.trim()
  if (reason.length < 10) {
    return {
      ok: false,
      message: 'Reopening a closed round needs a recorded reason of at least ten characters.',
    }
  }

  const round = await db.query.rounds.findFirst({ where: eq(rounds.id, input.roundId) })
  if (!round) return { ok: false, message: 'That round could not be found.' }
  if (round.closedAt === null) return { ok: false, message: 'That round is not closed.' }

  await db
    .update(rounds)
    .set({ closedAt: null, closedById: null })
    .where(eq(rounds.id, input.roundId))

  await audit({
    actor: input.actor,
    entityType: 'round',
    entityId: input.roundId,
    action: 'round.reopened',
    metadata: { reason, hadClosedAt: round.closedAt.toISOString() },
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Extending — §6.6
// ---------------------------------------------------------------------------

/**
 * `original_deadline` is written once, at import, and never again.
 *
 * It is what makes "who asked for more time" answerable: an offer whose current
 * deadline is later than its original one has been extended. If extending
 * overwrote it there would be nothing to compare against.
 */
export async function extendDeadline(input: {
  offerId: string
  newDeadline: string
  reason?: string | null
  actor: Actor
  now?: Date
}): Promise<RoundResult> {
  const now = input.now ?? new Date()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.newDeadline)) {
    return { ok: false, message: 'Use the date picker.' }
  }
  if (input.newDeadline < isoToday(now)) {
    return {
      ok: false,
      message: 'That date has already passed, so it would extend nothing.',
    }
  }

  const offer = await db.query.offers.findFirst({ where: eq(offers.id, input.offerId) })
  if (!offer) return { ok: false, message: 'That offer could not be found.' }

  if (input.newDeadline < offer.responseDeadline) {
    return {
      ok: false,
      message:
        `Their deadline is currently ${offer.responseDeadline}. Bringing it forward would take ` +
        'away time an investor has already been told they have, so this screen only extends.',
    }
  }

  await db
    .update(offers)
    .set({
      responseDeadline: input.newDeadline,
      // Written once, at import. Never overwritten — see above.
      originalDeadline: offer.originalDeadline ?? offer.responseDeadline,
    })
    .where(eq(offers.id, input.offerId))

  await audit({
    actor: input.actor,
    entityType: 'offer',
    entityId: input.offerId,
    action: 'round.deadline_extended',
    metadata: {
      from: offer.responseDeadline,
      to: input.newDeadline,
      reason: input.reason?.trim() || null,
    },
  })

  return { ok: true }
}

/**
 * Extend everybody who has not yet responded. §6.6: "Extending is a
 * per-recipient action as well as a global one."
 *
 * Deliberately only the non-responders. Somebody who has already answered does
 * not need more time, and moving their deadline would make the date on their
 * portal disagree with the date in the email they were sent.
 */
export async function extendRoundDeadline(input: {
  roundId: string
  newDeadline: string
  reason?: string | null
  actor: Actor
  now?: Date
}): Promise<{ ok: true; extended: number } | { ok: false; message: string }> {
  const now = input.now ?? new Date()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.newDeadline)) {
    return { ok: false, message: 'Use the date picker.' }
  }
  if (input.newDeadline < isoToday(now)) {
    return { ok: false, message: 'That date has already passed, so it would extend nothing.' }
  }

  const round = await db.query.rounds.findFirst({ where: eq(rounds.id, input.roundId) })
  if (!round) return { ok: false, message: 'That round could not be found.' }
  if (round.closedAt !== null) {
    return {
      ok: false,
      message: 'That round is closed. Reopen it first if you mean to give people more time.',
    }
  }

  const rows = await db
    .select({ id: offers.id, responseDeadline: offers.responseDeadline })
    .from(offers)
    .where(and(eq(offers.roundId, input.roundId), eq(offers.responseChoice, 'NO_RESPONSE')))

  let extended = 0
  for (const row of rows) {
    if (row.responseDeadline >= input.newDeadline) continue
    const result = await extendDeadline({
      offerId: row.id,
      newDeadline: input.newDeadline,
      reason: input.reason,
      actor: input.actor,
      now,
    })
    if (result.ok) extended += 1
  }

  await audit({
    actor: input.actor,
    entityType: 'round',
    entityId: input.roundId,
    action: 'round.deadline_extended_globally',
    metadata: { to: input.newDeadline, extended, reason: input.reason?.trim() || null },
  })

  return { ok: true, extended }
}

/** Whether any round is open at all. Used by the §6.7.5 Q&A switch. */
export async function hasOpenRound(): Promise<boolean> {
  const rows = await db.select({ id: rounds.id }).from(rounds).where(isNull(rounds.closedAt)).limit(1)
  return rows.length > 0
}
