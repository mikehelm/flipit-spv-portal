import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  estimateCallCostUsd,
  isPricedModel,
  startOfMonthUtc,
  summariseSpend,
} from './spend'

/**
 * BUILD_SPEC §9.1 — a spend cap, and usage shown on the settings page.
 *
 * The decision the owner took is that the cap **warns and does not block**. The
 * test that matters most in this file is the one asserting there is no state,
 * no return value and no exported function here that an import could read as
 * "stop". If somebody later makes going over the cap fatal, it should be a
 * decision taken on purpose, and this test is what makes them notice.
 */

describe('the cost of one call', () => {
  it('prices a known model from its token counts', () => {
    // gpt-4o-mini: $0.15 per million in, $0.60 per million out.
    // 1000 in  = 0.00015; 500 out = 0.0003. Total 0.00045.
    expect(estimateCallCostUsd('gpt-4o-mini', { promptTokens: 1000, completionTokens: 500 })).toBe(
      '0.000450',
    )
  })

  it('keeps six decimal places, because one call costs a fraction of a cent', () => {
    // Rounded to two places this would be 0.00, and a month of it would sum
    // to nothing at all.
    const cost = estimateCallCostUsd('gpt-4o-mini', { promptTokens: 900, completionTokens: 300 })
    expect(cost).toMatch(/^\d+\.\d{6}$/)
    expect(Number(cost)).toBeGreaterThan(0)
  })

  it('prices an unknown model at zero rather than guessing', () => {
    expect(estimateCallCostUsd('some-model-nobody-listed', { promptTokens: 1000, completionTokens: 1000 })).toBe(
      '0.000000',
    )
    expect(isPricedModel('some-model-nobody-listed')).toBe(false)
    expect(isPricedModel('gpt-4o-mini')).toBe(true)
  })

  it('costs nothing for a call that consumed nothing', () => {
    expect(estimateCallCostUsd('gpt-4o-mini', { promptTokens: 0, completionTokens: 0 })).toBe(
      '0.000000',
    )
  })

  it('is exact where floating point would drift', () => {
    // Ten identical calls, summed. As doubles this accumulates error.
    const one = estimateCallCostUsd('gpt-4o-mini', { promptTokens: 700, completionTokens: 100 })
    const summary = summariseSpend({ costs: Array(10).fill(one), capUsd: '20' })
    // 0.000165 × 10 = 0.00165, which rounds to 0.00 at two places.
    expect(summary.spentUsd).toBe('0.00')
    expect(summary.callCount).toBe(10)
  })
})

describe('the cap warns and never blocks', () => {
  it('reports OVER_CAP but says imports carry on', () => {
    const summary = summariseSpend({ costs: ['25.000000'], capUsd: '20' })
    expect(summary.state).toBe('OVER_CAP')
    expect(summary.message).toMatch(/carry on working|warns rather than blocks/i)
    expect(summary.message).not.toMatch(/blocked|refused|cannot import|disabled/i)
  })

  it('exposes nothing an import could read as a refusal', () => {
    const summary = summariseSpend({ costs: ['1000.000000'], capUsd: '1' })
    // Whatever else this object says, it must not say "stop".
    const keys = Object.keys(summary)
    expect(keys).not.toContain('blocked')
    expect(keys).not.toContain('allowed')
    expect(keys).not.toContain('canProceed')
    expect(keys).not.toContain('refuse')
  })

  it('has no function in the module that answers "may I spend?"', () => {
    const source = readFileSync(new URL('./spend.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/function\s+(assert|require|enforce)Spend/i)
    expect(source).not.toMatch(/throw new .*(Cap|Spend|Budget)/i)
    expect(source).not.toMatch(/\bSpendExceededError\b/)
  })

  it('floors the remaining figure at zero rather than going negative', () => {
    expect(summariseSpend({ costs: ['30.000000'], capUsd: '20' }).remainingUsd).toBe('0.00')
  })
})

describe('the warning arrives before the overrun, not with it', () => {
  it('warns at eighty per cent', () => {
    expect(summariseSpend({ costs: ['16.000000'], capUsd: '20' }).state).toBe('APPROACHING_CAP')
    expect(summariseSpend({ costs: ['15.990000'], capUsd: '20' }).state).toBe('WITHIN_CAP')
  })

  it('treats hitting the cap exactly as over, not as within', () => {
    expect(summariseSpend({ costs: ['20.000000'], capUsd: '20' }).state).toBe('OVER_CAP')
  })

  it('says how much is left while there is some', () => {
    const summary = summariseSpend({ costs: ['5.000000'], capUsd: '20' })
    expect(summary.remainingUsd).toBe('15.00')
    expect(summary.message).toContain('$15.00')
  })
})

describe('a cap of zero means no cap', () => {
  it('does not treat an unset field as a cap of nothing', () => {
    const summary = summariseSpend({ costs: ['1.000000'], capUsd: '0' })
    expect(summary.state).toBe('NO_CAP')
    expect(summary.message).toMatch(/no monthly cap is set/i)
  })
})

describe('an unpriced model is reported, not hidden', () => {
  it('says the real figure is higher', () => {
    const summary = summariseSpend({
      costs: ['0.000450', '0.000000'],
      capUsd: '20',
      models: ['gpt-4o-mini', 'some-new-model'],
    })
    expect(summary.unpricedModels).toEqual(['some-new-model'])
    expect(summary.message).toMatch(/not in the price list/i)
    expect(summary.message).toMatch(/higher than this/i)
  })

  it('says nothing when every model is priced', () => {
    const summary = summariseSpend({
      costs: ['0.000450'],
      capUsd: '20',
      models: ['gpt-4o-mini'],
    })
    expect(summary.unpricedModels).toEqual([])
    expect(summary.message).not.toMatch(/price list/i)
  })
})

describe('no money value is ever a JavaScript number', () => {
  it('returns every amount as a string', () => {
    const summary = summariseSpend({ costs: ['1.500000'], capUsd: '20' })
    expect(typeof summary.spentUsd).toBe('string')
    expect(typeof summary.capUsd).toBe('string')
    expect(typeof summary.remainingUsd).toBe('string')
  })

  it('never coerces one in the module itself', () => {
    // Comments stripped, so the module's own prose about avoiding Number()
    // does not trip the check that it avoids Number().
    const code = readFileSync(new URL('./spend.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

    expect(code).not.toMatch(/\bNumber\(/)
    expect(code).not.toMatch(/\bparseFloat\(/)
    expect(code).not.toMatch(/\.toNumber\(/)
    // The stripper still left real code behind.
    expect(code).toMatch(/export function summariseSpend/)
  })

  it('carries an amount larger than a double could hold exactly', () => {
    const summary = summariseSpend({
      costs: ['123456789012345678.99', '0.01'],
      capUsd: '999999999999999999',
    })
    expect(summary.spentUsd).toBe('123456789012345679.00')
  })
})

describe('the month boundary is UTC', () => {
  it('does not move with the viewer’s timezone', () => {
    const start = startOfMonthUtc(new Date('2026-07-25T18:30:00Z'))
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('handles the first instant of a month', () => {
    const start = startOfMonthUtc(new Date('2026-08-01T00:00:00Z'))
    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })
})
