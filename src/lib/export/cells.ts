/**
 * Neutralises values Excel would interpret as formulae. The apostrophe is
 * Excel's explicit text marker and keeps leading zeroes and long references.
 */
export function neutraliseSpreadsheetCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

export function serialiseStructuredCell(value: unknown): string {
  return JSON.stringify(value)
}

export function encodeCsvRow(values: readonly string[]): string {
  return values
    .map((value) => `"${neutraliseSpreadsheetCell(value).replaceAll('"', '""')}"`)
    .join(',')
}
