/**
 * Email template variables, and the rules for filling them in.
 *
 * BUILD_SPEC §11.1 declares the variable set, §11.2 fixes the order the sender
 * fields are resolved in, and §11.4 says rendering must fail loudly on anything
 * left unresolved. This module owns all three.
 *
 * Three things about it are deliberate.
 *
 *   1. **Resolution never guesses.** Each variable has one stated chain and no
 *      other source. `sender_phone` in particular has *no* automatic fallback
 *      (§11.2) — if neither the row nor `service_config` supplies it, that is
 *      an unresolved variable and the send is blocked. The operator's
 *      onboarding number is deliberately NOT used as a silent third source;
 *      see `SENDER_PHONE_NOTE`.
 *
 *   2. **Absent is not the same as blank.** A variable resolves to `null` when
 *      it genuinely has no value. Nothing here ever substitutes an empty
 *      string, because an empty string renders as a blank line in an
 *      investment email and a `null` inside a conditional block removes the
 *      line entirely — which is what §2.1 step 2 requires for `EMAIL_ONLY`.
 *
 *   3. **No JavaScript number touches an amount or a percentage.** Figures
 *      arrive from Drizzle as strings, go through `decimal.js` inside
 *      `formatMoney` / `formatPercentage`, and leave as strings. There is no
 *      `Number()` in this file and a test asserts that.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import type { ContactMethod } from '@/lib/auth/onboarding'
import { readServiceConfig } from '@/lib/auth/service-config'
import { decrypt } from '@/lib/crypto'
import { env } from '@/lib/env'
import { formatMoney, formatPercentage } from '@/lib/money'

// ---------------------------------------------------------------------------
// Paths that end up inside an email
// ---------------------------------------------------------------------------

/**
 * Where a claim link points. WP8 owns the route itself; this constant is the
 * single place the email side names it, so the two can be reconciled in one
 * edit rather than by grepping the templates.
 */
export const PORTAL_CLAIM_PATH = '/portal/claim'

/**
 * The public anti-phishing verification page (§15.1). It is linked from the
 * invitation footer, which is the whole reason it exists — someone who
 * received an unexpected securities invitation needs a way to check it.
 * WP14 builds the page; this is the path the email points at.
 */
export const VERIFICATION_PATH = '/verify'

/** Absolute URL for a path under this deployment. `APP_URL` includes basePath. */
export function absoluteUrl(path: string): string {
  const base = env().APP_URL.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** The claim link carried by an invitation. Never contains personal data (§15). */
export function buildPortalLink(claimToken: string): string {
  return absoluteUrl(`${PORTAL_CLAIM_PATH}/${encodeURIComponent(claimToken)}`)
}

export function buildVerificationLink(): string {
  return absoluteUrl(VERIFICATION_PATH)
}

/**
 * Used by the admin preview so the button is a real, clickable, obviously fake
 * link rather than a live token. A preview must never mint a working claim
 * token — it is a read, and reads do not issue credentials.
 */
export const PREVIEW_CLAIM_TOKEN = 'preview-only-not-a-real-link'

// ---------------------------------------------------------------------------
// The declared variable set — BUILD_SPEC §11.1, plus the two extras
// ---------------------------------------------------------------------------

export const EMAIL_VARIABLE_NAMES = [
  'recipient_name',
  'investment_amount',
  'spv_percentage',
  'indirect_flipit_percentage',
  'response_deadline',
  'secure_portal_link',
  'sender_name',
  'sender_email',
  'sender_phone',
  'personal_line',
  'use_of_funds',
  'verification_link',
] as const

export type EmailVariableName = (typeof EMAIL_VARIABLE_NAMES)[number]

/**
 * Boolean conditions available to `{{#if}}` and `{{#unless}}` only. They are
 * not substitutable — a flag can never print itself into an email.
 *
 * They exist because the contact method changes the *label* as well as the
 * presence of the line: a WhatsApp number and a telephone number are not
 * interchangeable strings, and rendering one as the other would be wrong.
 */
export const EMAIL_FLAG_NAMES = ['contact_phone', 'contact_whatsapp'] as const

export type EmailFlagName = (typeof EMAIL_FLAG_NAMES)[number]

/** Where a resolved value came from. Recorded so a preview can explain itself. */
export type ResolutionSource =
  | 'ROW'
  | 'SERVICE_CONFIG'
  | 'AUTHENTICATED_ADDRESS'
  | 'RECORD'
  | 'DEPLOYMENT'
  | 'ABSENT'

export interface EmailVariableDeclaration {
  name: EmailVariableName
  label: string
  /** Plain description for the admin template page. */
  description: string
  /**
   * May legitimately be absent. An optional variable MUST be referenced only
   * inside a conditional block; the renderer enforces that by treating a live
   * reference to an absent variable as unresolved regardless of this flag.
   */
  optional: boolean
  /** Human description of the resolution chain, shown on the template page. */
  chain: string
}

export const EMAIL_VARIABLES: Readonly<
  Record<EmailVariableName, EmailVariableDeclaration>
> = {
  recipient_name: {
    name: 'recipient_name',
    label: 'Recipient name',
    description: 'The investor, as addressed in the salutation.',
    optional: false,
    chain: 'The investor account record.',
  },
  investment_amount: {
    name: 'investment_amount',
    label: 'Proposed investment',
    description: 'The proposed amount in USD, formatted for display only.',
    optional: false,
    chain: "The offer's proposed amount.",
  },
  spv_percentage: {
    name: 'spv_percentage',
    label: 'SPV percentage',
    description: 'Their proposed share of the SPV. Rendered without the % sign.',
    optional: false,
    chain: "The offer's stored SPV percentage.",
  },
  indirect_flipit_percentage: {
    name: 'indirect_flipit_percentage',
    label: 'Indirect Flipit percentage',
    description:
      'The stored indirect economic interest. Stored, never recomputed at render time, so the figure sent cannot drift from the figure shown.',
    optional: false,
    chain: "The offer's stored indirect percentage.",
  },
  response_deadline: {
    name: 'response_deadline',
    label: 'Response deadline',
    description: 'A date, not a timestamp. Rendered as e.g. 10 August 2026.',
    optional: false,
    chain: "The offer's response deadline.",
  },
  secure_portal_link: {
    name: 'secure_portal_link',
    label: 'Secure portal link',
    description:
      'The single-use claim link. Issued at send time; the preview shows an obviously fake one.',
    optional: false,
    chain: 'Issued per send. Never contains a name, address, amount or percentage.',
  },
  sender_name: {
    name: 'sender_name',
    label: 'Sender name',
    description: 'The name the invitation is signed with.',
    optional: false,
    chain: 'Row value, then the default in settings. No further fallback.',
  },
  sender_email: {
    name: 'sender_email',
    label: 'Sender email',
    description: 'The reply address printed in the sign-off.',
    optional: false,
    chain:
      'Row value, then the default in settings, then the authenticated sending address.',
  },
  sender_phone: {
    name: 'sender_phone',
    label: 'Sender phone',
    description:
      'The contact number. Removed from the email entirely when the operator chose email-only.',
    optional: true,
    chain:
      'Row value, then the default in settings. No automatic fallback — see BUILD_SPEC §11.2.',
  },
  personal_line: {
    name: 'personal_line',
    label: 'Personal line',
    description:
      'One optional sentence to this recipient, placed under the salutation. Omitted entirely when not supplied.',
    optional: true,
    chain: 'Supplied per recipient. No default, and no error when absent.',
  },
  use_of_funds: {
    name: 'use_of_funds',
    label: 'Use of funds',
    description:
      'An optional short statement of what the raise is for. Omitted entirely when not supplied.',
    optional: true,
    chain: 'Supplied per recipient. No default, and no error when absent.',
  },
  verification_link: {
    name: 'verification_link',
    label: 'Verification page link',
    description:
      'The public anti-phishing page (§15.1), linked from the footer so a suspicious recipient can check the email is genuine.',
    optional: false,
    chain: 'Derived from this deployment’s public URL.',
  },
}

export const REQUIRED_EMAIL_VARIABLES: readonly EmailVariableName[] =
  EMAIL_VARIABLE_NAMES.filter((name) => !EMAIL_VARIABLES[name].optional)

export function isEmailVariable(name: string): name is EmailVariableName {
  return (EMAIL_VARIABLE_NAMES as readonly string[]).includes(name)
}

export function isEmailFlag(name: string): name is EmailFlagName {
  return (EMAIL_FLAG_NAMES as readonly string[]).includes(name)
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One recipient's record, as the renderer needs it. All figures are strings. */
export interface RecipientVariableInput {
  /** Used to name the recipient in an error, and to key batch problems. */
  offerId: string
  recipientName: string
  recipientEmail: string

  /** Drizzle `numeric` comes back as a string. It stays one. */
  proposedAmountUsd: string
  spvPercentage: string
  indirectPercentage: string
  /** ISO `yyyy-mm-dd`. */
  responseDeadline: string

  /** Per-row overrides from the upload (§9 optional fields). */
  rowSenderName?: string | null
  rowSenderEmail?: string | null
  rowSenderPhone?: string | null

  /** Optional per-recipient copy. Absent means the block is removed. */
  personalLine?: string | null
  useOfFunds?: string | null

  /** The claim link for this send. The preview passes an obviously fake one. */
  portalLink: string
}

/** Everything shared across the batch: settings, the operator, the deployment. */
export interface SenderDefaults {
  defaultSenderName: string | null
  defaultSenderEmail: string | null
  defaultSenderPhone: string | null
  /** The authenticated sending address. Last resort for `sender_email` only. */
  authenticatedSenderEmail: string | null
  /** Drives whether the phone line exists at all, and what it is called. */
  contactMethod: ContactMethod | null
  /**
   * Whether the operator gave a number during onboarding. Used ONLY to write a
   * more useful failure message — never as a value.
   */
  operatorContactValuePresent: boolean
  /** Display precision for percentages (§10). Money is always two places. */
  decimalPlaces: number
  verificationLink: string
}

export const SENDER_PHONE_NOTE =
  'BUILD_SPEC §11.2 gives sender_phone no automatic fallback. Set "Default sender phone" in settings, or supply the column in the upload.'

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface EmailVariableContext {
  variables: Readonly<Record<EmailVariableName, string | null>>
  sources: Readonly<Record<EmailVariableName, ResolutionSource>>
  flags: Readonly<Record<EmailFlagName, boolean>>
  /** Guidance attached to a variable that could not be resolved. */
  notes: Readonly<Partial<Record<EmailVariableName, string>>>
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** First non-empty candidate, with the source that produced it. */
function firstOf(
  candidates: Array<[ResolutionSource, string | null | undefined]>,
): { value: string | null; source: ResolutionSource } {
  for (const [source, raw] of candidates) {
    const value = trimmedOrNull(raw)
    if (value !== null) return { value, source }
  }
  return { value: null, source: 'ABSENT' }
}

const MONTH_NAMES: Readonly<Record<string, string>> = {
  '01': 'January',
  '02': 'February',
  '03': 'March',
  '04': 'April',
  '05': 'May',
  '06': 'June',
  '07': 'July',
  '08': 'August',
  '09': 'September',
  '10': 'October',
  '11': 'November',
  '12': 'December',
}

/**
 * `2026-08-10` → `10 August 2026`.
 *
 * Written out by hand rather than through `Intl`, because `Intl` needs a
 * `Date`, a `Date` needs a timezone decision, and a deadline is a date rather
 * than an instant (see the Time convention). The month index is an array
 * position, not arithmetic on a money value.
 */
export function formatDeadline(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) {
    throw new Error(
      `Deadline "${iso}" is not an ISO date (yyyy-mm-dd). Deadlines are dates, not timestamps.`,
    )
  }
  const [, year, month, day] = match
  const monthName = MONTH_NAMES[month]
  if (!monthName) {
    throw new Error(`Deadline "${iso}" names month ${month}, which does not exist.`)
  }
  if (day === '00' || day > '31') {
    throw new Error(`Deadline "${iso}" names day ${day}, which does not exist.`)
  }
  // Drop a leading zero from the day without arithmetic on the value.
  const dayText = day.startsWith('0') ? day.slice(1) : day
  return `${dayText} ${monthName} ${year}`
}

/**
 * Fill in every declared variable for one recipient.
 *
 * Returns a context rather than throwing. Whether an absent value is a problem
 * depends on whether the template actually references it in a live region, and
 * only the renderer knows that — see `render.ts`.
 */
export function resolveEmailVariables(
  input: RecipientVariableInput,
  defaults: SenderDefaults,
): EmailVariableContext {
  const variables = {} as Record<EmailVariableName, string | null>
  const sources = {} as Record<EmailVariableName, ResolutionSource>
  const notes: Partial<Record<EmailVariableName, string>> = {}

  const set = (
    name: EmailVariableName,
    value: string | null,
    source: ResolutionSource,
  ) => {
    variables[name] = value
    sources[name] = value === null ? 'ABSENT' : source
  }

  // --- from the record -----------------------------------------------------

  set('recipient_name', trimmedOrNull(input.recipientName), 'RECORD')

  set(
    'investment_amount',
    formatMoney(input.proposedAmountUsd, { decimalPlaces: 2, grouping: true }),
    'RECORD',
  )

  set(
    'spv_percentage',
    formatPercentage(input.spvPercentage, {
      decimalPlaces: defaults.decimalPlaces,
      suffix: false,
      trimTrailingZeros: true,
    }),
    'RECORD',
  )

  set(
    'indirect_flipit_percentage',
    formatPercentage(input.indirectPercentage, {
      decimalPlaces: defaults.decimalPlaces,
      suffix: false,
      trimTrailingZeros: true,
    }),
    'RECORD',
  )

  set('response_deadline', formatDeadline(input.responseDeadline), 'RECORD')
  set('secure_portal_link', trimmedOrNull(input.portalLink), 'RECORD')
  set('verification_link', trimmedOrNull(defaults.verificationLink), 'DEPLOYMENT')

  // --- optional per-recipient copy -----------------------------------------

  set('personal_line', trimmedOrNull(input.personalLine), 'ROW')
  set('use_of_funds', trimmedOrNull(input.useOfFunds), 'ROW')

  // --- the sender fields, §11.2 --------------------------------------------

  const name = firstOf([
    ['ROW', input.rowSenderName],
    ['SERVICE_CONFIG', defaults.defaultSenderName],
  ])
  set('sender_name', name.value, name.source)
  if (name.value === null) {
    notes.sender_name =
      'Set "Default sender name" in settings, or supply a sender_name column in the upload.'
  }

  const email = firstOf([
    ['ROW', input.rowSenderEmail],
    ['SERVICE_CONFIG', defaults.defaultSenderEmail],
    ['AUTHENTICATED_ADDRESS', defaults.authenticatedSenderEmail],
  ])
  set('sender_email', email.value, email.source)
  if (email.value === null) {
    notes.sender_email =
      'Connect the sending account, or set "Default sender email" in settings.'
  }

  // Email-only removes the line entirely. A blank value would render a blank
  // phone line, which BUILD_SPEC §2.1 step 2 explicitly rules out.
  if (defaults.contactMethod === 'EMAIL_ONLY') {
    set('sender_phone', null, 'ABSENT')
  } else {
    const phone = firstOf([
      ['ROW', input.rowSenderPhone],
      ['SERVICE_CONFIG', defaults.defaultSenderPhone],
    ])
    set('sender_phone', phone.value, phone.source)
    if (phone.value === null) {
      notes.sender_phone = defaults.operatorContactValuePresent
        ? `A contact number was captured during operator onboarding, but that is not one of the two sources §11.2 allows. ${SENDER_PHONE_NOTE}`
        : SENDER_PHONE_NOTE
    }
  }

  // --- flags ---------------------------------------------------------------

  const hasPhone = variables.sender_phone !== null
  const flags: Record<EmailFlagName, boolean> = {
    contact_phone: defaults.contactMethod === 'PHONE' && hasPhone,
    contact_whatsapp: defaults.contactMethod === 'WHATSAPP' && hasPhone,
  }

  // The operator has not answered §2.1 step 2 at all. Nothing here invents an
  // answer: the phone line stays required and the message says why.
  if (defaults.contactMethod === null && variables.sender_phone === null) {
    notes.sender_phone =
      'The operator has not chosen a contact method yet (BUILD_SPEC §2.1 step 2). Finish operator setup before sending.'
  }

  return { variables, sources, flags, notes }
}

// ---------------------------------------------------------------------------
// Loading the shared half of the context
// ---------------------------------------------------------------------------

/**
 * Reads `service_config` and the operator row.
 *
 * The SMTP *user* is decrypted here because §11.2 makes it the last fallback
 * for `sender_email` and it appears in the email anyway. The SMTP *password*
 * is never read by this module, never returned, and never logged.
 */
export async function loadSenderDefaults(): Promise<SenderDefaults> {
  const config = await readServiceConfig()

  const operatorRows = await db
    .select({
      contactMethod: users.contactMethod,
      contactValue: users.contactValue,
    })
    .from(users)
    .where(eq(users.role, 'OPERATOR'))
    .limit(1)

  const operator = operatorRows[0]

  let authenticatedSenderEmail: string | null = null
  if (config.smtpUserEncrypted) {
    try {
      authenticatedSenderEmail = trimmedOrNull(decrypt(config.smtpUserEncrypted))
    } catch {
      // A key rotation makes this unreadable. Treat it as absent rather than
      // crashing a preview — the fallback chain then reports it honestly.
      authenticatedSenderEmail = null
    }
  }

  return {
    defaultSenderName: config.defaultSenderName,
    defaultSenderEmail: config.defaultSenderEmail,
    defaultSenderPhone: config.defaultSenderPhone,
    authenticatedSenderEmail,
    contactMethod: (operator?.contactMethod as ContactMethod | null) ?? null,
    operatorContactValuePresent: trimmedOrNull(operator?.contactValue) !== null,
    decimalPlaces: config.decimalPlaces,
    verificationLink: buildVerificationLink(),
  }
}
