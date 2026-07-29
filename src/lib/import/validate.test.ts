import { describe, expect, it } from 'vitest'
import { normaliseProposal } from './ai'
import { applyMapping, proposeMappingFromHeaders, type ConfirmedMapping } from './mapping'
import { readTable, type SheetTable } from './table'
import { isValidEmail, validateImport, type ImportContext } from './validate'

function table(csv: string): SheetTable {
  const result = readTable('list.csv', new TextEncoder().encode(csv))
  if (!result.ok) throw new Error(result.message)
  return result.table
}

const HEADERS = 'recipient_name,recipient_email,investment_amount_usd,spv_percentage,response_deadline,recipient_jurisdiction'

/** The straightforward mapping: every column named after its field. */
function directMapping(sheet: SheetTable, answers: ConfirmedMapping['answers'] = {}): ConfirmedMapping {
  return {
    assignments: sheet.headers
      .filter((header) => header !== 'ignore_me')
      .map((header) => ({ sourceColumn: header, targetField: header as never })),
    answers,
  }
}

const baseContext: ImportContext = {
  today: '2026-07-25',
  flipitShare: '0.300000',
  approvedJurisdictions: ['GB', 'AU', 'FR', 'TH'],
  aggregateRaiseUsd: '30000.00',
  existingEmails: [],
  decimalPlaces: 3,
}

function run(csv: string, context: Partial<ImportContext> = {}, answers: ConfirmedMapping['answers'] = {}) {
  const sheet = table(csv)
  const mapping = directMapping(sheet, answers)
  return validateImport(applyMapping(sheet, mapping), mapping, { ...baseContext, ...context })
}

describe('the happy path', () => {
  it('produces exact stored values and the §10 calculation', () => {
    const result = run(`${HEADERS}\nAda Lovelace,ada@example.com,"$1,500.00",5,2026-08-10,GB\n`)
    expect(result.fileErrors).toEqual([])
    expect(result.canImport).toBe(true)

    const row = result.rows[0]
    expect(row.name).toBe('Ada Lovelace')
    expect(row.email).toBe('ada@example.com')
    expect(row.jurisdiction).toBe('GB')
    expect(row.proposedAmountUsd).toBe('1500.00')
    expect(row.spvPercentage).toBe('5.000000')
    expect(row.indirectPercentage).toBe('1.500000')
    expect(row.indirectOverridden).toBe(false)
    expect(row.responseDeadline).toBe('2026-08-10')
    expect(row.blocked).toBe(false)
    expect(row.display).toEqual({
      amount: 'USD 1,500.00',
      spvPercentage: '5.000%',
      indirectPercentage: '1.500%',
      deadline: '2026-08-10',
    })
  })

  it('lowercases the address and keeps the totals exact', () => {
    const result = run(
      `${HEADERS}\nA,A@Example.com,1000.10,5,2026-08-10,GB\nB,b@example.com,2000.20,7.5,2026-08-10,AU\n`,
    )
    expect(result.rows[0].email).toBe('a@example.com')
    expect(result.totals.proposedAmountUsd).toBe('3000.30')
    expect(result.totals.spvPercentage).toBe('12.500000')
  })

  it('respects an override and warns that it differs from the calculation', () => {
    const result = run(
      `${HEADERS},indirect_flipit_percentage_override\nA,a@example.com,1500,5,2026-08-10,GB,2\n`,
    )
    expect(result.rows[0].indirectPercentage).toBe('2.000000')
    expect(result.rows[0].indirectOverridden).toBe(true)
    expect(result.warnings.map((warning) => warning.code)).toContain('INDIRECT_OVERRIDE_DIFFERS')
    expect(result.canImport).toBe(true)
  })
})

describe('FILE-LEVEL errors — nothing in the file can be imported', () => {
  it('a missing required value', () => {
    const result = run(`${HEADERS}\n,a@example.com,1500,5,2026-08-10,GB\n`)
    expect(result.canImport).toBe(false)
    expect(result.fileErrors[0].code).toBe('MISSING_VALUE')
    expect(result.rows).toHaveLength(0)
  })

  it('a malformed email', () => {
    const result = run(`${HEADERS}\nA,not-an-address,1500,5,2026-08-10,GB\n`)
    expect(result.fileErrors[0].code).toBe('MALFORMED_EMAIL')
    expect(result.canImport).toBe(false)
  })

  it('a duplicate against a record that already exists', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,5,2026-08-10,GB\n`, {
      existingEmails: ['a@example.com'],
    })
    expect(result.fileErrors[0].code).toBe('DUPLICATE_EMAIL_EXISTING')
    expect(result.canImport).toBe(false)
  })

  it('a non-numeric or out-of-range percentage', () => {
    expect(run(`${HEADERS}\nA,a@example.com,1500,lots,2026-08-10,GB\n`).fileErrors[0].code).toBe(
      'INVALID_PERCENTAGE',
    )
    expect(run(`${HEADERS}\nA,a@example.com,1500,150,2026-08-10,GB\n`).fileErrors[0].code).toBe(
      'INVALID_PERCENTAGE',
    )
  })

  it('a non-numeric or negative amount', () => {
    expect(run(`${HEADERS}\nA,a@example.com,tbc,5,2026-08-10,GB\n`).fileErrors[0].code).toBe(
      'INVALID_AMOUNT',
    )
    expect(run(`${HEADERS}\nA,a@example.com,(500),5,2026-08-10,GB\n`).fileErrors[0].code).toBe(
      'INVALID_AMOUNT',
    )
  })

  it('a past-dated deadline', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,5,2026-07-24,GB\n`)
    expect(result.fileErrors[0].code).toBe('PAST_DEADLINE')
    expect(result.canImport).toBe(false)
  })

  it('accepts a deadline of today — the edge resolves in the investor’s favour', () => {
    expect(run(`${HEADERS}\nA,a@example.com,1500,5,2026-07-25,GB\n`).canImport).toBe(true)
  })

  it('an invalid ISO country code — AC22', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,5,2026-08-10,ZZ\n`)
    expect(result.fileErrors[0].code).toBe('INVALID_JURISDICTION')
    expect(result.canImport).toBe(false)
  })

  it('a bloc rather than a country', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,5,2026-08-10,EU\n`)
    expect(result.fileErrors[0].code).toBe('INVALID_JURISDICTION')
    expect(result.fileErrors[0].message).toMatch(/bloc or a region/)
  })

  it('a value too precise to store, rather than rounding it', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500.005,5,2026-08-10,GB\n`)
    expect(result.fileErrors[0].code).toBe('PRECISION_LOSS')
    expect(result.canImport).toBe(false)
  })

  it('an SPV percentage whose indirect figure would not fit the column', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,0.000001,2026-08-10,GB\n`)
    expect(result.fileErrors[0].code).toBe('PRECISION_LOSS')
    expect(result.fileErrors[0].message).toMatch(/decimal places/)
  })

  it('one bad row stops the whole file, including the good rows', () => {
    const result = run(
      `${HEADERS}\nA,a@example.com,1500,5,2026-08-10,GB\nB,bad-address,1500,5,2026-08-10,AU\n`,
    )
    expect(result.canImport).toBe(false)
    expect(result.rows).toHaveLength(1)
  })
})

describe('PER-RECIPIENT blocks — the row imports, and only it is blocked', () => {
  it('a valid code outside the approved list — AC7, AC22, §8.3', () => {
    const result = run(
      `${HEADERS}\nAda,ada@example.com,1500,5,2026-08-10,GB\nUS Person,us@example.com,1500,5,2026-08-10,US\n`,
    )
    expect(result.canImport).toBe(true)
    expect(result.fileErrors).toEqual([])
    expect(result.rows).toHaveLength(2)

    const [uk, us] = result.rows
    expect(uk.blocked).toBe(false)
    expect(uk.blockReason).toBeNull()
    expect(us.blocked).toBe(true)
    expect(us.blockReason).toBe('JURISDICTION_NOT_APPROVED')
    expect(us.blockDetail).toMatch(/United States \(US\)/)
    expect(result.totals.blockedCount).toBe(1)
  })

  it('blocks everyone when no jurisdiction has been approved yet', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,5,2026-08-10,GB\n`, {
      approvedJurisdictions: [],
    })
    expect(result.canImport).toBe(true)
    expect(result.rows[0].blocked).toBe(true)
  })

  it('reads a country name into a code and shows what it read', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,5,2026-08-10,England\n`)
    expect(result.rows[0].jurisdiction).toBe('GB')
    expect(result.rows[0].jurisdictionReadFrom).toBe('England')
    expect(result.rows[0].blocked).toBe(false)
  })
})

describe('warnings — they never block', () => {
  it('imports duplicate addresses as visible drafts for later resolution', () => {
    const result = run(
      `${HEADERS}\nA,same@example.com,1500,5,2026-08-10,GB\nB,SAME@example.com,1500,5,2026-08-10,AU\n`,
    )
    expect(result.fileErrors).toEqual([])
    expect(result.rows).toHaveLength(2)
    expect(result.warnings.map((warning) => warning.code)).toContain(
      'DUPLICATE_EMAIL_REQUIRES_REVIEW',
    )
    expect(result.canImport).toBe(true)
  })

  it('imports missing onboarding fields as held drafts', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,5,,\n`)
    expect(result.fileErrors).toEqual([])
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['MISSING_DEADLINE', 'MISSING_JURISDICTION']),
    )
    expect(result.rows[0]).toMatchObject({
      responseDeadline: null,
      jurisdiction: null,
      blocked: true,
      blockReason: 'VALIDATION_FAILED',
    })
    expect(result.canImport).toBe(true)
  })

  it('warns when the SPV percentages exceed the whole SPV', () => {
    const rows = Array.from(
      { length: 3 },
      (_, index) => `P${index},p${index}@example.com,1000,40,2026-08-10,GB`,
    ).join('\n')
    const result = run(`${HEADERS}\n${rows}\n`)
    expect(result.warnings.map((warning) => warning.code)).toContain('SPV_PERCENTAGE_TOTAL_OVER_100')
    expect(result.canImport).toBe(true)
  })

  it('warns when the amounts exceed the stated raise', () => {
    const result = run(`${HEADERS}\nA,a@example.com,40000,5,2026-08-10,GB\n`)
    expect(result.warnings.map((warning) => warning.code)).toContain('AMOUNT_TOTAL_OVER_AGGREGATE')
    expect(result.canImport).toBe(true)
  })
})

describe('the operator’s answers are applied to the whole column', () => {
  it('reads a fraction column as percentages when told to', () => {
    const sheet = table(`${HEADERS}\nA,a@example.com,1500,0.05,2026-08-10,GB\n`)
    const mapping = directMapping(sheet, {
      spv_percentage: { percentageInterpretation: 'FRACTION' },
    })
    const result = validateImport(applyMapping(sheet, mapping), mapping, baseContext)
    expect(result.rows[0].spvPercentage).toBe('5.000000')
    expect(result.rows[0].indirectPercentage).toBe('1.500000')
  })

  it('reads the same column literally when told that instead', () => {
    const sheet = table(`${HEADERS}\nA,a@example.com,1500,0.05,2026-08-10,GB\n`)
    const mapping = directMapping(sheet, {
      spv_percentage: { percentageInterpretation: 'PERCENT' },
    })
    const result = validateImport(applyMapping(sheet, mapping), mapping, baseContext)
    expect(result.rows[0].spvPercentage).toBe('0.050000')
    expect(result.rows[0].indirectPercentage).toBe('0.015000')
  })

  it('applies the date order answer', () => {
    const sheet = table(`${HEADERS}\nA,a@example.com,1500,5,03/04/2027,GB\n`)
    const dmy = directMapping(sheet, { response_deadline: { dateOrder: 'DMY' } })
    const mdy = directMapping(sheet, { response_deadline: { dateOrder: 'MDY' } })
    expect(validateImport(applyMapping(sheet, dmy), dmy, baseContext).rows[0].responseDeadline).toBe(
      '2027-04-03',
    )
    expect(validateImport(applyMapping(sheet, mdy), mdy, baseContext).rows[0].responseDeadline).toBe(
      '2027-03-04',
    )
  })

  it('fails the row rather than guessing when no date answer was given', () => {
    const result = run(`${HEADERS}\nA,a@example.com,1500,5,03/04/2027,GB\n`)
    expect(result.fileErrors[0].code).toBe('INVALID_DEADLINE')
    expect(result.fileErrors[0].message).toMatch(/does not guess/)
  })

  it('applies the decimal separator answer to the amount column', () => {
    const sheet = table(`${HEADERS}\nA,a@example.com,"1,500",5,2026-08-10,GB\n`)
    const thousands = directMapping(sheet, {
      investment_amount_usd: { decimalSeparator: '.' },
    })
    const decimalComma = directMapping(sheet, {
      investment_amount_usd: { decimalSeparator: ',' },
    })
    expect(
      validateImport(applyMapping(sheet, thousands), thousands, baseContext).rows[0]
        .proposedAmountUsd,
    ).toBe('1500.00')
    expect(
      validateImport(applyMapping(sheet, decimalComma), decimalComma, baseContext).rows[0]
        .proposedAmountUsd,
    ).toBe('1.50')
  })
})

describe('AC27 — no AI output is used in any monetary calculation', () => {
  const awkward = [
    'Investor,Contact Address,Ticket Size,Stake,Respond By,Country,Notes',
    'Ada Lovelace,ada@example.com,"$1,500.00",5,2026-08-10,GB,knows David',
    'Grace Hopper,grace@example.com,2.5k,7.5,2026-08-10,Australia,intro via Sam',
  ].join('\n')

  /** Exactly what the model is allowed to return: column names, nothing else. */
  const modelResponse = JSON.stringify({
    mappings: [
      { source_column: 'Investor', target_field: 'recipient_name', confidence: 'HIGH' },
      { source_column: 'Contact Address', target_field: 'recipient_email', confidence: 'HIGH' },
      { source_column: 'Ticket Size', target_field: 'investment_amount_usd', confidence: 'HIGH' },
      { source_column: 'Stake', target_field: 'spv_percentage', confidence: 'MEDIUM' },
      { source_column: 'Respond By', target_field: 'response_deadline', confidence: 'HIGH' },
      { source_column: 'Country', target_field: 'recipient_jurisdiction', confidence: 'HIGH' },
      { source_column: 'Notes', target_field: 'internal_notes', confidence: 'LOW' },
    ],
  })

  const answers = { Stake: { percentageInterpretation: 'PERCENT' as const } }

  function resultFrom(assignments: ConfirmedMapping['assignments']) {
    const sheet = table(awkward)
    const mapping: ConfirmedMapping = { assignments, answers }
    return validateImport(applyMapping(sheet, mapping), mapping, baseContext)
  }

  it('produces byte-identical figures whether the mapping came from a model or a dropdown', () => {
    const sheet = table(awkward)

    const fromModel = normaliseProposal(sheet.headers, modelResponse, 'test-model')
    const aiAssignments = fromModel.columns
      .filter((column) => column.targetField !== null)
      .map((column) => ({ sourceColumn: column.sourceColumn, targetField: column.targetField! }))

    // The same mapping, chosen by hand from the dropdowns.
    const manualAssignments: ConfirmedMapping['assignments'] = [
      { sourceColumn: 'Investor', targetField: 'recipient_name' },
      { sourceColumn: 'Contact Address', targetField: 'recipient_email' },
      { sourceColumn: 'Ticket Size', targetField: 'investment_amount_usd' },
      { sourceColumn: 'Stake', targetField: 'spv_percentage' },
      { sourceColumn: 'Respond By', targetField: 'response_deadline' },
      { sourceColumn: 'Country', targetField: 'recipient_jurisdiction' },
      { sourceColumn: 'Notes', targetField: 'internal_notes' },
    ]

    const withAi = resultFrom(aiAssignments)
    const withoutAi = resultFrom(manualAssignments)

    expect(withAi.canImport).toBe(true)
    expect(withAi.rows.map((row) => row.indirectPercentage)).toEqual(['1.500000', '2.250000'])
    expect(JSON.stringify(withAi.rows)).toBe(JSON.stringify(withoutAi.rows))
    expect(withAi.totals).toEqual(withoutAi.totals)
  })

  it('produces the same figures again from the header-name heuristic', () => {
    const sheet = table(awkward)
    const heuristic = proposeMappingFromHeaders(sheet)
    const assignments = heuristic.columns
      .filter((column) => column.targetField !== null)
      .map((column) => ({ sourceColumn: column.sourceColumn, targetField: column.targetField! }))

    const result = resultFrom(assignments)
    expect(result.rows.map((row) => row.indirectPercentage)).toEqual(['1.500000', '2.250000'])
    expect(result.rows[1].proposedAmountUsd).toBe('2500.00')
  })

  it('ignores anything the model says that is not a column name', () => {
    const sheet = table(awkward)
    const meddling = JSON.stringify({
      mappings: [
        { source_column: 'Investor', target_field: 'recipient_name' },
        { source_column: 'Ticket Size', target_field: 'investment_amount_usd' },
        // Not a column, not a field, and a computed figure it was never asked for.
        { source_column: 'indirect', target_field: 'indirect_flipit_percentage_override' },
        { source_column: 'Stake', target_field: 'total_raised' },
      ],
      notes: ['The indirect percentage should be 9.99'],
    })
    const proposal = normaliseProposal(sheet.headers, meddling, 'test-model')
    const mapped = proposal.columns.filter((column) => column.targetField !== null)
    expect(mapped.map((column) => column.sourceColumn)).toEqual(['Investor', 'Ticket Size'])
    expect(proposal.columns.find((column) => column.sourceColumn === 'Stake')?.targetField).toBeNull()
  })
})

describe('no money value passes through a JavaScript number', () => {
  it('has no floating-point escape hatch in the validation path', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const file of ['validate.ts', 'mapping.ts', 'persist.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
      for (const pattern of [/\bNumber\s*\(/, /\bparseFloat\s*\(/, /\bparseInt\s*\(/, /\.toNumber\s*\(/]) {
        expect(source, `${file} matched ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('keeps an amount a double could not represent', () => {
    const result = run(`${HEADERS}\nA,a@example.com,9007199254740993.99,5,2026-08-10,GB\n`)
    expect(result.rows[0].proposedAmountUsd).toBe('9007199254740993.99')
    expect(result.totals.proposedAmountUsd).toBe('9007199254740993.99')
  })

  it('sums amounts that binary floating point would drift on', () => {
    const rows = ['0.10', '0.20', '0.30', '0.40', '0.50', '0.60', '0.70']
      .map((amount, index) => `P${index},p${index}@example.com,${amount},1,2026-08-10,GB`)
      .join('\n')
    const result = run(`${HEADERS}\n${rows}\n`)
    expect(result.totals.proposedAmountUsd).toBe('2.80')
  })
})

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('ada@example.com')).toBe(true)
    expect(isValidEmail('ada.lovelace+spv@sub.example.co.uk')).toBe(true)
  })

  it('rejects the shapes that break a send', () => {
    for (const bad of [
      'ada',
      'ada@',
      '@example.com',
      'ada@example',
      'ada @example.com',
      'ada@exam ple.com',
      'ada@example..com',
      'a,b@example.com',
      '<ada@example.com>',
      `${'a'.repeat(250)}@example.com`,
    ]) {
      expect(isValidEmail(bad), bad).toBe(false)
    }
  })
})
