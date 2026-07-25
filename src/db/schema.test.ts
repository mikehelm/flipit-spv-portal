import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from './schema'

/**
 * BUILD_SPEC §17 lists the entities this application needs. This test asserts
 * every one of them exists, so a later refactor cannot quietly drop one.
 *
 * The mapping is spec name → database table name.
 */
const REQUIRED_ENTITIES: Record<string, string> = {
  User: 'users',
  OperatorInvite: 'operator_invites',
  InvestorAccount: 'investor_accounts',
  AccountStatusEvent: 'account_status_events',
  Round: 'rounds',
  Recipient: 'recipients',
  Offer: 'offers',
  OfferStatusEvent: 'offer_status_events',
  EmailSnapshot: 'email_snapshots',
  SendEvent: 'send_events',
  PortalToken: 'portal_tokens',
  InvestorResponse: 'investor_responses',
  ConversationMessage: 'conversation_messages',
  Commitment: 'commitments',
  PaymentInstruction: 'payment_instructions',
  FundsReceipt: 'funds_receipts',
  DocumentPackage: 'document_packages',
  PortalUpdate: 'portal_updates',
  UpdateDelivery: 'update_deliveries',
  ComplianceApproval: 'compliance_approvals',
  ReminderSchedule: 'reminder_schedules',
  ReminderEvent: 'reminder_events',
  ImportJob: 'import_jobs',
  ColumnMapping: 'column_mappings',
  AiProposal: 'ai_proposals',
  QaEntry: 'qa_entries',
  QaThreadMessage: 'qa_thread_messages',
  ParticipationCertificate: 'participation_certificates',
  InterestRegisterEntry: 'interest_register_entries',
  RoadmapTile: 'roadmap_tiles',
  MediaAsset: 'media_assets',
  OperatorVideo: 'operator_videos',
  ServiceConfig: 'service_config',
  FeatureFlag: 'feature_flags',
  AuditEvent: 'audit_events',
  ExportJob: 'export_jobs',
}

function tables(): Map<string, ReturnType<typeof getTableConfig>> {
  const found = new Map<string, ReturnType<typeof getTableConfig>>()
  for (const value of Object.values(schema)) {
    try {
      const config = getTableConfig(value as never)
      found.set(config.name, config)
    } catch {
      // Not a table (enum, helper). Ignore.
    }
  }
  return found
}

describe('BUILD_SPEC §17 — every entity exists', () => {
  const found = tables()

  for (const [specName, tableName] of Object.entries(REQUIRED_ENTITIES)) {
    it(`${specName} → ${tableName}`, () => {
      expect(found.has(tableName), `missing table: ${tableName}`).toBe(true)
    })
  }
})

describe('money and percentages are never floating point', () => {
  const found = tables()

  /**
   * Any column whose name suggests it holds money or a percentage must be
   * `numeric`. A `double precision` or `real` column here would silently
   * corrupt an investor's figures.
   */
  const MONEY_PATTERN = /(amount|usd|percentage|share|target|cap)/i

  it('has no floating-point column holding a value', () => {
    const offenders: string[] = []

    for (const [tableName, config] of found) {
      for (const column of config.columns) {
        if (!MONEY_PATTERN.test(column.name)) continue
        const type = column.getSQLType().toLowerCase()
        const isSafe =
          type.startsWith('numeric') ||
          type.startsWith('decimal') ||
          // Non-value columns that happen to match the name pattern.
          type.startsWith('boolean') ||
          type.startsWith('integer') ||
          type.startsWith('text') ||
          type.startsWith('timestamp')
        if (!isSafe) offenders.push(`${tableName}.${column.name} is ${type}`)
      }
    }

    expect(offenders, offenders.join('; ')).toEqual([])
  })

  it('stores the four separate offer amounts (BUILD_SPEC §5)', () => {
    const offers = found.get('offers')
    expect(offers).toBeDefined()
    const names = offers!.columns.map((c) => c.name)
    expect(names).toContain('proposed_amount_usd')
    expect(names).toContain('committed_amount_usd')
    expect(names).toContain('accepted_amount_usd')
    expect(names).toContain('received_amount_usd')
  })
})

describe('structural rules', () => {
  const found = tables()

  it('an offer belongs to a round and an account, so accounts outlive rounds (§4.3)', () => {
    const offers = found.get('offers')!
    const names = offers.columns.map((c) => c.name)
    expect(names).toContain('round_id')
    expect(names).toContain('account_id')
  })

  it('investor accounts carry no round reference — they are durable (§4.3)', () => {
    const accounts = found.get('investor_accounts')!
    const names = accounts.columns.map((c) => c.name)
    expect(names).not.toContain('round_id')
    expect(names).not.toContain('offer_id')
  })

  it('portal tokens store only a hash (§15)', () => {
    const tokens = found.get('portal_tokens')!
    const names = tokens.columns.map((c) => c.name)
    expect(names).toContain('token_hash')
    expect(names).not.toContain('token')
  })

  it('a Q&A entry keeps the original question separate from the published one (§6.7)', () => {
    const qa = found.get('qa_entries')!
    const names = qa.columns.map((c) => c.name)
    expect(names).toContain('question_original')
    expect(names).toContain('question_public')
  })

  it('the register stores no rank — order is computed (§5.2.2)', () => {
    const register = found.get('interest_register_entries')!
    const names = register.columns.map((c) => c.name)
    expect(names).not.toContain('position')
    expect(names).not.toContain('rank')
  })

  it('compliance approvals record the approved template hash and jurisdictions (§8.2)', () => {
    const approvals = found.get('compliance_approvals')!
    const names = approvals.columns.map((c) => c.name)
    expect(names).toContain('approved_template_hash')
    expect(names).toContain('approved_jurisdictions')
    expect(names).toContain('evidence_reference')
  })

  it('credentials are stored encrypted, by column name (§8.1, §9.1)', () => {
    const config = found.get('service_config')!
    const names = config.columns.map((c) => c.name)
    expect(names).toContain('smtp_password_encrypted')
    expect(names).toContain('open_ai_key_encrypted')
    // No plaintext equivalents.
    expect(names).not.toContain('smtp_password')
    expect(names).not.toContain('open_ai_key')
  })
})
