/**
 * What a published Q&A entry is allowed to be. BUILD_SPEC §6.7.3.
 *
 * The spec is unusually specific about this one, and the reason is worth
 * restating: *"The published question never shows who asked. No name, no
 * initials, no date precise enough to identify, no email."* Then immediately:
 * *"That is not enough on its own, because people identify themselves inside
 * the text."*
 *
 * So there are two mechanisms here and they do different jobs.
 *
 *   1. **`toPublicEntry` is structural.** It builds the object the investor
 *      side renders, and that object has no field capable of carrying an
 *      identity — no account id, no asker, no email, no timestamp. Nothing
 *      downstream can leak what it was never handed. This is the part that
 *      cannot be got wrong by a careless edit to a React component.
 *
 *   2. **`scanForIdentifyingDetail` is advisory, aimed at the human.** It reads
 *      the wording the operator proposes to publish and points at the things
 *      §6.7.3 names: amounts, percentages, addresses, dates, and the
 *      first-person phrasing that gives away a private conversation. It is a
 *      reminder, exactly as the spec frames it — the operator is the one who
 *      knows whether "the amount we discussed" identifies anybody.
 *
 * Pure. No database, no rendering, no side effects.
 */

// ---------------------------------------------------------------------------
// The public projection
// ---------------------------------------------------------------------------

/** The stored row, narrowed to what this module needs. */
export interface QaEntrySource {
  id: string
  /** Never published. Preserved unchanged on the private record (§6.7.3). */
  questionOriginal: string
  /** The wording the operator rewrote for publication. */
  questionPublic: string | null
  answer: string | null
  /** Null when the operator wrote the entry himself (§6.7.4). */
  askedByAccountId: string | null
  isPublished: boolean
  publishedAt: Date | null
  /** Set when the operator withdrew it. A withdrawn entry is never public. */
  unpublishedAt: Date | null
  pinned: boolean
  sortOrder: number
  updatedAtLabel: Date | null
}

/**
 * What every investor sees. Note what is absent: no id of any account, no
 * asker, no address, no exact date, no ordinal, no count.
 *
 * `id` is the entry's own id, which belongs to the entry rather than to a
 * person — it is needed for React keys and for anchor links. It is a random
 * identifier and reveals nothing about who asked, but it is worth being
 * deliberate that this is the *entry* id and never the account id.
 */
export interface PublicQaEntry {
  id: string
  question: string
  answer: string
  pinned: boolean
  /** Month and year, never a day. See `coarsePeriod`. */
  publishedPeriod: string | null
  /** Present only when a published answer was later edited (§6.7.3). */
  updatedPeriod: string | null
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * "July 2026". §6.7.3 forbids "a date precise enough to identify" — a day is,
 * because David answers a question within hours of it being asked and an
 * investor who asked on the 14th can recognise their own question by its date.
 * A month cannot be matched to a conversation that way, and having some sense
 * of when an answer was given is genuinely useful, so the month stays.
 *
 * Deliberately built from UTC parts rather than `toLocaleDateString`, which
 * would vary by server locale and could reintroduce a day.
 */
export function coarsePeriod(date: Date | null): string | null {
  if (date === null) return null
  if (Number.isNaN(date.getTime())) return null
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * Why an entry cannot be published yet. Null when it can.
 *
 * An investor-asked entry requires a public wording even when the original
 * would have done. §6.7.3 asks the operator to rewrite the question "into a
 * general form", and the way to make sure that happened is to require the
 * field rather than to fall back to the original. Falling back is the version
 * of this that publishes somebody's own words the first time the operator
 * forgets — and the spec's example of what goes wrong is a question that reads
 * perfectly innocent until you know who wrote it.
 *
 * An operator-authored entry (§6.7.4) has no asker, so its original text is
 * already public wording and no rewrite is required.
 */
export type PublishBlock =
  | 'NO_ANSWER'
  | 'NO_PUBLIC_QUESTION'

export function publishBlock(entry: QaEntrySource): PublishBlock | null {
  const answer = entry.answer?.trim() ?? ''
  if (answer === '') return 'NO_ANSWER'

  const isInvestorAsked = entry.askedByAccountId !== null
  const publicQuestion = entry.questionPublic?.trim() ?? ''
  if (isInvestorAsked && publicQuestion === '') return 'NO_PUBLIC_QUESTION'
  if (!isInvestorAsked && publicQuestion === '' && entry.questionOriginal.trim() === '') {
    return 'NO_PUBLIC_QUESTION'
  }

  return null
}

export const PUBLISH_BLOCK_MESSAGE: Readonly<Record<PublishBlock, string>> = {
  NO_ANSWER:
    'There is no answer on this entry yet, so there is nothing to publish. Write the answer first.',
  NO_PUBLIC_QUESTION:
    'This question was asked by an investor, so it needs a public version before it can be ' +
    'published. Rewrite it in a general form — the original stays on the private record ' +
    'either way. If the wording is already general, retype it into the public box to confirm ' +
    'you have read it with that in mind.',
}

/**
 * The published form, or null if this entry is not publishable.
 *
 * Returning null rather than throwing is deliberate: this runs over a list, and
 * one unpublishable row must not take the page down. A row that should not be
 * visible is simply absent.
 */
export function toPublicEntry(entry: QaEntrySource): PublicQaEntry | null {
  if (!entry.isPublished) return null
  // Belt and braces: `loadSharedQa` excludes withdrawn entries in the SQL, and
  // this excludes them again here. The query is a filter a future caller can
  // forget to write; this is the projection every caller has to go through.
  if (entry.unpublishedAt !== null) return null
  if (publishBlock(entry) !== null) return null

  const question = (entry.questionPublic ?? entry.questionOriginal).trim()
  const answer = (entry.answer ?? '').trim()
  if (question === '' || answer === '') return null

  return {
    id: entry.id,
    question,
    answer,
    pinned: entry.pinned,
    publishedPeriod: coarsePeriod(entry.publishedAt),
    updatedPeriod: coarsePeriod(entry.updatedAtLabel),
  }
}

/**
 * Pinned first, then the operator's order, then oldest first.
 *
 * Stable and total, so two entries with the same sort order do not swap places
 * between page loads — an investor watching the list rearrange itself would
 * reasonably wonder what changed and why.
 */
export function orderPublicEntries(entries: PublicQaEntry[]): PublicQaEntry[] {
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return 0
  })
}

// ---------------------------------------------------------------------------
// The identifying-detail scan
// ---------------------------------------------------------------------------

export type IdentifyingDetailKind =
  | 'EMAIL_ADDRESS'
  | 'MONEY_AMOUNT'
  | 'PERCENTAGE'
  | 'TELEPHONE_NUMBER'
  | 'SPECIFIC_DATE'
  | 'PRIVATE_CONVERSATION'
  | 'FIRST_PERSON_HOLDING'

export interface IdentifyingDetail {
  kind: IdentifyingDetailKind
  /** What the operator is being asked to look at. */
  label: string
  /** The matched fragment, trimmed. Shown back to the operator, never sent. */
  excerpt: string
}

interface Rule {
  kind: IdentifyingDetailKind
  label: string
  pattern: RegExp
}

/**
 * The list is not — and cannot be — exhaustive. It covers the four things
 * §6.7.3 names by example (amounts, percentages, "as we discussed", an
 * allocation) plus addresses, phone numbers and specific dates, which identify
 * for the same reason. A general-purpose "does this text identify anybody"
 * detector does not exist, which is why the operator's judgement stays in the
 * loop rather than being replaced by this.
 *
 * Every pattern is global so `matchAll` finds each occurrence; each is built
 * fresh per call, because a global regex carries `lastIndex` between calls and
 * a shared one would skip matches on every second invocation.
 */
function rules(): Rule[] {
  return [
    {
      kind: 'EMAIL_ADDRESS',
      label: 'An email address',
      pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    },
    {
      kind: 'MONEY_AMOUNT',
      label: 'A monetary amount',
      pattern:
        /(?:[$£€]\s?\d[\d,.\s]*)|(?:\b\d[\d,.]*\s?(?:usd|dollars?|pounds?|euros?|gbp|eur)\b)/gi,
    },
    {
      kind: 'PERCENTAGE',
      label: 'A percentage',
      pattern: /(?:\d[\d,.]*\s?%)|(?:\b\d[\d,.]*\s?(?:per\s?cent|percent)\b)/gi,
    },
    {
      kind: 'TELEPHONE_NUMBER',
      label: 'Something that looks like a telephone number',
      pattern: /(?:\+\d[\d\s()-]{7,})|(?:\b\d[\d\s()-]{8,}\d\b)/g,
    },
    {
      kind: 'SPECIFIC_DATE',
      label: 'A specific date or day',
      pattern:
        /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|yesterday|tomorrow|last\s+week|this\s+morning)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/gi,
    },
    {
      kind: 'PRIVATE_CONVERSATION',
      label: 'A reference to a private conversation',
      pattern:
        /\b(?:as\s+(?:we|you\s+and\s+i)\s+(?:discussed|agreed|said|spoke)|when\s+we\s+(?:spoke|met)|on\s+(?:our|the)\s+call|you\s+(?:told|offered|mentioned\s+to)\s+me|in\s+your\s+email\s+to\s+me)\b/gi,
    },
    {
      kind: 'FIRST_PERSON_HOLDING',
      label: 'A reference to the writer’s own holding',
      pattern:
        /\b(?:my|our)\s+(?:allocation|allocations|stake|share|shares|holding|holdings|investment|investments|position|amount|percentage|subscription)\b/gi,
    },
  ]
}

const MAX_EXCERPT = 60

function excerptOf(match: string): string {
  const trimmed = match.trim().replace(/\s+/g, ' ')
  return trimmed.length <= MAX_EXCERPT ? trimmed : `${trimmed.slice(0, MAX_EXCERPT - 1)}…`
}

/**
 * Everything in the proposed public wording worth a second look, in the order
 * the rules are declared, deduplicated by kind and excerpt so a question that
 * says "5%" twice produces one line rather than two.
 */
export function scanForIdentifyingDetail(...texts: Array<string | null | undefined>): IdentifyingDetail[] {
  const subject = texts.filter((text): text is string => typeof text === 'string').join('\n')
  if (subject.trim() === '') return []

  const found: IdentifyingDetail[] = []
  const seen = new Set<string>()

  for (const rule of rules()) {
    for (const match of subject.matchAll(rule.pattern)) {
      const excerpt = excerptOf(match[0])
      if (excerpt === '') continue

      const key = `${rule.kind}:${excerpt.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      found.push({ kind: rule.kind, label: rule.label, excerpt })
    }
  }

  return found
}

/**
 * Whether the operator has to tick "I have read this as a stranger would"
 * before the entry publishes.
 *
 * §6.7.3 asks for "a reminder to check". A reminder nobody has to acknowledge
 * is a reminder nobody reads, and the cost of the stricter reading is one
 * checkbox on the entries that actually contain an amount or an address. Where
 * the scan finds nothing, no acknowledgement is asked for and publishing is one
 * action — the friction lands only where there is something to look at.
 */
export function requiresAnonymityAcknowledgement(findings: IdentifyingDetail[]): boolean {
  return findings.length > 0
}

/** The one line §6.7.6 asks for, shown in the publish dialog. Exactly once. */
export const PUBLISH_COMPLIANCE_NOTICE =
  'An answer published here is a communication to every recipient of the offer, and carries ' +
  'the same weight as the invitation itself. A private answer to one person is ordinary ' +
  'correspondence and is not.'

/** §6.7.3: "David should be told plainly that unpublishing does not un-see it." */
export const UNPUBLISH_NOTICE =
  'Unpublishing removes the entry from the shared page. It does not un-send it — anyone who ' +
  'has already read it has already read it, and may have copied it. Unpublishing is recorded ' +
  'in the audit log.'
