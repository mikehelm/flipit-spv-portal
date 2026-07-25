/**
 * What the operator is shown when a recipient is blocked. BUILD_SPEC §8.3.
 *
 * "A blocked recipient is not a silent failure — the app explains it to him in
 * plain language at the point he tries to send... It tells him exactly what
 * unblocking requires — a recorded approval reference from whoever is
 * qualified to give it — and does not let him route around it. The wording
 * makes clear the app is not giving legal advice; it is refusing to guess."
 *
 * That last sentence is the design brief for this whole file. Every string
 * here is written to be read by a person who is trying to send an email and
 * has just been stopped, and it has to do four things at once: say what
 * happened, say why it matters, say exactly what would change it, and be
 * honest that this is a refusal to guess rather than an opinion about the law.
 *
 * Pure. No database, no session. Returned as structure rather than one blob of
 * markup so the same words can appear on the compliance page, in the review
 * table and next to a refused send without being rewritten three times.
 */

import { countryName } from '@/lib/import/iso-countries'
import { normaliseJurisdiction } from './jurisdictions'

export interface BlockExplanation {
  /** One line. Safe to use as a heading or a table cell. */
  headline: string
  /** The body, in paragraphs. Plain language, no legal citations. */
  paragraphs: string[]
  /** Exactly what would unblock this recipient, in order. */
  unblockingRequires: string[]
  /** The disclaimer. Shown every time, never abbreviated away. */
  notLegalAdvice: string
  /** The recommendation §8.3 asks the app to make. */
  recommendation: string
}

export const NOT_LEGAL_ADVICE =
  'This application does not give legal advice and does not assess whether any approval is ' +
  'adequate. It is not making a judgement about this person or this jurisdiction. It is ' +
  'declining to guess, because guessing on a securities offer is the one thing software ' +
  'should never do on your behalf.'

const RECOMMENDATION =
  'The practical path is to send to everyone else and hold this one person pending advice. ' +
  'That costs one conversation and delays one recipient. Reversing an offer that has already ' +
  'been made costs considerably more.'

function label(code: string): string {
  const normalised = normaliseJurisdiction(code)
  if (normalised === null) return code
  const name = countryName(normalised)
  return name ? `${name} (${normalised})` : normalised
}

/**
 * The United States gets its own explanation because it is not the same
 * situation as the others, and §8.3 is explicit that the app must not treat it
 * as one: adding a single US person changes the analysis for the offering, not
 * only for that person.
 */
function explainUnitedStates(recipientName: string | null): BlockExplanation {
  const who = recipientName ? recipientName : 'This recipient'

  return {
    headline: `${who} is in the United States, which is not on the approved list — held, not sent.`,
    paragraphs: [
      `${who} has imported normally and appears everywhere the others do. The invitation to ` +
        'them is held. Every other recipient is completely unaffected and can be sent to now.',
      'The United States is treated differently from the other jurisdictions on this list ' +
        'deliberately. An offering made entirely outside the United States is generally ' +
        'structured to rely on that fact. Adding one US person changes the analysis for the ' +
        'whole offering, not just for that person.',
      'The size of the investment does not help here. A small offering is still an offering, ' +
        'and there is no threshold below which this stops applying. That is why the amount is ' +
        'not offered as a reason to proceed.',
      'The compliance approval on file simply does not list US. Nobody has decided this ' +
        'recipient may not be approached — it is that no qualified person has yet said they ' +
        'may, and the application will not fill that gap by assumption.',
    ],
    unblockingRequires: [
      'Ask whoever is qualified to advise on this offering about this one recipient specifically.',
      'When they clear it, record their reference on this recipient — the letter, email or ' +
        'document identifier that shows what was approved and by whom.',
      'The owner enters that reference against this recipient. It unblocks this person only. ' +
        'There is no setting anywhere in the application that unblocks a jurisdiction for ' +
        'everybody at once, and that is on purpose.',
      'Alternatively, the owner records a new compliance approval whose cleared jurisdiction ' +
        'list includes US — which is the same decision, made once, for everyone from there.',
    ],
    notLegalAdvice: NOT_LEGAL_ADVICE,
    recommendation: RECOMMENDATION,
  }
}

/**
 * Every other uncleared jurisdiction. Same shape, same honesty, without the
 * US-specific reasoning that would not be true of, say, Thailand.
 */
export function explainJurisdictionBlock(input: {
  code: string
  recipientName?: string | null
  approvedJurisdictions?: readonly string[]
}): BlockExplanation {
  const normalised = normaliseJurisdiction(input.code)
  const recipientName = input.recipientName?.trim() || null

  if (normalised === 'US') return explainUnitedStates(recipientName)

  const who = recipientName ?? 'This recipient'
  const place = normalised ? label(normalised) : `"${input.code}"`
  const cleared = (input.approvedJurisdictions ?? []).filter(Boolean)

  if (normalised === null) {
    return {
      headline: `${who} has no usable jurisdiction recorded — held, not sent.`,
      paragraphs: [
        `The jurisdiction field for ${who.toLowerCase() === 'this recipient' ? 'this recipient' : who} ` +
          'is empty or is not an ISO 3166-1 alpha-2 country code, so there is nothing to check ' +
          'against the approval. Everyone else is unaffected.',
        'The application will not treat a missing country as an approved one, and it will not ' +
          'infer a country from an email address, a name or a phone number.',
      ],
      unblockingRequires: [
        'Correct the recipient’s jurisdiction to the two-letter country code where they ' +
          'actually are — GB, AU, FR, TH and so on.',
        'If that country is on the approved list, the hold clears by itself.',
        'If it is not, this becomes an ordinary jurisdiction block and needs a recorded ' +
          'approval reference for that person.',
      ],
      notLegalAdvice: NOT_LEGAL_ADVICE,
      recommendation: RECOMMENDATION,
    }
  }

  return {
    headline: `${who} is in ${place}, which is not on the approved list — held, not sent.`,
    paragraphs: [
      `${who} has imported normally and is held rather than dropped. Every other recipient is ` +
        'unaffected and can be sent to now.',
      `The compliance approval on file clears ${cleared.length > 0 ? cleared.join(', ') : 'no jurisdictions at all'}. ` +
        `${place} is not among them. That is not a judgement about ${place} — it is that ` +
        'nobody qualified has yet said this offer may be communicated there, and the ' +
        'application will not decide that for you.',
      'Private rounds among known contacts routinely satisfy the local rules. They satisfy ' +
        'them deliberately, though, not by accident, and the difference between those two ' +
        'things is the reason this is a hold rather than a warning.',
    ],
    unblockingRequires: [
      `Ask whoever is qualified to advise on this offering about ${place} specifically.`,
      'When they clear it, record their reference on this recipient — the letter, email or ' +
        'document identifier that shows what was approved and by whom.',
      'The owner enters that reference against this recipient. It unblocks this person only; ' +
        'no blanket unblock exists.',
      `Alternatively, the owner records a new compliance approval whose cleared list includes ` +
        `${normalised}.`,
    ],
    notLegalAdvice: NOT_LEGAL_ADVICE,
    recommendation: RECOMMENDATION,
  }
}

/** The short form, for a table cell or an error string. */
export function shortBlockReason(code: string, approved: readonly string[]): string {
  const normalised = normaliseJurisdiction(code)
  if (normalised === null) {
    return 'No valid jurisdiction is recorded for this recipient, so the compliance gate has nothing to check.'
  }
  return (
    `${label(normalised)} is not on the compliance-approved jurisdiction list ` +
    `(${approved.length > 0 ? approved.join(', ') : 'the list is empty'}). ` +
    'This recipient is held on their own; every other recipient is unaffected.'
  )
}
