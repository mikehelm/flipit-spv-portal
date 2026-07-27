import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMAIL_REVIEW_CLAUSES,
  ORIGINAL_EMAIL_TEXT,
  REVISED_EMAIL_TEXT,
} from './document'

function source(name: string): string {
  return readFileSync(join(process.cwd(), name), 'utf8').trimEnd()
}

describe('the preserved email-review document', () => {
  it('keeps David’s original byte-for-byte with the retrieved plaintext', () => {
    expect(ORIGINAL_EMAIL_TEXT).toBe(source('David_Serene_Original_Email_2026-07-25.txt'))
  })

  it('keeps the revised email byte-for-byte with the canonical template', () => {
    expect(REVISED_EMAIL_TEXT).toBe(source('EMAIL_TEMPLATE.txt'))
    expect(createHash('sha256').update(`${REVISED_EMAIL_TEXT}\n`).digest('hex')).toBe(
      'f1491501cdf2c8a2e00309fd53a14a6d3dbc3f9f884bf7eaf8a4084f5ff65554',
    )
  })

  it('has one unique, evidence-labelled record for every reviewed clause', () => {
    expect(EMAIL_REVIEW_CLAUSES).toHaveLength(20)
    expect(new Set(EMAIL_REVIEW_CLAUSES.map((clause) => clause.id)).size).toBe(20)

    const counts = EMAIL_REVIEW_CLAUSES.reduce(
      (found, clause) => {
        found[clause.evidenceKind] += 1
        return found
      },
      { SPEC: 0, TEST: 0, UNVERIFIED: 0 },
    )
    expect(counts).toEqual({ SPEC: 8, TEST: 6, UNVERIFIED: 6 })
  })

  it('does not soften an unknown reason into speculation', () => {
    for (const clause of EMAIL_REVIEW_CLAUSES.filter(
      (entry) => entry.evidenceKind === 'UNVERIFIED',
    )) {
      expect(clause.reason).toBe('Reason not recorded anywhere.')
      expect(clause.evidence).toBe('Reason not recorded anywhere.')
      expect(clause.reason).not.toMatch(/likely|probably|may have|perhaps/i)
    }
  })
})
