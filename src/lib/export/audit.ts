import * as XLSX from 'xlsx'
import { encodeCsvRow, neutraliseSpreadsheetCell, serialiseStructuredCell } from './cells'
import {
  ownerAuditExportRequestSchema,
  type OwnerAuditExportRequest,
} from './schema'

export const AUDIT_EXPORT_HEADERS = [
  'Event ID',
  'Actor',
  'Actor user ID',
  'Actor account ID',
  'Entity type',
  'Entity ID',
  'Action',
  'Metadata',
  'Created at',
] as const

function flattenAuditRows(input: OwnerAuditExportRequest): string[][] {
  const request = ownerAuditExportRequestSchema.parse(input)
  return request.rows.map((row) => [
    row.id,
    row.actorLabel,
    row.actorUserId ?? '',
    row.actorAccountId ?? '',
    row.entityType,
    row.entityId ?? '',
    row.action,
    serialiseStructuredCell(row.metadata),
    row.createdAt,
  ])
}

export function exportAuditLogCsv(input: OwnerAuditExportRequest): Buffer {
  const rows = flattenAuditRows(input)
  const csv = [
    encodeCsvRow(AUDIT_EXPORT_HEADERS),
    ...rows.map(encodeCsvRow),
  ].join('\r\n')
  return Buffer.from(`\uFEFF${csv}\r\n`, 'utf8')
}

export function exportAuditLogXlsx(input: OwnerAuditExportRequest): Buffer {
  const rows = flattenAuditRows(input)
  const sheet = XLSX.utils.aoa_to_sheet([
    [...AUDIT_EXPORT_HEADERS],
    ...rows.map((row) => row.map(neutraliseSpreadsheetCell)),
  ])

  for (const cellAddress of Object.keys(sheet)) {
    if (cellAddress.startsWith('!')) continue
    const cell = sheet[cellAddress]
    cell.t = 's'
    cell.z = '@'
    delete cell.f
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Audit log')
  const output = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true,
    cellDates: false,
  })
  return Buffer.isBuffer(output) ? output : Buffer.from(output)
}
