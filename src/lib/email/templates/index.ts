/**
 * The template registry.
 *
 * Two templates, two hashes, two compliance approvals (§6.5, §8.2). They are
 * kept as separate modules rather than one parameterised body precisely so
 * that neither can drift into the other: a reminder is not a shortened
 * invitation and must never be able to become one by a wrong argument.
 *
 * **Hashing covers the SOURCE, not the rendered output** — subject, HTML and
 * text, including the conditional blocks (§2.1, §8.2). That is what lets the
 * operator switch between phone, WhatsApp and email-only without silently
 * voiding an approval, while a single changed word does void it.
 *
 * `templateSource()` returns the code default. `loadCurrentTemplate()` prefers
 * the stored row when one exists. Neither writes: seeding a template row is a
 * mutation and belongs to whoever owns that surface, not to a render path.
 */

import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { emailTemplates } from '@/db/schema'
import { hashTemplateSource } from '@/lib/crypto'
import { INVITATION_HTML, INVITATION_SUBJECT, INVITATION_TEXT } from './invitation'
import { REMINDER_HTML, REMINDER_SUBJECT, REMINDER_TEXT } from './reminder'

export type EmailTemplateKind = 'INVITATION' | 'REMINDER'

export const EMAIL_TEMPLATE_KINDS: readonly EmailTemplateKind[] = [
  'INVITATION',
  'REMINDER',
] as const

export interface EmailTemplateSource {
  kind: EmailTemplateKind
  subject: string
  htmlSource: string
  textSource: string
  /** SHA-256 over subject + both sources, from `@/lib/crypto`. */
  hash: string
  /** Where this came from, so a preview can say so honestly. */
  origin: 'BUILT_IN' | 'STORED'
  /** Stored row id and version, when the source came from the database. */
  storedId?: string
  version?: number
}

export const TEMPLATE_LABEL: Readonly<Record<EmailTemplateKind, string>> = {
  INVITATION: 'Invitation',
  REMINDER: 'Reminder',
}

export const TEMPLATE_DESCRIPTION: Readonly<Record<EmailTemplateKind, string>> = {
  INVITATION:
    'The designed HTML invitation with its mandatory plain-text alternative. Carries the offer figures in a bordered panel.',
  REMINDER:
    'The automatic nudge. Carries the deadline and the portal link and no offer terms, amounts or percentages. Approved separately from the invitation.',
}

function build(
  kind: EmailTemplateKind,
  subject: string,
  htmlSource: string,
  textSource: string,
): EmailTemplateSource {
  return {
    kind,
    subject,
    htmlSource,
    textSource,
    hash: hashTemplateSource({ subject, htmlSource, textSource }),
    origin: 'BUILT_IN',
  }
}

export const INVITATION_TEMPLATE: EmailTemplateSource = build(
  'INVITATION',
  INVITATION_SUBJECT,
  INVITATION_HTML,
  INVITATION_TEXT,
)

export const REMINDER_TEMPLATE: EmailTemplateSource = build(
  'REMINDER',
  REMINDER_SUBJECT,
  REMINDER_HTML,
  REMINDER_TEXT,
)

const BUILT_IN: Readonly<Record<EmailTemplateKind, EmailTemplateSource>> = {
  INVITATION: INVITATION_TEMPLATE,
  REMINDER: REMINDER_TEMPLATE,
}

/** The built-in source for a kind. Pure, synchronous, no database. */
export function templateSource(kind: EmailTemplateKind): EmailTemplateSource {
  const template = BUILT_IN[kind]
  if (!template) {
    throw new Error(`No email template exists for kind "${kind}".`)
  }
  return template
}

/** Recompute a hash from arbitrary source. Used when comparing a stored row. */
export function hashOf(input: {
  subject: string
  htmlSource: string
  textSource: string
}): string {
  return hashTemplateSource(input)
}

/**
 * The template that would actually be sent.
 *
 * Prefers the current stored row so an edit made through the admin surface is
 * what gets hashed, approved and sent. Falls back to the built-in source when
 * no row exists, because a missing row must not silently mean "no email" — it
 * means the shipped default has not been edited yet.
 *
 * The hash is always recomputed from the source rather than trusted from the
 * stored column. A stored hash that disagrees with its own source is exactly
 * the drift §8.2 exists to catch, and trusting the column would hide it.
 */
export async function loadCurrentTemplate(
  kind: EmailTemplateKind,
): Promise<EmailTemplateSource> {
  const rows = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.kind, kind), eq(emailTemplates.isCurrent, true)))
    .orderBy(desc(emailTemplates.version))
    .limit(1)

  const row = rows[0]
  if (!row) return templateSource(kind)

  return {
    kind,
    subject: row.subject,
    htmlSource: row.htmlSource,
    textSource: row.textSource,
    hash: hashOf({
      subject: row.subject,
      htmlSource: row.htmlSource,
      textSource: row.textSource,
    }),
    origin: 'STORED',
    storedId: row.id,
    version: row.version,
  }
}
