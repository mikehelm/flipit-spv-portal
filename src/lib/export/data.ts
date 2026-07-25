/**
 * Loading what the export formats. BUILD_SPEC §20, §16.
 *
 * The formatting modules (`recipient.ts`, `audit.ts`) were built early and are
 * complete; nothing fed them. This is the layer that does, and it is the only
 * place in the export path that touches the database.
 *
 * Money and percentages come out of the driver as strings and are handed to the
 * export schema as strings. Nothing here parses, rounds or reformats a figure —
 * §20 says the export must show all four amounts, and it shows exactly what is
 * recorded.
 */

import { asc, desc, eq, gte, inArray, lte, and, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import {
  auditEvents,
  emailSnapshots,
  fundsReceipts,
  investorAccounts,
  accountStatusEvents,
  offerStatusEvents,
  offers,
  qaEntries,
  qaThreadMessages,
  recipients,
  rounds,
  sendEvents,
  serviceConfig,
} from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import type { RecipientExportRow } from './schema'

const iso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null

/**
 * Every recipient in a round, in export shape.
 *
 * §20 lists thirteen things and every one of them is here. The three history
 * arrays come from the append-only event tables rather than from the current
 * columns, so the export carries what happened rather than only where things
 * ended up.
 */
export async function loadRecipientExportRows(
  roundId: string,
): Promise<RecipientExportRow[]> {
  const rows = await db
    .select({
      offer: offers,
      account: investorAccounts,
      roundName: rounds.name,
      jurisdiction: recipients.jurisdiction,
      internalNotes: recipients.internalNotes,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .innerJoin(rounds, eq(offers.roundId, rounds.id))
    .leftJoin(recipients, eq(offers.recipientId, recipients.id))
    .where(eq(offers.roundId, roundId))
    .orderBy(asc(investorAccounts.name))

  const out: RecipientExportRow[] = []

  for (const row of rows) {
    const stageEvents = await db
      .select()
      .from(offerStatusEvents)
      .where(eq(offerStatusEvents.offerId, row.offer.id))
      .orderBy(asc(offerStatusEvents.createdAt))

    const accountEvents = await db
      .select()
      .from(accountStatusEvents)
      .where(eq(accountStatusEvents.accountId, row.account.id))
      .orderBy(asc(accountStatusEvents.createdAt))

    const sends = await db
      .select()
      .from(sendEvents)
      .where(eq(sendEvents.offerId, row.offer.id))
      .orderBy(asc(sendEvents.createdAt))

    const firstSnapshot = await db.query.emailSnapshots.findFirst({
      where: eq(emailSnapshots.offerId, row.offer.id),
      orderBy: asc(emailSnapshots.createdAt),
    })

    const receipt = await db.query.fundsReceipts.findFirst({
      where: eq(fundsReceipts.offerId, row.offer.id),
    })

    const entries = await db
      .select()
      .from(qaEntries)
      .where(eq(qaEntries.askedByAccountId, row.account.id))
      .orderBy(asc(qaEntries.createdAt))

    const investorQuestions: Array<{ body: string; at: string }> = []
    const adminReplies: Array<{ body: string; at: string }> = []

    for (const entry of entries) {
      const messages = await db
        .select()
        .from(qaThreadMessages)
        .where(eq(qaThreadMessages.entryId, entry.id))
        .orderBy(asc(qaThreadMessages.createdAt))

      for (const message of messages) {
        const item = { body: message.body, at: message.createdAt.toISOString() }
        if (message.direction === 'FROM_INVESTOR') investorQuestions.push(item)
        else adminReplies.push(item)
      }
    }

    const succeeded = sends.filter((event) => event.outcome === 'SUCCEEDED')

    out.push({
      recipientName: row.account.name,
      recipientEmail: row.account.email,
      // A recipient row is required for the gate, so a missing one is a data
      // problem — but the export must not lose the whole file over it. `ZZ` is
      // the ISO "user-assigned" code and reads as clearly wrong in a
      // spreadsheet, which is what somebody should see.
      jurisdiction: row.jurisdiction ?? 'ZZ',
      roundName: row.roundName,
      offerId: row.offer.id,
      responseDeadline: row.offer.responseDeadline,
      currency: receipt?.currency?.toUpperCase() ?? 'USD',
      spvPercentage: row.offer.spvPercentage,
      indirectFlipitPercentage: row.offer.indirectPercentage,
      proposedAmount: row.offer.proposedAmountUsd,
      committedAmount: row.offer.committedAmountUsd,
      acceptedAmount: row.offer.acceptedAmountUsd,
      receivedAmount: row.offer.receivedAmountUsd,
      paymentReference: receipt?.reference ?? null,
      sendStatus: row.offer.emailStatus,
      invitationSentAt: iso(succeeded[0]?.createdAt ?? firstSnapshot?.createdAt ?? null),
      lastSendAt: iso(sends[sends.length - 1]?.createdAt ?? null),
      accountStatus: row.account.status,
      accountCreatedAt: iso(row.account.createdAt),
      accountStatusHistory: accountEvents.map((event) => ({
        status: event.toStatus,
        at: event.createdAt.toISOString(),
        reason: event.reason ?? null,
      })),
      timelineStage: row.offer.stage,
      timelineStageChangedAt: iso(
        stageEvents[stageEvents.length - 1]?.createdAt ?? null,
      ),
      timelineHistory: stageEvents.map((event) => ({
        status: event.toStage,
        at: event.createdAt.toISOString(),
        reason: event.isCorrection ? (event.reason ?? 'correction') : (event.reason ?? null),
      })),
      responseStatus: row.offer.responseChoice,
      responseAt: iso(row.offer.responseAt),
      responseHistory: row.offer.responseAt
        ? [
            {
              status: row.offer.responseChoice,
              at: row.offer.responseAt.toISOString(),
              reason: row.offer.responseNote ?? null,
            },
          ]
        : [],
      investorQuestions,
      adminReplies,
      updatedContactEmail: null,
      internalNotes: row.internalNotes ?? null,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// The audit log — §16, owner only
// ---------------------------------------------------------------------------

export interface AuditFilter {
  actor?: string | null
  entityType?: string | null
  action?: string | null
  from?: string | null
  to?: string | null
  limit?: number
}

export interface AuditRow {
  id: string
  actorLabel: string
  actorUserId: string | null
  actorAccountId: string | null
  entityType: string
  entityId: string | null
  action: string
  metadata: unknown
  createdAt: Date
}

/**
 * The log, filtered. §16: "visible to the owner", filterable by actor, entity
 * and action.
 *
 * Read-only by construction — there is no update or delete anywhere in the
 * export path, and `lib/audit.ts` deliberately provides neither.
 */
export async function loadAuditRows(filter: AuditFilter = {}): Promise<AuditRow[]> {
  const conditions: SQL[] = []

  if (filter.actor) conditions.push(eq(auditEvents.actorLabel, filter.actor))
  if (filter.entityType) conditions.push(eq(auditEvents.entityType, filter.entityType))
  if (filter.action) conditions.push(eq(auditEvents.action, filter.action))
  if (filter.from) conditions.push(gte(auditEvents.createdAt, new Date(`${filter.from}T00:00:00Z`)))
  if (filter.to) conditions.push(lte(auditEvents.createdAt, new Date(`${filter.to}T23:59:59Z`)))

  const rows = await db
    .select()
    .from(auditEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.createdAt))
    .limit(filter.limit ?? 500)

  return rows.map((row) => ({
    id: row.id,
    actorLabel: row.actorLabel,
    actorUserId: row.actorUserId,
    actorAccountId: row.actorAccountId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    metadata: row.metadata,
    createdAt: row.createdAt,
  }))
}

/** The distinct values a filter can take, for the viewer's dropdowns. */
export async function auditFilterOptions(): Promise<{
  actors: string[]
  entityTypes: string[]
  actions: string[]
}> {
  const rows = await db
    .select({
      actorLabel: auditEvents.actorLabel,
      entityType: auditEvents.entityType,
      action: auditEvents.action,
    })
    .from(auditEvents)
    .limit(20000)

  const unique = (values: string[]) => [...new Set(values)].sort()

  return {
    actors: unique(rows.map((row) => row.actorLabel)),
    entityTypes: unique(rows.map((row) => row.entityType)),
    actions: unique(rows.map((row) => row.action)),
  }
}

// ---------------------------------------------------------------------------
// Recording that an export happened — §7
// ---------------------------------------------------------------------------

/**
 * §7 makes moving to `disabled` conditional on "a completed export within the
 * preceding 7 days", and that precondition reads `service_config.last_export_at`.
 * This is the one place that column is written, and it is written only after
 * the bytes have actually been produced — an export that failed halfway is not
 * a completed export and must not satisfy the gate.
 */
export async function recordExport(input: {
  kind: 'RECIPIENTS' | 'AUDIT'
  format: 'CSV' | 'XLSX'
  rows: number
  bytes: number
  actor: Actor
  now?: Date
}): Promise<void> {
  const now = input.now ?? new Date()

  if (input.kind === 'RECIPIENTS') {
    await db
      .update(serviceConfig)
      .set({ lastExportAt: now })
      .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))
  }

  await audit({
    actor: input.actor,
    entityType: 'export',
    entityId: null,
    action: 'export.completed',
    // Counts and a size. Never a row, never an address, never a figure.
    metadata: { kind: input.kind, format: input.format, rows: input.rows, bytes: input.bytes },
  })
}

/** Rounds available to export, newest first. */
export async function exportableRounds() {
  return db
    .select({ id: rounds.id, name: rounds.name, closedAt: rounds.closedAt })
    .from(rounds)
    .orderBy(desc(rounds.createdAt))
}

/** Whether these ids are real rounds. Used before an export runs. */
export async function roundExists(roundId: string): Promise<boolean> {
  const rows = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(inArray(rounds.id, [roundId]))
    .limit(1)
  return rows.length > 0
}
