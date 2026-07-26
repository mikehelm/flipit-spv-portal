/**
 * Reading a spreadsheet into a table of strings.
 *
 * Everything downstream of this file works on strings. That is the whole point
 * of the file: a value that arrives as text stays text, exactly as written,
 * until `parseMoney`/`parsePercentage` turn it into a `Decimal`. No arithmetic
 * happens here and no value is coerced to a JavaScript number.
 *
 * The one unavoidable exception is a numeric cell in a binary `.xlsx`, which
 * the format itself stores as a double — see `cellToString`.
 */

import * as XLSX from 'xlsx'
import { MAX_FILE_BYTES, importTooLargeMessage } from './limits'

export interface SheetTable {
  /** Column headers, in file order, de-duplicated and never empty. */
  headers: string[]
  /** One entry per data row, aligned to `headers`. Missing cells are ''. */
  rows: string[][]
  /** Which sheet this came from, for the operator's benefit. */
  sheetName: string | null
  /** Sheets present in the workbook, so the operator can pick another. */
  sheetNames: string[]
  /**
   * The 1-based line or row number in the source file for each row, so an
   * error message can point at the row the operator can see.
   */
  sourceRowNumbers: number[]
}

export type TableReadResult =
  | { ok: true; table: SheetTable; notices: string[] }
  | { ok: false; message: string }

export const MAX_ROWS = 5000

/**
 * Re-exported from `limits.ts`, which the wizard imports without dragging the
 * spreadsheet reader into the browser. Kept here so every existing caller of
 * `table.ts` still finds it where it was.
 */
export { MAX_FILE_BYTES }

// ---------------------------------------------------------------------------
// Delimited text
// ---------------------------------------------------------------------------

/** Comma, semicolon and tab are all in the wild. Sniffed, not assumed. */
export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n')
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    // Count only separators outside quotes.
    let count = 0
    let inQuotes = false
    for (let index = 0; index < sample.length; index += 1) {
      const character = sample[index]
      if (character === '"') inQuotes = !inQuotes
      else if (!inQuotes && character === candidate) count += 1
    }
    if (count > bestCount) {
      bestCount = count
      best = candidate
    }
  }
  return best
}

/**
 * RFC 4180 with the usual real-world tolerances: CRLF or LF, a BOM, quoted
 * fields containing the delimiter or a newline, and doubled quotes.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const separator = delimiter ?? sniffDelimiter(body)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let index = 0

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    row.push(field)
    field = ''
    rows.push(row)
    row = []
  }

  while (index < body.length) {
    const character = body[index]

    if (inQuotes) {
      if (character === '"') {
        if (body[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      field += character
      index += 1
      continue
    }

    if (character === '"' && field === '') {
      inQuotes = true
      index += 1
      continue
    }
    if (character === separator) {
      pushField()
      index += 1
      continue
    }
    if (character === '\r') {
      index += 1
      continue
    }
    if (character === '\n') {
      pushRow()
      index += 1
      continue
    }
    field += character
    index += 1
  }

  if (field !== '' || row.length > 0) pushRow()

  return rows
}

// ---------------------------------------------------------------------------
// Workbooks
// ---------------------------------------------------------------------------

/**
 * A spreadsheet cell as a string, without arithmetic.
 *
 * A numeric cell in an `.xlsx` is a double in the file itself — that is the
 * format, not a choice made here. It is converted to its shortest exact
 * decimal representation once, at this boundary, and is a string from this
 * point on. A `.csv` never goes through that step at all, which is why a CSV
 * is the safer format for a file full of money and why the review table shows
 * every converted value before anything is imported.
 */
function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return ''
    const year = String(cell.getFullYear()).padStart(4, '0')
    const month = String(cell.getMonth() + 1).padStart(2, '0')
    const day = String(cell.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE'
  if (typeof cell === 'string') return cell.trim()
  return String(cell).trim()
}

function readWorkbook(bytes: Uint8Array, sheetName?: string): TableReadResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellText: false })
  } catch {
    return {
      ok: false,
      message: 'That file could not be opened as a spreadsheet. Try re-saving it as .xlsx or .csv.',
    }
  }

  const sheetNames = workbook.SheetNames
  if (sheetNames.length === 0) return { ok: false, message: 'The workbook has no sheets.' }

  const chosen = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0]
  const sheet = workbook.Sheets[chosen]
  if (!sheet) return { ok: false, message: `Sheet "${chosen}" is not in this workbook.` }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  })

  const asStrings = matrix.map((row) => (row ?? []).map(cellToString))
  return finishTable(asStrings, chosen, sheetNames)
}

/**
 * Turn a raw matrix into a table: find the header row, name every column,
 * drop entirely blank rows, and keep the source row number for each.
 */
function finishTable(
  matrix: string[][],
  sheetName: string | null,
  sheetNames: string[],
): TableReadResult {
  const notices: string[] = []

  const headerIndex = matrix.findIndex((row) => row.some((cell) => cell.trim() !== ''))
  if (headerIndex === -1) return { ok: false, message: 'The file is empty.' }
  if (headerIndex > 0) {
    notices.push(
      `The first ${headerIndex} row(s) were blank and were skipped. Headers were read from row ${headerIndex + 1}.`,
    )
  }

  const rawHeaders = matrix[headerIndex]
  const headers: string[] = []
  rawHeaders.forEach((header, columnIndex) => {
    let name = header.trim()
    if (name === '') name = `Column ${columnIndex + 1}`
    let candidate = name
    let suffix = 2
    while (headers.includes(candidate)) {
      candidate = `${name} (${suffix})`
      suffix += 1
    }
    if (candidate !== name) {
      notices.push(`Two columns are both called "${name}". The second is shown as "${candidate}".`)
    }
    headers.push(candidate)
  })

  const rows: string[][] = []
  const sourceRowNumbers: number[] = []
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index]
    if (!row.some((cell) => cell.trim() !== '')) continue
    const padded = headers.map((_, columnIndex) => row[columnIndex] ?? '')
    if (row.length > headers.length) {
      const extra = row.slice(headers.length).filter((cell) => cell.trim() !== '')
      if (extra.length > 0) {
        notices.push(
          `Row ${index + 1} has more cells than there are headers. The extra values were ignored.`,
        )
      }
    }
    rows.push(padded)
    sourceRowNumbers.push(index + 1)
    if (rows.length > MAX_ROWS) {
      return {
        ok: false,
        message: `This file has more than ${MAX_ROWS} rows. That is far beyond what this round expects; check it is the right file.`,
      }
    }
  }

  if (rows.length === 0) {
    return { ok: false, message: 'The file has headers but no data rows.' }
  }

  return {
    ok: true,
    table: { headers, rows, sheetName, sheetNames, sourceRowNumbers },
    notices,
  }
}

const UTF8 = new TextDecoder('utf-8')

/** Read a `.csv`, `.tsv`, `.xlsx` or `.xls` into a table of strings. */
export function readTable(
  filename: string,
  bytes: Uint8Array,
  options: { sheetName?: string } = {},
): TableReadResult {
  if (bytes.byteLength === 0) return { ok: false, message: 'The file is empty.' }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    // The same sentence the wizard shows when it refuses one before posting.
    return { ok: false, message: importTooLargeMessage(bytes.byteLength) }
  }

  const extension = filename.toLowerCase().split('.').pop() ?? ''

  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    const text = UTF8.decode(bytes)
    const matrix = parseDelimited(text, extension === 'tsv' ? '\t' : undefined)
    return finishTable(matrix, null, [])
  }

  if (extension === 'xlsx' || extension === 'xls' || extension === 'xlsm') {
    return readWorkbook(bytes, options.sheetName)
  }

  return {
    ok: false,
    message: `"${filename}" is not a spreadsheet this importer reads. Use .csv, .xlsx or .xls.`,
  }
}

/** Column values in file order, for ambiguity detection and AI samples. */
export function columnValues(table: SheetTable, header: string): string[] {
  const index = table.headers.indexOf(header)
  if (index === -1) return []
  return table.rows.map((row) => row[index] ?? '')
}
