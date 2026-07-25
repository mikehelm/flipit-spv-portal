import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditInput } from '@/lib/audit'
import type { ServiceConfigRow } from '@/lib/auth/service-config'
import { decrypt } from '@/lib/crypto'
import { portalAccess, type ServiceMode } from '@/lib/portal/access'
import {
  AUDIT_EXPORT_HEADERS,
  RECIPIENT_EXPORT_HEADERS,
  exportAuditLogCsv,
  exportAuditLogXlsx,
  exportRecipientsCsv,
  exportRecipientsXlsx,
  recipientExportRowSchema,
  type OwnerAuditExportRequest,
  type RecipientExportRow,
} from '.'

/**
 * The half of §22 AC25 that encryption at rest does not cover — "never
 * displayed after saving, never logged, and never exported" — and the half of
 * AC14 that the service-mode table does not cover: "the owner retains access
 * and export throughout".
 *
 * `crypto.test.ts` proves the key is encrypted going in. Nothing proved it
 * cannot come back out, and every way it could is boring: a column added to an
 * export, a server component rendering the stored value instead of a boolean, a
 * `console.log` in a route, a whole config object handed to `audit`. Each is
 * checked below — at the source where the mistake would be made, and against
 * the real functions where the behaviour is the thing.
 *
 * The service-mode half is deliberately an absence proof. The export path never
 * reads `service_mode`, so there is nothing to assert about it mode by mode.
 * What can be asserted is that neither route consults it, and that the one gate
 * §7 puts anywhere near an export sits on *entering* `disabled` rather than on
 * exporting — with the override logged, exactly as §7 words it.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A plausible key: long enough, and prefixed as the settings schema insists. */
const OPENAI_KEY = 'sk-proj-000000000000000000000000000000000000ABCD'
/** Sixteen characters, the shape Google issues an app password in. */
const APP_PASSWORD = 'abcdefghijklmnop'

const DAY = 24 * 60 * 60 * 1000

const recipientRow: RecipientExportRow = {
  recipientName: 'Alex Investor',
  recipientEmail: 'alex@example.com',
  jurisdiction: 'AU',
  roundName: 'Flipit Global SPV 2026',
  offerId: 'offer-1',
  responseDeadline: '2026-08-31',
  currency: 'USD',
  spvPercentage: '4.166800',
  indirectFlipitPercentage: '1.250040',
  proposedAmount: '1250.00',
  committedAmount: null,
  acceptedAmount: null,
  receivedAmount: null,
  paymentReference: null,
  sendStatus: 'SENT',
  invitationSentAt: '2026-08-01T01:02:03.000Z',
  lastSendAt: '2026-08-01T01:02:03.000Z',
  accountStatus: 'ACTIVE',
  accountCreatedAt: '2026-08-01T01:00:00.000Z',
  accountStatusHistory: [],
  timelineStage: 'INVITED',
  timelineStageChangedAt: null,
  timelineHistory: [],
  responseStatus: 'NONE',
  responseAt: null,
  responseHistory: [],
  investorQuestions: [],
  adminReplies: [],
  updatedContactEmail: null,
  internalNotes: null,
}

type AuditExportRow = OwnerAuditExportRequest['rows'][number]

const auditRow: AuditExportRow = {
  id: 'event-1',
  actorLabel: 'mike@flipit.com',
  actorUserId: 'user-owner',
  actorAccountId: null,
  entityType: 'export',
  entityId: null,
  action: 'export.completed',
  metadata: { kind: 'RECIPIENTS', format: 'CSV', rows: 12, bytes: 4096 },
  createdAt: '2026-08-01T01:02:03.000Z',
}

// ---------------------------------------------------------------------------
// Mocks. The settings actions run for real; everything beneath them does not.
// Every factory defers its outer reference, and the actions are imported
// lazily through `settingsActions()`.
// ---------------------------------------------------------------------------

const requireOwnerMock = vi.fn<() => Promise<{ id: string; email: string }>>()
const auditSpy = vi.fn<(input: AuditInput) => void>()
const writtenValues = vi.fn<(values: Record<string, unknown>) => void>()
const serviceConfigRow = vi.fn<() => ServiceConfigRow>()

vi.mock('@/lib/auth/guards', () => ({
  requireOwner: () => requireOwnerMock(),
}))

vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>()
  return {
    ...actual,
    audit: (input: AuditInput) => {
      // The real guard stays in the path, so a careless metadata key fails
      // here rather than in production.
      actual.assertNoSecrets(input.metadata)
      auditSpy(input)
      return Promise.resolve()
    },
  }
})

vi.mock('@/lib/auth/service-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/service-config')>()
  return { ...actual, readServiceConfig: () => Promise.resolve(serviceConfigRow()) }
})

vi.mock('@/db', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        writtenValues(values)
        return { where: () => Promise.resolve() }
      },
    }),
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

async function settingsActions() {
  return import('@/actions/settings')
}

const OWNER = { id: 'user-owner', email: 'mike@flipit.com' }

function configRow(overrides: Partial<ServiceConfigRow> = {}): ServiceConfigRow {
  return {
    id: 'singleton',
    serviceMode: 'ACTIVE',
    sunsetClosingDate: null,
    serviceContactEmail: 'records@flipit.com',
    closedAccountAccess: 'READ_ONLY',
    decimalPlaces: 3,
    approvedJurisdictions: ['AU', 'GB'],
    aggregateRaiseUsd: '30000',
    defaultSenderName: 'David Serene',
    defaultSenderEmail: 'david@flipit.com',
    defaultSenderPhone: '+61400000000',
    qaVisibleDuringRaise: true,
    emailTransport: 'SMTP',
    smtpUserEncrypted: 'v1.aaaa.bbbb.cccc',
    smtpPasswordEncrypted: 'v1.dddd.eeee.ffff',
    smtpLastVerifiedAt: null,
    smtpLastVerifyResult: null,
    openAiKeyEncrypted: null,
    openAiModel: 'gpt-4o-mini',
    aiMonthlyCapUsd: '20',
    aiHeadersOnly: false,
    attributionOnAdmin: true,
    attributionOnPortal: true,
    attributionUrl: null,
    lastExportAt: null,
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  }
}

function aiForm(key: string): FormData {
  const form = new FormData()
  form.set('openAiModel', 'gpt-4o-mini')
  form.set('aiMonthlyCapUsd', '20.00')
  form.set('aiHeadersOnly', 'on')
  form.set('openAiKey', key)
  return form
}

function serviceForm(fields: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('serviceMode', 'DISABLED')
  form.set('closedAccountAccess', 'READ_ONLY')
  form.set('qaVisibleDuringRaise', 'on')
  form.set('decimalPlaces', '3')
  form.set('serviceContactEmail', 'records@flipit.com')
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  return form
}

beforeEach(() => {
  requireOwnerMock.mockReset()
  requireOwnerMock.mockResolvedValue(OWNER)
  auditSpy.mockReset()
  writtenValues.mockReset()
  serviceConfigRow.mockReset()
  serviceConfigRow.mockReturnValue(configRow())
})

// ---------------------------------------------------------------------------
// Source helpers, in the shape `qa/service.test.ts` established.
// ---------------------------------------------------------------------------

const EXPORT_DIR = join(process.cwd(), 'src/lib/export')
const ACCESS_MODULE = join(process.cwd(), 'src/lib/portal/access.ts')
const SETTINGS_ACTIONS = join(process.cwd(), 'src/actions/settings.ts')
const SETTINGS_PAGE = join(process.cwd(), 'src/app/(admin)/admin/settings/page.tsx')
const RECIPIENTS_ROUTE = join(process.cwd(), 'src/app/(admin)/export/recipients/route.ts')
const AUDIT_ROUTE = join(process.cwd(), 'src/app/(admin)/export/audit/route.ts')
const IMPORT_ACTIONS = join(process.cwd(), 'src/actions/import.ts')

/** Comments explain what the code avoids; they must not trip the check for it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function read(path: string): string {
  return withoutComments(readFileSync(path, 'utf8'))
}

function exportSources(): Array<{ name: string; source: string }> {
  return readdirSync(EXPORT_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, source: read(join(EXPORT_DIR, name)) }))
}

/** The export path as it actually runs: the modules plus the two routes. */
function exportPathSources(): Array<{ name: string; source: string }> {
  return [
    ...exportSources(),
    { name: 'export/recipients/route.ts', source: read(RECIPIENTS_ROUTE) },
    { name: 'export/audit/route.ts', source: read(AUDIT_ROUTE) },
  ]
}

function exportAndSettingsSources(): Array<{ name: string; source: string }> {
  return [
    ...exportPathSources(),
    { name: 'actions/settings.ts', source: read(SETTINGS_ACTIONS) },
    { name: 'admin/settings/page.tsx', source: read(SETTINGS_PAGE) },
  ]
}

/** The columns the two credentials are stored encrypted under. */
const ENCRYPTED_COLUMNS = [
  'openAiKeyEncrypted',
  'smtpPasswordEncrypted',
  'smtpUserEncrypted',
  'open_ai_key_encrypted',
  'smtp_password_encrypted',
  'smtp_user_encrypted',
]

function recipientTable(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellFormula: false })
  return XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    raw: true,
    defval: '',
  })
}

// ---------------------------------------------------------------------------
// 1. No export column is a place a credential could sit (AC25, §20)
// ---------------------------------------------------------------------------

describe('no export column could carry a credential (AC25)', () => {
  const credentialWord = /password|passphrase|secret|token|api[\s_-]?key|credential|\bkey\b/i

  it('names no credential in any recipient or audit export header', () => {
    for (const header of [...RECIPIENT_EXPORT_HEADERS, ...AUDIT_EXPORT_HEADERS]) {
      expect(header, header).not.toMatch(credentialWord)
    }
  })

  it('names no credential in any field of the recipient export schema', () => {
    for (const field of Object.keys(recipientExportRowSchema.shape)) {
      expect(field, field).not.toMatch(credentialWord)
    }
  })

  it('never reads or decrypts an encrypted column anywhere in the export path', () => {
    for (const { name, source } of exportPathSources()) {
      for (const column of ENCRYPTED_COLUMNS) {
        expect(source, `${name} reads ${column}`).not.toContain(column)
      }
      expect(source, `${name} decrypts something`).not.toMatch(/\bdecrypt\s*\(/)
    }
  })

  it('strips a credential smuggled onto a recipient row at the schema boundary', () => {
    // The row builder reads the parsed object, never the caller's, so an extra
    // property is gone before a single cell is written.
    const smuggled = {
      ...recipientRow,
      openAiKeyEncrypted: OPENAI_KEY,
      smtpPassword: APP_PASSWORD,
    } as RecipientExportRow

    const csv = exportRecipientsCsv([smuggled]).toString('utf8')
    expect(csv).not.toContain(OPENAI_KEY)
    expect(csv).not.toContain(APP_PASSWORD)
    // Still a complete row, so the stripping is not silent damage.
    expect(csv).toContain('alex@example.com')

    const table = recipientTable(exportRecipientsXlsx([smuggled]))
    expect(table[0]).toEqual([...RECIPIENT_EXPORT_HEADERS])
    expect(table[1]).toHaveLength(RECIPIENT_EXPORT_HEADERS.length)
    expect(table[1].join('\u0000')).not.toContain(OPENAI_KEY)
    expect(table[1].join('\u0000')).not.toContain(APP_PASSWORD)
  })

  it('strips a credential smuggled onto an audit row at the schema boundary', () => {
    const smuggled = { ...auditRow, apiKey: OPENAI_KEY } as AuditExportRow
    const request: OwnerAuditExportRequest = { requestedByRole: 'OWNER', rows: [smuggled] }

    const csv = exportAuditLogCsv(request).toString('utf8')
    expect(csv).not.toContain(OPENAI_KEY)
    expect(csv).toContain('export.completed')

    const workbook = XLSX.read(exportAuditLogXlsx(request), { type: 'buffer', raw: true })
    const table = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: true,
      defval: '',
    })
    expect(table[0]).toEqual([...AUDIT_EXPORT_HEADERS])
    expect(table[1].join('\u0000')).not.toContain(OPENAI_KEY)
  })
})

// ---------------------------------------------------------------------------
// 2. The settings surface is write-only for the key (AC25)
// ---------------------------------------------------------------------------

describe('the openai key is write-only once saved (AC25)', () => {
  it('encrypts the key on the way in and hands back nothing containing it', async () => {
    const { updateAiSettingsAction } = await settingsActions()

    const result = await updateAiSettingsAction({ status: 'idle' }, aiForm(OPENAI_KEY))

    expect(result.status).toBe('ok')
    expect(JSON.stringify(result)).not.toContain(OPENAI_KEY)
    expect(JSON.stringify(result)).not.toContain('sk-')

    const written = writtenValues.mock.calls[0][0]
    expect(written.openAiKeyEncrypted).toEqual(expect.stringMatching(/^v1\./))
    expect(decrypt(String(written.openAiKeyEncrypted))).toBe(OPENAI_KEY)
  })

  it('records that the key changed without recording the key', async () => {
    const { updateAiSettingsAction } = await settingsActions()
    await updateAiSettingsAction({ status: 'idle' }, aiForm(OPENAI_KEY))

    expect(auditSpy).toHaveBeenCalledTimes(1)
    const entry = auditSpy.mock.calls[0][0]

    expect(entry.action).toBe('service_config.ai_settings_updated')
    expect(entry.metadata).toMatchObject({ openAiKeyReplaced: true })
    expect(JSON.stringify(entry.metadata)).not.toContain(OPENAI_KEY)
    expect(JSON.stringify(entry.metadata)).not.toContain('sk-')
  })

  it('leaves the stored key alone when the box comes back empty', async () => {
    const { updateAiSettingsAction } = await settingsActions()
    const result = await updateAiSettingsAction({ status: 'idle' }, aiForm(''))

    expect(result.status).toBe('ok')
    expect(writtenValues.mock.calls[0][0]).not.toHaveProperty('openAiKeyEncrypted')
    expect(auditSpy.mock.calls[0][0].metadata).toMatchObject({ openAiKeyReplaced: false })
  })

  it('removes the key without ever reading it back', async () => {
    const { removeOpenAiKeyAction } = await settingsActions()
    serviceConfigRow.mockReturnValue(configRow({ openAiKeyEncrypted: 'v1.gggg.hhhh.iiii' }))

    const result = await removeOpenAiKeyAction({ status: 'idle' }, new FormData())

    expect(result.status).toBe('ok')
    expect(writtenValues.mock.calls[0][0]).toEqual({ openAiKeyEncrypted: null })
    expect(auditSpy.mock.calls[0][0].action).toBe('service_config.ai_key_removed')
    expect(auditSpy.mock.calls[0][0].metadata).toBeUndefined()
  })

  it('never selects, decrypts or returns the stored key from the settings action', () => {
    const source = read(SETTINGS_ACTIONS)

    expect(source).not.toMatch(/\bdecrypt\b/)

    // Every appearance of the column is a write: an encrypt, or a null.
    const mentions = source.match(/openAiKeyEncrypted[^,\n]*/g) ?? []
    expect(mentions.length).toBeGreaterThan(0)
    for (const mention of mentions) {
      expect(mention).toMatch(/^openAiKeyEncrypted:\s*(encrypt\(|null)/)
    }

    // And the plaintext reaches neither a message nor audit metadata.
    const calls = source.match(/action(?:Ok|Error)\([\s\S]*?\)\n/g) ?? []
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call).not.toContain('openAiKey')
    }

    const blocks = source.match(/metadata:\s*\{[^}]*\}/g) ?? []
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block).not.toMatch(/:\s*(?:parsed\.data\.)?openAiKey\s*[,}]/)
    }
  })

  it('reads the stored key as a boolean only, on the one screen that shows it', () => {
    const page = read(SETTINGS_PAGE)

    // Every reference is `maskConfigured(...)` or a ternary test. None of them
    // puts the value itself into the tree.
    const reads = [...page.matchAll(/config\.openAiKeyEncrypted(.{0,3})/g)]
    expect(reads.length).toBeGreaterThan(0)
    for (const [match, tail] of reads) {
      expect(tail, match).toMatch(/^\)|^\s*\?/)
    }

    expect(page).not.toMatch(/(?:defaultValue|value)=\{[^}]*openAiKeyEncrypted/)
    expect(page).not.toMatch(/\bdecrypt\b/)

    // The box the key is typed into is write-only: masked, not autofilled, and
    // with no value to prefill it from.
    const input = page.match(/<TextInput\s+name="openAiKey"[\s\S]*?\/>/)?.[0] ?? ''
    expect(input).toContain('type="password"')
    expect(input).toContain('autoComplete="off"')
    expect(input).not.toContain('defaultValue')
  })

  it('keeps the one decrypted copy inside the import call that needs it', () => {
    // `loadAiKey` is the only reader of the plaintext. Its result must reach
    // the provider client and nowhere else.
    const source = read(IMPORT_ACTIONS)
    expect(source.match(/key\.apiKey/g) ?? []).toHaveLength(1)
    expect(source).toContain('new OpenAiMappingProposer(key.apiKey, key.model)')
    for (const block of source.match(/metadata:\s*\{[^}]*\}/g) ?? []) {
      expect(block).not.toContain('apiKey')
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Nothing in either path logs (§15)
// ---------------------------------------------------------------------------

describe('nothing in the export or settings path writes to the console (§15)', () => {
  it('has no console call in any export module, export route or settings file', () => {
    for (const { name, source } of exportAndSettingsSources()) {
      expect(source, name).not.toMatch(/console\.(log|info|warn|error|debug|trace|dir)/)
    }
  })

  it('never hands a whole config object to a log, a message or audit metadata', () => {
    for (const { name, source } of exportAndSettingsSources()) {
      expect(source, name).not.toMatch(/JSON\.stringify\(\s*config\b/)
      expect(source, name).not.toMatch(/metadata:\s*config\b/)
      expect(source, name).not.toMatch(/metadata:\s*\{\s*\.\.\.\s*(?:config|current)\b/)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. The guard that would refuse a credential (§15, §16)
// ---------------------------------------------------------------------------

describe('the audit metadata guard is what refuses a credential (§15)', () => {
  it('accepts the counts and sizes the export path actually records', async () => {
    const { assertNoSecrets } = await import('@/lib/audit')

    expect(() =>
      assertNoSecrets({ kind: 'RECIPIENTS', format: 'CSV', rows: 12, bytes: 4096 }),
    ).not.toThrow()
    expect(() => assertNoSecrets(undefined)).not.toThrow()
  })

  it('refuses an api key, an app password, a token or a credential by name', async () => {
    const { assertNoSecrets } = await import('@/lib/audit')

    for (const key of [
      'apiKey',
      'api_key',
      'openai_api_key',
      'smtpAppPassword',
      'smtpPassword',
      'clientSecret',
      'signInToken',
      'credential',
    ]) {
      expect(() => assertNoSecrets({ [key]: OPENAI_KEY }), key).toThrow(
        /must not contain secrets/,
      )
    }
  })

  it('names the offending keys rather than redacting them quietly', async () => {
    const { assertNoSecrets } = await import('@/lib/audit')

    expect(() =>
      assertNoSecrets({ rows: 12, apiKey: OPENAI_KEY, smtpPassword: APP_PASSWORD }),
    ).toThrow(/apiKey, smtpPassword/)
  })

  it('reads the key the settings action itself uses, and reads it at every depth', async () => {
    const { assertNoSecrets } = await import('@/lib/audit')

    // `openAiKey` is the field name `updateAiSettingsAction` uses, and until
    // WP19 it matched none of the forbidden words. A nested key was not seen at
    // all, because only the top level was read — and metadata is serialised
    // into the audit export cell whatever depth it sits at.
    expect(() => assertNoSecrets({ openAiKey: OPENAI_KEY })).toThrow(/openAiKey/)
    expect(() => assertNoSecrets({ smtp: { password: APP_PASSWORD } })).toThrow(/smtp\.password/)
  })

  it('admits a booleaned key, because a fact about a secret is not the secret', async () => {
    const { assertNoSecrets } = await import('@/lib/audit')

    // `{ openAiKeyReplaced: true }` records that the owner changed the key,
    // which is the whole point of auditing the settings screen. Refusing it
    // would be the false alarm that gets a real check switched off.
    expect(() => assertNoSecrets({ openAiKeyReplaced: true })).not.toThrow()
    expect(() => assertNoSecrets({ appPasswordPresent: false, tokenCount: 3 })).not.toThrow()
  })

  it('still reads keys and never values, so a legitimate word stays sayable', async () => {
    const { assertNoSecrets } = await import('@/lib/audit')

    // A sign-in records the authentication method. Scanning values would refuse
    // it — `scripts/verify-export.ts` did exactly that once.
    expect(() => assertNoSecrets({ method: 'password' })).not.toThrow()
    expect(() => assertNoSecrets({ note: `key is ${OPENAI_KEY}` })).not.toThrow()
  })

  it('is the only thing between audit metadata and an export cell', () => {
    // Metadata is serialised into the audit export verbatim, so whatever the
    // guard admits is exported. That is why the guard, not the exporter, is the
    // control that AC25 rests on for this route.
    const csv = exportAuditLogCsv({
      requestedByRole: 'OWNER',
      rows: [{ ...auditRow, metadata: { note: OPENAI_KEY } }],
    }).toString('utf8')

    expect(csv).toContain(OPENAI_KEY)
  })
})

// ---------------------------------------------------------------------------
// 5. Owner access and export in every service mode (AC14, §7)
// ---------------------------------------------------------------------------

const MODES: readonly ServiceMode[] = ['ACTIVE', 'READ_ONLY', 'SUNSET', 'DISABLED']

describe('the owner keeps access and export in every service mode (AC14, §7)', () => {
  it('puts no service-mode precondition anywhere in the export path', () => {
    for (const { name, source } of exportPathSources()) {
      expect(source, `${name} reads the service mode`).not.toContain('serviceMode')
      expect(source, `${name} reads the service mode`).not.toContain('ServiceMode')
      expect(source, `${name} consults the portal policy`).not.toContain('portalAccess')
      // `data.ts` writes `last_export_at` on the config row; nothing in the
      // path reads that row to decide whether an export may run.
      expect(source, `${name} reads the config`).not.toContain('readServiceConfig')
    }
  })

  it('gates each export route on identity alone', () => {
    expect(read(RECIPIENTS_ROUTE)).toContain('await requireOnboardedAdmin()')
    expect(read(AUDIT_ROUTE)).toContain('await requireOwner()')
  })

  it('applies the mode to the investor only, with no owner or operator in the policy', () => {
    const access = read(ACCESS_MODULE)
    expect(access).not.toContain('OWNER')
    expect(access).not.toContain('OPERATOR')
    expect(access).not.toContain('requireOwner')
    expect(access).not.toContain('AdminIdentity')

    const investor = { accountStatus: 'ACTIVE', closedAccountAccess: 'READ_ONLY' } as const

    expect(portalAccess({ ...investor, serviceMode: 'ACTIVE' })).toMatchObject({
      capability: 'FULL',
      issueLink: true,
      notice: null,
    })
    expect(portalAccess({ ...investor, serviceMode: 'READ_ONLY' })).toMatchObject({
      capability: 'READ_ONLY',
      issueLink: true,
      notice: 'READ_ONLY',
    })
    expect(portalAccess({ ...investor, serviceMode: 'SUNSET' })).toMatchObject({
      capability: 'READ_ONLY',
      issueLink: true,
      notice: 'SUNSET',
    })
    expect(portalAccess({ ...investor, serviceMode: 'DISABLED' })).toMatchObject({
      capability: 'NONE',
      issueLink: false,
      allowClaim: false,
      notice: 'SERVICE_CLOSED',
    })
  })

  it('produces the same export bytes whatever mode the service is put into', async () => {
    const { updateServiceSettingsAction } = await settingsActions()
    const recipients = exportRecipientsCsv([recipientRow]).toString('utf8')
    const auditLog = exportAuditLogCsv({
      requestedByRole: 'OWNER',
      rows: [auditRow],
    }).toString('utf8')

    for (const mode of MODES) {
      serviceConfigRow.mockReturnValue(
        configRow({ serviceMode: 'ACTIVE', lastExportAt: new Date(Date.now() - DAY) }),
      )

      const result = await updateServiceSettingsAction(
        { status: 'idle' },
        serviceForm({ serviceMode: mode, sunsetClosingDate: '2026-12-31' }),
      )
      expect(result.status, mode).toBe('ok')

      expect(exportRecipientsCsv([recipientRow]).toString('utf8'), mode).toBe(recipients)
      expect(
        exportAuditLogCsv({ requestedByRole: 'OWNER', rows: [auditRow] }).toString('utf8'),
        mode,
      ).toBe(auditLog)
    }
  })
})

describe('the one gate §7 puts near an export is on entering disabled', () => {
  it('refuses the move when no export has completed in seven days and no reason is given', async () => {
    const { updateServiceSettingsAction } = await settingsActions()
    serviceConfigRow.mockReturnValue(configRow({ serviceMode: 'ACTIVE', lastExportAt: null }))

    const result = await updateServiceSettingsAction({ status: 'idle' }, serviceForm())

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.message).toMatch(/no completed export in the last 7 days/)
    expect(result.fieldErrors?.overrideReason).toMatch(/reason of at least ten characters/)
    // Refused means nothing written and nothing logged.
    expect(writtenValues).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('lets the move through on an export inside seven days, recording no override', async () => {
    const { updateServiceSettingsAction } = await settingsActions()
    serviceConfigRow.mockReturnValue(
      configRow({ serviceMode: 'ACTIVE', lastExportAt: new Date(Date.now() - 6 * DAY) }),
    )

    const result = await updateServiceSettingsAction({ status: 'idle' }, serviceForm())

    expect(result.status).toBe('ok')
    expect(auditSpy.mock.calls[0][0].metadata).toMatchObject({
      toServiceMode: 'DISABLED',
      exportPreconditionOverridden: false,
      overrideReason: null,
    })
  })

  it('is exactly seven days, so an eight-day-old export needs the override', async () => {
    const { updateServiceSettingsAction } = await settingsActions()
    serviceConfigRow.mockReturnValue(
      configRow({ serviceMode: 'ACTIVE', lastExportAt: new Date(Date.now() - 8 * DAY) }),
    )

    const result = await updateServiceSettingsAction({ status: 'idle' }, serviceForm())
    expect(result.status).toBe('error')
  })

  it('logs the override and its reason when the owner takes it', async () => {
    const { updateServiceSettingsAction } = await settingsActions()
    serviceConfigRow.mockReturnValue(configRow({ serviceMode: 'ACTIVE', lastExportAt: null }))
    const reason = 'Data already handed to the BVI agent on 2026-07-20.'

    const result = await updateServiceSettingsAction(
      { status: 'idle' },
      serviceForm({ overrideReason: reason }),
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.message).toMatch(/overridden and the reason is on the audit log/)

    const entry = auditSpy.mock.calls[0][0]
    expect(entry.action).toBe('service_config.updated')
    expect(entry.actor).toEqual({ kind: 'user', id: OWNER.id, label: OWNER.email })
    expect(entry.metadata).toMatchObject({
      fromServiceMode: 'ACTIVE',
      toServiceMode: 'DISABLED',
      exportPreconditionOverridden: true,
      overrideReason: reason,
    })
  })

  it('gates nothing but disabled, and does not re-gate a service already disabled', async () => {
    const { updateServiceSettingsAction } = await settingsActions()

    for (const mode of ['ACTIVE', 'READ_ONLY', 'SUNSET'] as const) {
      auditSpy.mockClear()
      serviceConfigRow.mockReturnValue(configRow({ serviceMode: 'ACTIVE', lastExportAt: null }))

      const result = await updateServiceSettingsAction(
        { status: 'idle' },
        serviceForm({ serviceMode: mode, sunsetClosingDate: '2026-12-31' }),
      )

      expect(result.status, mode).toBe('ok')
      expect(auditSpy.mock.calls[0][0].metadata, mode).toMatchObject({
        exportPreconditionOverridden: false,
      })
    }

    auditSpy.mockClear()
    serviceConfigRow.mockReturnValue(configRow({ serviceMode: 'DISABLED', lastExportAt: null }))

    const result = await updateServiceSettingsAction({ status: 'idle' }, serviceForm())
    expect(result.status).toBe('ok')
    expect(auditSpy.mock.calls[0][0].metadata).toMatchObject({
      exportPreconditionOverridden: false,
    })
  })
})
