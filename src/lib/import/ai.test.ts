import { describe, expect, it } from 'vitest'
import {
  buildSample,
  buildUserPrompt,
  describePrompt,
  MAX_SAMPLE_ROWS,
  normaliseProposal,
} from './ai'
import { readTable, type SheetTable } from './table'

function table(rowCount: number): SheetTable {
  const rows = Array.from(
    { length: rowCount },
    (_, index) => `Person ${index},p${index}@example.com,1500,5,2026-08-10,GB`,
  ).join('\n')
  const result = readTable(
    'list.csv',
    new TextEncoder().encode(`Name,Email,Amount,Stake,Due,Country\n${rows}\n`),
  )
  if (!result.ok) throw new Error(result.message)
  return result.table
}

describe('what leaves the system — BUILD_SPEC §9.1', () => {
  it('sends at most five rows however long the file is', () => {
    const sample = buildSample(table(40), false)
    expect(MAX_SAMPLE_ROWS).toBe(5)
    expect(sample.sampleRows).toHaveLength(5)
    expect(sample.headers).toEqual(['Name', 'Email', 'Amount', 'Stake', 'Due', 'Country'])
  })

  it('the prompt contains no row beyond the sample', () => {
    const sheet = table(40)
    const prompt = buildUserPrompt(buildSample(sheet, false))
    expect(prompt).toContain('p0@example.com')
    expect(prompt).toContain('p4@example.com')
    expect(prompt).not.toContain('p5@example.com')
    expect(prompt).not.toContain('p39@example.com')
  })

  it('headers-only mode sends no values at all', () => {
    const sample = buildSample(table(40), true)
    expect(sample.sampleRows).toEqual([])
    const prompt = buildUserPrompt(sample)
    expect(prompt).not.toContain('@example.com')
    expect(prompt).not.toContain('1500')
    expect(prompt).toContain('Name')
  })

  it('truncates a very long cell rather than sending it whole', () => {
    const result = readTable(
      'list.csv',
      new TextEncoder().encode(`Notes\n"${'x'.repeat(500)}"\n`),
    )
    if (!result.ok) throw new Error(result.message)
    expect(buildSample(result.table, false).sampleRows[0][0].length).toBeLessThanOrEqual(121)
  })

  it('describes the request without repeating the data in it', () => {
    const summary = describePrompt(buildSample(table(40), false), 'gpt-4o-mini')
    expect(summary).toContain('sample_rows_sent=5')
    expect(summary).toContain('headers_only=false')
    expect(summary).not.toContain('@example.com')
  })
})

describe('normaliseProposal — nothing the model says is trusted', () => {
  const headers = ['Name', 'Email', 'Amount']

  it('accepts a well-formed proposal', () => {
    const proposal = normaliseProposal(
      headers,
      JSON.stringify({
        mappings: [
          { source_column: 'Name', target_field: 'recipient_name', confidence: 'HIGH' },
          { source_column: 'Email', target_field: 'recipient_email', confidence: 'HIGH' },
          { source_column: 'Amount', target_field: null },
        ],
      }),
      'test-model',
    )
    expect(proposal.source).toBe('AI')
    expect(proposal.columns.map((column) => column.targetField)).toEqual([
      'recipient_name',
      'recipient_email',
      null,
    ])
  })

  it('always returns one entry per real column, in file order', () => {
    const proposal = normaliseProposal(
      headers,
      JSON.stringify({ mappings: [{ source_column: 'Amount', target_field: 'investment_amount_usd' }] }),
      'test-model',
    )
    expect(proposal.columns.map((column) => column.sourceColumn)).toEqual(headers)
  })

  it('drops a column the file does not have', () => {
    const proposal = normaliseProposal(
      headers,
      JSON.stringify({ mappings: [{ source_column: 'Invented', target_field: 'recipient_name' }] }),
      'test-model',
    )
    expect(proposal.columns.every((column) => column.targetField === null)).toBe(true)
    expect(proposal.notes.join(' ')).toMatch(/not a column in this file/)
  })

  it('drops a field that does not exist', () => {
    const proposal = normaliseProposal(
      headers,
      JSON.stringify({ mappings: [{ source_column: 'Name', target_field: 'wire_transfer_reference' }] }),
      'test-model',
    )
    expect(proposal.columns[0].targetField).toBeNull()
    expect(proposal.notes.join(' ')).toMatch(/not a field of this import/)
  })

  it('refuses to let two columns claim the same field', () => {
    const proposal = normaliseProposal(
      headers,
      JSON.stringify({
        mappings: [
          { source_column: 'Name', target_field: 'recipient_name' },
          { source_column: 'Email', target_field: 'recipient_name' },
        ],
      }),
      'test-model',
    )
    expect(proposal.columns[0].targetField).toBe('recipient_name')
    expect(proposal.columns[1].targetField).toBeNull()
    expect(proposal.notes.join(' ')).toMatch(/left unmapped for you to decide/)
  })

  it('survives a non-JSON answer and falls back to nothing mapped', () => {
    const proposal = normaliseProposal(headers, 'I think column one is the name.', 'test-model')
    expect(proposal.columns.every((column) => column.targetField === null)).toBe(true)
    expect(proposal.notes[0]).toMatch(/did not return usable JSON/)
  })

  it('survives a well-formed JSON answer of the wrong shape', () => {
    const proposal = normaliseProposal(headers, JSON.stringify({ answer: 42 }), 'test-model')
    expect(proposal.columns.every((column) => column.targetField === null)).toBe(true)
    expect(proposal.notes[0]).toMatch(/unexpected shape/)
  })

  it('carries no numbers across the boundary — only column names', () => {
    const proposal = normaliseProposal(
      headers,
      JSON.stringify({
        mappings: [
          {
            source_column: 'Amount',
            target_field: 'investment_amount_usd',
            confidence: 'HIGH',
            converted_values: [1500.5, 2000],
            total: 3500.5,
          },
        ],
        indirect_percentage: 9.99,
      }),
      'test-model',
    )
    const serialised = JSON.stringify(proposal)
    expect(serialised).not.toContain('1500.5')
    expect(serialised).not.toContain('3500.5')
    expect(serialised).not.toContain('9.99')
  })
})
