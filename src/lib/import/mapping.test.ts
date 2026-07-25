import { describe, expect, it } from 'vitest'
import {
  applyMapping,
  answerForField,
  buildQuestions,
  checkMapping,
  proposeMappingFromHeaders,
  type ConfirmedMapping,
} from './mapping'
import { readTable, type SheetTable } from './table'

function table(csv: string): SheetTable {
  const result = readTable('list.csv', new TextEncoder().encode(csv))
  if (!result.ok) throw new Error(result.message)
  return result.table
}

/** Renamed, reordered, with extra columns — BUILD_SPEC §9.1 step 1, AC23. */
const AWKWARD = [
  'Notes,Who,Respond By,Stake,Where,How much,Owner',
  'knows David,ada@example.com,10/08/2026,5,GB,1500,Ada Lovelace',
  'intro via Sam,grace@example.com,11/08/2026,7.5,AU,2500,Grace Hopper',
].join('\n')

describe('proposeMappingFromHeaders — the no-key path, AC24', () => {
  it('maps a straightforwardly named file', () => {
    const proposal = proposeMappingFromHeaders(
      table('recipient_name,recipient_email,investment_amount_usd,spv_percentage,response_deadline,recipient_jurisdiction\nA,a@example.com,1,1,2026-08-10,GB\n'),
    )
    expect(proposal.source).toBe('HEURISTIC')
    expect(proposal.notes).toEqual([])
    const mapped = Object.fromEntries(
      proposal.columns.map((column) => [column.sourceColumn, column.targetField]),
    )
    expect(mapped.recipient_email).toBe('recipient_email')
    expect(mapped.spv_percentage).toBe('spv_percentage')
  })

  it('reads a column by what is in it when the header is unhelpful', () => {
    const proposal = proposeMappingFromHeaders(table(AWKWARD))
    const mapped = Object.fromEntries(
      proposal.columns.map((column) => [column.sourceColumn, column.targetField]),
    )
    expect(mapped.Who).toBe('recipient_email')
    expect(mapped['Respond By']).toBe('response_deadline')
    expect(mapped.Where).toBe('recipient_jurisdiction')
    expect(mapped.Stake).toBe('spv_percentage')
    expect(mapped['How much']).toBe('investment_amount_usd')
    expect(mapped.Notes).toBe('internal_notes')
  })

  it('never proposes the same field twice', () => {
    const proposal = proposeMappingFromHeaders(
      table('email,email address,contact email\na@example.com,b@example.com,c@example.com\n'),
    )
    const used = proposal.columns.map((column) => column.targetField).filter(Boolean)
    expect(new Set(used).size).toBe(used.length)
  })

  it('says which required fields it could not find rather than inventing one', () => {
    const proposal = proposeMappingFromHeaders(table('colour,shape\nred,round\n'))
    expect(proposal.columns.every((column) => column.targetField === null)).toBe(true)
    expect(proposal.notes[0]).toMatch(/recipient_name/)
  })
})

describe('checkMapping — the mapping is checked on the server, every time', () => {
  const sheet = table(AWKWARD)

  const complete: ConfirmedMapping = {
    assignments: [
      { sourceColumn: 'Owner', targetField: 'recipient_name' },
      { sourceColumn: 'Who', targetField: 'recipient_email' },
      { sourceColumn: 'How much', targetField: 'investment_amount_usd' },
      { sourceColumn: 'Stake', targetField: 'spv_percentage' },
      { sourceColumn: 'Respond By', targetField: 'response_deadline' },
      { sourceColumn: 'Where', targetField: 'recipient_jurisdiction' },
    ],
    answers: { 'Respond By': { dateOrder: 'DMY' } },
  }

  it('passes a complete, answered mapping', () => {
    expect(checkMapping(sheet, complete)).toEqual([])
  })

  it('refuses a missing required field', () => {
    const problems = checkMapping(sheet, {
      ...complete,
      assignments: complete.assignments.filter(
        (assignment) => assignment.targetField !== 'recipient_email',
      ),
    })
    expect(problems.map((problem) => problem.code)).toContain('MISSING_REQUIRED_FIELD')
  })

  it('refuses two columns claiming the same field', () => {
    const problems = checkMapping(sheet, {
      ...complete,
      assignments: [
        ...complete.assignments,
        { sourceColumn: 'Notes', targetField: 'recipient_email' },
      ],
    })
    expect(problems.map((problem) => problem.code)).toContain('DUPLICATE_FIELD')
  })

  it('refuses a column that is not in the file', () => {
    const problems = checkMapping(sheet, {
      ...complete,
      assignments: [...complete.assignments, { sourceColumn: 'Invented', targetField: 'sender_name' }],
    })
    expect(problems.map((problem) => problem.code)).toContain('UNKNOWN_COLUMN')
  })

  it('refuses to proceed while an ambiguity is unanswered — AC26', () => {
    const problems = checkMapping(sheet, { ...complete, answers: {} })
    expect(problems.map((problem) => problem.code)).toEqual(['UNANSWERED_QUESTION'])
    expect(problems[0].sourceColumn).toBe('Respond By')
  })
})

describe('buildQuestions', () => {
  it('asks about a date column that could go either way', () => {
    const sheet = table(AWKWARD)
    const questions = buildQuestions(sheet, [
      { sourceColumn: 'Respond By', targetField: 'response_deadline' },
    ])
    expect(questions).toHaveLength(1)
    expect(questions[0].ambiguity.kind).toBe('DATE_FIELD_ORDER')
  })

  it('asks about a percentage column that could be a fraction', () => {
    const sheet = table('pct\n0.05\n0.075\n')
    const questions = buildQuestions(sheet, [{ sourceColumn: 'pct', targetField: 'spv_percentage' }])
    expect(questions[0].ambiguity.kind).toBe('PERCENTAGE_SCALE')
  })

  it('asks about a comma that could be a decimal mark', () => {
    const sheet = table('amount\n"1,500"\n"2,000"\n')
    const questions = buildQuestions(sheet, [
      { sourceColumn: 'amount', targetField: 'investment_amount_usd' },
    ])
    expect(questions[0].ambiguity.kind).toBe('DECIMAL_SEPARATOR')
  })

  it('asks nothing when nothing is ambiguous', () => {
    const sheet = table('amount,pct,due\n1500.00,5%,2026-08-10\n')
    expect(
      buildQuestions(sheet, [
        { sourceColumn: 'amount', targetField: 'investment_amount_usd' },
        { sourceColumn: 'pct', targetField: 'spv_percentage' },
        { sourceColumn: 'due', targetField: 'response_deadline' },
      ]),
    ).toEqual([])
  })
})

describe('applyMapping', () => {
  it('pulls the mapped cells out and keeps the source row number', () => {
    const sheet = table(AWKWARD)
    const rows = applyMapping(sheet, {
      assignments: [
        { sourceColumn: 'Owner', targetField: 'recipient_name' },
        { sourceColumn: 'Who', targetField: 'recipient_email' },
      ],
      answers: {},
    })
    expect(rows).toEqual([
      { sourceRowNumber: 2, values: { recipient_name: 'Ada Lovelace', recipient_email: 'ada@example.com' } },
      { sourceRowNumber: 3, values: { recipient_name: 'Grace Hopper', recipient_email: 'grace@example.com' } },
    ])
  })

  it('ignores an assignment for a column the file does not have', () => {
    const sheet = table('a\n1\n')
    const rows = applyMapping(sheet, {
      assignments: [{ sourceColumn: 'nope', targetField: 'recipient_name' }],
      answers: {},
    })
    expect(rows[0].values).toEqual({})
  })
})

describe('answerForField', () => {
  it('finds the answer given for whichever column feeds a field', () => {
    const mapping: ConfirmedMapping = {
      assignments: [{ sourceColumn: 'Stake', targetField: 'spv_percentage' }],
      answers: { Stake: { percentageInterpretation: 'FRACTION' } },
    }
    expect(answerForField(mapping, 'spv_percentage')).toEqual({
      percentageInterpretation: 'FRACTION',
    })
    expect(answerForField(mapping, 'investment_amount_usd')).toEqual({})
  })
})
