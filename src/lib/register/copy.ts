/**
 * The register of interest, in the exact words BUILD_SPEC §5.2.1 requires.
 *
 * The spec says why this is a constant and not prose typed into a component:
 * *"The copy has to carry this precisely, because the whole feature lives or
 * dies on not overstating."* A register that reads as a queue is a promise, and
 * a promise about a securities allocation is a thing nobody here is allowed to
 * make by accident.
 *
 * `copy.test.ts` reads the blockquote out of `BUILD_SPEC.md` and compares it
 * to `REGISTER_COPY` paragraph by paragraph. If somebody edits either one, the
 * test fails and they have to change both deliberately.
 *
 * Note the name throughout: **register of interest**, never waitlist. §5.2:
 * "A waitlist implies a queue you are progressing along and a thing you will
 * eventually receive. Neither is true here." A test asserts the word does not
 * appear in this module or anywhere on the investor's side.
 */

export const REGISTER_TITLE = 'Register of interest'

/** The four paragraphs of §5.2.1, in order, verbatim. */
export const REGISTER_COPY: readonly string[] = [
  'If further allocations become available, we contact people from this register.',

  'Adding your name records your interest. It does not reserve an allocation, create any ' +
    'entitlement to one, or oblige anyone to offer you anything. Whether anything becomes ' +
    'available at all, and whether it is offered to you, depends on circumstances at the time, ' +
    'on the final SPV and subscription documents, and on applicable law.',

  'Where we are able to make an offer, we work through the register beginning with those who ' +
    'completed their own participation earliest — commitment agreed and funds settled. Joining ' +
    'the register does not itself create a position; completing your current participation does.',

  'You can remove yourself at any time.',
] as const

/** PORTAL_COPY, verbatim. */
export const JOIN_BUTTON_LABEL = 'Add my name to the register'
export const LEAVE_BUTTON_LABEL = 'Remove my name'

export const INDICATIVE_AMOUNT_LABEL =
  'If more became available, roughly how much would interest you? Indicative only — this is ' +
  'not a commitment and nothing is held on the basis of it.'

export const JOINED_CONFIRMATION =
  'Your name is on the register. We’ll be in touch if anything becomes available. You can ' +
  'remove yourself at any time.'

export const LEFT_CONFIRMATION =
  'Your name has been removed from the register. You can add it again at any time.'

/**
 * What the operator is told before issuing an offer from the register.
 *
 * §5.2.4: *"A freed allocation is a new offer, not a continuation of an old
 * one. Nothing about the register shortcuts any gate."*
 */
export const ISSUE_COMPLIANCE_NOTICE =
  'An offer issued from the register is an ordinary offer and passes through every gate. The ' +
  'jurisdiction check applies, the compliance approval must be current, and it sends one ' +
  'recipient at a time from the review screen like any other. A freed allocation is a new ' +
  'offer, not a continuation of an old one.'

/** Shown beside the computed order, so nobody mistakes it for a promise. */
export const ORDER_IS_NOT_A_QUEUE_NOTICE =
  'This order is computed for you and is never shown to any investor. A displayed rank is a ' +
  'promise whatever the surrounding text says, and it would leak the existence and relative ' +
  'standing of other investors. It is a starting point for your judgement, not an instruction.'
