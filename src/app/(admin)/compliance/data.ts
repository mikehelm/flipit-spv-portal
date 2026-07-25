/**
 * Data for the compliance screen.
 *
 * Reads only, and no authorization of its own — the page calls
 * `requireOwner()` before it calls anything here, and every write lives in
 * `src/actions/compliance.ts`. Keeping this file free of both means the page
 * stays presentational and there is no second place where the owner-only rule
 * has to be remembered.
 */

import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { complianceApprovals, users } from '@/db/schema'
import {
  checkTemplateDrift,
  evaluateOfferCompliance,
  listApprovals,
  type ComplianceApprovalRecord,
  type ComplianceDecision,
  type TemplateDriftReport,
} from '@/lib/compliance'
import { loadGateableOffers, type OfferGateRow } from '@/lib/compliance/offers'
import { EMAIL_TEMPLATE_KINDS, type EmailTemplateKind } from '@/lib/email/templates'

export interface ApprovalHistoryEntry {
  approval: ComplianceApprovalRecord
  recordedByEmail: string | null
}

export interface KindOverview {
  kind: EmailTemplateKind
  drift: TemplateDriftReport
  history: ApprovalHistoryEntry[]
}

export interface GatedRecipient {
  offer: OfferGateRow
  decision: ComplianceDecision
}

export interface ComplianceOverview {
  kinds: KindOverview[]
  recipients: GatedRecipient[]
  blocked: GatedRecipient[]
  sendableCount: number
}

async function recordedByEmails(
  approvals: readonly ComplianceApprovalRecord[],
): Promise<Map<string, string>> {
  const ids = [...new Set(approvals.map((approval) => approval.recordedById))]
  if (ids.length === 0) return new Map()

  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .orderBy(desc(users.createdAt))

  const wanted = new Set(ids)
  const map = new Map<string, string>()
  for (const row of rows) {
    if (wanted.has(row.id)) map.set(row.id, row.email)
  }
  return map
}

async function loadKind(kind: EmailTemplateKind): Promise<KindOverview> {
  const [drift, approvals] = await Promise.all([
    checkTemplateDrift(kind),
    listApprovals(kind),
  ])

  const emails = await recordedByEmails(approvals)

  return {
    kind,
    drift,
    history: approvals.map((approval) => ({
      approval,
      recordedByEmail: emails.get(approval.recordedById) ?? null,
    })),
  }
}

/**
 * Everything the compliance page shows, in one read.
 *
 * The per-recipient decisions are computed against the INVITATION approval,
 * because that is the template the review table sends. The reminder has its
 * own approval and its own hash (§6.5, §8.2) and is shown separately.
 */
export async function loadComplianceOverview(): Promise<ComplianceOverview> {
  const kinds = await Promise.all(EMAIL_TEMPLATE_KINDS.map((kind) => loadKind(kind)))

  const invitation = kinds.find((entry) => entry.kind === 'INVITATION')
  const offers = await loadGateableOffers()

  const recipients: GatedRecipient[] = offers.map((offer) => ({
    offer,
    decision: evaluateOfferCompliance({
      offer,
      approval: invitation?.drift.approval ?? null,
      drift: invitation
        ? { state: invitation.drift.state, message: invitation.drift.message }
        : { state: 'NO_APPROVAL', message: 'No approval has been recorded.' },
    }),
  }))

  return {
    kinds,
    recipients,
    blocked: recipients.filter((entry) => !entry.decision.allowed),
    sendableCount: recipients.filter((entry) => entry.decision.allowed).length,
  }
}

/** One approval row by id, for the void form. */
export async function loadApproval(id: string): Promise<ComplianceApprovalRecord | null> {
  const rows = await db
    .select()
    .from(complianceApprovals)
    .where(eq(complianceApprovals.id, id))
    .limit(1)
  return rows[0] ?? null
}
