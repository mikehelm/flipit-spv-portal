/**
 * When a reminder is due. BUILD_SPEC §6.5.
 *
 * *"Schedule: configurable, default 7 days and 2 days before that recipient's
 * `response_deadline`."*
 *
 * A deadline is a **date**, not a timestamp, and the app stores it as one. A
 * reminder is an instant, so this file is where the two meet, and it is the
 * only place that conversion happens.
 *
 * Pure. No database, no `new Date()`.
 */

/**
 * The hour reminders go out, in UTC.
 *
 * The spec does not name one. Nine in the morning UTC lands in the working day
 * across Europe, in the evening in Asia-Pacific and overnight in the Americas —
 * there is no hour that is polite everywhere, and picking one that is polite
 * *somewhere* beats an arbitrary midnight that reads as automated. Recorded as
 * a decision rather than a default nobody chose.
 */
export const REMINDER_HOUR_UTC = 9

export interface PlannedReminder {
  /** 1 for the first reminder, 2 for the second, and so on. */
  sequence: number
  /** How many days before the deadline this one is for. */
  daysBefore: number
  scheduledFor: Date
}

/** `YYYY-MM-DD` → the UTC instant at `REMINDER_HOUR_UTC` that day. */
function atReminderHour(isoDate: string): Date {
  return new Date(`${isoDate}T${String(REMINDER_HOUR_UTC).padStart(2, '0')}:00:00.000Z`)
}

/** `YYYY-MM-DD` minus N days, as `YYYY-MM-DD`. Calendar arithmetic in UTC. */
export function subtractDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() - days)
  return base.toISOString().slice(0, 10)
}

/**
 * The reminders that should exist for one offer.
 *
 * Rules, in order:
 *
 *   - Furthest from the deadline first, so `sequence` counts the way a person
 *     would: the seven-day one is the first reminder, the two-day one is the
 *     second. A `daysBefore` list given in any order produces the same result.
 *   - **Never more than the cap**, whatever the list says. §6.5: "Never more."
 *     A schedule of `[14, 7, 2]` with a cap of 2 produces two reminders, not
 *     three, and it drops the ones nearest the deadline rather than the ones
 *     furthest from it — the last chance to respond is the one worth keeping.
 *   - A date already in the past is dropped. Creating a reminder that was due
 *     last week produces either a message sent late or a permanently overdue
 *     row, and neither is useful.
 *   - Duplicate `daysBefore` values collapse. Nobody gets the same nudge twice
 *     because a list was typed carelessly.
 */
export function planReminders(input: {
  responseDeadline: string
  daysBefore: readonly number[]
  maxPerRecipient: number
  now: Date
}): PlannedReminder[] {
  const unique = [...new Set(input.daysBefore.filter((days) => Number.isInteger(days) && days >= 0))]
  const descending = unique.sort((a, b) => b - a)

  const planned: PlannedReminder[] = []
  let sequence = 0

  for (const daysBefore of descending) {
    const scheduledFor = atReminderHour(subtractDays(input.responseDeadline, daysBefore))
    sequence += 1
    planned.push({ sequence, daysBefore, scheduledFor })
  }

  // The cap first, keeping the earliest — see the note above about which one to
  // drop. Then the past, because a capped list can still contain a stale date.
  const capped = planned.slice(0, Math.max(0, input.maxPerRecipient))

  return capped.filter((reminder) => reminder.scheduledFor.getTime() > input.now.getTime())
}

/** Whether a queued reminder is due to go out now. */
export function isDue(scheduledFor: Date, now: Date): boolean {
  return scheduledFor.getTime() <= now.getTime()
}

/**
 * A reminder more than this far past its scheduled time is stale.
 *
 * The scheduler may not run for a while — a deploy, an outage, a cron that was
 * never wired up. Sending a "respond within seven days" nudge four days late is
 * worse than not sending it: the recipient reads a deadline that has moved.
 * Two days is long enough to survive a weekend outage and short enough that the
 * message is still true when it lands.
 */
export const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000

export function isStale(scheduledFor: Date, now: Date, maxAgeMs = STALE_AFTER_MS): boolean {
  return now.getTime() - scheduledFor.getTime() > maxAgeMs
}

export const STALE_SKIP_REASON =
  'This reminder came due more than two days ago and was not sent — most likely the scheduler ' +
  'was not running. It has been skipped rather than sent late, because a nudge about a deadline ' +
  'that has since moved closer reads as wrong rather than helpful.'
