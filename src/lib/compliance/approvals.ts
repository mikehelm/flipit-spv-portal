/**
 * Reading compliance approvals. BUILD_SPEC §8.2.
 *
 * Reads only. Every write goes through `src/actions/compliance.ts`, where the
 * owner check and the audit entry live, so there is no function in this file
 * that a caller could use to create an approval without passing the gate.
 */

import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { complianceApprovals, emailTemplates } from '@/db/schema'
import { hashOf, templateSource, type EmailTemplateKind } from '@/lib/email/templates'
import type { TemplateSourceParts } from './diff'

/** The stored row. Money is not involved here, so plain fields are fine. */
export type ComplianceApprovalRecord = typeof complianceApprovals.$inferSelect

/**
 * The newest approval for a kind that has not been voided.
 *
 * "Newest" is by `createdAt`, the moment it was recorded — not by
 * `approvedAt`, the date on the approver's letter. Those differ, and the one
 * that governs is the record the owner entered most recently: back-dating a
 * letter must not silently reinstate an older set of jurisdictions.
 *
 * Returns null when there is none, and null is the reason sending is refused.
 */
export async function getCurrentApproval(
  kind: EmailTemplateKind,
): Promise<ComplianceApprovalRecord | null> {
  const rows = await db
    .select()
    .from(complianceApprovals)
    .where(
      and(
        eq(complianceApprovals.templateKind, kind),
        isNull(complianceApprovals.voidedAt),
      ),
    )
    .orderBy(desc(complianceApprovals.createdAt), desc(complianceApprovals.approvedAt))
    .limit(1)

  return rows[0] ?? null
}

/** Every approval for a kind, newest first, including voided ones. */
export async function listApprovals(
  kind: EmailTemplateKind,
): Promise<ComplianceApprovalRecord[]> {
  return db
    .select()
    .from(complianceApprovals)
    .where(eq(complianceApprovals.templateKind, kind))
    .orderBy(desc(complianceApprovals.createdAt))
}

/**
 * Recover the source that a hash was recorded against, so a drift can be shown
 * as a diff rather than as two hex strings.
 *
 * The approval stores a hash, not a body — that is the right thing for it to
 * store, and it means the source has to be found elsewhere. It is looked for
 * among the stored template versions and the built-in default, and every
 * candidate is re-hashed from its own source rather than trusted from its
 * `hash` column: a stored row whose column disagrees with its body is exactly
 * the drift this gate exists to catch, and believing the column would hide it.
 *
 * Returns null when the approved version is no longer on file — which is
 * honest, and the UI says so instead of inventing a diff.
 */
export async function findSourceByHash(
  kind: EmailTemplateKind,
  hash: string,
): Promise<TemplateSourceParts | null> {
  const builtIn = templateSource(kind)
  if (builtIn.hash === hash) {
    return {
      subject: builtIn.subject,
      htmlSource: builtIn.htmlSource,
      textSource: builtIn.textSource,
    }
  }

  const rows = await db
    .select({
      subject: emailTemplates.subject,
      htmlSource: emailTemplates.htmlSource,
      textSource: emailTemplates.textSource,
    })
    .from(emailTemplates)
    .where(eq(emailTemplates.kind, kind))
    .orderBy(desc(emailTemplates.version))

  for (const row of rows) {
    if (hashOf(row) === hash) return row
  }

  return null
}
