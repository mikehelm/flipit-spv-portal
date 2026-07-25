/**
 * The eight-step investor timeline. BUILD_SPEC §5, PORTAL_COPY.
 *
 * Pure. Given an offer's current stage, this returns the eight steps with their
 * investor-facing labels, their plain-language explanations, and which are done,
 * current and still ahead.
 *
 * Two things this file is careful about:
 *
 *   1. **Every step carries an explanation.** §5: "the portal displays a
 *      plain-language explanation beside each step so an investor is never
 *      guessing what 'allocation accepted' means." A step with a label and no
 *      explanation is not finished.
 *   2. **A step not yet reached shows no detail at all** — not a blank value,
 *      not a placeholder date, not a zero. It shows the standard sentence from
 *      PORTAL_COPY and nothing else. A greyed-out step displaying "Amount: —"
 *      invites the reader to fill in the blank themselves.
 *
 * Nothing here reveals that any other investor exists. There is no position, no
 * count, no total and no comparison anywhere in the timeline.
 */

export const OFFER_STAGES = [
  'INVITATION_SENT',
  'RESPONSE_RECORDED',
  'DOCUMENTS_ISSUED',
  'COMMITMENT_AGREED',
  'ALLOCATION_ACCEPTED',
  'PAYMENT_INSTRUCTIONS_ISSUED',
  'FUNDS_RECEIVED',
  'COMPLETED',
] as const

export type OfferStage = (typeof OFFER_STAGES)[number]

export type StepState = 'DONE' | 'CURRENT' | 'AHEAD'

export interface TimelineStep {
  number: number
  stage: OfferStage
  /** What the investor sees as the step's name. */
  label: string
  /**
   * The explanation beside it. For a step not yet reached this is the standard
   * "nothing for you to do" sentence — never a template with empty slots.
   */
  explanation: string
  state: StepState
}

/** The facts a reached step is allowed to mention. All strings. */
export interface TimelineFacts {
  sentOn?: string | null
  responseChoice?: 'INTERESTED' | 'NOT_INTERESTED' | 'QUESTION' | 'NO_RESPONSE' | null
  respondedOn?: string | null
  responseDeadline?: string | null
  documentsIssuedOn?: string | null
  committedAmount?: string | null
  acceptedAmount?: string | null
  spvPercentage?: string | null
  paymentInstructionsIssuedOn?: string | null
  fundsCurrency?: string | null
  fundsAmount?: string | null
  fundsValueDate?: string | null
  fundsReference?: string | null
}

export const NOT_YET_REACHED =
  'Not yet reached. There is nothing for you to do at this stage.'

const LABELS: Record<OfferStage, string> = {
  INVITATION_SENT: 'Invitation sent',
  RESPONSE_RECORDED: 'Your response recorded',
  DOCUMENTS_ISSUED: 'Documents issued',
  COMMITMENT_AGREED: 'Commitment agreed',
  ALLOCATION_ACCEPTED: 'Allocation accepted',
  PAYMENT_INSTRUCTIONS_ISSUED: 'Payment instructions issued',
  FUNDS_RECEIVED: 'Funds received',
  COMPLETED: 'Completed',
}

const RESPONSE_WORDS: Record<string, string> = {
  INTERESTED: 'interested in receiving the formal investment documents',
  NOT_INTERESTED: 'not interested at this time',
  QUESTION: 'holding a question before deciding',
  NO_RESPONSE: 'yet to respond',
}

/**
 * The explanation for a step that has been reached.
 *
 * Where a fact is genuinely missing the sentence is written without it rather
 * than with a gap. "Your personalised invitation was sent." is true and
 * complete; "Your personalised invitation was sent on ." is neither.
 */
function explanationFor(stage: OfferStage, facts: TimelineFacts): string {
  switch (stage) {
    case 'INVITATION_SENT':
      return facts.sentOn
        ? `Your personalised invitation was sent on ${facts.sentOn}.`
        : 'Your personalised invitation was sent.'

    case 'RESPONSE_RECORDED': {
      const word = facts.responseChoice ? RESPONSE_WORDS[facts.responseChoice] : null
      const opening = word ? `You told us you are ${word}` : 'Your response has been recorded'
      const when = facts.respondedOn ? ` on ${facts.respondedOn}` : ''
      const until = facts.responseDeadline
        ? ` You can change this until ${facts.responseDeadline}.`
        : ''
      return `${opening}${when}.${until}`
    }

    case 'DOCUMENTS_ISSUED':
      return 'The proposed SPV structure, subscription documents and risk disclosures have been sent to you for review.'

    case 'COMMITMENT_AGREED':
      return facts.committedAmount
        ? `You have confirmed the amount you wish to invest: ${facts.committedAmount}. This becomes binding only to the extent the signed documents say so.`
        : 'You have confirmed the amount you wish to invest. This becomes binding only to the extent the signed documents say so.'

    case 'ALLOCATION_ACCEPTED':
      return facts.acceptedAmount && facts.spvPercentage
        ? `The company has accepted your allocation. Your confirmed participation is ${facts.acceptedAmount} for ${facts.spvPercentage} of the SPV.`
        : 'The company has accepted your allocation.'

    case 'PAYMENT_INSTRUCTIONS_ISSUED': {
      const when = facts.paymentInstructionsIssuedOn
        ? ` on ${facts.paymentInstructionsIssuedOn}`
        : ''
      return `Payment instructions were sent to you${when}. Always verify payment details directly with David before transferring funds.`
    }

    case 'FUNDS_RECEIVED': {
      const amount =
        facts.fundsCurrency && facts.fundsAmount
          ? `${facts.fundsCurrency} ${facts.fundsAmount}`
          : (facts.fundsAmount ?? null)
      const head = amount ? `We confirm receipt of ${amount}` : 'We confirm receipt of your funds'
      const when = facts.fundsValueDate ? ` on ${facts.fundsValueDate}` : ''
      const reference = facts.fundsReference ? ` Reference: ${facts.fundsReference}.` : ''
      return `${head}${when}.${reference}`
    }

    case 'COMPLETED':
      return 'Your participation is recorded. Ongoing updates will appear below.'
  }
}

export function buildTimeline(
  currentStage: OfferStage,
  facts: TimelineFacts = {},
): TimelineStep[] {
  const currentIndex = OFFER_STAGES.indexOf(currentStage)

  return OFFER_STAGES.map((stage, index) => {
    const state: StepState =
      index < currentIndex ? 'DONE' : index === currentIndex ? 'CURRENT' : 'AHEAD'

    return {
      number: index + 1,
      stage,
      label: LABELS[stage],
      // A step still ahead gets the standard sentence and no facts whatever.
      explanation: state === 'AHEAD' ? NOT_YET_REACHED : explanationFor(stage, facts),
      state,
    }
  })
}

/**
 * §5, PORTAL_COPY: the payment-safety notice is shown from step 6 onward, and
 * prominently. It is the one piece of copy in the portal whose whole purpose is
 * to survive somebody else's forged email.
 */
export const PAYMENT_SAFETY_NOTICE =
  'We will never email you a change of bank details. If you receive any message ' +
  'appearing to change payment instructions, do not act on it — contact David ' +
  'directly using the number you already have for him and confirm by voice before ' +
  'sending any funds.'

export function showsPaymentSafetyNotice(stage: OfferStage): boolean {
  return OFFER_STAGES.indexOf(stage) >= OFFER_STAGES.indexOf('PAYMENT_INSTRUCTIONS_ISSUED')
}
