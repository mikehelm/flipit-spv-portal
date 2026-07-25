import { describe, expect, it } from 'vitest'
import { encodeVerifyResult, parseVerifyResult } from './verify-result'
import type { VerifyResult } from './types'

const CHECKED_AT = new Date('2026-07-25T12:00:00.000Z')

function result(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return { ok: true, checkedAt: CHECKED_AT, detail: 'Authenticated.', ...overrides }
}

describe('encodeVerifyResult', () => {
  it('encodes a pass', () => {
    expect(encodeVerifyResult(result())).toBe('OK: Authenticated.')
  })

  it('encodes a permanent failure distinguishably from a transient one', () => {
    const permanent = encodeVerifyResult(
      result({
        ok: false,
        detail: 'Rejected.',
        failure: {
          kind: 'PERMANENT',
          reason: 'AUTH_REJECTED',
          retryable: false,
          code: 'EAUTH',
          responseCode: 535,
          message: 'Rejected.',
        },
      }),
    )
    const transient = encodeVerifyResult(result({ ok: false, detail: 'Timed out.' }))

    expect(permanent).toBe('FAILED_PERMANENT: Rejected.')
    expect(transient).toBe('FAILED_TRANSIENT: Timed out.')
  })

  it('flattens whitespace and bounds the length', () => {
    const encoded = encodeVerifyResult(result({ detail: `a\n b   c${'x'.repeat(1000)}` }))
    expect(encoded).not.toContain('\n')
    expect(encoded.length).toBeLessThanOrEqual(505)
  })
})

describe('parseVerifyResult', () => {
  it('reads back what it wrote', () => {
    expect(parseVerifyResult(encodeVerifyResult(result()))).toEqual({
      ok: true,
      detail: 'Authenticated.',
    })
  })

  it('distinguishes never-checked from failed', () => {
    expect(parseVerifyResult(null)).toBeNull()
    expect(parseVerifyResult(undefined)).toBeNull()
    expect(parseVerifyResult('   ')).toBeNull()
  })

  it('reads a bare OK with no detail', () => {
    expect(parseVerifyResult('OK')).toEqual({ ok: true, detail: null })
  })

  it('reads any FAILED variant as a failure', () => {
    expect(parseVerifyResult('FAILED_PERMANENT: nope')?.ok).toBe(false)
    expect(parseVerifyResult('FAILED_TRANSIENT: later')?.ok).toBe(false)
    expect(parseVerifyResult('FAILED')?.ok).toBe(false)
  })

  it('refuses to read anything it does not recognise as a pass', () => {
    // This is the safety property. A free-text column someone wrote by hand,
    // or a value from an older encoding, must never be mistaken for success.
    for (const value of ['fine', 'success', 'verified ok', 'true', '250 OK', 'okay']) {
      const parsed = parseVerifyResult(value)
      expect(parsed?.ok).toBe(false)
      expect(parsed?.detail).toMatch(/unrecognised/i)
    }
  })

  it('is not fooled by case', () => {
    expect(parseVerifyResult('ok: fine')?.ok).toBe(true)
    expect(parseVerifyResult('failed_permanent: nope')?.ok).toBe(false)
  })
})
