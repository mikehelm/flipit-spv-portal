import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { emailReviewProposals, users } from '@/db/schema'
import type { AdminIdentity } from '@/lib/auth/guards'
import { checkTemplateDrift } from '@/lib/compliance/drift'
import type { EmailPolicyOutcome } from '@/lib/email/policy'
import { loadCurrentTemplate } from '@/lib/email/templates'
import { EMAIL_REVIEW_DOCUMENT } from './document'
import { buildPairedEmailDiff, type EmailDiffUnit } from './segments'
import {
  readableInvitationSource,
  resolveEmailReviewSections,
  type EmailReviewSection,
} from './sections'

export type EmailReviewProposalStatus =
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'PROMOTED'
  | 'WITHDRAWN'

export interface EmailReviewProposalView {
  id: string
  status: EmailReviewProposalStatus
  sectionId: string
  sectionLabel: string
  beforeText: string
  proposedText: string
  reason: string
  baseTemplateHash: string
  candidateTemplateHash: string
  policyResults: EmailPolicyOutcome[]
  aiReview: string | null
  aiModel: string | null
  submittedAt: string
  createdByName: string
  createdByEmail: string
  reviewNote: string | null
  reviewedAt: string | null
  reviewedByName: string | null
}

export interface EmailReviewWorkspaceData {
  liveTemplate: {
    hash: string
    origin: 'BUILT_IN' | 'STORED'
    version: number | null
    readableText: string
  }
  drift: {
    state: 'NO_APPROVAL' | 'APPROVED' | 'DRIFTED'
    sendingPermitted: boolean
    message: string
  }
  diffUnits: EmailDiffUnit[]
  sections: readonly EmailReviewSection[]
  proposals: EmailReviewProposalView[]
}

function proposalVisibility(admin: AdminIdentity) {
  return admin.role === 'OWNER'
    ? inArray(emailReviewProposals.status, [
        'SUBMITTED',
        'CHANGES_REQUESTED',
        'REJECTED',
        'PROMOTED',
      ])
    : and(
        eq(emailReviewProposals.createdById, admin.id),
        inArray(emailReviewProposals.status, [
          'SUBMITTED',
          'CHANGES_REQUESTED',
          'REJECTED',
          'PROMOTED',
        ]),
      )
}

export async function loadEmailReviewWorkspace(
  admin: AdminIdentity,
): Promise<EmailReviewWorkspaceData> {
  const [live, drift, rows, promotedWordings] = await Promise.all([
    loadCurrentTemplate('INVITATION'),
    checkTemplateDrift('INVITATION'),
    db
      .select({
        proposal: emailReviewProposals,
        creatorName: users.name,
        creatorEmail: users.email,
      })
      .from(emailReviewProposals)
      .innerJoin(users, eq(emailReviewProposals.createdById, users.id))
      .where(proposalVisibility(admin))
      .orderBy(desc(emailReviewProposals.createdAt))
      .limit(50),
    db
      .select({
        sectionId: emailReviewProposals.sectionId,
        proposedText: emailReviewProposals.proposedText,
      })
      .from(emailReviewProposals)
      .where(eq(emailReviewProposals.status, 'PROMOTED'))
      .orderBy(desc(emailReviewProposals.reviewedAt)),
  ])

  const reviewerIds = [
    ...new Set(
      rows
        .map((row) => row.proposal.reviewedById)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  const reviewers =
    reviewerIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, reviewerIds))
  const reviewerById = new Map(
    reviewers.map((reviewer) => [
      reviewer.id,
      reviewer.name?.trim() || reviewer.email,
    ]),
  )

  const readableText = readableInvitationSource(live)
  const promotedBySection = new Map<string, string[]>()
  for (const wording of promotedWordings) {
    const entries = promotedBySection.get(wording.sectionId) ?? []
    entries.push(wording.proposedText)
    promotedBySection.set(wording.sectionId, entries)
  }
  const sections = resolveEmailReviewSections(live, promotedBySection)
  return {
    liveTemplate: {
      hash: live.hash,
      origin: live.origin,
      version: live.version ?? null,
      readableText,
    },
    drift: {
      state: drift.state,
      sendingPermitted: drift.sendingPermitted,
      message: drift.message,
    },
    diffUnits: buildPairedEmailDiff(
      EMAIL_REVIEW_DOCUMENT.original.text,
      readableText,
      EMAIL_REVIEW_DOCUMENT.clauses,
      sections,
    ),
    sections,
    proposals: rows.map(({ proposal, creatorName, creatorEmail }) => ({
      id: proposal.id,
      status: proposal.status,
      sectionId: proposal.sectionId,
      sectionLabel: proposal.sectionLabel,
      beforeText: proposal.beforeText,
      proposedText: proposal.proposedText,
      reason: proposal.reason,
      baseTemplateHash: proposal.baseTemplateHash,
      candidateTemplateHash: proposal.candidateTemplateHash,
      policyResults: proposal.policyResults as EmailPolicyOutcome[],
      aiReview: proposal.aiReview,
      aiModel: proposal.aiModel,
      submittedAt: proposal.submittedAt.toISOString(),
      createdByName: creatorName?.trim() || creatorEmail,
      createdByEmail: creatorEmail,
      reviewNote: proposal.reviewNote,
      reviewedAt: proposal.reviewedAt?.toISOString() ?? null,
      reviewedByName: proposal.reviewedById
        ? reviewerById.get(proposal.reviewedById) ?? null
        : null,
    })),
  }
}

export async function countSubmittedEmailReviewProposals(): Promise<number> {
  const rows = await db
    .select({ id: emailReviewProposals.id })
    .from(emailReviewProposals)
    .where(eq(emailReviewProposals.status, 'SUBMITTED'))
  return rows.length
}
