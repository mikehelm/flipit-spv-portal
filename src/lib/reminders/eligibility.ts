/**
 * Who may be chased, and when. BUILD_SPEC §6.5.
 *
 * *"This is the one place in the app that sends without a human clicking send
 * at that moment. That is deliberate, and it is why the constraints above are
 * tight."*
 *
 * Every constraint in §6.5 is in this file, as a pure function returning a
 * reason rather than a boolean. Two consequences follow, and both are the point:
 *
 *   1. The rules can be tested exhaustively with no database and no clock.
 *   2. The scheduler checks them **twice** — once when it builds the queue and
 *      again immediately before it sends — using this same function. Nothing
 *      about "it was eligible last Tuesday" is allowed to survive to the moment
 *      of sending. An investor who responded on Monday is not chased on
 *      Tuesday because the row was written on Sunday.
 *
 * No side effects, no I/O, no `new Date()` — the caller supplies `now`.
 */

export type ReminderIneligibility =
  /** §6.5: "Anyone who has responded is never chased." */
  | 'ALREADY_RESPONDED'
  /** §6.5: "only accounts ... in state invited or active". */
  | 'ACCOUNT_NOT_INVITED_OR_ACTIVE'
  /** §6.5: "not blocked". A blocked offer may not be communicated at all. */
  | 'OFFER_BLOCKED'
  /** Chasing somebody who never received the invitation is not a reminder. */
  | 'INVITATION_NEVER_SENT'
  /** §6.5: "Cap: a configurable maximum per recipient, default 2. Never more." */
  | 'CAP_REACHED'
  /** After the deadline there is nothing left to remind anybody about. */
  | 'DEADLINE_PASSED'
  /** §6.5: "Reminders respect service mode: nothing sends outside active." */
  | 'SERVICE_MODE_NOT_ACTIVE'
  /** §6.5: the schedule itself can be switched off. */
  | 'SCHEDULE_DISABLED'

export const INELIGIBILITY_MESSAGE: Readonly<Record<ReminderIneligibility, string>> = {
  ALREADY_RESPONDED:
    'They have recorded a response, and somebody who has answered is never chased again.',
  ACCOUNT_NOT_INVITED_OR_ACTIVE:
    'Their account is not invited or active. A suspended, closed or archived account is never ' +
    'sent an automatic email.',
  OFFER_BLOCKED:
    'This offer is blocked, so nothing may be communicated about it at all — including a ' +
    'reminder to look at it.',
  INVITATION_NEVER_SENT:
    'No invitation has reached them yet, so there is nothing to remind them about. A reminder ' +
    'sent before an invitation is a first contact wearing the wrong clothes.',
  CAP_REACHED:
    'They have already had the maximum number of reminders for this offer. The cap is a hard ' +
    'limit and is never exceeded.',
  DEADLINE_PASSED:
    'The response deadline has passed, so a reminder to respond by it would be asking for ' +
    'something that is no longer possible.',
  SERVICE_MODE_NOT_ACTIVE:
    'The service mode is not active, and nothing sends outside active mode. The reminder stays ' +
    'in the queue and will be reconsidered if the service becomes active again before the ' +
    'deadline.',
  SCHEDULE_DISABLED: 'Reminders are switched off for this round.',
}

export interface ReminderCandidate {
  offerId: string
  accountStatus: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'ARCHIVED'
  responseChoice: 'NO_RESPONSE' | 'INTERESTED' | 'NOT_INTERESTED' | 'QUESTION'
  blocked: boolean
  /** `offers.email_status`. Only SENT means an invitation actually arrived. */
  emailStatus: 'DRAFT' | 'SENT' | 'FAILED' | 'BLOCKED'
  /** ISO date, `YYYY-MM-DD`. A deadline is a date, never a timestamp (§Time). */
  responseDeadline: string
  /** Reminders already sent for this offer. Cancelled and skipped do not count. */
  remindersSent: number
}

export interface ReminderContext {
  serviceMode: 'ACTIVE' | 'READ_ONLY' | 'SUNSET' | 'DISABLED'
  scheduleEnabled: boolean
  maxPerRecipient: number
  /** Today, in the investor's terms. See `isoToday`. */
  today: string
}

export type EligibilityDecision =
  | { eligible: true }
  | { eligible: false; reason: ReminderIneligibility; message: string }

function no(reason: ReminderIneligibility): EligibilityDecision {
  return { eligible: false, reason, message: INELIGIBILITY_MESSAGE[reason] }
}

/**
 * The order matters only for which reason is reported first, and it is chosen
 * so the most informative one wins: "they answered" is more use to the operator
 * than "the service is read-only".
 */
export function evaluateEligibility(
  candidate: ReminderCandidate,
  context: ReminderContext,
): EligibilityDecision {
  // §6.5: "Anyone who has responded is never chased."
  if (candidate.responseChoice !== 'NO_RESPONSE') return no('ALREADY_RESPONDED')

  if (candidate.accountStatus !== 'INVITED' && candidate.accountStatus !== 'ACTIVE') {
    return no('ACCOUNT_NOT_INVITED_OR_ACTIVE')
  }

  if (candidate.blocked) return no('OFFER_BLOCKED')

  if (candidate.emailStatus !== 'SENT') return no('INVITATION_NEVER_SENT')

  // The cap is checked before the clock, because a recipient who has had their
  // two reminders is finished with whatever the date says.
  if (candidate.remindersSent >= context.maxPerRecipient) return no('CAP_REACHED')

  // A deadline is a date and the edge resolves in the investor's favour: a
  // deadline of the tenth is still open all through the tenth, so a reminder is
  // still meaningful on the tenth.
  if (candidate.responseDeadline < context.today) return no('DEADLINE_PASSED')

  if (!context.scheduleEnabled) return no('SCHEDULE_DISABLED')

  // §6.5, last. Deliberately after everything else so that a queue viewed in
  // read-only mode still explains the interesting reasons rather than reporting
  // "service mode" against every row.
  if (context.serviceMode !== 'ACTIVE') return no('SERVICE_MODE_NOT_ACTIVE')

  return { eligible: true }
}

export function isEligible(
  candidate: ReminderCandidate,
  context: ReminderContext,
): boolean {
  return evaluateEligibility(candidate, context).eligible
}
