import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeIndirectPercentage,
  Dec,
  detectAmountAmbiguity,
  detectDateAmbiguity,
  detectPercentageAmbiguity,
  formatMoney,
  formatPercentage,
  inferDecimalSeparator,
  isoDateIsBefore,
  isoToday,
  MONEY_SCALE,
  PERCENTAGE_SCALE,
  parseDate,
  parseMoney,
  parsePercentage,
  sumDecimals,
  toStorageString,
} from './money'

function value(result: ReturnType<typeof parseMoney>): string {
  if (!result.ok) throw new Error(`expected a parse, got ${result.code}: ${result.message}`)
  return result.value.toFixed()
}

describe('parseMoney — the shapes a spreadsheet produces', () => {
  it('reads a plain number', () => {
    expect(value(parseMoney('1500'))).toBe('1500')
  })

  it('reads thousands separators', () => {
    expect(value(parseMoney('1,500'))).toBe('1500')
    expect(value(parseMoney('1,234,567.89'))).toBe('1234567.89')
  })

  it('reads a currency symbol', () => {
    expect(value(parseMoney('$1,500.00'))).toBe('1500')
    expect(value(parseMoney('£250'))).toBe('250')
    expect(value(parseMoney('USD 1,500'))).toBe('1500')
    expect(value(parseMoney('1500 AUD'))).toBe('1500')
  })

  it('reads parentheses as negative', () => {
    expect(value(parseMoney('(500)'))).toBe('-500')
    expect(value(parseMoney('($1,500.00)'))).toBe('-1500')
  })

  it('reads a magnitude suffix', () => {
    expect(value(parseMoney('1.5k'))).toBe('1500')
    expect(value(parseMoney('2K'))).toBe('2000')
    expect(value(parseMoney('1.25m'))).toBe('1250000')
  })

  it('reads whitespace-padded values', () => {
    expect(value(parseMoney(' 5 '))).toBe('5')
    expect(value(parseMoney(' 1 500 '))).toBe('1500')
  })

  it('reads a leading decimal point', () => {
    expect(value(parseMoney('.75'))).toBe('0.75')
  })

  it('reads a decimal comma when told to', () => {
    expect(value(parseMoney('1.500,25', { decimalSeparator: ',' }))).toBe('1500.25')
    expect(value(parseMoney('1,5', { decimalSeparator: ',' }))).toBe('1.5')
  })

  it('records what it had to do to read the value', () => {
    const result = parseMoney('($1,500.00)')
    if (!result.ok) throw new Error('expected a parse')
    expect(result.notes).toContain('NEGATIVE_FROM_PARENTHESES')
    expect(result.notes).toContain('CURRENCY_SYMBOL_REMOVED')
    expect(result.notes).toContain('GROUPING_SEPARATORS_REMOVED')
    expect(result.raw).toBe('($1,500.00)')
  })

  it('refuses junk rather than reading part of it', () => {
    expect(parseMoney('twelve hundred').ok).toBe(false)
    expect(parseMoney('1500abc').ok).toBe(false)
    expect(parseMoney('1.2.3').ok).toBe(false)
    expect(parseMoney('').ok).toBe(false)
    expect(parseMoney(null).ok).toBe(false)
    expect(parseMoney(undefined).ok).toBe(false)
  })

  it('can refuse a negative when the field forbids one', () => {
    const result = parseMoney('(500)', { allowNegative: false })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('OUT_OF_RANGE')
  })

  it('REJECTS a JavaScript number outright', () => {
    const result = parseMoney(1500)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('JS_NUMBER_REJECTED')
  })
})

describe('parsePercentage', () => {
  it('reads a signed percentage', () => {
    expect(value(parsePercentage('5%'))).toBe('5')
    expect(value(parsePercentage('5 %'))).toBe('5')
  })

  it('reads a bare number literally by default', () => {
    expect(value(parsePercentage(' 5 '))).toBe('5')
    expect(value(parsePercentage('0.05'))).toBe('0.05')
  })

  it('scales a bare number when told it is a fraction', () => {
    expect(value(parsePercentage('0.05', { interpretation: 'FRACTION' }))).toBe('5')
    expect(value(parsePercentage('0.125', { interpretation: 'FRACTION' }))).toBe('12.5')
  })

  it('honours an explicit % sign whatever the interpretation says', () => {
    expect(value(parsePercentage('5%', { interpretation: 'FRACTION' }))).toBe('5')
  })

  it('rejects out-of-range percentages', () => {
    const result = parsePercentage('150')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('OUT_OF_RANGE')
    expect(parsePercentage('-1').ok).toBe(false)
    expect(parsePercentage('2', { interpretation: 'FRACTION' }).ok).toBe(false)
  })

  it('rejects a JavaScript number', () => {
    const result = parsePercentage(5)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('JS_NUMBER_REJECTED')
  })
})

describe('computeIndirectPercentage — BUILD_SPEC §10', () => {
  it('multiplies exactly', () => {
    expect(computeIndirectPercentage('5', '0.30')).toBe('1.5')
    expect(computeIndirectPercentage('12.5', '0.30')).toBe('3.75')
    expect(computeIndirectPercentage('0', '0.30')).toBe('0')
  })

  it('is exact where binary floating point is not', () => {
    // 0.1 * 0.3 is 0.030000000000000002 in IEEE-754 doubles.
    expect(computeIndirectPercentage('0.1', '0.3')).toBe('0.03')
    expect(computeIndirectPercentage('1.1', '0.3')).toBe('0.33')
    expect(computeIndirectPercentage('7.7', '0.3')).toBe('2.31')
  })

  it('keeps every digit of a long value', () => {
    expect(computeIndirectPercentage('33.333333', '0.3')).toBe('9.9999999')
  })

  it('is byte-identical however the same figure arrived', () => {
    const fromManualMapping = computeIndirectPercentage('5', '0.30')
    const fromAiAssistedMapping = computeIndirectPercentage('5', '0.30')
    expect(fromAiAssistedMapping).toBe(fromManualMapping)
  })

  it('refuses anything that is not a plain decimal string', () => {
    // @ts-expect-error — a number is exactly what must never reach this.
    expect(() => computeIndirectPercentage(5, '0.3')).toThrow(/never travel as JavaScript numbers/)
    expect(() => computeIndirectPercentage('5%', '0.3')).toThrow(/not a plain decimal string/)
  })
})

describe('sumDecimals', () => {
  it('sums exactly', () => {
    expect(sumDecimals(['0.1', '0.2']).toFixed()).toBe('0.3')
    expect(sumDecimals([]).toFixed()).toBe('0')
    expect(sumDecimals(['1500', '2500.55', '99.45']).toFixed()).toBe('4100')
  })
})

describe('toStorageString — refuses to round, never rounds silently', () => {
  it('pads to the column scale', () => {
    const result = toStorageString('1.5', PERCENTAGE_SCALE)
    if (!result.ok) throw new Error('expected a value')
    expect(result.value).toBe('1.500000')
    const money = toStorageString('1500', MONEY_SCALE)
    if (!money.ok) throw new Error('expected a value')
    expect(money.value).toBe('1500.00')
  })

  it('refuses a value that would lose precision', () => {
    const result = toStorageString('9.9999999', PERCENTAGE_SCALE)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('TOO_PRECISE')
    expect(toStorageString('10.005', MONEY_SCALE).ok).toBe(false)
  })
})

describe('formatting — the only place rounding happens', () => {
  it('formats money with grouping', () => {
    expect(formatMoney('1500')).toBe('1,500.00')
    expect(formatMoney('1234567.891')).toBe('1,234,567.89')
    expect(formatMoney('1500', { currencyCode: 'USD' })).toBe('USD 1,500.00')
    expect(formatMoney('-1500', { grouping: false })).toBe('-1500.00')
  })

  it('honours configurable decimal places', () => {
    expect(formatPercentage('1.5')).toBe('1.500%')
    expect(formatPercentage('1.5', { decimalPlaces: 6 })).toBe('1.500000%')
    expect(formatPercentage('1.5', { decimalPlaces: 1 })).toBe('1.5%')
    expect(formatPercentage('1.5', { trimTrailingZeros: true })).toBe('1.5%')
    expect(formatPercentage('1.5', { suffix: false })).toBe('1.500')
  })

  it('rounds half up at the display boundary only', () => {
    expect(formatPercentage('1.2345', { decimalPlaces: 3 })).toBe('1.235%')
    expect(formatMoney('0.005')).toBe('0.01')
  })
})

describe('parseDate', () => {
  it('reads ISO', () => {
    const result = parseDate('2026-08-10')
    if (!result.ok) throw new Error('expected a date')
    expect(result.value).toBe('2026-08-10')
  })

  it('reads a textual month in either order', () => {
    const a = parseDate('10 Aug 2026')
    const b = parseDate('August 10, 2026')
    if (!a.ok || !b.ok) throw new Error('expected dates')
    expect(a.value).toBe('2026-08-10')
    expect(b.value).toBe('2026-08-10')
  })

  it('determines field order from the values when it can', () => {
    const result = parseDate('25/12/2026')
    if (!result.ok) throw new Error('expected a date')
    expect(result.value).toBe('2026-12-25')
    expect(result.notes).toContain('FIELD_ORDER_DETERMINED_BY_VALUE')
  })

  it('REFUSES to guess an ambiguous date', () => {
    const result = parseDate('03/04/2026')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('AMBIGUOUS_DATE')
  })

  it('applies the operator answer', () => {
    const dmy = parseDate('03/04/2026', { order: 'DMY' })
    const mdy = parseDate('03/04/2026', { order: 'MDY' })
    if (!dmy.ok || !mdy.ok) throw new Error('expected dates')
    expect(dmy.value).toBe('2026-04-03')
    expect(mdy.value).toBe('2026-03-04')
    expect(dmy.notes).toContain('FIELD_ORDER_FROM_ANSWER')
  })

  it('reads a Date object as its calendar date', () => {
    const result = parseDate(new Date(2026, 7, 10, 13, 45))
    if (!result.ok) throw new Error('expected a date')
    expect(result.value).toBe('2026-08-10')
  })

  it('reads an Excel serial', () => {
    const result = parseDate('46244')
    if (!result.ok) throw new Error('expected a date')
    expect(result.value).toBe('2026-08-10')
    expect(result.notes).toContain('EXCEL_SERIAL_DATE')
  })

  it('rejects impossible dates', () => {
    expect(parseDate('2026-02-30').ok).toBe(false)
    expect(parseDate('31/13/2026').ok).toBe(false)
    expect(parseDate('not a date').ok).toBe(false)
    expect(parseDate('2026').ok).toBe(false)
  })

  it('accepts a leap day and rejects a false one', () => {
    expect(parseDate('2028-02-29').ok).toBe(true)
    expect(parseDate('2026-02-29').ok).toBe(false)
  })

  it('flags a two-digit year rather than hiding it', () => {
    const result = parseDate('25/12/26')
    if (!result.ok) throw new Error('expected a date')
    expect(result.value).toBe('2026-12-25')
    expect(result.notes).toContain('TWO_DIGIT_YEAR')
  })

  it('compares ISO dates as calendar dates', () => {
    expect(isoDateIsBefore('2026-08-09', '2026-08-10')).toBe(true)
    expect(isoDateIsBefore('2026-08-10', '2026-08-10')).toBe(false)
    expect(isoToday(new Date('2026-07-25T23:30:00Z'))).toBe('2026-07-25')
  })
})

describe('ambiguity detection — raised, never guessed', () => {
  it('raises a percentage column that could be 5% or 0.05 — AC26', () => {
    const ambiguity = detectPercentageAmbiguity(['5', '0.05', '0.1'])
    expect(ambiguity).not.toBeNull()
    expect(ambiguity?.kind).toBe('PERCENTAGE_SCALE')
    expect(ambiguity?.options.map((option) => option.id)).toEqual(['PERCENT', 'FRACTION'])
  })

  it('shows the consequence of each answer', () => {
    const ambiguity = detectPercentageAmbiguity(['0.05'])
    expect(ambiguity?.options[0].preview).toEqual(['0.05%'])
    expect(ambiguity?.options[1].preview).toEqual(['5%'])
  })

  it('does not raise a column that carries % signs throughout', () => {
    expect(detectPercentageAmbiguity(['5%', '7.5%', '0.5%'])).toBeNull()
  })

  it('does not raise a column where the fraction reading is impossible', () => {
    // Read as fractions these would be 500%, 750% and 1200%.
    expect(detectPercentageAmbiguity(['5', '7.5', '12'])).toBeNull()
  })

  it('raises when any single value could be read either way', () => {
    expect(detectPercentageAmbiguity(['5', '7.5', '1'])).not.toBeNull()
  })

  it('raises a date column that could be D/M or M/D', () => {
    const ambiguity = detectDateAmbiguity(['03/04/2026', '05/06/2026'])
    expect(ambiguity?.kind).toBe('DATE_FIELD_ORDER')
    expect(ambiguity?.options[0].preview[0]).toBe('2026-04-03')
    expect(ambiguity?.options[1].preview[0]).toBe('2026-03-04')
  })

  it('does not raise a date column that settles itself', () => {
    expect(detectDateAmbiguity(['2026-08-10', '2026-09-01'])).toBeNull()
    expect(detectDateAmbiguity(['25/12/2026', '26/12/2026'])).toBeNull()
    expect(detectDateAmbiguity(['10 Aug 2026'])).toBeNull()
  })

  it('warns when a date column contradicts itself', () => {
    const ambiguity = detectDateAmbiguity(['25/12/2026', '12/25/2026', '03/04/2026'])
    expect(ambiguity?.reasoning).toMatch(/only make sense day-first and others only month-first/)
  })

  it('raises a comma that could be a thousands separator or a decimal mark', () => {
    const ambiguity = detectAmountAmbiguity(['1,500', '2,000'])
    expect(ambiguity?.kind).toBe('DECIMAL_SEPARATOR')
    expect(ambiguity?.options[0].preview[0]).toBe('1,500.00')
    expect(ambiguity?.options[1].preview[0]).toBe('1.50')
  })

  it('does not raise when the column settles it', () => {
    expect(inferDecimalSeparator(['1,500.00'])).toBe('.')
    expect(inferDecimalSeparator(['1.500,00'])).toBe(',')
    expect(inferDecimalSeparator(['1,50'])).toBe(',')
    expect(inferDecimalSeparator(['1,500', '2.75'])).toBe('.')
    expect(inferDecimalSeparator(['1500', '2000'])).toBe('.')
    expect(detectAmountAmbiguity(['1,500.00', '900'])).toBeNull()
  })
})

describe('no value ever passes through a JavaScript number', () => {
  it('has no floating-point escape hatch anywhere in the source', () => {
    const source = readFileSync(join(__dirname, 'money.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '')
    // `digits()` converts a matched ^\d+$ calendar component, never a money value.
    const forbidden = [
      /\bNumber\s*\(/,
      /\bparseFloat\s*\(/,
      /\bparseInt\s*\(/,
      /\.toNumber\s*\(/,
      /\bMath\./,
    ]
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern)
    }
  })

  it('keeps digits a double could not hold', () => {
    // 2^53 + 1 — the first integer a double cannot represent.
    expect(value(parseMoney('9007199254740993'))).toBe('9007199254740993')
    expect(value(parseMoney('123456789012345678.91'))).toBe('123456789012345678.91')
    expect(formatMoney('123456789012345678.91')).toBe('123,456,789,012,345,678.91')
  })

  it('adds without floating-point drift', () => {
    const total = sumDecimals(Array.from({ length: 10 }, () => '0.1'))
    expect(total.toFixed()).toBe('1')
    expect(total.equals(new Dec('1'))).toBe(true)
  })

  it('multiplies a large amount by a percentage exactly', () => {
    const amount = parseMoney('99999999999999.99')
    if (!amount.ok) throw new Error('expected a parse')
    expect(amount.value.times(new Dec('0.3')).toFixed()).toBe('29999999999999.997')
  })
})
