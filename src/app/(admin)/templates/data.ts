/**
 * Data for the template and preview screens.
 *
 * Not a component. Authorization, the database read and the audit entry live
 * here so the pages stay presentational — `audit()` is called from the same
 * layer as the read it records, never from JSX.
 *
 * Everything in this module is a read. Nothing here issues a token, writes a
 * snapshot, or sends anything: a preview that minted a working claim link
 * would be a send by another name.
 */

import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, offers, recipients } from '@/db/schema'
import { audit } from '@/lib/audit'
import type { AdminIdentity } from '@/lib/auth/guards'
import {
  renderEmail,
  UnresolvedVariableError,
  validateBatch,
  type BatchValidationResult,
  type RenderedEmail,
  type UnresolvedVariable,
} from '@/lib/email/render'
import {
  loadCurrentTemplate,
  type EmailTemplateKind,
  type EmailTemplateSource,
} from '@/lib/email/templates'
import {
  buildPortalLink,
  loadSenderDefaults,
  PREVIEW_CLAIM_TOKEN,
  resolveEmailVariables,
  type EmailVariableContext,
  type RecipientVariableInput,
  type SenderDefaults,
} from '@/lib/email/variables'
import { loadRound } from '@/lib/import/persist'

export interface PreviewRecipient {
  offerId: string
  name: string
  email: string
  jurisdiction: string | null
  blocked: boolean
  emailStatus: string
  /** Strings, straight from Drizzle. They are never coerced to a number. */
  proposedAmountUsd: string
  spvPercentage: string
  indirectPercentage: string
  responseDeadline: string
  rowSenderName: string | null
  rowSenderEmail: string | null
  rowSenderPhone: string | null
}

async function selectRecipients(offerId?: string): Promise<PreviewRecipient[]> {
  const round = await loadRound()
  if (!round) return []

  const rows = await db
    .select({
      offerId: offers.id,
      proposedAmountUsd: offers.proposedAmountUsd,
      spvPercentage: offers.spvPercentage,
      indirectPercentage: offers.indirectPercentage,
      responseDeadline: offers.responseDeadline,
      blocked: offers.blocked,
      emailStatus: offers.emailStatus,
      name: investorAccounts.name,
      email: investorAccounts.email,
      jurisdiction: recipients.jurisdiction,
      rowSenderName: recipients.senderName,
      rowSenderEmail: recipients.senderEmail,
      rowSenderPhone: recipients.senderPhone,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .leftJoin(recipients, eq(offers.recipientId, recipients.id))
    .where(offerId ? eq(offers.id, offerId) : eq(offers.roundId, round.id))
    .orderBy(desc(offers.createdAt))

  return rows.map((row) => ({
    offerId: row.offerId,
    name: row.name,
    email: row.email,
    jurisdiction: row.jurisdiction,
    blocked: row.blocked,
    emailStatus: row.emailStatus,
    proposedAmountUsd: row.proposedAmountUsd,
    spvPercentage: row.spvPercentage,
    indirectPercentage: row.indirectPercentage,
    responseDeadline: row.responseDeadline,
    rowSenderName: row.rowSenderName,
    rowSenderEmail: row.rowSenderEmail,
    rowSenderPhone: row.rowSenderPhone,
  }))
}

export async function loadPreviewRecipients(): Promise<PreviewRecipient[]> {
  return selectRecipients()
}

export async function loadPreviewRecipient(
  offerId: string,
): Promise<PreviewRecipient | null> {
  const rows = await selectRecipients(offerId)
  return rows[0] ?? null
}

/**
 * A preview link. Deliberately not a real token — see `PREVIEW_CLAIM_TOKEN`.
 * The URL is otherwise identical to the one that will be sent, so the preview
 * shows the true shape and length of the link.
 */
export function previewPortalLink(): string {
  return buildPortalLink(PREVIEW_CLAIM_TOKEN)
}

export function toVariableInput(
  row: PreviewRecipient,
  portalLink: string,
): RecipientVariableInput {
  return {
    offerId: row.offerId,
    recipientName: row.name,
    recipientEmail: row.email,
    proposedAmountUsd: row.proposedAmountUsd,
    spvPercentage: row.spvPercentage,
    indirectPercentage: row.indirectPercentage,
    responseDeadline: row.responseDeadline,
    rowSenderName: row.rowSenderName,
    rowSenderEmail: row.rowSenderEmail,
    rowSenderPhone: row.rowSenderPhone,
    portalLink,
  }
}

export interface TemplateOverview {
  template: EmailTemplateSource
  parseError: string | null
}

export async function loadTemplateOverview(
  kind: EmailTemplateKind,
): Promise<TemplateOverview> {
  const template = await loadCurrentTemplate(kind)
  return { template, parseError: null }
}

export interface PreflightSummary {
  defaults: SenderDefaults
  recipients: PreviewRecipient[]
  result: BatchValidationResult
}

/**
 * Render every recipient against every template and collect every problem.
 *
 * BUILD_SPEC §11.4 and §19: this is the check that must happen *before* the
 * batch starts. It is surfaced here so the operator can see and fix the whole
 * list rather than discovering it one failed send at a time.
 */
export async function loadPreflight(): Promise<PreflightSummary> {
  const [recipientRows, defaults, invitation, reminder] = await Promise.all([
    loadPreviewRecipients(),
    loadSenderDefaults(),
    loadCurrentTemplate('INVITATION'),
    loadCurrentTemplate('REMINDER'),
  ])

  const link = previewPortalLink()
  const result = validateBatch(
    recipientRows.map((row) => toVariableInput(row, link)),
    defaults,
    { templates: [invitation, reminder] },
  )

  return { defaults, recipients: recipientRows, result }
}

export type PreviewOutcome =
  | {
      status: 'RENDERED'
      email: RenderedEmail
      context: EmailVariableContext
      template: EmailTemplateSource
    }
  | {
      status: 'UNRESOLVED'
      message: string
      unresolved: readonly UnresolvedVariable[]
      context: EmailVariableContext
      template: EmailTemplateSource
    }
  | {
      status: 'ERROR'
      message: string
      template: EmailTemplateSource
    }

/**
 * Render the real email for a real recipient. No audit, no side effect at all.
 *
 * Split out of `previewFor` when the HTML part moved to its own route. Two
 * callers now render the same email for the same screen — the page, which draws
 * the headers and the resolution table, and `…/body`, which serves the markup
 * into the frame — and they must agree byte for byte, because the page's whole
 * claim is that what is framed is what will be sent. One function renders; each
 * caller records its own read.
 */
export async function renderPreview(
  row: PreviewRecipient,
  kind: EmailTemplateKind,
): Promise<PreviewOutcome> {
  const [template, defaults] = await Promise.all([
    loadCurrentTemplate(kind),
    loadSenderDefaults(),
  ])

  const input = toVariableInput(row, previewPortalLink())
  const context = resolveEmailVariables(input, defaults)

  try {
    return {
      status: 'RENDERED',
      email: renderEmail(template, input, defaults),
      context,
      template,
    }
  } catch (error) {
    if (error instanceof UnresolvedVariableError) {
      return {
        status: 'UNRESOLVED',
        message: error.message,
        unresolved: error.unresolved,
        context,
        template,
      }
    }
    return {
      status: 'ERROR',
      message: error instanceof Error ? error.message : String(error),
      template,
    }
  }
}

/**
 * Record that an administrator read one recipient's correspondence.
 *
 * §16 lists "preview and test sends" among the events that must be recorded.
 * The metadata carries identifiers and the template hash — never the rendered
 * body, which `assertNoSecrets` refuses outright.
 *
 * `action` is a parameter because the page and the body route are two reads and
 * are logged as two events. See the note on `email.body_served` in the route.
 */
export async function auditPreviewRead(
  admin: AdminIdentity,
  row: PreviewRecipient,
  kind: EmailTemplateKind,
  outcome: PreviewOutcome,
  action: 'email.previewed' | 'email.body_served',
): Promise<void> {
  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'offer',
    entityId: row.offerId,
    action,
    metadata: {
      templateKind: kind,
      templateHash: outcome.template.hash,
      templateOrigin: outcome.template.origin,
      outcome: outcome.status,
      unresolvedVariables:
        outcome.status === 'UNRESOLVED'
          ? [...new Set(outcome.unresolved.map((item) => item.variable))]
          : [],
    },
  })
}

/**
 * Render the real email for a real recipient, and log that it was viewed.
 *
 * The page's entry point, unchanged in behaviour: the same outcome and the same
 * `email.previewed` row it has always written.
 */
export async function previewFor(
  admin: AdminIdentity,
  row: PreviewRecipient,
  kind: EmailTemplateKind,
): Promise<PreviewOutcome> {
  const outcome = await renderPreview(row, kind)
  await auditPreviewRead(admin, row, kind, outcome, 'email.previewed')
  return outcome
}
