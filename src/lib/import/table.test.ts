import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { columnValues, parseDelimited, readTable, sniffDelimiter } from './table'

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('parseDelimited', () => {
  it('reads a plain CSV', () => {
    expect(parseDelimited('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('reads quoted fields containing the delimiter and newlines', () => {
    const rows = parseDelimited('name,note\n"Smith, John","line one\nline two"\n')
    expect(rows[1]).toEqual(['Smith, John', 'line one\nline two'])
  })

  it('reads doubled quotes', () => {
    expect(parseDelimited('a\n"He said ""no"""\n')[1]).toEqual(['He said "no"'])
  })

  it('reads CRLF and a BOM', () => {
    expect(parseDelimited('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('sniffs semicolons and tabs', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(parseDelimited('a;b\n1;2')[1]).toEqual(['1', '2'])
  })

  it('does not treat a quoted delimiter as a delimiter when sniffing', () => {
    expect(sniffDelimiter('name;note\n"Smith, John";"a, b, c, d, e"')).toBe(';')
  })
})

describe('readTable', () => {
  it('reads a CSV into headers and rows', () => {
    const result = readTable('list.csv', bytes('Name,Email\nAda,ada@example.com\n'))
    if (!result.ok) throw new Error(result.message)
    expect(result.table.headers).toEqual(['Name', 'Email'])
    expect(result.table.rows).toEqual([['Ada', 'ada@example.com']])
    expect(result.table.sourceRowNumbers).toEqual([2])
  })

  it('skips leading blank rows and says so', () => {
    const result = readTable('list.csv', bytes('\n\nName,Email\nAda,ada@example.com\n'))
    if (!result.ok) throw new Error(result.message)
    expect(result.table.headers).toEqual(['Name', 'Email'])
    expect(result.table.sourceRowNumbers).toEqual([4])
    expect(result.notices.join(' ')).toMatch(/blank/)
  })

  it('names empty and duplicated headers rather than losing them', () => {
    const result = readTable('list.csv', bytes('Name,,Name\na,b,c\n'))
    if (!result.ok) throw new Error(result.message)
    expect(result.table.headers).toEqual(['Name', 'Column 2', 'Name (2)'])
  })

  it('pads short rows and drops entirely blank ones', () => {
    const result = readTable('list.csv', bytes('a,b,c\n1\n\n2,3,4\n'))
    if (!result.ok) throw new Error(result.message)
    expect(result.table.rows).toEqual([
      ['1', '', ''],
      ['2', '3', '4'],
    ])
  })

  it('refuses an empty file, a headers-only file and an unknown type', () => {
    expect(readTable('list.csv', bytes('')).ok).toBe(false)
    expect(readTable('list.csv', bytes('a,b\n')).ok).toBe(false)
    expect(readTable('list.pdf', bytes('a,b\n1,2')).ok).toBe(false)
  })

  it('reads an xlsx, including dates and numbers, as strings', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Name', 'Amount', 'Deadline'],
      ['Ada', 1500, new Date(2026, 7, 10)],
    ])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Recipients')
    const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const result = readTable('list.xlsx', new Uint8Array(buffer))
    if (!result.ok) throw new Error(result.message)
    expect(result.table.headers).toEqual(['Name', 'Amount', 'Deadline'])
    expect(result.table.rows[0][0]).toBe('Ada')
    expect(result.table.rows[0][1]).toBe('1500')
    expect(result.table.rows[0][2]).toBe('2026-08-10')
    expect(result.table.sheetNames).toEqual(['Recipients'])
    expect(result.table.rows[0].every((cell) => typeof cell === 'string')).toBe(true)
  })

  it('reads a named sheet when asked', () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['x'], ['1']]), 'First')
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['y'], ['2']]), 'Second')
    const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const result = readTable('list.xlsx', new Uint8Array(buffer), { sheetName: 'Second' })
    if (!result.ok) throw new Error(result.message)
    expect(result.table.headers).toEqual(['y'])
  })
})

describe('columnValues', () => {
  it('returns a column in file order', () => {
    const result = readTable('list.csv', bytes('a,b\n1,2\n3,4\n'))
    if (!result.ok) throw new Error(result.message)
    expect(columnValues(result.table, 'b')).toEqual(['2', '4'])
    expect(columnValues(result.table, 'missing')).toEqual([])
  })
})
