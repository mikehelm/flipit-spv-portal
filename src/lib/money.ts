/**
 * Money, percentages, dates — the arithmetic and the parsing of the messy
 * shapes a spreadsheet produces.
 *
 * BUILD_SPEC §9.1, §10.
 *
 * Three rules govern this file and nothing in it bends them.
 *
 *   1. **No JavaScript number ever touches a monetary or percentage value.**
 *      Values arrive as strings, become `Decimal`, and leave as strings. A
 *      `number` handed to `parseMoney` or `parsePercentage` is REJECTED rather
 *      than accepted — a float that got this far has already lost whatever it
 *      was going to lose, and silently blessing it is worse than refusing it.
 *      There is no `Number()`, `parseFloat()`, `parseInt()`, `Math.*` or
 *      `.toNumber()` anywhere below, and a test asserts that.
 *
 *   2. **Nothing ambiguous is guessed.** A percentage column that could read
 *      as `5%` or `0.05`, and a date that could read as day-month or
 *      month-day, produce a structured `Ambiguity` for the operator to answer.
 *      Ambiguities are returned, never thrown, and never resolved by a default.
 *
 *   3. **Rounding happens at render time only.** `formatMoney` and
 *      `formatPercentage` round for display; everything upstream of them is
 *      exact. `toStorageString` refuses to round — it reports precision loss
 *      rather than performing it.
 */

import Decimal from 'decimal.js'

/**
 * A private constructor so this module's configuration cannot be changed out
 * from under it by any other part of the app calling `Decimal.set`.
 *
 * 50 significant digits: multiplication in decimal.js rounds to `precision`,
 * and the largest thing we multiply is an 18-digit amount by a 6-decimal
 * percentage. 50 leaves the product exact with room to spare.
 */
export const Dec = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
})

/** Scale of the `numeric(18, 2)` money columns. */
export const MONEY_SCALE = 2
/** Scale of the `numeric(9, 6)` percentage columns. */
export const PERCENTAGE_SCALE = 6
/** BUILD_SPEC §10 — display default, overridden by `service_config.decimal_places`. */
export const DEFAULT_DISPLAY_DECIMAL_PLACES = 3

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type ParseFailureCode =
  /** Nothing there. */
  | 'EMPTY'
  /** A JavaScript number was passed in. Convert at the file boundary. */
  | 'JS_NUMBER_REJECTED'
  /** Not a number in any recognised notation. */
  | 'NOT_NUMERIC'
  /** Numeric but outside the permitted range. */
  | 'OUT_OF_RANGE'
  /** More decimal places than the column can store without rounding. */
  | 'TOO_PRECISE'
  /** Not a date in any recognised notation. */
  | 'NOT_A_DATE'
  /** A real date notation whose field order cannot be determined. */
  | 'AMBIGUOUS_DATE'

export type ParseNote =
  | 'CURRENCY_SYMBOL_REMOVED'
  | 'GROUPING_SEPARATORS_REMOVED'
  | 'NEGATIVE_FROM_PARENTHESES'
  | 'MAGNITUDE_SUFFIX_APPLIED'
  | 'PERCENT_SIGN_PRESENT'
  | 'SCALED_FROM_FRACTION'
  | 'DECIMAL_COMMA'
  | 'TWO_DIGIT_YEAR'
  | 'EXCEL_SERIAL_DATE'
  | 'FIELD_ORDER_DETERMINED_BY_VALUE'
  | 'FIELD_ORDER_FROM_ANSWER'

export interface ParseSuccess<T> {
  ok: true
  value: T
  /** The input exactly as it appeared, for the review table and the audit log. */
  raw: string
  /** What had to be done to read it. Shown to the operator before import. */
  notes: ParseNote[]
}

export interface ParseFailure {
  ok: false
  code: ParseFailureCode
  message: string
  raw: string
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure

function ok<T>(value: T, raw: string, notes: ParseNote[]): ParseSuccess<T> {
  return { ok: true, value, raw, notes }
}

function fail(code: ParseFailureCode, message: string, raw: string): ParseFailure {
  return { ok: false, code, message, raw }
}

// ---------------------------------------------------------------------------
// Ambiguity — returned, never guessed, never thrown
// ---------------------------------------------------------------------------

export type AmbiguityKind =
  | 'PERCENTAGE_SCALE'
  | 'DECIMAL_SEPARATOR'
  | 'DATE_FIELD_ORDER'

export type PercentageInterpretation = 'PERCENT' | 'FRACTION'
export type DecimalSeparator = '.' | ','
export type DateFieldOrder = 'DMY' | 'MDY'

export interface AmbiguityOption {
  /** The value posted back when the operator picks this option. */
  id: string
  label: string
  /** The same sample values, read this way. Shows the consequence of the choice. */
  preview: string[]
}

/**
 * An explicit question for the operator. Applied to the whole column.
 * BUILD_SPEC §9.1 — "Silent coercion of financial figures is not acceptable."
 */
export interface Ambiguity {
  kind: AmbiguityKind
  question: string
  /** Up to five distinct raw values from the column, so the question is concrete. */
  samples: string[]
  options: AmbiguityOption[]
  /**
   * A non-binding note about which reading looks more likely and why. It is
   * displayed beside the question and is never applied automatically.
   */
  reasoning?: string
}

// ---------------------------------------------------------------------------
// Shared string preparation
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS = /[$£€¥₹₩₽฿]/g
/** A trailing or leading three-letter currency code, e.g. "USD 1,500". */
const CURRENCY_CODE = /^(?:usd|aud|gbp|eur|thb|nzd|cad|chf|sgd|hkd|jpy)\s*|\s*(?:usd|aud|gbp|eur|thb|nzd|cad|chf|sgd|hkd|jpy)$/gi

/** Whitespace of every flavour a spreadsheet manages to produce. */
const ANY_SPACE = /[\s   ]/g

function toRawString(input: unknown): { raw: string } | ParseFailure {
  if (input === null || input === undefined) {
    return fail('EMPTY', 'No value was supplied.', '')
  }
  if (typeof input === 'number') {
    return fail(
      'JS_NUMBER_REJECTED',
      'A JavaScript number reached the money parser. Spreadsheet values must be ' +
        'converted to a string at the file boundary so no precision is lost.',
      '',
    )
  }
  if (typeof input === 'bigint') {
    return { raw: input.toString() }
  }
  if (Decimal.isDecimal(input)) {
    return { raw: (input as Decimal).toFixed() }
  }
  if (typeof input !== 'string') {
    return fail('NOT_NUMERIC', 'Value is not text.', String(input))
  }
  return { raw: input }
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface MoneyParseOptions {
  /**
   * Which character separates the decimal part. Defaults to `.`; the column
   * planner resolves it from `inferDecimalSeparator` or the operator's answer
   * rather than relying on the default.
   */
  decimalSeparator?: DecimalSeparator
  /** `(500)` means −500. On by default; accounting exports do this. */
  parenthesesAreNegative?: boolean
  /** `1.5k` means 1500. On by default. */
  magnitudeSuffixes?: boolean
  /** Reject a negative result. Investment amounts set this. */
  allowNegative?: boolean
}

/**
 * Parse the messy shapes: `"1,500"`, `"$1,500.00"`, `"(500)"`, `"1.5k"`,
 * `" 5 "`, `"USD 1 500,00"`.
 */
export function parseMoney(
  input: unknown,
  options: MoneyParseOptions = {},
): ParseResult<Decimal> {
  const prepared = toRawString(input)
  if ('ok' in prepared) return prepared
  const raw = prepared.raw

  const {
    decimalSeparator = '.',
    parenthesesAreNegative = true,
    magnitudeSuffixes = true,
    allowNegative = true,
  } = options

  const notes: ParseNote[] = []
  let work = raw.replace(ANY_SPACE, '')

  if (work === '') return fail('EMPTY', 'No value was supplied.', raw)

  let negative = false
  if (parenthesesAreNegative && /^\((.*)\)$/.test(work)) {
    work = work.slice(1, -1)
    negative = true
    notes.push('NEGATIVE_FROM_PARENTHESES')
  }

  const withoutCurrency = work.replace(CURRENCY_SYMBOLS, '').replace(CURRENCY_CODE, '')
  if (withoutCurrency !== work) notes.push('CURRENCY_SYMBOL_REMOVED')
  work = withoutCurrency

  if (work.startsWith('-')) {
    negative = !negative
    work = work.slice(1)
  } else if (work.startsWith('+')) {
    work = work.slice(1)
  }

  let multiplier: Decimal | null = null
  if (magnitudeSuffixes) {
    const suffix = work.slice(-1).toLowerCase()
    if (suffix === 'k' || suffix === 'm') {
      const head = work.slice(0, -1)
      if (head !== '') {
        multiplier = new Dec(suffix === 'k' ? '1000' : '1000000')
        work = head
        notes.push('MAGNITUDE_SUFFIX_APPLIED')
      }
    }
  }

  const cleaned = stripGrouping(work, decimalSeparator, notes)
  if (cleaned === null) {
    return fail(
      'NOT_NUMERIC',
      'This is not a number in any notation the importer recognises.',
      raw,
    )
  }

  let value = new Dec(cleaned)
  if (multiplier) value = value.times(multiplier)
  if (negative) value = value.negated()

  if (!allowNegative && value.isNegative()) {
    return fail('OUT_OF_RANGE', 'A negative amount is not permitted here.', raw)
  }

  return ok(value, raw, notes)
}

/**
 * Remove grouping separators and normalise the decimal mark, or return null if
 * what remains is not a plain decimal number.
 */
function stripGrouping(
  input: string,
  decimalSeparator: DecimalSeparator,
  notes: ParseNote[],
): string | null {
  let work = input.replace(/['’]/g, '')

  if (decimalSeparator === ',') {
    if (work.includes('.')) {
      work = work.replace(/\./g, '')
      notes.push('GROUPING_SEPARATORS_REMOVED')
    }
    if (work.includes(',')) {
      notes.push('DECIMAL_COMMA')
      work = work.replace(',', '.')
    }
  } else {
    if (work.includes(',')) {
      work = work.replace(/,/g, '')
      notes.push('GROUPING_SEPARATORS_REMOVED')
    }
  }

  if (!/^\d+(?:\.\d+)?$/.test(work) && !/^\.\d+$/.test(work)) return null
  return work.startsWith('.') ? `0${work}` : work
}

// ---------------------------------------------------------------------------
// Percentages
// ---------------------------------------------------------------------------

export interface PercentageParseOptions {
  /**
   * How to read a bare number. `PERCENT` means `5` is five percent;
   * `FRACTION` means `0.05` is five percent.
   *
   * Defaults to `PERCENT`, which is the literal reading of the digits. The
   * import pipeline never relies on that default: `detectPercentageAmbiguity`
   * forces the operator to answer for any column where both readings are
   * possible, and the answer is passed in explicitly.
   *
   * A value carrying an explicit `%` is always read as a percent whatever this
   * says — the sign is the author's own statement of intent.
   */
  interpretation?: PercentageInterpretation
  decimalSeparator?: DecimalSeparator
  /** Inclusive bounds. Defaults to 0–100. */
  min?: string
  max?: string
}

/** Parse `"5%"`, `"0.05"`, `" 5 "`, `"5,5%"`. Result is in percent units. */
export function parsePercentage(
  input: unknown,
  options: PercentageParseOptions = {},
): ParseResult<Decimal> {
  const prepared = toRawString(input)
  if ('ok' in prepared) return prepared
  const raw = prepared.raw

  const {
    interpretation = 'PERCENT',
    decimalSeparator = '.',
    min = '0',
    max = '100',
  } = options

  const notes: ParseNote[] = []
  let work = raw.replace(ANY_SPACE, '')
  if (work === '') return fail('EMPTY', 'No value was supplied.', raw)

  const hasPercentSign = work.includes('%')
  if (hasPercentSign) {
    work = work.replace(/%/g, '')
    notes.push('PERCENT_SIGN_PRESENT')
  }

  let negative = false
  if (work.startsWith('-')) {
    negative = true
    work = work.slice(1)
  } else if (work.startsWith('+')) {
    work = work.slice(1)
  }

  const cleaned = stripGrouping(work, decimalSeparator, notes)
  if (cleaned === null) {
    return fail('NOT_NUMERIC', 'This is not a percentage the importer recognises.', raw)
  }

  let value = new Dec(cleaned)
  if (negative) value = value.negated()

  if (!hasPercentSign && interpretation === 'FRACTION') {
    value = value.times(100)
    notes.push('SCALED_FROM_FRACTION')
  }

  if (value.lessThan(new Dec(min)) || value.greaterThan(new Dec(max))) {
    return fail(
      'OUT_OF_RANGE',
      `A percentage must be between ${min} and ${max}. This one reads as ${value.toFixed()}.`,
      raw,
    )
  }

  return ok(value, raw, notes)
}

// ---------------------------------------------------------------------------
// The calculation — BUILD_SPEC §10
// ---------------------------------------------------------------------------

/**
 * `indirect_flipit_percentage = spv_percentage × flipit_share`.
 *
 * Exact. String in, string out. No rounding — if the product needs more
 * decimal places than the column can hold, `toStorageString` says so rather
 * than quietly dropping them.
 *
 * `flipitShare` is the fraction the SPV acquires, i.e. `"0.30"` for thirty
 * percent, matching `rounds.flipit_share`.
 *
 * This function is the ONLY place the indirect figure is computed. The AI
 * import path and the manual import path both call it with the same strings
 * and therefore get byte-identical results — the model reads, it never
 * computes (BUILD_SPEC §9.1, AC27).
 */
export function computeIndirectPercentage(
  spvPercentage: string,
  flipitShare: string,
): string {
  const spv = new Dec(assertDecimalString(spvPercentage, 'spvPercentage'))
  const share = new Dec(assertDecimalString(flipitShare, 'flipitShare'))
  return spv.times(share).toFixed()
}

function assertDecimalString(value: string, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${label} must be a string. Money and percentages never travel as JavaScript numbers.`,
    )
  }
  const trimmed = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new TypeError(`${label} is not a plain decimal string: ${JSON.stringify(value)}`)
  }
  return trimmed
}

/** Exact sum. Empty list sums to zero. */
export function sumDecimals(values: Array<string | Decimal>): Decimal {
  return values.reduce<Decimal>(
    (total, value) => total.plus(Decimal.isDecimal(value) ? (value as Decimal) : new Dec(value as string)),
    new Dec('0'),
  )
}

/**
 * The value as it will be stored, or a refusal.
 *
 * Deliberately does not round. Rounding a figure an investor was quoted is a
 * change to what they were offered, and it happens here silently or not at all.
 */
export function toStorageString(
  value: Decimal | string,
  scale: number,
): ParseResult<string> {
  const decimal = Decimal.isDecimal(value) ? (value as Decimal) : new Dec(value as string)
  const raw = decimal.toFixed()
  if (decimal.decimalPlaces() > scale) {
    return fail(
      'TOO_PRECISE',
      `This value has ${decimal.decimalPlaces()} decimal places and can be stored ` +
        `with at most ${scale}. Storing it would change the figure.`,
      raw,
    )
  }
  return ok(decimal.toFixed(scale), raw, [])
}

// ---------------------------------------------------------------------------
// Formatting — the only place rounding happens
// ---------------------------------------------------------------------------

export interface MoneyFormatOptions {
  decimalPlaces?: number
  /** e.g. "USD". Rendered as a prefix with a space. */
  currencyCode?: string
  grouping?: boolean
}

export function formatMoney(
  value: Decimal | string,
  options: MoneyFormatOptions = {},
): string {
  const { decimalPlaces = MONEY_SCALE, currencyCode, grouping = true } = options
  const decimal = Decimal.isDecimal(value) ? (value as Decimal) : new Dec(value as string)
  const fixed = decimal.toFixed(decimalPlaces)
  const body = grouping ? group(fixed) : fixed
  return currencyCode ? `${currencyCode} ${body}` : body
}

export interface PercentageFormatOptions {
  decimalPlaces?: number
  /** Append `%`. On by default. */
  suffix?: boolean
  /** Drop trailing zeros so 5.000 shows as 5. Off by default. */
  trimTrailingZeros?: boolean
}

export function formatPercentage(
  value: Decimal | string,
  options: PercentageFormatOptions = {},
): string {
  const {
    decimalPlaces = DEFAULT_DISPLAY_DECIMAL_PLACES,
    suffix = true,
    trimTrailingZeros = false,
  } = options
  const decimal = Decimal.isDecimal(value) ? (value as Decimal) : new Dec(value as string)
  let text = decimal.toFixed(decimalPlaces)
  if (trimTrailingZeros && text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '')
  }
  return suffix ? `${text}%` : text
}

/**
 * Thousands separators, applied to the string. `Intl.NumberFormat` would need
 * a JavaScript number, which is exactly what this file exists to avoid.
 */
function group(fixed: string): string {
  const negative = fixed.startsWith('-')
  const unsigned = negative ? fixed.slice(1) : fixed
  const [whole, fraction] = unsigned.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`
  return negative ? `-${body}` : body
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export interface DateParseOptions {
  /**
   * Field order for `03/04/2026`. Omitted and genuinely ambiguous means the
   * parse FAILS with `AMBIGUOUS_DATE` — there is no default reading of a date.
   */
  order?: DateFieldOrder
  /** Read a bare integer as an Excel serial date. On by default. */
  excelSerial?: boolean
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

/** Excel serial 36526 = 2000-01-01; 73415 = 2100-12-31. */
const EXCEL_SERIAL_MIN = 36526
const EXCEL_SERIAL_MAX = 73415

/** Parse a date to `YYYY-MM-DD`. Deadlines are dates, never timestamps. */
export function parseDate(
  input: unknown,
  options: DateParseOptions = {},
): ParseResult<string> {
  const { order, excelSerial = true } = options

  if (input instanceof Date) {
    if (isNaN(input.getTime())) return fail('NOT_A_DATE', 'Invalid date.', '')
    // Spreadsheet readers build dates in local time from the sheet's calendar
    // date, so the local getters give back the date the author typed.
    return ok(
      isoDate(input.getFullYear(), input.getMonth() + 1, input.getDate()),
      input.toISOString(),
      [],
    )
  }

  const prepared = toRawString(input)
  if ('ok' in prepared) {
    return prepared.code === 'JS_NUMBER_REJECTED'
      ? fail(
          'JS_NUMBER_REJECTED',
          'A JavaScript number reached the date parser. Convert at the file boundary.',
          '',
        )
      : prepared
  }
  const raw = prepared.raw
  const work = raw.trim().replace(ANY_SPACE, ' ')
  if (work === '') return fail('EMPTY', 'No value was supplied.', raw)

  const notes: ParseNote[] = []

  // ISO first — unambiguous by construction.
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(work)
  if (iso) return finishDate(digits(iso[1]), digits(iso[2]), digits(iso[3]), raw, notes)

  // Textual month, either order: "10 Aug 2026", "Aug 10, 2026", "10-Aug-2026".
  const textual = parseTextualMonth(work)
  if (textual) {
    return finishDate(textual.year, textual.month, textual.day, raw, notes)
  }

  const numeric = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(work)
  if (numeric) {
    const first = digits(numeric[1])
    const second = digits(numeric[2])
    let year = digits(numeric[3])
    if (numeric[3].length === 2) {
      year = 2000 + year
      notes.push('TWO_DIGIT_YEAR')
    }

    let day: number
    let month: number
    if (first > 12 && second <= 12) {
      day = first
      month = second
      notes.push('FIELD_ORDER_DETERMINED_BY_VALUE')
    } else if (second > 12 && first <= 12) {
      month = first
      day = second
      notes.push('FIELD_ORDER_DETERMINED_BY_VALUE')
    } else if (order === 'DMY') {
      day = first
      month = second
      notes.push('FIELD_ORDER_FROM_ANSWER')
    } else if (order === 'MDY') {
      month = first
      day = second
      notes.push('FIELD_ORDER_FROM_ANSWER')
    } else {
      return fail(
        'AMBIGUOUS_DATE',
        `"${raw}" could be day-month or month-day. The importer does not guess dates.`,
        raw,
      )
    }
    return finishDate(year, month, day, raw, notes)
  }

  if (excelSerial && /^\d+$/.test(work)) {
    const serial = digits(work)
    if (serial >= EXCEL_SERIAL_MIN && serial <= EXCEL_SERIAL_MAX) {
      notes.push('EXCEL_SERIAL_DATE')
      const converted = excelSerialToParts(serial)
      return finishDate(converted.year, converted.month, converted.day, raw, notes)
    }
  }

  return fail('NOT_A_DATE', 'This is not a date the importer recognises.', raw)
}

function parseTextualMonth(
  work: string,
): { year: number; month: number; day: number } | null {
  const cleaned = work.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]+)[ -](\d{4})$/.exec(cleaned)
  if (dayFirst) {
    const month = MONTH_NAMES[dayFirst[2].toLowerCase()]
    if (month) return { year: digits(dayFirst[3]), month, day: digits(dayFirst[1]) }
  }

  const monthFirst = /^([A-Za-z]+)[ -](\d{1,2})(?:st|nd|rd|th)?[ -](\d{4})$/.exec(cleaned)
  if (monthFirst) {
    const month = MONTH_NAMES[monthFirst[1].toLowerCase()]
    if (month) return { year: digits(monthFirst[3]), month, day: digits(monthFirst[2]) }
  }

  return null
}

/** Digit-string to integer without `parseInt`. Input is already `^\d+$`. */
function digits(text: string): number {
  let total = 0
  for (const character of text) {
    total = total * 10 + (character.charCodeAt(0) - 48)
  }
  return total
}

function finishDate(
  year: number,
  month: number,
  day: number,
  raw: string,
  notes: ParseNote[],
): ParseResult<string> {
  if (month < 1 || month > 12) {
    return fail('NOT_A_DATE', `There is no month ${month}.`, raw)
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return fail('NOT_A_DATE', `${raw} is not a real calendar date.`, raw)
  }
  return ok(isoDate(year, month, day), raw, notes)
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month === 2 && isLeapYear(year)) return 29
  return lengths[month - 1]
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function pad(value: number, width: number): string {
  const text = String(value)
  return text.length >= width ? text : '0'.repeat(width - text.length) + text
}

function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/**
 * Excel's day-zero is 1899-12-30 (its 1900 leap-year bug included). Converted
 * with integer day arithmetic — no Date maths, no timezone to get wrong.
 */
function excelSerialToParts(serial: number): { year: number; month: number; day: number } {
  let remaining = serial
  let year = 1899
  let month = 12
  let day = 30
  while (remaining > 0) {
    day += 1
    if (day > daysInMonth(year, month)) {
      day = 1
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
    remaining -= 1
  }
  return { year, month, day }
}

/** Compare two `YYYY-MM-DD` strings. Lexicographic order is calendar order. */
export function isoDateIsBefore(a: string, b: string): boolean {
  return a < b
}

/** Today, in the given IANA zone, as `YYYY-MM-DD`. Defaults to UTC. */
export function isoToday(now: Date = new Date(), timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts
}

// ---------------------------------------------------------------------------
// Ambiguity detection — BUILD_SPEC §9.1
// ---------------------------------------------------------------------------

function distinctSamples(values: string[], limit = 5): string[] {
  const seen: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed === '') continue
    if (!seen.includes(trimmed)) seen.push(trimmed)
    if (seen.length >= limit) break
  }
  return seen
}

/**
 * A percentage column that could read either way.
 *
 * The rule: any bare value at or below 1 is ambiguous, because `0.05` is
 * either five percent or five hundredths of a percent and both are legitimate
 * spreadsheet conventions. A column whose bare values are all above 1 is not
 * ambiguous, because the fraction reading would put every one of them above
 * 100% — impossible for a share of an SPV. Values carrying an explicit `%` are
 * never ambiguous.
 *
 * Never guessed, never defaulted. AC26.
 */
export function detectPercentageAmbiguity(values: string[]): Ambiguity | null {
  const bare: Decimal[] = []
  let anySigned = false

  for (const value of values) {
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (text === '') continue
    if (text.includes('%')) {
      anySigned = true
      continue
    }
    const parsed = parsePercentage(text, { min: '-1000000', max: '1000000' })
    if (parsed.ok) bare.push(parsed.value)
  }

  if (bare.length === 0) return null

  const couldBeFraction = bare.some(
    (value) => !value.isZero() && value.abs().lessThanOrEqualTo(1),
  )
  if (!couldBeFraction) return null

  const samples = distinctSamples(
    values.filter((value) => typeof value === 'string' && !value.includes('%')),
  )

  return {
    kind: 'PERCENTAGE_SCALE',
    question:
      'How should this percentage column be read? A value such as "0.05" is ' +
      'either five percent or five hundredths of one percent. The importer will not guess.',
    samples,
    options: [
      {
        id: 'PERCENT',
        label: 'The number is already a percentage — 0.05 means 0.05%',
        preview: samples.map((sample) => previewPercentage(sample, 'PERCENT')),
      },
      {
        id: 'FRACTION',
        label: 'The number is a fraction of the whole — 0.05 means 5%',
        preview: samples.map((sample) => previewPercentage(sample, 'FRACTION')),
      },
    ],
    reasoning: anySigned
      ? 'Some values in this column carry a % sign and some do not. Those with a sign are read as written whatever you choose here.'
      : undefined,
  }
}

function previewPercentage(sample: string, interpretation: PercentageInterpretation): string {
  const parsed = parsePercentage(sample, { interpretation, min: '-1000000', max: '1000000' })
  return parsed.ok ? formatPercentage(parsed.value, { trimTrailingZeros: true }) : '—'
}

/**
 * Whether `,` in this column is a thousands separator or a decimal mark.
 * `"1,500"` is 1500 to an English speaker and 1.5 to a French one.
 */
export function inferDecimalSeparator(values: string[]): DecimalSeparator | 'AMBIGUOUS' {
  let sawCommaThenDot = false
  let sawDotThenComma = false
  let sawCommaGroupOfThree = false
  let sawCommaNotGroupOfThree = false
  let sawDot = false

  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.replace(ANY_SPACE, '')
    if (text === '') continue
    const commaAt = text.lastIndexOf(',')
    const dotAt = text.lastIndexOf('.')
    if (commaAt >= 0 && dotAt >= 0) {
      if (commaAt < dotAt) sawCommaThenDot = true
      else sawDotThenComma = true
      continue
    }
    if (dotAt >= 0) sawDot = true
    if (commaAt >= 0) {
      const tail = text.slice(commaAt + 1)
      if (/^\d{3}$/.test(tail)) sawCommaGroupOfThree = true
      else sawCommaNotGroupOfThree = true
    }
  }

  // A value containing both marks settles it: the rightmost is the decimal one.
  if (sawCommaThenDot && !sawDotThenComma) return '.'
  if (sawDotThenComma && !sawCommaThenDot) return ','
  // A comma followed by anything other than exactly three digits cannot be a
  // thousands separator.
  if (sawCommaNotGroupOfThree && !sawCommaGroupOfThree) return ','
  // A dot elsewhere in the column is the decimal mark, so the comma is grouping.
  if (sawCommaGroupOfThree && sawDot && !sawCommaNotGroupOfThree) return '.'
  if (sawCommaGroupOfThree || sawCommaNotGroupOfThree) return 'AMBIGUOUS'
  return '.'
}

/** The decimal-separator question, when the column cannot answer it itself. */
export function detectAmountAmbiguity(values: string[]): Ambiguity | null {
  if (inferDecimalSeparator(values) !== 'AMBIGUOUS') return null
  const samples = distinctSamples(values)
  return {
    kind: 'DECIMAL_SEPARATOR',
    question:
      'Is the comma in this column a thousands separator or a decimal mark? ' +
      '"1,500" is one thousand five hundred in one convention and one and a half in another.',
    samples,
    options: [
      {
        id: '.',
        label: 'Thousands separator — "1,500" means 1500',
        preview: samples.map((sample) => previewMoney(sample, '.')),
      },
      {
        id: ',',
        label: 'Decimal mark — "1,500" means 1.5',
        preview: samples.map((sample) => previewMoney(sample, ',')),
      },
    ],
  }
}

function previewMoney(sample: string, decimalSeparator: DecimalSeparator): string {
  const parsed = parseMoney(sample, { decimalSeparator })
  return parsed.ok ? formatMoney(parsed.value) : '—'
}

/**
 * A date column whose field order cannot be determined from its own values.
 * `03/04/2026` is 3 April or 4 March; nothing in the file settles it.
 */
export function detectDateAmbiguity(values: string[]): Ambiguity | null {
  let ambiguousFormPresent = false
  let determinedDmy = false
  let determinedMdy = false

  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text === '') continue
    const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text)
    if (!numeric) continue
    const first = digits(numeric[1])
    const second = digits(numeric[2])
    if (first > 12 && second <= 12) determinedDmy = true
    else if (second > 12 && first <= 12) determinedMdy = true
    else if (first <= 12 && second <= 12) ambiguousFormPresent = true
  }

  if (!ambiguousFormPresent) return null

  const samples = distinctSamples(
    values.filter(
      (value) => typeof value === 'string' && /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(value.trim()),
    ),
  )

  const conflict = determinedDmy && determinedMdy
  return {
    kind: 'DATE_FIELD_ORDER',
    question:
      'Which comes first in this date column, the day or the month? ' +
      '"03/04/2026" is 3 April in one convention and 4 March in the other.',
    samples,
    options: [
      {
        id: 'DMY',
        label: 'Day first — 03/04/2026 is 3 April 2026',
        preview: samples.map((sample) => previewDate(sample, 'DMY')),
      },
      {
        id: 'MDY',
        label: 'Month first — 03/04/2026 is 4 March 2026',
        preview: samples.map((sample) => previewDate(sample, 'MDY')),
      },
    ],
    reasoning: conflict
      ? 'Careful: some rows in this column only make sense day-first and others only month-first. Whichever you choose, the rows that disagree will fail validation and the file will need fixing.'
      : determinedDmy
        ? 'Some rows in this column have a first number above 12, which can only be a day.'
        : determinedMdy
          ? 'Some rows in this column have a second number above 12, which can only be a day.'
          : undefined,
  }
}

function previewDate(sample: string, order: DateFieldOrder): string {
  const parsed = parseDate(sample, { order })
  return parsed.ok ? parsed.value : '—'
}
