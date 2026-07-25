import { describe, expect, it } from 'vitest'
import {
  countryName,
  isIsoAlpha2,
  ISO_3166_1_ALPHA_2,
  resolveJurisdiction,
} from './iso-countries'

describe('the code list', () => {
  it('is the 249 currently assigned ISO 3166-1 alpha-2 codes', () => {
    expect(ISO_3166_1_ALPHA_2).toHaveLength(249)
    const codes = ISO_3166_1_ALPHA_2.map(([code]) => code)
    expect(new Set(codes).size).toBe(249)
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true)
  })

  it('holds the codes this round actually needs', () => {
    for (const code of ['GB', 'AU', 'FR', 'TH', 'US', 'VG', 'HK', 'NZ', 'SG']) {
      expect(isIsoAlpha2(code), code).toBe(true)
    }
    expect(countryName('GB')).toBe('United Kingdom')
    expect(countryName('zz')).toBeNull()
  })

  it('excludes blocs, withdrawn codes and non-ISO reservations', () => {
    for (const code of ['EU', 'UK', 'XK', 'AN', 'SU', 'YU', 'ZZ', 'QO']) {
      expect(isIsoAlpha2(code), code).toBe(false)
    }
  })
})

describe('resolveJurisdiction', () => {
  it('takes a code as written', () => {
    const result = resolveJurisdiction(' gb ')
    expect(result.ok && result.code).toBe('GB')
    expect(result.ok && result.from).toBe('CODE')
  })

  it('takes a country name and says it read one', () => {
    const result = resolveJurisdiction('United Kingdom')
    expect(result.ok && result.code).toBe('GB')
    expect(result.ok && result.from).toBe('NAME')
    expect(resolveJurisdiction('france').ok && resolveJurisdiction('france')).toMatchObject({
      code: 'FR',
    })
  })

  it('takes the everyday names people actually write', () => {
    const cases: Array<[string, string]> = [
      ['England', 'GB'],
      ['UK', 'GB'],
      ['USA', 'US'],
      ['United States of America', 'US'],
      ['Czech Republic', 'CZ'],
      ['South Korea', 'KR'],
      ['British Virgin Islands', 'VG'],
    ]
    for (const [input, expected] of cases) {
      const result = resolveJurisdiction(input)
      expect(result.ok && result.code, input).toBe(expected)
    }
  })

  it('handles accents and punctuation', () => {
    expect(resolveJurisdiction('Côte d’Ivoire').ok).toBe(true)
    expect(resolveJurisdiction("Cote d'Ivoire").ok).toBe(true)
    expect(resolveJurisdiction('cote d ivoire').ok).toBe(true)
  })

  it('refuses a bloc with an explanation rather than picking a member', () => {
    const result = resolveJurisdiction('European Union')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('BLOC_OR_REGION')
    expect(result.message).toMatch(/individual country codes/)
  })

  it('refuses a city, a region and a blank', () => {
    expect(resolveJurisdiction('Bangkok').ok).toBe(false)
    expect(resolveJurisdiction('EMEA').ok).toBe(false)
    expect(resolveJurisdiction('   ').ok).toBe(false)
  })

  it('never resolves something it is only vaguely like', () => {
    expect(resolveJurisdiction('Great').ok).toBe(false)
    expect(resolveJurisdiction('United').ok).toBe(false)
    expect(resolveJurisdiction('G').ok).toBe(false)
  })
})
