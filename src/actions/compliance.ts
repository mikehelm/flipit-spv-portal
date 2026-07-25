'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { complianceApprovals, offers } from '@/db/schema'
import { audit } from '@/lib/audit'
import { currentAdmin } from '@/lib/auth/guards'
import {
  authorizeComplianceAction,
  complianceActionLabel,
  type ComplianceAction,
} from '@/lib/compliance/authority'
import { getCurrentApproval } from '@/lib/compliance/approvals'
import { checkTemplateDrift } from '@/lib/compliance/drift'
import {
  hasRecordedOverride,
  isJurisdictionApproved,
  MIN_APPROVAL_REFERENCE_LENGTH,
  parseApprovedJurisdictions,
} from '@/lib/compliance/jurisdictions'
import { loadGateableOffers, planBlockUpdates } from '@/lib/compliance/offers'
import { loadCurrentTemplate, type EmailTemplateKind } from '@/lib/email/templates'
import {
  checkbox,
  optionalText,
  requiredText as text,
  zodFieldErrors as fieldErrors,
} from '@/lib/form-values'

/**
 * Compliance approvals — record, amend, void, and the individual clearance of
 * BUILD_SPEC §8.3. This is the mutation layer for the §8.2 gate.
 *
 * **Owner only, enforced here.** §8.2 item 4: "Approval is owner-only. The
 * operator cannot record or amend it." Every action in this file begins with
 * `authorize()`, which re-resolves the role from the allowlist on this request
 * and, when it refuses, writes the attempt to the audit log before returning.
 * The compliance page hides these forms from an operator; that hiding is
 * manners, and this function is the access control. Nothing here trusts that a
 * button was not rendered.
 *
 * **Append-only.** An approval row is never edited in place. Amending voids
 * the current row and records a new one, so the audit trail shows what was in
 * force at every moment rather than what is in force now.
 *
 * §8.2 item 6: "Every element of the above is written to the audit log —
 * including blocked send attempts and the reason they were blocked."
 */

const COMPLIANCE_PATH = '/compliance'

// ---------------------------------------------------------------------------
// Authorization — the same three lines at the top of every action
// ---------------------------------------------------------------------------

interface Authorized {
  ok: true
  admin: { id: string; email: string }
}

type AuthorizationOutcome = Authorized | { ok: false; state: ActionState }

/**
 * Owner, or a refusal that is both returned to the caller and written to the
 * audit log. A refused privileged action is never silent (§22 AC19).
 *
 * The audit entry is written before the refusal is returned, so an operator
 * probing this surface leaves a record even if they close the tab.
 */
async function authorize(action: ComplianceAction): Promise<AuthorizationOutcome> {
  const admin = await currentAdmin()
  const decision = authorizeComplianceAction(admin?.role ?? null, action)

  if (decision.allowed && admin) {
    return { ok: true, admin: { id: admin.id, email: admin.email } }
  }

  await audit({
    actor: admin
      ? { kind: 'user', id: admin.id, label: admin.email }
      : { kind: 'system', label: 'unauthenticated' },
    entityType: 'compliance_approval',
    entityId: null,
    action: 'compliance.refused',
    metadata: {
      attemptedAction: action,
      attemptedLabel: complianceActionLabel(action),
      refusalReason: decision.allowed ? 'NOT_OWNER' : decision.reason,
      actorRole: admin?.role ?? null,
      requiredRole: 'OWNER',
    },
  })

  return {
    ok: false,
    state: actionError(
      decision.allowed
        ? 'Only the owner can change a compliance approval.'
        : decision.message,
    ),
  }
}

// ---------------------------------------------------------------------------
// Shared parsing
// ---------------------------------------------------------------------------

const templateKindSchema = z.enum(['INVITATION', 'REMINDER'])

const approvalSchema = z.object({
  templateKind: templateKindSchema,
  approverName: z
    .string()
    .trim()
    .min(2, 'Give the name of the person who signed this off.')
    .max(200),
  approverRole: z
    .string()
    .trim()
    .min(2, 'Give their role — "Partner", "General Counsel", "Solicitor".')
    .max(200),
  approverFirm: z.string().trim().max(200).nullable(),
  approvedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date on the approval itself.'),
  evidenceReference: z
    .string()
    .trim()
    .min(
      3,
      'Record where the approval can be found — a letter reference, an email subject and date, or a document id.',
    )
    .max(500),
  jurisdictions: z.string(),
  conditions: z.string().trim().max(4000).nullable(),
  /** The hash the owner was looking at when they filled the form in. */
  templateHash: z.string().trim().min(16, 'The template hash is missing from the form.'),
  acknowledged: z.literal(true, {
    message:
      'Tick the confirmation. Recording this is what makes sending possible, so it is done deliberately.',
  }),
})

interface ParsedApproval {
  templateKind: EmailTemplateKind
  approverName: string
  approverRole: string
  approverFirm: string | null
  approvedAt: Date
  evidenceReference: string
  jurisdictions: string[]
  conditions: string | null
  templateHash: string
  expansionNote: string | null
}

type ParseOutcome = { ok: true; value: ParsedApproval } | { ok: false; state: ActionState }

/**
 * Everything the two write paths share: the field validation, the bloc
 * expansion, and the check that the template has not moved underneath the
 * form. Split out so `record` and `amend` cannot drift apart — an amendment
 * with looser validation than an original would be a way around the gate.
 */
async function parseApprovalForm(formData: FormData): Promise<ParseOutcome> {
  const parsed = approvalSchema.safeParse({
    templateKind: formData.get('templateKind'),
    approverName: text(formData.get('approverName')),
    approverRole: text(formData.get('approverRole')),
    approverFirm: optionalText(formData.get('approverFirm')),
    approvedAt: text(formData.get('approvedAt')),
    evidenceReference: text(formData.get('evidenceReference')),
    jurisdictions: text(formData.get('jurisdictions')),
    conditions: optionalText(formData.get('conditions')),
    templateHash: text(formData.get('templateHash')),
    acknowledged: checkbox(formData.get('acknowledged')),
  })

  if (!parsed.success) {
    return {
      ok: false,
      state: actionError(
        'The approval was not recorded — some details are missing or malformed.',
        fieldErrors(parsed.error),
      ),
    }
  }

  const data = parsed.data

  const approvedAt = new Date(`${data.approvedAt}T00:00:00.000Z`)
  if (Number.isNaN(approvedAt.getTime())) {
    return {
      ok: false,
      state: actionError('That approval date is not a real date.', {
        approvedAt: 'Use the date picker.',
      }),
    }
  }
  if (approvedAt.getTime() > Date.now()) {
    return {
      ok: false,
      state: actionError(
        'The approval date is in the future. An approval that has not happened yet cannot enable sending.',
        { approvedAt: 'Use the date on the approval itself.' },
      ),
    }
  }

  // §8.2: blocs are expanded to their member codes at the moment of recording,
  // so the stored list is directly comparable to a recipient's field value and
  // nothing at send time ever has to interpret "EU".
  const jurisdictions = parseApprovedJurisdictions(data.jurisdictions)

  if (jurisdictions.rejected.length > 0) {
    return {
      ok: false,
      state: actionError(
        'Some of the cleared jurisdictions could not be read as country codes, so nothing was recorded.',
        { jurisdictions: jurisdictions.rejected.map((item) => item.message).join(' ') },
      ),
    }
  }

  if (jurisdictions.codes.length === 0) {
    return {
      ok: false,
      state: actionError(
        'An approval that clears no jurisdictions would not let anything be sent. List the countries it covers, as two-letter codes.',
        { jurisdictions: 'For example: GB, AU, FR, TH.' },
      ),
    }
  }

  // The owner approves a specific wording. If the template changed between the
  // page rendering and this form being submitted, the hash on the form is not
  // the hash of what would now be sent — and recording it would approve text
  // nobody read.
  const live = await loadCurrentTemplate(data.templateKind)
  if (live.hash !== data.templateHash) {
    return {
      ok: false,
      state: actionError(
        'The template changed while this form was open, so nothing was recorded. The approval ' +
          'covers an exact wording and this form no longer describes what would be sent. ' +
          'Reload the page, check the current wording against the approver’s letter, and record it again.',
      ),
    }
  }

  return {
    ok: true,
    value: {
      templateKind: data.templateKind,
      approverName: data.approverName,
      approverRole: data.approverRole,
      approverFirm: data.approverFirm,
      approvedAt,
      evidenceReference: data.evidenceReference,
      jurisdictions: jurisdictions.codes,
      conditions: data.conditions,
      templateHash: live.hash,
      expansionNote:
        jurisdictions.expansions.length > 0
          ? jurisdictions.expansions
              .map((item) => `${item.label} expanded to ${item.members.length} country codes`)
              .join('; ')
          : null,
    },
  }
}

// ---------------------------------------------------------------------------
// Re-applying the per-recipient gate
// ---------------------------------------------------------------------------

/**
 * Set and clear jurisdiction blocks so the review table matches the approval
 * that is actually in force.
 *
 * Per-recipient by construction: `planBlockUpdates` produces one update per
 * offer and each is written on its own. One recipient's block never stops
 * another from being cleared, and a block placed for a reason other than the
 * jurisdiction gate is left untouched.
 */
async function applyJurisdictionBlocks(
  actor: { id: string; email: string },
  reason: string,
): Promise<{ blocked: number; unblocked: number; unchanged: number }> {
  const [rows, approval] = await Promise.all([
    loadGateableOffers(),
    getCurrentApproval('INVITATION'),
  ])

  const plan = planBlockUpdates(rows, approval)

  for (const update of plan.updates) {
    await db
      .update(offers)
      .set({
        blocked: update.blocked,
        blockReason: update.blockReason,
        blockDetail: update.blockDetail,
        // `null` means "leave it": the message has already been sent or has
        // failed, and neither is the gate's to rewrite.
        ...(update.emailStatus === null ? {} : { emailStatus: update.emailStatus }),
        updatedAt: new Date(),
      })
      .where(eq(offers.id, update.offerId))

    await audit({
      actor: { kind: 'user', id: actor.id, label: actor.email },
      entityType: 'offer',
      entityId: update.offerId,
      action:
        update.change === 'BLOCKED'
          ? 'compliance.offer_blocked'
          : 'compliance.offer_unblocked',
      metadata: {
        blockReason: update.blockReason,
        trigger: reason,
        approvalId: approval?.id ?? null,
      },
    })
  }

  return {
    blocked: plan.updates.filter((u) => u.change === 'BLOCKED').length,
    unblocked: plan.updates.filter((u) => u.change === 'UNBLOCKED').length,
    unchanged: plan.unchanged,
  }
}

function revalidate(): void {
  revalidatePath(COMPLIANCE_PATH)
  revalidatePath('/admin')
}

function summarise(counts: { blocked: number; unblocked: number }): string {
  const parts: string[] = []
  if (counts.blocked > 0) parts.push(`${counts.blocked} recipient(s) held`)
  if (counts.unblocked > 0) parts.push(`${counts.unblocked} recipient(s) released`)
  return parts.length === 0 ? 'No recipient block changed.' : `${parts.join(', ')}.`
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export async function recordApprovalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('RECORD')
  if (!auth.ok) return auth.state

  const parsed = await parseApprovalForm(formData)
  if (!parsed.ok) return parsed.state

  const approval = parsed.value

  const existing = await getCurrentApproval(approval.templateKind)
  if (existing) {
    return actionError(
      'An approval is already in force for this template. Amend it instead — amending voids ' +
        'the current one and records the new one, so the audit trail shows what was in force ' +
        'at every moment.',
    )
  }

  const [inserted] = await db
    .insert(complianceApprovals)
    .values({
      approverName: approval.approverName,
      approverRole: approval.approverRole,
      approverFirm: approval.approverFirm,
      approvedAt: approval.approvedAt,
      evidenceReference: approval.evidenceReference,
      approvedJurisdictions: approval.jurisdictions,
      approvedTemplateHash: approval.templateHash,
      templateKind: approval.templateKind,
      conditions: approval.conditions,
      recordedById: auth.admin.id,
    })
    .returning({ id: complianceApprovals.id })

  await audit({
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    entityType: 'compliance_approval',
    entityId: inserted.id,
    action: 'compliance.approval_recorded',
    metadata: {
      templateKind: approval.templateKind,
      approvedTemplateHash: approval.templateHash,
      approvedJurisdictions: approval.jurisdictions,
      approverName: approval.approverName,
      approverRole: approval.approverRole,
      approverFirm: approval.approverFirm,
      evidenceReference: approval.evidenceReference,
      hasConditions: approval.conditions !== null,
      blocsExpanded: approval.expansionNote,
    },
  })

  const counts = await applyJurisdictionBlocks(auth.admin, 'approval_recorded')
  revalidate()

  return actionOk(
    `Approval recorded for the ${approval.templateKind.toLowerCase()} template, covering ` +
      `${approval.jurisdictions.join(', ')}. ${summarise(counts)} ` +
      'Any change to the template from here voids this approval and disables sending until a new one is recorded.',
  )
}

// ---------------------------------------------------------------------------
// Amend — void the current record and write a new one
// ---------------------------------------------------------------------------

export async function amendApprovalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('AMEND')
  if (!auth.ok) return auth.state

  const amendmentReason = text(formData.get('amendmentReason'))
  if (amendmentReason.length < 10) {
    return actionError('Say what is being amended and why, in a sentence.', {
      amendmentReason: 'At least ten characters. It goes on the audit trail.',
    })
  }

  const parsed = await parseApprovalForm(formData)
  if (!parsed.ok) return parsed.state

  const approval = parsed.value
  const previous = await getCurrentApproval(approval.templateKind)

  if (!previous) {
    return actionError(
      'There is no approval in force for this template to amend. Record one instead.',
    )
  }

  const now = new Date()

  await db
    .update(complianceApprovals)
    .set({
      voidedAt: now,
      voidedReason: `Superseded by an amendment: ${amendmentReason}`,
    })
    .where(
      and(
        eq(complianceApprovals.id, previous.id),
        isNull(complianceApprovals.voidedAt),
      ),
    )

  const [inserted] = await db
    .insert(complianceApprovals)
    .values({
      approverName: approval.approverName,
      approverRole: approval.approverRole,
      approverFirm: approval.approverFirm,
      approvedAt: approval.approvedAt,
      evidenceReference: approval.evidenceReference,
      approvedJurisdictions: approval.jurisdictions,
      approvedTemplateHash: approval.templateHash,
      templateKind: approval.templateKind,
      conditions: approval.conditions,
      recordedById: auth.admin.id,
    })
    .returning({ id: complianceApprovals.id })

  await audit({
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    entityType: 'compliance_approval',
    entityId: inserted.id,
    action: 'compliance.approval_amended',
    metadata: {
      supersededApprovalId: previous.id,
      amendmentReason,
      templateKind: approval.templateKind,
      approvedTemplateHash: approval.templateHash,
      previousTemplateHash: previous.approvedTemplateHash,
      approvedJurisdictions: approval.jurisdictions,
      previousJurisdictions: previous.approvedJurisdictions,
      approverName: approval.approverName,
      approverRole: approval.approverRole,
      evidenceReference: approval.evidenceReference,
      blocsExpanded: approval.expansionNote,
    },
  })

  const counts = await applyJurisdictionBlocks(auth.admin, 'approval_amended')
  revalidate()

  return actionOk(
    `Amended. The previous approval is voided and retained, and the new one covers ` +
      `${approval.jurisdictions.join(', ')}. ${summarise(counts)}`,
  )
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

export async function voidApprovalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('VOID')
  if (!auth.ok) return auth.state

  const schema = z.object({
    approvalId: z.string().trim().min(1, 'Which approval?'),
    reason: z
      .string()
      .trim()
      .min(10, 'Say why it is being withdrawn. At least ten characters.')
      .max(1000),
  })

  const parsed = schema.safeParse({
    approvalId: text(formData.get('approvalId')),
    reason: text(formData.get('reason')),
  })

  if (!parsed.success) {
    return actionError('The approval was not voided.', fieldErrors(parsed.error))
  }

  const updated = await db
    .update(complianceApprovals)
    .set({ voidedAt: new Date(), voidedReason: parsed.data.reason })
    .where(
      and(
        eq(complianceApprovals.id, parsed.data.approvalId),
        isNull(complianceApprovals.voidedAt),
      ),
    )
    .returning({
      id: complianceApprovals.id,
      templateKind: complianceApprovals.templateKind,
    })

  if (updated.length === 0) {
    return actionError(
      'That approval is not in force — it has already been voided, or it does not exist. Nothing was changed.',
    )
  }

  await audit({
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    entityType: 'compliance_approval',
    entityId: updated[0].id,
    action: 'compliance.approval_voided',
    metadata: {
      templateKind: updated[0].templateKind,
      reason: parsed.data.reason,
    },
  })

  const counts = await applyJurisdictionBlocks(auth.admin, 'approval_voided')
  revalidate()

  return actionOk(
    'Voided. Sending is disabled until a new approval is recorded. The record itself is kept — ' +
      `approvals are never deleted. ${summarise(counts)}`,
  )
}

// ---------------------------------------------------------------------------
// The individual clearance — BUILD_SPEC §8.3
// ---------------------------------------------------------------------------

/**
 * Unblock ONE recipient, against a recorded reference, and nobody else.
 *
 * §8.3: "A recipient can be individually approved against a recorded approval
 * reference, so if advice comes back clearing that specific person, David
 * unblocks them without loosening the gate for anyone else."
 *
 * There is no action in this file that clears a jurisdiction for everybody,
 * and there is no code path that writes `blocked = false` without either a
 * reference on that row or that row's country being on the approved list.
 */
export async function clearRecipientAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('CLEAR_RECIPIENT')
  if (!auth.ok) return auth.state

  const schema = z.object({
    offerId: z.string().trim().min(1, 'Which recipient?'),
    reference: z
      .string()
      .trim()
      .min(
        MIN_APPROVAL_REFERENCE_LENGTH,
        'Record the reference from whoever cleared this person — a letter reference, an email ' +
          'subject and date, or a document id. A recipient cannot be unblocked without one.',
      )
      .max(500),
  })

  const parsed = schema.safeParse({
    offerId: text(formData.get('offerId')),
    reference: text(formData.get('reference')),
  })

  if (!parsed.success) {
    return actionError(
      'This recipient was not cleared. An individual clearance needs a recorded reference — ' +
        'that is the only thing that unblocks one, and there is no blanket unblock anywhere ' +
        'in the application.',
      fieldErrors(parsed.error),
    )
  }

  // Belt and braces: the same predicate the gate uses, so the two can never
  // disagree about what counts as a recorded reference.
  if (!hasRecordedOverride(parsed.data.reference)) {
    return actionError(
      'That reference is too short to be a record of anything. Nothing was changed.',
    )
  }

  const rows = await loadGateableOffers()
  const row = rows.find((candidate) => candidate.id === parsed.data.offerId)

  if (!row) {
    return actionError('That recipient does not exist. Nothing was changed.')
  }

  // Only the jurisdiction hold is lifted. A validation failure, an unresolved
  // template variable or a manual hold is somebody else's gate and stays shut.
  const liftsBlock = row.blocked && row.blockReason === 'JURISDICTION_NOT_APPROVED'

  await db
    .update(offers)
    .set({
      jurisdictionApprovalRef: parsed.data.reference,
      ...(liftsBlock
        ? {
            blocked: false,
            blockReason: null,
            blockDetail: null,
            // Keep `email_status` in step with `blocked` — the import writes
            // both together and a send list reads the status, not the flag.
            // SENT and FAILED are left exactly as they are.
            ...(row.emailStatus === 'BLOCKED' ? { emailStatus: 'DRAFT' as const } : {}),
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(offers.id, parsed.data.offerId))

  await audit({
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    entityType: 'offer',
    entityId: parsed.data.offerId,
    action: 'compliance.recipient_cleared',
    metadata: {
      jurisdiction: row.jurisdiction,
      approvalReference: parsed.data.reference,
      liftedJurisdictionBlock: liftsBlock,
      remainingBlockReason: liftsBlock ? null : row.blockReason,
    },
  })

  revalidate()

  return actionOk(
    liftsBlock
      ? 'Cleared. This recipient alone is now sendable, against the reference you recorded. ' +
          'Nobody else in their jurisdiction has been unblocked.'
      : 'Reference recorded against this recipient. They are still held for another reason ' +
          `(${row.blockReason ?? 'unknown'}), which this clearance does not touch.`,
  )
}

export async function revokeRecipientClearanceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('REVOKE_RECIPIENT_CLEARANCE')
  if (!auth.ok) return auth.state

  const offerId = text(formData.get('offerId'))
  if (offerId === '') return actionError('Which recipient? Nothing was changed.')

  const rows = await loadGateableOffers()
  const row = rows.find((candidate) => candidate.id === offerId)
  if (!row) return actionError('That recipient does not exist. Nothing was changed.')

  const approval = await getCurrentApproval('INVITATION')
  const clearedByList = isJurisdictionApproved(row.jurisdiction, approval)

  await db
    .update(offers)
    .set({
      jurisdictionApprovalRef: null,
      ...(clearedByList
        ? {}
        : {
            blocked: true,
            blockReason: 'JURISDICTION_NOT_APPROVED' as const,
            blockDetail:
              'The individual clearance recorded for this recipient has been withdrawn, and ' +
              'their jurisdiction is not on the approved list.',
            ...(row.emailStatus === 'DRAFT' ? { emailStatus: 'BLOCKED' as const } : {}),
          }),
      updatedAt: new Date(),
    })
    .where(eq(offers.id, offerId))

  await audit({
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    entityType: 'offer',
    entityId: offerId,
    action: 'compliance.recipient_clearance_revoked',
    metadata: {
      jurisdiction: row.jurisdiction,
      reblocked: !clearedByList,
    },
  })

  revalidate()

  return actionOk(
    clearedByList
      ? 'Clearance withdrawn. This recipient stays sendable because their jurisdiction is on the approved list anyway.'
      : 'Clearance withdrawn and this recipient is held again. Every other recipient is unaffected.',
  )
}

// ---------------------------------------------------------------------------
// Re-check
// ---------------------------------------------------------------------------

/**
 * Re-apply the gate to every offer without changing the approval.
 *
 * Useful after an import or a jurisdiction correction. It cannot loosen
 * anything: it runs the same plan as recording an approval does, and that plan
 * never lifts a block placed for a reason other than the jurisdiction gate.
 */
export async function recheckJurisdictionsAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('RECHECK')
  if (!auth.ok) return auth.state

  const drift = await checkTemplateDrift('INVITATION')
  const counts = await applyJurisdictionBlocks(auth.admin, 'manual_recheck')

  await audit({
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
    entityType: 'compliance_approval',
    entityId: drift.approval?.id ?? null,
    action: 'compliance.rechecked',
    metadata: {
      driftState: drift.state,
      blocked: counts.blocked,
      unblocked: counts.unblocked,
      unchanged: counts.unchanged,
    },
  })

  revalidate()

  return actionOk(
    `${summarise(counts)} ${counts.unchanged} recipient(s) were already in the right state. ` +
      `Template state: ${drift.state}.`,
  )
}
