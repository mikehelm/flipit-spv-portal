/**
 * The rule that makes an unattended sender acceptable. BUILD_SPEC §6.5.
 *
 * *"The reminder is a nudge with the portal link. It restates the deadline and
 * nothing else. **It contains no offer terms, amounts, or percentages** —
 * those live in the portal, which is where the investor should be looking
 * anyway."*
 *
 * WP4 tests that the **built-in** reminder template satisfies this. That is not
 * enough on its own, because §8.2 and the template registry both allow a stored
 * template row to replace the built-in one, and a stored row is edited through
 * a form by a person in a hurry. So this check runs against whatever is
 * actually about to be sent, every time, and a reminder that fails it does not
 * go out — it is refused with a message naming the offending variable or
 * figure.
 *
 * Two mechanisms, doing two different jobs:
 *
 *   1. **Structural.** Which variables does the source reference? A template
 *      that mentions `{{investment_amount}}` carries an amount whatever the
 *      value happens to be for one recipient, so this is decided from the
 *      source and is the same answer for everybody.
 *   2. **Literal.** What does the rendered text actually say? A hard-coded
 *      "USD 5,000" references no variable at all, and the structural check
 *      would wave it through.
 *
 * Neither substitutes for the other, and both are cheap.
 */

import { referencedVariables } from '@/lib/email/render'
import type { EmailTemplateSource } from '@/lib/email/templates'
import type { EmailVariableName } from '@/lib/email/variables'

/**
 * Variables a reminder may never reference.
 *
 * The three figures are §6.5's own list. `use_of_funds` and `personal_line` are
 * added because both are free text the operator writes, either of which can
 * carry a figure — and §6.5's "nothing else" is a stronger instruction than a
 * list of three named columns. Where the spec is silent, the conservative
 * option: the reminder says when, and where to go, and that is all.
 */
export const FORBIDDEN_IN_REMINDER: readonly EmailVariableName[] = [
  'investment_amount',
  'spv_percentage',
  'indirect_flipit_percentage',
  'use_of_funds',
  'personal_line',
] as const

/**
 * Figures in the rendered text.
 *
 * Deliberately narrow, so it does not fire on the one number a reminder is
 * supposed to contain. `formatDeadline` renders a deadline as "10 March 2026" —
 * no currency mark, no per-cent sign, no thousands separator and no decimal
 * point — so none of these patterns can match a legitimate deadline.
 */
const LITERAL_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'a per-cent sign', pattern: /%/ },
  { label: 'a currency symbol', pattern: /[$£€¥]/ },
  { label: 'a currency code', pattern: /\b(?:USD|EUR|GBP|AUD|CAD|NZD|CHF|JPY)\b/i },
  { label: 'the word "percent"', pattern: /\bper ?cent\b/i },
  { label: 'a decimal figure', pattern: /\d+\.\d/ },
  { label: 'a grouped figure', pattern: /\d{1,3}(?:,\d{3})+/ },
]

export interface OfferTermsFinding {
  kind: 'VARIABLE' | 'LITERAL'
  /** The variable name, or the label of the pattern that matched. */
  detail: string
  /** Which part of the email it was found in. */
  part: 'subject' | 'html' | 'text'
}

export class ReminderCarriesOfferTermsError extends Error {
  readonly findings: OfferTermsFinding[]

  constructor(findings: OfferTermsFinding[]) {
    super(
      'This reminder carries offer terms, so it was not sent. BUILD_SPEC §6.5 requires the ' +
        'reminder to restate the deadline and nothing else — no amounts, no percentages. ' +
        `Found: ${findings
          .map((finding) =>
            finding.kind === 'VARIABLE'
              ? `{{${finding.detail}}} in the ${finding.part}`
              : `${finding.detail} in the ${finding.part}`,
          )
          .join('; ')}. Edit the reminder template, then have the change approved again.`,
    )
    this.name = 'ReminderCarriesOfferTermsError'
    this.findings = findings
  }
}

/** Which forbidden variables the source references, and where. */
export function findForbiddenVariables(
  template: Pick<EmailTemplateSource, 'subject' | 'htmlSource' | 'textSource'>,
): OfferTermsFinding[] {
  const parts: ReadonlyArray<[OfferTermsFinding['part'], string]> = [
    ['subject', template.subject],
    ['html', template.htmlSource],
    ['text', template.textSource],
  ]

  const findings: OfferTermsFinding[] = []
  for (const [part, source] of parts) {
    const referenced = referencedVariables(source)
    for (const name of FORBIDDEN_IN_REMINDER) {
      if (referenced.has(name)) findings.push({ kind: 'VARIABLE', detail: name, part })
    }
  }
  return findings
}

/**
 * Markup removed, so `width:100%` in a table attribute is not mistaken for a
 * percentage in the copy. Style and script contents go entirely; tags and HTML
 * entities are replaced with a space so words either side do not run together.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Figures written into the copy itself, referencing no variable at all. */
export function findLiteralFigures(rendered: {
  subject: string
  html: string
  text: string
}): OfferTermsFinding[] {
  const parts: ReadonlyArray<[OfferTermsFinding['part'], string]> = [
    ['subject', rendered.subject],
    ['html', visibleText(rendered.html)],
    ['text', rendered.text],
  ]

  const findings: OfferTermsFinding[] = []
  for (const [part, text] of parts) {
    for (const { label, pattern } of LITERAL_PATTERNS) {
      if (pattern.test(text)) findings.push({ kind: 'LITERAL', detail: label, part })
    }
  }
  return findings
}

export interface OfferTermsCheck {
  clean: boolean
  findings: OfferTermsFinding[]
}

export function checkNoOfferTerms(input: {
  template: Pick<EmailTemplateSource, 'subject' | 'htmlSource' | 'textSource'>
  rendered: { subject: string; html: string; text: string }
}): OfferTermsCheck {
  const findings = [
    ...findForbiddenVariables(input.template),
    ...findLiteralFigures(input.rendered),
  ]
  return { clean: findings.length === 0, findings }
}

/**
 * Throws rather than returning false, for the same reason `assertCompliant`
 * does: a caller that ignores a returned decision sends the email anyway, and
 * this is the one email in the application that nobody is watching go out.
 */
export function assertNoOfferTerms(input: {
  template: Pick<EmailTemplateSource, 'subject' | 'htmlSource' | 'textSource'>
  rendered: { subject: string; html: string; text: string }
}): void {
  const check = checkNoOfferTerms(input)
  if (!check.clean) throw new ReminderCarriesOfferTermsError(check.findings)
}
