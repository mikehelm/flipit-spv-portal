'use server'

import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import {
  aiUsageEvents,
  auditEvents,
  emailReviewProposals,
  emailTemplates,
} from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireAdmin, requireOwner, requireReader } from '@/lib/auth/guards'
import {
  answerEmailReviewQuestion,
  reviewEmailProposal,
} from '@/lib/email-review/ai'
import {
  EMAIL_REVIEW_DOCUMENT,
  findEmailReviewClause,
} from '@/lib/email-review/document'
import {
  EMAIL_REVIEW_MODEL,
  MAX_EMAIL_REVIEW_QUESTION_LENGTH,
} from '@/lib/email-review/model'
import { buildPairedEmailDiff } from '@/lib/email-review/segments'
import {
  canAskViewerEmailReviewQuestion,
  VIEWER_EMAIL_REVIEW_LIMIT,
  VIEWER_EMAIL_REVIEW_WINDOW_MS,
} from '@/lib/email-review/viewer-limit'
import {
  applySectionReplacement,
  findEmailReviewSection,
  readableInvitationSource,
  resolveEmailReviewSections,
} from '@/lib/email-review/sections'
import {
  blockingPolicyFailures,
  evaluateInvitationPolicy,
} from '@/lib/email/policy'
import { hashOf, loadCurrentTemplate } from '@/lib/email/templates'
import { loadAiKey } from '@/lib/import/persist'
import { estimateCallCostUsd } from '@/lib/import/spend'

export type EmailReviewAiState =
  | { status: 'idle' }
  | {
      status: 'ok'
      answer: string
      model: string
      scopeLabel: string
    }
  | { status: 'error'; message: string }

const questionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, 'Ask a complete question.')
    .max(
      MAX_EMAIL_REVIEW_QUESTION_LENGTH,
      `Keep the question under ${MAX_EMAIL_REVIEW_QUESTION_LENGTH.toLocaleString()} characters.`,
    ),
  clauseId: z.string().trim().max(100),
  changeId: z.string().trim().max(100),
})

async function recordUsage(input: {
  promptTokens: number
  completionTokens: number
  succeeded: boolean
}): Promise<void> {
  await db.insert(aiUsageEvents).values({
    model: EMAIL_REVIEW_MODEL,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    estimatedCostUsd: estimateCallCostUsd(EMAIL_REVIEW_MODEL, input),
    succeeded: input.succeeded,
  })
}

async function reserveViewerQuestionAttempt(admin: {
  id: string
  email: string
  role: 'OWNER' | 'OPERATOR' | 'VIEWER'
}): Promise<boolean> {
  if (admin.role !== 'VIEWER') return true

  const windowStart = new Date(Date.now() - VIEWER_EMAIL_REVIEW_WINDOW_MS)
  return db.transaction(async (tx) => {
    // Serialize this viewer's count-and-record operation. Without the lock,
    // simultaneous questions could all observe attempt nine and pass together.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`email-review-viewer:${admin.id}`}, 0))`,
    )
    const [row] = await tx
      .select({ value: count() })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorUserId, admin.id),
          eq(auditEvents.action, 'email_review.question_attempted'),
          gte(auditEvents.createdAt, windowStart),
        ),
      )
    const recentAttempts = Number(row?.value ?? 0)
    if (!canAskViewerEmailReviewQuestion(admin.role, recentAttempts)) return false

    // This is deliberately an inline audit insert so the advisory lock and
    // reservation share one transaction. Every field is fixed metadata; the
    // submitted question and provider answer are not available to this block.
    await tx.insert(auditEvents).values({
      actorUserId: admin.id,
      actorAccountId: null,
      actorLabel: admin.email,
      entityType: 'email_review',
      entityId: 'viewer-question-window',
      action: 'email_review.question_attempted',
      metadata: {
        rollingHours: VIEWER_EMAIL_REVIEW_WINDOW_MS / (60 * 60 * 1_000),
        attemptNumber: recentAttempts + 1,
        limit: VIEWER_EMAIL_REVIEW_LIMIT,
      },
    })
    return true
  })
}

export async function askEmailReviewQuestionAction(
  _previous: EmailReviewAiState,
  formData: FormData,
): Promise<EmailReviewAiState> {
  // A read-only experience tester may ask the same explanatory question as
  // David. Provider storage is disabled and neither the question nor answer is
  // written to our database; only counts-only usage and metadata-only audit
  // entries remain. Every proposal, review and promotion action below keeps
  // its acting-admin/owner guard.
  const admin = await requireReader()

  const parsed = questionSchema.safeParse({
    question: formData.get('question'),
    clauseId: formData.get('clauseId') ?? '',
    changeId: formData.get('changeId') ?? '',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'The question could not be read.',
    }
  }

  const clauseId = parsed.data.clauseId || undefined
  const changeId = parsed.data.changeId || undefined
  if (clauseId && !findEmailReviewClause(clauseId)) {
    return { status: 'error', message: 'Choose a clause from this review and try again.' }
  }

  const live = await loadCurrentTemplate('INVITATION')
  const currentEmail = readableInvitationSource(live)
  const selection = changeId
    ? buildPairedEmailDiff(
        EMAIL_REVIEW_DOCUMENT.original.text,
        currentEmail,
        EMAIL_REVIEW_DOCUMENT.clauses,
      ).find((unit) => unit.id === changeId)
    : undefined
  if (changeId && !selection) {
    return { status: 'error', message: 'Choose a visible change and try again.' }
  }

  if (!(await reserveViewerQuestionAttempt(admin))) {
    return {
      status: 'error',
      message:
        'Graham’s AI question limit has been reached for the last 24 hours. The recorded evidence and both email views remain available without AI.',
    }
  }

  const configured = await loadAiKey()
  if (!configured) {
    return {
      status: 'error',
      message:
        'AI questions are not connected yet. Mike can add the OpenAI key in Settings; the comparison and recorded explanations remain available without it.',
    }
  }

  try {
    const result = await answerEmailReviewQuestion({
      apiKey: configured.apiKey,
      actorId: admin.id,
      question: parsed.data.question,
      currentEmail,
      ...(clauseId ? { clauseId } : {}),
      ...(selection ? { selection } : {}),
    })

    await recordUsage({
      promptTokens: result.usage?.inputTokens ?? 0,
      completionTokens: result.usage?.outputTokens ?? 0,
      succeeded: true,
    })

    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'email_review',
      entityId: changeId ?? clauseId ?? 'whole-document',
      action: 'email_review.question_answered',
      metadata: {
        model: EMAIL_REVIEW_MODEL,
        scope: result.scope,
        clauseId: clauseId ?? null,
        changeId: changeId ?? null,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
      },
    })

    return {
      status: 'ok',
      answer: result.answer,
      model: result.model,
      scopeLabel: result.scopeLabel,
    }
  } catch {
    await recordUsage({ promptTokens: 0, completionTokens: 0, succeeded: false })
    return {
      status: 'error',
      message:
        'OpenAI could not answer just now. Nothing was saved. Try again, or use the recorded clause explanation above.',
    }
  }
}

const proposalSchema = z.object({
  sectionId: z.string().trim().min(1).max(100),
  proposedText: z.string().trim().min(3).max(2_000),
  reason: z.string().trim().min(10, 'Explain why you want this wording changed.').max(2_000),
})

export async function submitEmailReviewProposalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()
  const parsed = proposalSchema.safeParse({
    sectionId: formData.get('sectionId'),
    proposedText: formData.get('proposedText'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? 'The proposal is incomplete.')
  }

  const staticSection = findEmailReviewSection(parsed.data.sectionId)
  if (!staticSection?.editable) {
    return actionError(staticSection?.lockedReason ?? 'That wording is protected.')
  }

  const [live, promotedWordings] = await Promise.all([
    loadCurrentTemplate('INVITATION'),
    db
      .select({ proposedText: emailReviewProposals.proposedText })
      .from(emailReviewProposals)
      .where(
        and(
          eq(emailReviewProposals.sectionId, parsed.data.sectionId),
          eq(emailReviewProposals.status, 'PROMOTED'),
        ),
      )
      .orderBy(desc(emailReviewProposals.reviewedAt)),
  ])
  const section =
    resolveEmailReviewSections(
      live,
      new Map([
        [
          parsed.data.sectionId,
          promotedWordings.map((wording) => wording.proposedText),
        ],
      ]),
    ).find((entry) => entry.id === parsed.data.sectionId) ?? staticSection
  if (parsed.data.proposedText === section.currentText) {
    return actionError('The proposed wording is unchanged.')
  }

  let candidate
  try {
    candidate = applySectionReplacement(
      live,
      parsed.data.sectionId,
      parsed.data.proposedText,
      section.currentText,
    )
  } catch (error) {
    return actionError(
      error instanceof Error ? error.message : 'The live wording could not be changed safely.',
    )
  }

  const policyResults = evaluateInvitationPolicy(candidate)
  const failures = blockingPolicyFailures(policyResults)
  if (failures.length > 0) {
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'email_review_proposal',
      entityId: null,
      action: 'email_review.proposal_blocked',
      metadata: {
        sectionId: section.id,
        baseTemplateHash: live.hash,
        failedRuleIds: failures.map((failure) => failure.id),
      },
    })
    return actionError(
      `This proposal breaks ${failures.length} protected rule${failures.length === 1 ? '' : 's'}: ` +
        failures.map((failure) => failure.message).join(' '),
    )
  }

  let aiReview: string | null = null
  let aiModel: string | null = null
  const configured = await loadAiKey()
  if (configured) {
    try {
      const evidenceSectionId =
        section.id === 'private-process' ? 'opening-context' : section.id
      const recordedEvidence = EMAIL_REVIEW_DOCUMENT.clauses
        .filter((clause) => clause.id === evidenceSectionId)
        .map((clause) => ({
          clause: clause.title,
          reason: clause.reason,
          evidenceLabel: clause.evidenceKind,
          evidenceCitation: clause.evidence,
        }))
      const review = await reviewEmailProposal({
        apiKey: configured.apiKey,
        actorId: admin.id,
        sectionLabel: section.title,
        beforeText: section.currentText,
        proposedText: parsed.data.proposedText,
        davidReason: parsed.data.reason,
        policyResults,
        recordedEvidence,
      })
      aiReview = review.answer
      aiModel = review.model
      await recordUsage({
        promptTokens: review.usage?.inputTokens ?? 0,
        completionTokens: review.usage?.outputTokens ?? 0,
        succeeded: true,
      })
    } catch {
      await recordUsage({ promptTokens: 0, completionTokens: 0, succeeded: false })
    }
  }

  const candidateTemplateHash = hashOf(candidate)
  const inserted = await db
    .insert(emailReviewProposals)
    .values({
      createdById: admin.id,
      sectionId: section.id,
      sectionLabel: section.title,
      beforeText: section.currentText,
      proposedText: parsed.data.proposedText,
      reason: parsed.data.reason,
      baseTemplateHash: live.hash,
      candidateTemplateHash,
      candidateSubject: candidate.subject,
      candidateHtmlSource: candidate.htmlSource,
      candidateTextSource: candidate.textSource,
      policyResults,
      aiReview,
      aiModel,
    })
    .returning({ id: emailReviewProposals.id })
  const proposalId = inserted[0]?.id
  if (!proposalId) return actionError('The proposal could not be saved.')

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'email_review_proposal',
    entityId: proposalId,
    action: 'email_review.proposal_submitted',
    metadata: {
      sectionId: section.id,
      baseTemplateHash: live.hash,
      candidateTemplateHash,
      passedRuleIds: policyResults.filter((entry) => entry.passed).map((entry) => entry.id),
      aiModel,
    },
  })

  revalidatePath('/admin/email-review')
  revalidatePath('/admin')
  return actionOk(
    admin.role === 'OWNER'
      ? 'Proposal saved. Review it below before promoting it.'
      : 'Sent to Mike for review. The live invitation has not changed.',
  )
}

const reviewSchema = z.object({
  proposalId: z.string().trim().min(1),
  decision: z.enum(['REQUEST_CHANGES', 'REJECT', 'PROMOTE']),
  note: z.string().trim().max(2_000),
  acknowledged: z.enum(['on']).optional(),
})

export async function reviewEmailProposalAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()
  const parsed = reviewSchema.safeParse({
    proposalId: formData.get('proposalId'),
    decision: formData.get('decision'),
    note: formData.get('note') ?? '',
    acknowledged: formData.get('acknowledged') ?? undefined,
  })
  if (!parsed.success) return actionError('That review decision could not be read.')
  if (
    parsed.data.decision !== 'PROMOTE' &&
    parsed.data.note.length < 5
  ) {
    return actionError('Give David a short reason for that decision.')
  }
  if (parsed.data.decision === 'PROMOTE' && parsed.data.acknowledged !== 'on') {
    return actionError(
      'Confirm that promotion disables sending until the exact new wording is approved.',
    )
  }

  const proposal = await db.query.emailReviewProposals.findFirst({
    where: eq(emailReviewProposals.id, parsed.data.proposalId),
  })
  if (!proposal) return actionError('That proposal no longer exists.')
  if (!['SUBMITTED', 'CHANGES_REQUESTED'].includes(proposal.status)) {
    return actionError('That proposal has already reached a final decision.')
  }

  if (parsed.data.decision !== 'PROMOTE') {
    const status =
      parsed.data.decision === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED'
    await db
      .update(emailReviewProposals)
      .set({
        status,
        reviewedById: owner.id,
        reviewNote: parsed.data.note,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailReviewProposals.id, proposal.id))
    await audit({
      actor: { kind: 'user', id: owner.id, label: owner.email },
      entityType: 'email_review_proposal',
      entityId: proposal.id,
      action:
        status === 'REJECTED'
          ? 'email_review.proposal_rejected'
          : 'email_review.changes_requested',
      metadata: { sectionId: proposal.sectionId, status },
    })
    revalidatePath('/admin/email-review')
    return actionOk(
      status === 'REJECTED'
        ? 'Proposal rejected. The live invitation is unchanged.'
        : 'Changes requested. David can see your note; the live invitation is unchanged.',
    )
  }

  if (proposal.status !== 'SUBMITTED') {
    return actionError('David must resubmit the wording after requested changes.')
  }

  const live = await loadCurrentTemplate('INVITATION')
  if (live.hash !== proposal.baseTemplateHash) {
    return actionError(
      'The live invitation changed after this proposal was created. Nothing was promoted. ' +
        'Ask David to review the new version and submit the change again.',
    )
  }

  const candidate = {
    subject: proposal.candidateSubject,
    htmlSource: proposal.candidateHtmlSource,
    textSource: proposal.candidateTextSource,
  }
  if (hashOf(candidate) !== proposal.candidateTemplateHash) {
    return actionError('The saved proposal does not match its recorded hash.')
  }
  const policyResults = evaluateInvitationPolicy(candidate)
  const failures = blockingPolicyFailures(policyResults)
  if (failures.length > 0) {
    return actionError(
      'The proposal no longer passes the protected rules: ' +
        failures.map((failure) => failure.message).join(' '),
    )
  }

  const promoted = await db.transaction(async (tx) => {
    const latest = await tx
      .select({ version: emailTemplates.version })
      .from(emailTemplates)
      .where(eq(emailTemplates.kind, 'INVITATION'))
      .orderBy(desc(emailTemplates.version))
      .limit(1)
    const version = (latest[0]?.version ?? 0) + 1

    await tx
      .update(emailTemplates)
      .set({ isCurrent: false })
      .where(
        and(
          eq(emailTemplates.kind, 'INVITATION'),
          eq(emailTemplates.isCurrent, true),
        ),
      )
    const rows = await tx
      .insert(emailTemplates)
      .values({
        kind: 'INVITATION',
        subject: candidate.subject,
        htmlSource: candidate.htmlSource,
        textSource: candidate.textSource,
        version,
        hash: proposal.candidateTemplateHash,
        isCurrent: true,
      })
      .returning({ id: emailTemplates.id, version: emailTemplates.version })
    const template = rows[0]
    if (!template) throw new Error('The new template version was not created.')

    await tx
      .update(emailReviewProposals)
      .set({
        status: 'PROMOTED',
        reviewedById: owner.id,
        reviewNote: parsed.data.note || null,
        reviewedAt: new Date(),
        promotedTemplateId: template.id,
        policyResults,
        updatedAt: new Date(),
      })
      .where(eq(emailReviewProposals.id, proposal.id))
    return template
  })

  await audit({
    actor: { kind: 'user', id: owner.id, label: owner.email },
    entityType: 'email_review_proposal',
    entityId: proposal.id,
    action: 'email_review.proposal_promoted',
    metadata: {
      sectionId: proposal.sectionId,
      baseTemplateHash: proposal.baseTemplateHash,
      promotedTemplateHash: proposal.candidateTemplateHash,
      promotedTemplateId: promoted.id,
      promotedVersion: promoted.version,
      approvalRequired: true,
    },
  })

  for (const path of [
    '/admin/email-review',
    '/templates',
    '/compliance',
    '/recipients',
    '/admin',
  ]) {
    revalidatePath(path)
  }
  return actionOk(
    `Promoted as invitation version ${promoted.version}. Sending is now disabled until ` +
      'a fresh owner-recorded compliance approval matches this exact wording.',
  )
}
