/**
 * Loading the review table and the pre-flight state. BUILD_SPEC §12, §19.
 *
 * Reads only. Nothing here sends, mints a token, or writes a snapshot.
 *
 * The pre-flight attestations live in the append-only audit log rather than in
 * a column of their own, for the same reason the operator onboarding
 * acknowledgements do: they record that a person confirmed something at a
 * moment, which is what an audit entry is. It also means the checklist and the
 * audit trail cannot disagree about who ticked what.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
  auditEvents,
  investorAccounts,
  offers,
  recipients,
  rounds,
} from '@/db/schema'
import { readServiceConfig } from '@/lib/auth/service-config'
import { gateBatch, loadGateContext, type BatchGateResult } from '@/lib/compliance'
import type { ComplianceApprovalRecord, DriftEvaluation } from '@/lib/compliance'
import { validateBatch, type BatchValidationResult } from '@/lib/email/render'
import { readMailConnectionHealth } from '@/lib/email/transport'
import {
  loadSenderDefaults,
  PREVIEW_CLAIM_TOKEN,
  buildPortalLink,
  type RecipientVariableInput,
  type SenderDefaults,
} from '@/lib/email/variables'
import { isoToday } from '@/lib/money'
import { evaluatePreflight, isAttestedItemId, type PreflightItemId, type PreflightResult } from './preflight'
import type { ReviewRow } from './review'
import type { SendInvitationTarget } from './send-invitation'

export const PREFLIGHT_ATTESTATION_ACTION = 'preflight.item_confirmed'
export const PREFLIGHT_RESET_ACTION = 'preflight.reset'

export interface BatchContext {
  roundId: string | null
  rows: ReviewRow[]
  targets: SendInvitationTarget[]
  defaults: SenderDefaults
  approval: ComplianceApprovalRecord | null
  drift: DriftEvaluation
  gate: BatchGateResult
  validation: BatchValidationResult
  preflight: PreflightResult
  mailConnection: Awaited<ReturnType<typeof readMailConnectionHealth>>
  serviceMode: 'ACTIVE' | 'READ_ONLY' | 'SUNSET' | 'DISABLED'
}

async function currentRoundId(): Promise<string | null> {
  const round = await db.query.rounds.findFirst({ orderBy: desc(rounds.createdAt) })
  return round?.id ?? null
}

/**
 * Which attestations are in force for this round.
 *
 * A reset entry invalidates every confirmation recorded before it, which is how
 * a re-imported recipient file forces the checklist to be walked again. Reading
 * the log newest-first and stopping at the reset is cheaper than deleting rows,
 * and the audit log is append-only by design.
 */
export async function loadAttestations(roundId: string): Promise<Set<PreflightItemId>> {
  const entries = await db
    .select({
      action: auditEvents.action,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, 'round'),
        eq(auditEvents.entityId, roundId),
        inArray(auditEvents.action, [PREFLIGHT_ATTESTATION_ACTION, PREFLIGHT_RESET_ACTION]),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))

  const confirmed = new Set<PreflightItemId>()
  for (const entry of entries) {
    if (entry.action === PREFLIGHT_RESET_ACTION) break
    const item = (entry.metadata as { item?: unknown } | null)?.item
    if (typeof item === 'string' && isAttestedItemId(item)) confirmed.add(item)
  }
  return confirmed
}

function toVariableInput(target: SendInvitationTarget): RecipientVariableInput {
  return {
    offerId: target.offerId,
    recipientName: target.recipientName,
    recipientEmail: target.recipientEmail,
    proposedAmountUsd: target.proposedAmountUsd,
    spvPercentage: target.spvPercentage,
    indirectPercentage: target.indirectPercentage,
    responseDeadline: target.responseDeadline,
    // Pre-flight validates rendering, and rendering must not mint a credential
    // to do it. The placeholder is the same shape and length as a real link, so
    // it exercises the template identically.
    portalLink: buildPortalLink(PREVIEW_CLAIM_TOKEN),
    rowSenderName: target.rowSenderName,
    rowSenderEmail: target.rowSenderEmail,
    rowSenderPhone: target.rowSenderPhone,
  }
}

export async function loadBatchContext(): Promise<BatchContext> {
  const roundId = await currentRoundId()
  const config = await readServiceConfig()
  const defaults = await loadSenderDefaults()
  const { approval, drift } = await loadGateContext('INVITATION')
  const mailConnection = await readMailConnectionHealth()

  if (!roundId) {
    const empty = validateBatch([], defaults)
    const gate = gateBatch([], approval, drift)
    return {
      roundId: null,
      rows: [],
      targets: [],
      defaults,
      approval,
      drift,
      gate,
      validation: empty,
      preflight: evaluatePreflight(
        {
          offers: [],
          gate,
          validation: empty,
          serviceMode: config.serviceMode,
          mailConnectionVerified: mailConnection.state === 'HEALTHY',
          mailConnectionDetail: mailConnection.summary,
          attestations: new Set(),
        },
        isoToday(),
      ),
      mailConnection,
      serviceMode: config.serviceMode,
    }
  }

  const dbRows = await db
    .select({
      offerId: offers.id,
      accountId: offers.accountId,
      proposedAmountUsd: offers.proposedAmountUsd,
      committedAmountUsd: offers.committedAmountUsd,
      acceptedAmountUsd: offers.acceptedAmountUsd,
      receivedAmountUsd: offers.receivedAmountUsd,
      spvPercentage: offers.spvPercentage,
      indirectPercentage: offers.indirectPercentage,
      responseDeadline: offers.responseDeadline,
      stage: offers.stage,
      emailStatus: offers.emailStatus,
      responseChoice: offers.responseChoice,
      blocked: offers.blocked,
      blockReason: offers.blockReason,
      blockDetail: offers.blockDetail,
      jurisdictionApprovalRef: offers.jurisdictionApprovalRef,
      offerUpdatedAt: offers.updatedAt,
      name: investorAccounts.name,
      email: investorAccounts.email,
      accountStatus: investorAccounts.status,
      lastSignInAt: investorAccounts.lastSignInAt,
      jurisdiction: recipients.jurisdiction,
      rowSenderName: recipients.senderName,
      rowSenderEmail: recipients.senderEmail,
      rowSenderPhone: recipients.senderPhone,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .leftJoin(recipients, eq(offers.recipientId, recipients.id))
    .where(eq(offers.roundId, roundId))
    .orderBy(investorAccounts.name)

  const rows: ReviewRow[] = dbRows.map((row) => ({
    offerId: row.offerId,
    accountId: row.accountId,
    name: row.name,
    email: row.email,
    jurisdiction: row.jurisdiction,
    proposedAmountUsd: row.proposedAmountUsd,
    committedAmountUsd: row.committedAmountUsd,
    acceptedAmountUsd: row.acceptedAmountUsd,
    receivedAmountUsd: row.receivedAmountUsd,
    spvPercentage: row.spvPercentage,
    indirectPercentage: row.indirectPercentage,
    responseDeadline: row.responseDeadline,
    emailStatus: row.emailStatus,
    accountStatus: row.accountStatus,
    stage: row.stage,
    responseChoice: row.responseChoice,
    blocked: row.blocked,
    blockReason: row.blockReason,
    // §12: "portal opened" is a claim-and-open, never an email open. There is
    // no tracking pixel in this application, so this is the only honest source.
    portalOpenedAt: row.lastSignInAt,
    lastActivityAt: row.offerUpdatedAt,
  }))

  const targets: SendInvitationTarget[] = dbRows.map((row) => ({
    offerId: row.offerId,
    accountId: row.accountId,
    recipientName: row.name,
    recipientEmail: row.email,
    jurisdiction: row.jurisdiction,
    blocked: row.blocked,
    blockReason: row.blockReason,
    blockDetail: row.blockDetail,
    jurisdictionApprovalRef: row.jurisdictionApprovalRef,
    proposedAmountUsd: row.proposedAmountUsd,
    spvPercentage: row.spvPercentage,
    indirectPercentage: row.indirectPercentage,
    responseDeadline: row.responseDeadline,
    rowSenderName: row.rowSenderName,
    rowSenderEmail: row.rowSenderEmail,
    rowSenderPhone: row.rowSenderPhone,
  }))

  const gate = gateBatch(
    targets.map((target) => ({
      id: target.offerId,
      jurisdiction: target.jurisdiction,
      blocked: target.blocked,
      blockReason: target.blockReason,
      blockDetail: target.blockDetail,
      jurisdictionApprovalRef: target.jurisdictionApprovalRef,
      recipientName: target.recipientName,
    })),
    approval,
    drift,
  )

  const validation = validateBatch(targets.map(toVariableInput), defaults, {
    kinds: ['INVITATION'],
  })

  const preflight = evaluatePreflight(
    {
      offers: targets.map((target) => ({
        offerId: target.offerId,
        recipientName: target.recipientName,
        recipientEmail: target.recipientEmail,
        responseDeadline: target.responseDeadline,
        proposedAmountUsd: target.proposedAmountUsd,
        spvPercentage: target.spvPercentage,
        indirectPercentage: target.indirectPercentage,
      })),
      gate,
      validation,
      serviceMode: config.serviceMode,
      mailConnectionVerified: mailConnection.state === 'HEALTHY',
      mailConnectionDetail: mailConnection.summary,
      attestations: await loadAttestations(roundId),
    },
    isoToday(),
  )

  return {
    roundId,
    rows,
    targets,
    defaults,
    approval,
    drift,
    gate,
    validation,
    preflight,
    mailConnection,
    serviceMode: config.serviceMode,
  }
}

export async function loadSendTarget(offerId: string): Promise<SendInvitationTarget | null> {
  const context = await loadBatchContext()
  return context.targets.find((target) => target.offerId === offerId) ?? null
}
