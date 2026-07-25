/**
 * Everything the import does to the database.
 *
 * BUILD_SPEC §4.1 is precise about which record comes into existence when, and
 * this file follows it exactly:
 *
 *   - **On upload** a `Recipient` row is created. That is this file.
 *   - An `InvestorAccount` is created in `INVITED` — a real account state that
 *     simply predates verification (§4.1). Accounts are durable (§4.3), so an
 *     address that already has an account keeps it and gains a second offer
 *     rather than being duplicated.
 *   - An `Offer` carries the four amounts (§5) and the STORED indirect
 *     percentage, so the figure sent can never drift from the figure shown.
 *
 * No token is issued here and nothing is emailed. Sending is WP5, behind the
 * §8 gates.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  aiProposals,
  columnMappings,
  importJobs,
  investorAccounts,
  offers,
  recipients,
  rounds,
  serviceConfig,
} from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { decrypt } from '@/lib/crypto'
import { isoToday } from '@/lib/money'
import type { PrivilegedActor } from './authz'
import type { ConfirmedMapping } from './mapping'
import type { ImportContext, PreparedRow } from './validate'

const SINGLETON = 'singleton'

export interface RoundSummary {
  id: string
  name: string
  flipitShare: string
  aggregateTargetUsd: string
}

/** The open round, or the named one. */
export async function loadRound(roundId?: string): Promise<RoundSummary | null> {
  const rows = roundId
    ? await db.select().from(rounds).where(eq(rounds.id, roundId)).limit(1)
    : await db.select().from(rounds).where(isNull(rounds.closedAt)).limit(1)

  const round = rows[0]
  if (!round) return null
  return {
    id: round.id,
    name: round.name,
    flipitShare: round.flipitShare,
    aggregateTargetUsd: round.aggregateTargetUsd,
  }
}

export interface AiConfig {
  /** Whether a key is configured. The key itself never leaves this module. */
  configured: boolean
  model: string
  headersOnly: boolean
}

/**
 * The decrypted key, for server-side use only.
 *
 * Never returned to a client component, never logged, never put in audit
 * metadata, never included in an export. BUILD_SPEC §9.1, AC25.
 */
export async function loadAiKey(): Promise<{ apiKey: string; model: string } | null> {
  const config = await loadServiceConfig()
  if (!config?.openAiKeyEncrypted) return null
  try {
    const apiKey = decrypt(config.openAiKeyEncrypted)
    if (!apiKey) return null
    return { apiKey, model: config.openAiModel }
  } catch {
    // A key that cannot be decrypted is treated as absent: the manual path
    // still works and nothing about the failure is written anywhere.
    return null
  }
}

export async function loadAiConfig(): Promise<AiConfig> {
  const config = await loadServiceConfig()
  return {
    configured: Boolean(config?.openAiKeyEncrypted),
    model: config?.openAiModel ?? 'gpt-4o-mini',
    headersOnly: config?.aiHeadersOnly ?? false,
  }
}

/**
 * BUILD_SPEC §7. Importing is an admin function and stays available in
 * `READ_ONLY`, where the admin side keeps full function. It is refused in
 * `SUNSET` and `DISABLED`: adding recipients to a service that is winding down
 * or closed is a contradiction, and where the spec is silent the conservative
 * reading wins.
 */
export async function loadServiceMode(): Promise<'ACTIVE' | 'READ_ONLY' | 'SUNSET' | 'DISABLED'> {
  const config = await loadServiceConfig()
  return config?.serviceMode ?? 'ACTIVE'
}

async function loadServiceConfig() {
  const rows = await db
    .select()
    .from(serviceConfig)
    .where(eq(serviceConfig.id, SINGLETON))
    .limit(1)
  return rows[0] ?? null
}

/** Everything validation needs, read from the database rather than assumed. */
export async function loadImportContext(round: RoundSummary): Promise<ImportContext> {
  const config = await loadServiceConfig()

  const existingRecipients = await db
    .select({ email: recipients.email })
    .from(recipients)
    .where(eq(recipients.roundId, round.id))

  return {
    today: isoToday(),
    flipitShare: round.flipitShare,
    approvedJurisdictions: config?.approvedJurisdictions ?? [],
    aggregateRaiseUsd: config?.aggregateRaiseUsd ?? '0',
    existingEmails: existingRecipients.map((row) => row.email.toLowerCase()),
    decimalPlaces: config?.decimalPlaces ?? 3,
  }
}

// ---------------------------------------------------------------------------
// Import jobs
// ---------------------------------------------------------------------------

export async function createImportJob(input: {
  roundId: string
  filename: string
  headers: string[]
  rowCount: number
  usedAi: boolean
  actor: PrivilegedActor
}): Promise<string> {
  const [job] = await db
    .insert(importJobs)
    .values({
      roundId: input.roundId,
      filename: input.filename,
      sourceHeaders: input.headers,
      rowCount: input.rowCount,
      usedAi: input.usedAi,
    })
    .returning({ id: importJobs.id })

  await audit({
    actor: toAuditActor(input.actor),
    entityType: 'import_job',
    entityId: job.id,
    action: 'import.file_read',
    metadata: {
      filename: input.filename,
      rowCount: input.rowCount,
      columnCount: input.headers.length,
      usedAi: input.usedAi,
    },
  })

  return job.id
}

export async function recordAiProposal(input: {
  importJobId: string
  model: string
  promptSummary: string
  raw: string
  actor: PrivilegedActor
}): Promise<string> {
  const [proposal] = await db
    .insert(aiProposals)
    .values({
      importJobId: input.importJobId,
      model: input.model,
      promptSummary: input.promptSummary,
      rawProposal: input.raw,
    })
    .returning({ id: aiProposals.id })

  await audit({
    actor: toAuditActor(input.actor),
    entityType: 'ai_proposal',
    entityId: proposal.id,
    action: 'import.ai_proposed',
    metadata: { importJobId: input.importJobId, model: input.model },
  })

  return proposal.id
}

export async function loadImportJob(id: string) {
  const rows = await db.select().from(importJobs).where(eq(importJobs.id, id)).limit(1)
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// The import itself
// ---------------------------------------------------------------------------

export interface ImportOutcome {
  importJobId: string
  createdRecipients: number
  createdAccounts: number
  reusedAccounts: number
  createdOffers: number
  blockedOffers: number
}

/**
 * Create the records, in one transaction. Either the whole confirmed file
 * lands or none of it does — a half-imported recipient list is the worst
 * possible outcome for a send flow that works one recipient at a time.
 */
export async function persistImport(input: {
  round: RoundSummary
  importJobId: string
  rows: PreparedRow[]
  mapping: ConfirmedMapping
  proposedColumns: Array<{ sourceColumn: string; targetField: string; wasProposed: boolean; wasCorrected: boolean }>
  actor: PrivilegedActor
  usedAi: boolean
  aiProposalId: string | null
}): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    importJobId: input.importJobId,
    createdRecipients: 0,
    createdAccounts: 0,
    reusedAccounts: 0,
    createdOffers: 0,
    blockedOffers: 0,
  }

  const emails = input.rows.map((row) => row.email)
  const created: Array<{ recipientId: string; offerId: string; row: PreparedRow }> = []

  await db.transaction(async (tx) => {
    const existingAccounts = emails.length
      ? await tx
          .select({ id: investorAccounts.id, email: investorAccounts.email })
          .from(investorAccounts)
          .where(inArray(investorAccounts.email, emails))
      : []
    const accountByEmail = new Map(existingAccounts.map((row) => [row.email, row.id]))

    for (const row of input.rows) {
      const [recipient] = await tx
        .insert(recipients)
        .values({
          roundId: input.round.id,
          name: row.name,
          email: row.email,
          jurisdiction: row.jurisdiction,
          internalNotes: row.internalNotes,
          senderName: row.senderName,
          senderEmail: row.senderEmail,
          senderPhone: row.senderPhone,
          importJobId: input.importJobId,
        })
        .returning({ id: recipients.id })
      outcome.createdRecipients += 1

      let accountId = accountByEmail.get(row.email)
      if (accountId) {
        outcome.reusedAccounts += 1
      } else {
        const [account] = await tx
          .insert(investorAccounts)
          .values({ email: row.email, name: row.name, status: 'INVITED' })
          .returning({ id: investorAccounts.id })
        accountId = account.id
        accountByEmail.set(row.email, accountId)
        outcome.createdAccounts += 1
      }

      const [offer] = await tx
        .insert(offers)
        .values({
          roundId: input.round.id,
          accountId,
          recipientId: recipient.id,
          proposedAmountUsd: row.proposedAmountUsd,
          spvPercentage: row.spvPercentage,
          indirectPercentage: row.indirectPercentage,
          indirectOverridden: row.indirectOverridden,
          responseDeadline: row.responseDeadline,
          originalDeadline: row.responseDeadline,
          emailStatus: row.blocked ? 'BLOCKED' : 'DRAFT',
          blocked: row.blocked,
          blockReason: row.blockReason,
          blockDetail: row.blockDetail,
        })
        .returning({ id: offers.id })

      outcome.createdOffers += 1
      if (row.blocked) outcome.blockedOffers += 1
      created.push({ recipientId: recipient.id, offerId: offer.id, row })
    }

    for (const column of input.proposedColumns) {
      await tx.insert(columnMappings).values({
        importJobId: input.importJobId,
        sourceColumn: column.sourceColumn,
        targetField: column.targetField,
        transform: describeTransform(input.mapping, column.sourceColumn),
        wasProposed: column.wasProposed,
        wasCorrected: column.wasCorrected,
      })
    }

    await tx
      .update(importJobs)
      .set({
        confirmedById: input.actor.userId,
        confirmedAt: new Date(),
        rowCount: input.rows.length,
        usedAi: input.usedAi,
      })
      .where(eq(importJobs.id, input.importJobId))

    if (input.aiProposalId) {
      await tx
        .update(aiProposals)
        .set({ acceptedById: input.actor.userId, acceptedAt: new Date() })
        .where(eq(aiProposals.id, input.aiProposalId))
    }
  })

  const auditActor = toAuditActor(input.actor)

  await audit({
    actor: auditActor,
    entityType: 'import_job',
    entityId: input.importJobId,
    action: 'import.confirmed',
    metadata: {
      roundId: input.round.id,
      usedAi: input.usedAi,
      aiProposalId: input.aiProposalId,
      recipients: outcome.createdRecipients,
      accountsCreated: outcome.createdAccounts,
      accountsReused: outcome.reusedAccounts,
      offers: outcome.createdOffers,
      blocked: outcome.blockedOffers,
      mapping: input.proposedColumns.map(
        (column) => `${column.sourceColumn} -> ${column.targetField}${column.wasCorrected ? ' (corrected)' : ''}`,
      ),
    },
  })

  // One entry per record, so a mis-import can be traced to the row it came
  // from. Deliberately no name, address or amount — the record itself holds
  // those and the audit log does not need a second copy.
  for (const entry of created) {
    await audit({
      actor: auditActor,
      entityType: 'offer',
      entityId: entry.offerId,
      action: entry.row.blocked ? 'offer.created_blocked' : 'offer.created',
      metadata: {
        importJobId: input.importJobId,
        recipientId: entry.recipientId,
        sourceRow: entry.row.sourceRowNumber,
        jurisdiction: entry.row.jurisdiction,
        blockReason: entry.row.blockReason,
        indirectOverridden: entry.row.indirectOverridden,
      },
    })
  }

  return outcome
}

function describeTransform(mapping: ConfirmedMapping, sourceColumn: string): string | null {
  const answer = mapping.answers[sourceColumn]
  if (!answer) return null
  const parts: string[] = []
  if (answer.percentageInterpretation) parts.push(`percentage=${answer.percentageInterpretation}`)
  if (answer.decimalSeparator) parts.push(`decimal_separator=${answer.decimalSeparator}`)
  if (answer.dateOrder) parts.push(`date_order=${answer.dateOrder}`)
  return parts.length > 0 ? parts.join(' ') : null
}

export function toAuditActor(actor: PrivilegedActor): Actor {
  return { kind: 'user', id: actor.userId, label: `${actor.role} ${actor.email}` }
}

/** Recipients already imported into this round, for the review screen. */
export async function countExistingRecipients(roundId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recipients)
    .where(and(eq(recipients.roundId, roundId)))
  return row?.count ?? 0
}
