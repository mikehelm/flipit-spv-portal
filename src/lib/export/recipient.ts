import * as XLSX from 'xlsx'
import { z } from 'zod'
import {
  encodeCsvRow,
  neutraliseSpreadsheetCell,
  serialiseStructuredCell,
} from './cells'
import {
  recipientExportRowSchema,
  type RecipientExportRow,
} from './schema'

export const RECIPIENT_EXPORT_HEADERS = [
  'Recipient name',
  'Recipient email',
  'Jurisdiction',
  'Round',
  'Offer ID',
  'Response deadline',
  'Currency',
  'SPV percentage',
  'Indirect Flipit percentage',
  'Proposed amount',
  'Committed amount',
  'Accepted amount',
  'Received amount',
  'Payment reference',
  'Send status',
  'Invitation sent at',
  'Last send at',
  'Account status',
  'Account created at',
  'Account status history',
  'Timeline stage',
  'Timeline stage changed at',
  'Timeline history',
  'Response status',
  'Response at',
  'Response history',
  'Investor questions',
  'Admin replies',
  'Updated contact email',
  'Internal notes',
] as const

function nullable(value: string | null): string {
  return value ?? ''
}

function flattenRecipientRow(input: RecipientExportRow): string[] {
  const row = recipientExportRowSchema.parse(input)
  return [
    row.recipientName,
    row.recipientEmail,
    row.jurisdiction,
    row.roundName,
    row.offerId,
    row.responseDeadline,
    row.currency,
    row.spvPercentage,
    row.indirectFlipitPercentage,
    row.proposedAmount,
    nullable(row.committedAmount),
    nullable(row.acceptedAmount),
    nullable(row.receivedAmount),
    nullable(row.paymentReference),
    row.sendStatus,
    nullable(row.invitationSentAt),
    nullable(row.lastSendAt),
    row.accountStatus,
    nullable(row.accountCreatedAt),
    serialiseStructuredCell(row.accountStatusHistory),
    row.timelineStage,
    nullable(row.timelineStageChangedAt),
    serialiseStructuredCell(row.timelineHistory),
    row.responseStatus,
    nullable(row.responseAt),
    serialiseStructuredCell(row.responseHistory),
    serialiseStructuredCell(row.investorQuestions),
    serialiseStructuredCell(row.adminReplies),
    nullable(row.updatedContactEmail),
    nullable(row.internalNotes),
  ]
}

function parseRows(input: readonly RecipientExportRow[]): RecipientExportRow[] {
  return z.array(recipientExportRowSchema).parse(input)
}

export function exportRecipientsCsv(
  input: readonly RecipientExportRow[],
): Buffer {
  const rows = parseRows(input)
  const csv = [
    encodeCsvRow(RECIPIENT_EXPORT_HEADERS),
    ...rows.map((row) => encodeCsvRow(flattenRecipientRow(row))),
  ].join('\r\n')
  return Buffer.from(`\uFEFF${csv}\r\n`, 'utf8')
}

export function exportRecipientsXlsx(
  input: readonly RecipientExportRow[],
): Buffer {
  const rows = parseRows(input)
  const table = [
    [...RECIPIENT_EXPORT_HEADERS],
    ...rows.map((row) =>
      flattenRecipientRow(row).map(neutraliseSpreadsheetCell),
    ),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(table, { cellDates: false })

  for (const cellAddress of Object.keys(sheet)) {
    if (cellAddress.startsWith('!')) continue
    const cell = sheet[cellAddress]
    cell.t = 's'
    cell.z = '@'
    delete cell.f
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Recipients')
  const output = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true,
    cellDates: false,
  })
  return Buffer.isBuffer(output) ? output : Buffer.from(output)
}
