/**
 * Database-backed verification of WP17. BUILD_SPEC §20, §16, §7.
 *
 *   pnpm tsx scripts/verify-export.ts
 */

import 'dotenv/config'
import { eq, isNull, like } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { db } from '@/db'
import {
  fundsReceipts,
  investorAccounts,
  offerStatusEvents,
  offers,
  recipients,
  rounds,
  serviceConfig,
  users,
} from '@/db/schema'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import {
  exportAuditLogCsv,
  exportRecipientsCsv,
  exportRecipientsXlsx,
} from '@/lib/export'
import {
  auditFilterOptions,
  loadAuditRows,
  loadRecipientExportRows,
  recordExport,
} from '@/lib/export/data'
import { everyOf } from '@/lib/verify/vacuous'

const PREFIX = 'wp17-verify'
let actor: { kind: 'user'; id: string; label: string }

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function cleanup(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    const rows = await db
      .select({ id: offers.id, recipientId: offers.recipientId })
      .from(offers)
      .where(eq(offers.accountId, account.id))

    for (const row of rows) {
      await db.delete(fundsReceipts).where(eq(fundsReceipts.offerId, row.id))
      await db.delete(offerStatusEvents).where(eq(offerStatusEvents.offerId, row.id))
    }
    await db.delete(offers).where(eq(offers.accountId, account.id))
    for (const row of rows) {
      if (row.recipientId) {
        await db.delete(recipients).where(eq(recipients.id, row.recipientId))
      }
    }
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }
  await db.delete(recipients).where(like(recipients.email, `${PREFIX}%`))
}

async function main(): Promise<void> {
  await cleanup()

  const round = await db.query.rounds.findFirst({ where: isNull(rounds.closedAt) })
  if (!round) throw new Error('No open round. Run `pnpm db:seed` first.')

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) throw new Error('No operator user. Run `pnpm db:seed` first.')
  actor = { kind: 'user', id: operator.id, label: operator.email }

  const [account] = await db
    .insert(investorAccounts)
    .values({ email: `${PREFIX}-jane@example.test`, name: 'Jane Export', status: 'ACTIVE' })
    .returning()

  const [recipient] = await db
    .insert(recipients)
    .values({
      roundId: round.id,
      name: 'Jane Export',
      email: `${PREFIX}-jane@example.test`,
      jurisdiction: 'GB',
      internalNotes: 'Introduced by Michael.',
    })
    .returning()

  const [offer] = await db
    .insert(offers)
    .values({
      roundId: round.id,
      accountId: account!.id,
      recipientId: recipient!.id,
      proposedAmountUsd: '5000.00',
      committedAmountUsd: '4800.00',
      acceptedAmountUsd: '4750.00',
      receivedAmountUsd: '4750.00',
      spvPercentage: '16.666667',
      indirectPercentage: '5.000000',
      responseDeadline: '2026-12-31',
      emailStatus: 'SENT',
      responseChoice: 'INTERESTED',
      responseAt: new Date('2026-07-20T10:00:00Z'),
      stage: 'FUNDS_RECEIVED',
    })
    .returning()

  await db.insert(offerStatusEvents).values({
    offerId: offer!.id,
    fromStage: 'INVITATION_SENT',
    toStage: 'RESPONSE_RECORDED',
    isCorrection: false,
  })
  await db.insert(offerStatusEvents).values({
    offerId: offer!.id,
    fromStage: 'RESPONSE_RECORDED',
    toStage: 'FUNDS_RECEIVED',
    isCorrection: true,
    reason: 'Recorded out of order after the bank confirmed.',
  })

  await db.insert(fundsReceipts).values({
    offerId: offer!.id,
    amount: '4750.00',
    currency: 'USD',
    valueDate: '2026-07-22',
    reference: 'FLIPIT-0042',
  })

  console.log('\nThe recipient export (§20)')

  const rows = await loadRecipientExportRows(round.id)
  const row = rows.find((item) => item.offerId === offer!.id)
  check('the recipient is in the export', row !== undefined)
  if (!row) throw new Error('missing row')

  check('all four amounts are present and distinct', [
    row.proposedAmount === '5000.00',
    row.committedAmount === '4800.00',
    row.acceptedAmount === '4750.00',
    row.receivedAmount === '4750.00',
  ].every(Boolean))

  check(
    'every amount is an exact decimal string, never a number',
    everyOf(
      [row.proposedAmount, row.committedAmount, row.acceptedAmount, row.receivedAmount],
      (value) => typeof value === 'string' && /^\d+\.\d{2}$/.test(value),
    ),
  )

  check('the jurisdiction is carried', row.jurisdiction === 'GB')
  check('the payment reference is carried', row.paymentReference === 'FLIPIT-0042')
  check('the internal notes are carried', row.internalNotes === 'Introduced by Michael.')
  check('the timeline history has both events', row.timelineHistory.length === 2)
  check(
    'and the correction carries its reason',
    row.timelineHistory.some((event) => (event.reason ?? '').includes('out of order')),
  )
  check('the response history is present', row.responseHistory.length === 1)

  const csv = exportRecipientsCsv(rows)
  const csvText = csv.toString('utf8')
  check('the CSV builds', csv.length > 100)
  check('it opens as UTF-8 with a byte-order mark, for Excel', csvText.startsWith('﻿'))
  check('it carries the four amount columns', [
    'Proposed amount',
    'Committed amount',
    'Accepted amount',
    'Received amount',
  ].every((header) => csvText.includes(header)))
  check('and the values, unrounded', csvText.includes('5000.00') && csvText.includes('4800.00'))

  const xlsx = exportRecipientsXlsx(rows)
  check('the XLSX builds', xlsx.length > 1000)

  const workbook = XLSX.read(xlsx, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]!
  const parsed = XLSX.utils.sheet_to_json<Record<string, string>>(sheet)
  const parsedRow = parsed.find((item) => item['Offer ID'] === offer!.id)
  check('it opens as a real workbook', parsedRow !== undefined)
  check(
    'with the decimals intact and not reformatted',
    parsedRow?.['Proposed amount'] === '5000.00',
    String(parsedRow?.['Proposed amount']),
  )

  console.log('\nSpreadsheet-injection safety')

  await db
    .update(recipients)
    .set({ internalNotes: '=1+1' })
    .where(eq(recipients.id, recipient!.id))

  const dangerous = await loadRecipientExportRows(round.id)
  const dangerousXlsx = exportRecipientsXlsx(dangerous)
  const dangerousSheet = XLSX.read(dangerousXlsx, { type: 'buffer' })
  const cells = XLSX.utils.sheet_to_json<Record<string, string>>(
    dangerousSheet.Sheets[dangerousSheet.SheetNames[0]!]!,
  )
  const note = cells.find((item) => item['Offer ID'] === offer!.id)?.['Internal notes'] ?? ''
  check(
    'a cell beginning with = is neutralised rather than left as a formula',
    note !== '=1+1',
    note,
  )

  await db
    .update(recipients)
    .set({ internalNotes: 'Introduced by Michael.' })
    .where(eq(recipients.id, recipient!.id))

  console.log('\nThe audit log (§16, §20)')

  const before = await db.query.serviceConfig.findFirst({
    where: eq(serviceConfig.id, SERVICE_CONFIG_ID),
  })

  await recordExport({
    kind: 'RECIPIENTS',
    format: 'CSV',
    rows: rows.length,
    bytes: csv.length,
    actor,
  })

  const after = await db.query.serviceConfig.findFirst({
    where: eq(serviceConfig.id, SERVICE_CONFIG_ID),
  })
  check(
    'a completed recipient export stamps last_export_at, which §7 reads',
    after?.lastExportAt !== null &&
      after?.lastExportAt?.getTime() !== before?.lastExportAt?.getTime(),
  )

  const auditRows = await loadAuditRows({ action: 'export.completed', limit: 5 })
  check('the export itself is audited', auditRows.length > 0)
  check(
    'and the entry carries counts rather than rows',
    JSON.stringify(auditRows[0]?.metadata ?? {}).includes('"rows"') &&
      !JSON.stringify(auditRows[0]?.metadata ?? {}).includes('@example.test'),
  )

  const options = await auditFilterOptions()
  check('the viewer can offer actors to filter by', options.actors.length > 0)
  check('and entity types', options.entityTypes.includes('export'))
  check('and actions', options.actions.includes('export.completed'))

  const filtered = await loadAuditRows({ entityType: 'export', limit: 50 })
  check(
    'filtering by entity returns only that entity',
    everyOf(filtered, (item) => item.entityType === 'export'),
  )

  const auditCsv = exportAuditLogCsv({
    requestedByRole: 'OWNER',
    rows: auditRows.map((item) => ({
      id: item.id,
      actorLabel: item.actorLabel,
      actorUserId: item.actorUserId,
      actorAccountId: item.actorAccountId,
      entityType: item.entityType,
      entityId: item.entityId,
      action: item.action,
      metadata: item.metadata ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
  })
  check('the audit CSV builds', auditCsv.length > 100)
  check('and names the action', auditCsv.toString('utf8').includes('export.completed'))

  let refused = false
  try {
    exportAuditLogCsv({
      // The formatter's schema requires the literal 'OWNER'. Two locks on the
      // same door: the route guard, and this.
      requestedByRole: 'OPERATOR' as unknown as 'OWNER',
      rows: [],
    })
  } catch {
    refused = true
  }
  check('the audit formatter refuses a non-owner request outright', refused)

  console.log('\nNothing in the log is a secret')

  const everything = await loadAuditRows({ limit: 2000 })

  /**
   * Keys, not values. `assertNoSecrets` refuses a *key* named `password` at
   * write time (lib/audit.ts), and a sign-in legitimately records
   * `{ method: 'password' }` — the authentication method, which is the sort of
   * thing an audit log exists to record. Matching the serialised JSON without
   * anchoring to a key position flagged that as a leaked credential, which is
   * both wrong and the kind of false alarm that gets a real check switched off.
   *
   * The trailing `\s*:` is the whole fix: it only matches where the string is
   * a property name.
   */
  const offendingKeys: string[] = []
  for (const item of everything) {
    if (!item.metadata || typeof item.metadata !== 'object') continue
    for (const key of Object.keys(item.metadata as Record<string, unknown>)) {
      if (/(password|secret|token|apikey|api_key|credential|htmlbody|textbody|body)/i.test(key)) {
        offendingKeys.push(`${item.action}.${key}`)
      }
    }
  }

  check(
    'no metadata key looks like a credential or a body',
    offendingKeys.length === 0,
    offendingKeys.slice(0, 5).join(', '),
  )

  await cleanup()

  const orphans = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))
  check('verification data is removed', orphans.length === 0)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
