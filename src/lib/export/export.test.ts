import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  AUDIT_EXPORT_HEADERS,
  exportAuditLogCsv,
  exportRecipientsCsv,
  exportRecipientsXlsx,
  RECIPIENT_EXPORT_HEADERS,
  type RecipientExportRow,
} from '.'

const row: RecipientExportRow = {
  recipientName: '=HYPERLINK("https://attacker.invalid")',
  recipientEmail: 'alex@example.com',
  jurisdiction: 'AU',
  roundName: 'Flipit Global SPV 2026',
  offerId: '00000000000000000042',
  responseDeadline: '2026-08-31',
  currency: 'USD',
  spvPercentage: '4.166800',
  indirectFlipitPercentage: '1.250040',
  proposedAmount: '9007199254740993.01',
  committedAmount: '9007199254740993.02',
  acceptedAmount: '9007199254740993.03',
  receivedAmount: '9007199254740993.04',
  paymentReference: '000042',
  sendStatus: 'SENT',
  invitationSentAt: '2026-08-01T01:02:03.000Z',
  lastSendAt: '2026-08-01T01:02:03.000Z',
  accountStatus: 'ACTIVE',
  accountCreatedAt: '2026-08-01T01:00:00.000Z',
  accountStatusHistory: [
    { status: 'ACTIVE', at: '2026-08-01T01:03:00.000Z' },
  ],
  timelineStage: 'FUNDS_RECEIVED',
  timelineStageChangedAt: '2026-08-05T04:00:00.000Z',
  timelineHistory: [
    { status: 'FUNDS_RECEIVED', at: '2026-08-05T04:00:00.000Z' },
  ],
  responseStatus: 'INTERESTED',
  responseAt: '2026-08-02T02:00:00.000Z',
  responseHistory: [
    { status: 'INTERESTED', at: '2026-08-02T02:00:00.000Z' },
  ],
  investorQuestions: [
    { body: 'When are documents issued?', at: '2026-08-02T03:00:00.000Z' },
  ],
  adminReplies: [
    { body: 'After acceptance.', at: '2026-08-02T04:00:00.000Z' },
  ],
  updatedContactEmail: 'alex.new@example.com',
  internalNotes: '@private review note',
}

function readRecipientSheet(buffer: Buffer): XLSX.WorkSheet {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellFormula: false })
  return workbook.Sheets[workbook.SheetNames[0]]
}

describe('recipient exports', () => {
  it('keeps every amount in a separate exact text cell through XLSX round trip', () => {
    const sheet = readRecipientSheet(exportRecipientsXlsx([row]))
    const table = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: true,
      defval: '',
    })
    const header = table[0]
    const values = table[1]

    expect(values[header.indexOf('Proposed amount')]).toBe('9007199254740993.01')
    expect(values[header.indexOf('Committed amount')]).toBe('9007199254740993.02')
    expect(values[header.indexOf('Accepted amount')]).toBe('9007199254740993.03')
    expect(values[header.indexOf('Received amount')]).toBe('9007199254740993.04')
    expect(sheet[`J2`].t).toBe('s')
  })

  it('neutralises formula prefixes and preserves long references as text', () => {
    const sheet = readRecipientSheet(exportRecipientsXlsx([row]))

    expect(sheet.A2.v).toBe(`'=HYPERLINK("https://attacker.invalid")`)
    expect(sheet.A2.f).toBeUndefined()
    expect(sheet.N2.v).toBe('000042')
    expect(sheet.N2.t).toBe('s')

    const csv = exportRecipientsCsv([row]).toString('utf8')
    expect(csv).toContain(`\"'=HYPERLINK(\"\"https://attacker.invalid\"\")\"`)
    expect(csv).toContain(`\"'@private review note\"`)
  })

  it('produces valid CSV and XLSX files with headers for an empty result', () => {
    const csv = exportRecipientsCsv([]).toString('utf8')
    expect(csv).toContain('"Recipient name"')

    const sheet = readRecipientSheet(exportRecipientsXlsx([]))
    const table = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
    expect(table).toHaveLength(1)
    expect(table[0]).toEqual([...RECIPIENT_EXPORT_HEADERS])
  })
})

describe('owner-only audit export', () => {
  it('is separate and rejects an operator at the Zod boundary', () => {
    expect(() =>
      exportAuditLogCsv({
        // @ts-expect-error — proving the runtime boundary does not trust types.
        requestedByRole: 'OPERATOR',
        rows: [],
      }),
    ).toThrow()

    const csv = exportAuditLogCsv({
      requestedByRole: 'OWNER',
      rows: [],
    }).toString('utf8')
    expect(csv).toContain(`"${AUDIT_EXPORT_HEADERS[0]}"`)
    expect(csv).not.toContain('"Recipient name"')
  })
})
