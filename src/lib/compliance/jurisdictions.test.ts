import { describe, expect, it } from 'vitest'
import {
  hasRecordedOverride,
  isJurisdictionApproved,
  jurisdictionLabel,
  MIN_APPROVAL_REFERENCE_LENGTH,
  normaliseJurisdiction,
  parseApprovedJurisdictions,
} from './jurisdictions'

/** BUILD_SPEC §8.2 item 3, §8.3. */

const approval = (codes: string[], voidedAt: Date | null = null) => ({
  approvedJurisdictions: codes,
  voidedAt,
})

describe('normaliseJurisdiction', () => {
  it('accepts a real code in any case, with whitespace', () => {
    expect(normaliseJurisdiction('  gb ')).toBe('GB')
    expect(normaliseJurisdiction('Au')).toBe('AU')
  })

  it('rejects anything that is not an assigned ISO 3166-1 alpha-2 code', () => {
    expect(normaliseJurisdiction('UK')).toBeNull() // exceptional reservation, not a code
    expect(normaliseJurisdiction('XX')).toBeNull()
    expect(normaliseJurisdiction('GBR')).toBeNull()
    expect(normaliseJurisdiction('')).toBeNull()
    expect(normaliseJurisdiction(null)).toBeNull()
    expect(normaliseJurisdiction(undefined)).toBeNull()
  })
})

describe('isJurisdictionApproved', () => {
  it('clears a code that is on the list', () => {
    expect(isJurisdictionApproved('GB', approval(['GB', 'AU', 'FR']))).toBe(true)
  })

  it('is case and whitespace insensitive on both sides', () => {
    expect(isJurisdictionApproved(' au ', approval(['gb', 'AU']))).toBe(true)
  })

  it('refuses a code that is not on the list', () => {
    expect(isJurisdictionApproved('US', approval(['GB', 'AU', 'FR', 'TH']))).toBe(false)
  })

  // Every one of these is a "fail closed" case. They are the whole point.
  it('refuses when there is no approval at all', () => {
    expect(isJurisdictionApproved('GB', null)).toBe(false)
    expect(isJurisdictionApproved('GB', undefined)).toBe(false)
  })

  it('refuses when the approval has been voided, however complete it looks', () => {
    expect(isJurisdictionApproved('GB', approval(['GB'], new Date()))).toBe(false)
  })

  it('refuses a missing or unusable jurisdiction rather than treating it as cleared', () => {
    expect(isJurisdictionApproved(null, approval(['GB']))).toBe(false)
    expect(isJurisdictionApproved('', approval(['GB']))).toBe(false)
    expect(isJurisdictionApproved('XX', approval(['GB', 'XX']))).toBe(false)
  })

  it('refuses when the approved list is empty', () => {
    expect(isJurisdictionApproved('GB', approval([]))).toBe(false)
  })
})

describe('parseApprovedJurisdictions', () => {
  it('reads a comma-separated list and sorts and deduplicates it', () => {
    const result = parseApprovedJurisdictions('TH, gb ,AU,FR,GB')
    expect(result.codes).toEqual(['AU', 'FR', 'GB', 'TH'])
    expect(result.rejected).toEqual([])
  })

  it('reads a space-separated list too', () => {
    expect(parseApprovedJurisdictions('GB AU FR').codes).toEqual(['AU', 'FR', 'GB'])
  })

  it('expands a bloc to its member codes at the moment of recording (§8.2)', () => {
    const result = parseApprovedJurisdictions('EU, GB')
    expect(result.codes).toContain('FR')
    expect(result.codes).toContain('DE')
    expect(result.codes).toContain('GB')
    expect(result.codes).toHaveLength(28) // 27 EU members plus GB
    expect(result.expansions).toHaveLength(1)
    expect(result.expansions[0].token).toBe('EU')
  })

  it('expands the EEA to the EU plus Iceland, Liechtenstein and Norway', () => {
    const result = parseApprovedJurisdictions('EEA')
    expect(result.codes).toHaveLength(30)
    expect(result.codes).toContain('NO')
    expect(result.codes).toContain('IS')
    expect(result.codes).toContain('LI')
  })

  it('refuses shorthand that has no defined membership rather than guessing', () => {
    const result = parseApprovedJurisdictions('Europe, worldwide, GB')
    expect(result.codes).toEqual(['GB'])
    expect(result.rejected.map((item) => item.token)).toEqual(['Europe', 'worldwide'])
    expect(result.rejected[0].message).toMatch(/not an ISO 3166-1 alpha-2 country code/)
  })

  it('refuses country names — an approval is typed once, by hand, and is not the place to resolve them', () => {
    const result = parseApprovedJurisdictions('United Kingdom')
    expect(result.codes).toEqual([])
    expect(result.rejected).toHaveLength(2)
  })
})

describe('hasRecordedOverride', () => {
  it('accepts a real reference', () => {
    expect(hasRecordedOverride('Ref: Baker & Co letter 2026-07-20')).toBe(true)
  })

  it('refuses an empty, blank, missing or token reference — there is no blanket unblock', () => {
    expect(hasRecordedOverride(null)).toBe(false)
    expect(hasRecordedOverride(undefined)).toBe(false)
    expect(hasRecordedOverride('')).toBe(false)
    expect(hasRecordedOverride('     ')).toBe(false)
    expect(hasRecordedOverride('ok')).toBe(false)
    expect(hasRecordedOverride('x'.repeat(MIN_APPROVAL_REFERENCE_LENGTH - 1))).toBe(false)
    expect(hasRecordedOverride('x'.repeat(MIN_APPROVAL_REFERENCE_LENGTH))).toBe(true)
  })
})

describe('jurisdictionLabel', () => {
  it('names the country so the operator is not reading two-letter codes', () => {
    expect(jurisdictionLabel('US')).toBe('United States (US)')
    expect(jurisdictionLabel('GB')).toBe('United Kingdom (GB)')
  })

  it('falls back to the raw value rather than inventing a country', () => {
    expect(jurisdictionLabel('XX')).toBe('XX')
  })
})
