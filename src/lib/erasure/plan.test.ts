import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ERASED_JSON,
  ERASED_MARKER,
  ERASED_STORAGE_KEY,
  ERASURE_FIELD_RULES,
  ERASURE_PURGE_RULES,
  ERASURE_RETENTION_RULES,
  looksErased,
  pseudonymEmail,
  pseudonymName,
  pseudonymRef,
  rulesFor,
  tablesAccountedFor,
  tablesTouched,
  type SchemaTable,
} from './plan'

/**
 * The plan against the schema it describes.
 *
 * This is the test that stops the erasure procedure going stale the way
 * `OPEN_DECISIONS.md` did. A written runbook decays the moment somebody adds a
 * column; a declaration checked against `src/db/schema.ts` cannot, because the
 * check fails on the commit that adds the table.
 */

const root = process.cwd()
const schemaText = readFileSync(join(root, 'src/db/schema.ts'), 'utf8')

/** Every `export const X = pgTable(` in the schema, by export name. */
function schemaTables(): string[] {
  return [...schemaText.matchAll(/^export const (\w+) = pgTable\(/gm)].map((m) => m[1]).sort()
}

/**
 * The text of one table's definition, so a column's nullability can be read.
 * Crude on purpose: it is the same source the reviewer would read.
 */
function tableBody(table: string): string {
  const start = schemaText.indexOf(`export const ${table} = pgTable(`)
  if (start === -1) return ''
  const next = schemaText.indexOf('\nexport const ', start + 1)
  return schemaText.slice(start, next === -1 ? schemaText.length : next)
}

function columnLine(table: string, column: string): string {
  const body = tableBody(table)
  const match = new RegExp(`^\\s+${column}:\\s*([^\\n]*(?:\\n\\s{6,}[^\\n]*)*)`, 'm').exec(body)
  return match ? match[1] : ''
}

describe('the plan covers the whole schema', () => {
  it('every table in the schema is named exactly once', () => {
    /*
     * The property that matters. A table nobody has an opinion about is a table
     * whose contents survive an erasure by accident, and nobody finds out until
     * an investor asks what is still held about them.
     */
    expect(tablesAccountedFor()).toEqual(schemaTables())
  })

  it('and no table is named in two lists at once', () => {
    const counted = new Map<string, string[]>()
    for (const rule of ERASURE_FIELD_RULES) {
      counted.set(rule.table, [...(counted.get(rule.table) ?? []), 'field'])
    }
    for (const rule of ERASURE_PURGE_RULES) {
      counted.set(rule.table, [...(counted.get(rule.table) ?? []), 'purge'])
    }
    for (const rule of ERASURE_RETENTION_RULES) {
      counted.set(rule.table, [...(counted.get(rule.table) ?? []), 'retain'])
    }

    for (const [table, lists] of counted) {
      const distinct = [...new Set(lists)]
      expect(distinct.length, `${table} appears in ${distinct.join(' and ')}`).toBe(1)
    }
  })

  it('every column a rule names exists on the table it names', () => {
    for (const rule of ERASURE_FIELD_RULES) {
      expect(
        columnLine(rule.table, rule.column),
        `${rule.table}.${rule.column} is not a column in src/db/schema.ts`,
      ).not.toBe('')
    }
  })
})

describe('CLEAR is nullable and REDACT is not', () => {
  /*
   * Getting this backwards is a not-null violation discovered halfway through
   * somebody's erasure, with the stored documents already destroyed. It is the
   * single most expensive mistake available in this module, so it is checked
   * against the schema text rather than trusted.
   */
  it('every CLEAR names a nullable column', () => {
    for (const rule of ERASURE_FIELD_RULES.filter((r) => r.treatment === 'CLEAR')) {
      const line = columnLine(rule.table, rule.column)
      expect(
        /\.notNull\(\)/.test(line),
        `${rule.table}.${rule.column} is notNull, so CLEAR would fail — use REDACT`,
      ).toBe(false)
    }
  })

  it('every REDACT names a notNull text column', () => {
    for (const rule of ERASURE_FIELD_RULES.filter((r) => r.treatment === 'REDACT')) {
      const line = columnLine(rule.table, rule.column)
      expect(
        /\.notNull\(\)/.test(line),
        `${rule.table}.${rule.column} is nullable — CLEAR says more than REDACT does`,
      ).toBe(true)
    }
  })

  it('every PSEUDONYM_EMAIL and PSEUDONYM_NAME names a text column', () => {
    const pseudonymised = ERASURE_FIELD_RULES.filter(
      (r) => r.treatment === 'PSEUDONYM_EMAIL' || r.treatment === 'PSEUDONYM_NAME',
    )
    expect(pseudonymised.length).toBeGreaterThan(0)
    for (const rule of pseudonymised) {
      expect(
        /text\(/.test(columnLine(rule.table, rule.column)),
        `${rule.table}.${rule.column} is not a text column`,
      ).toBe(true)
    }
  })
})

describe('every rule explains itself', () => {
  it('no rule has an empty or one-word reason', () => {
    for (const rule of [...ERASURE_FIELD_RULES, ...ERASURE_PURGE_RULES, ...ERASURE_RETENTION_RULES]) {
      expect(rule.why.trim().length, `${rule.table} has no usable reason`).toBeGreaterThan(20)
    }
  })
})

describe('the account graph is reached', () => {
  /*
   * A list of tables that hold something an investor typed or that name them
   * directly. Written out here rather than derived, so that the plan and this
   * test cannot both be wrong in the same way — if a future change drops one of
   * these from the plan, this fails.
   */
  const MUST_BE_TOUCHED: SchemaTable[] = [
    'investorAccounts',
    'recipients',
    'accountStatusEvents',
    'offers',
    'offerStatusEvents',
    'emailSnapshots',
    'sendEvents',
    'emailChangeRequests',
    'investorResponses',
    'conversationMessages',
    'commitments',
    'paymentInstructions',
    'fundsReceipts',
    'documentPackages',
    'participationCertificates',
    'qaEntries',
    'qaThreadMessages',
    'interestRegisterEntries',
    'auditEvents',
    'signInAttempts',
  ]

  it('each one has a rule', () => {
    const touched = tablesTouched()
    for (const table of MUST_BE_TOUCHED) {
      expect(touched, `${table} is not touched by the erasure`).toContain(table)
    }
  })

  it('the whole body of an email snapshot goes, not only the address', () => {
    const columns = rulesFor('emailSnapshots').map((r) => r.column)
    expect(columns).toContain('htmlBody')
    expect(columns).toContain('textBody')
    expect(columns).toContain('subject')
    expect(columns).toContain('toAddress')
  })

  it('the template hash on a snapshot is kept, so which template was sent stays provable', () => {
    expect(rulesFor('emailSnapshots').map((r) => r.column)).not.toContain('templateHash')
  })

  it('no rule touches a money or percentage column', () => {
    // The figures are the record. An erasure removes the person, not the round.
    const MONEY = /(amountUsd|Percentage|indicativeAmountUsd|estimatedCostUsd|^amount$)/
    for (const rule of ERASURE_FIELD_RULES) {
      expect(
        MONEY.test(rule.column),
        `${rule.table}.${rule.column} is a figure and must survive an erasure`,
      ).toBe(false)
    }
  })

  it('no rule removes an audit row, and only the label is rewritten', () => {
    expect(ERASURE_PURGE_RULES.map((r) => r.table)).not.toContain('auditEvents')
    expect(rulesFor('auditEvents').map((r) => r.column)).toEqual(['actorLabel'])
  })

  it('exactly one table is purged outright, and it is the throttle counter', () => {
    expect(ERASURE_PURGE_RULES).toHaveLength(1)
    expect(ERASURE_PURGE_RULES[0].table).toBe('signInAttempts')
  })

  it('the compliance approval is retained', () => {
    // The approver is a third party and the approval is what made the send
    // lawful. It is not the investor's to erase.
    expect(ERASURE_RETENTION_RULES.map((r) => r.table)).toContain('complianceApprovals')
  })
})

describe('the pseudonym', () => {
  it('is stable, so a retry converges instead of inventing a second person', () => {
    expect(pseudonymRef('acc_one')).toBe(pseudonymRef('acc_one'))
    expect(pseudonymEmail('acc_one')).toBe(pseudonymEmail('acc_one'))
    expect(pseudonymName('acc_one')).toBe(pseudonymName('acc_one'))
  })

  it('differs between accounts, because the email column is unique', () => {
    const refs = new Set(
      Array.from({ length: 500 }, (_unused, index) => pseudonymRef(`acc_${index}`)),
    )
    expect(refs.size).toBe(500)
  })

  it('is twelve hex characters and carries nothing of the person', () => {
    const ref = pseudonymRef('acc_one')
    expect(ref).toMatch(/^[0-9a-f]{12}$/)
    expect(pseudonymName('acc_one')).toBe(`Erased investor ${ref}`)
  })

  it('produces an address no mail server can deliver to', () => {
    /*
     * RFC 2606 reserves `.invalid`. This is the rule that will not bend made
     * structural: an erased account cannot be written to by accident, because
     * the address it now holds does not resolve anywhere.
     */
    expect(pseudonymEmail('acc_one')).toMatch(/@erased\.invalid$/)
  })

  it('is not derived from the name or the address it replaces', () => {
    // Deriving it from the email would make the pseudonym a hash of the thing
    // being erased, which is a lookup table away from not being erased at all.
    const ref = pseudonymRef('acc_one')
    expect(ref).not.toContain('acc')
    expect(pseudonymRef('someone@example.com')).not.toBe(ref)
  })
})

describe('looksErased', () => {
  it('accepts everything the plan produces', () => {
    expect(looksErased(null)).toBe(true)
    expect(looksErased(ERASED_MARKER)).toBe(true)
    expect(looksErased(ERASED_STORAGE_KEY)).toBe(true)
    expect(looksErased(pseudonymName('acc_one'))).toBe(true)
    expect(looksErased(pseudonymEmail('acc_one'))).toBe(true)
  })

  it('rejects anything that survived', () => {
    expect(looksErased('Jane Investor')).toBe(false)
    expect(looksErased('jane@example.com')).toBe(false)
    expect(looksErased('')).toBe(false)
    // The shape has to be right, not merely similar.
    expect(looksErased('Erased investor xyz')).toBe(false)
    expect(looksErased('erased-abc@erased.invalid')).toBe(false)
  })
})

describe('the markers', () => {
  it('the redaction marker is a sentence a person can read in a table cell', () => {
    expect(ERASED_MARKER).toContain('erased')
    expect(ERASED_MARKER.length).toBeGreaterThan(10)
  })

  it('the json marker is frozen, so one erasure cannot mutate the next one', () => {
    expect(Object.isFrozen(ERASED_JSON)).toBe(true)
  })

  it('the storage-key marker is neither null nor a real key', () => {
    // Null would make the row indistinguishable from one that never had a file;
    // a real key would send `pnpm media:check` looking for a deliberate absence.
    expect(ERASED_STORAGE_KEY).not.toBe('')
    expect(ERASED_STORAGE_KEY.length).toBeLessThan(32)
  })
})
