import { describe, expect, it } from 'vitest'
import {
  contentRangeHeader,
  resolveRange,
  unsatisfiableRangeHeader,
  type RangeOutcome,
} from './ranges'

/**
 * The arithmetic the original route refused to write, written down.
 *
 * The comment it replaced said a hand-written range parser is a place to get an
 * off-by-one wrong. It is — which is an argument for putting it in one pure
 * function with the tests against it, not for a portal whose video does not
 * play on an iPhone.
 */

const SIZE = 1000

function partial(header: string, size = SIZE): { start: number; end: number; length: number } {
  const outcome = resolveRange(header, size)
  if (outcome.kind !== 'partial') throw new Error(`expected a partial range, got ${outcome.kind}`)
  return outcome.range
}

function kindOf(header: string | null, size = SIZE): RangeOutcome['kind'] {
  return resolveRange(header, size).kind
}

describe('an explicit span', () => {
  it('bytes=0-99 is the first hundred bytes', () => {
    expect(partial('bytes=0-99')).toEqual({ start: 0, end: 99, length: 100 })
  })

  it('the end is inclusive, which is where the off-by-one lives', () => {
    expect(partial('bytes=0-0')).toEqual({ start: 0, end: 0, length: 1 })
    expect(partial('bytes=999-999')).toEqual({ start: 999, end: 999, length: 1 })
  })

  it('bytes=0-999 is the whole thousand, as a 206', () => {
    expect(partial('bytes=0-999')).toEqual({ start: 0, end: 999, length: SIZE })
  })

  /** Safari's opening move on every video element it meets. */
  it('bytes=0-1 — the two bytes Safari asks for first', () => {
    expect(partial('bytes=0-1')).toEqual({ start: 0, end: 1, length: 2 })
  })

  it('an end past the last byte is clamped rather than refused', () => {
    expect(partial('bytes=500-99999')).toEqual({ start: 500, end: 999, length: 500 })
  })

  it('a start past the end is unsatisfiable', () => {
    expect(kindOf('bytes=1000-1099')).toBe('unsatisfiable')
    expect(kindOf('bytes=5000-')).toBe('unsatisfiable')
  })

  it('an end before the start is unsatisfiable', () => {
    expect(kindOf('bytes=500-499')).toBe('unsatisfiable')
  })
})

describe('an open-ended span', () => {
  it('bytes=500- runs to the end', () => {
    expect(partial('bytes=500-')).toEqual({ start: 500, end: 999, length: 500 })
  })

  it('bytes=0- is the whole file as a 206', () => {
    expect(partial('bytes=0-')).toEqual({ start: 0, end: 999, length: SIZE })
  })
})

describe('a suffix', () => {
  it('bytes=-100 is the LAST hundred bytes, not the first', () => {
    expect(partial('bytes=-100')).toEqual({ start: 900, end: 999, length: 100 })
  })

  it('a suffix longer than the file is the whole file', () => {
    expect(partial('bytes=-99999')).toEqual({ start: 0, end: 999, length: SIZE })
  })

  it('a suffix of zero is unsatisfiable — there is no last nothing bytes', () => {
    expect(kindOf('bytes=-0')).toBe('unsatisfiable')
  })
})

describe('everything that is not a range this build answers', () => {
  it('no header at all', () => {
    expect(kindOf(null)).toBe('whole')
  })

  it('an empty file is answered whole, never 416', () => {
    expect(kindOf('bytes=0-99', 0)).toBe('whole')
    expect(kindOf('bytes=-1', 0)).toBe('whole')
  })

  it('a unit that is not bytes', () => {
    expect(kindOf('items=0-99')).toBe('whole')
    expect(kindOf('seconds=0-10')).toBe('whole')
  })

  /**
   * Answering 200 to a multi-range request is explicitly permitted — a server
   * may always ignore `Range`. It is also the safer answer: building a
   * multipart/byteranges body is the part of this that really would be a place
   * to get something wrong.
   */
  it('several ranges at once are answered whole rather than as multipart', () => {
    expect(kindOf('bytes=0-99,200-299')).toBe('whole')
    expect(kindOf('bytes=0-99, 200-299')).toBe('whole')
  })

  it('malformed headers are answered whole rather than guessed at', () => {
    for (const header of [
      'bytes=',
      'bytes=-',
      'bytes=abc-def',
      'bytes=1-2-3',
      'bytes 0-99',
      '0-99',
      'bytes=0-99;q=1',
      'bytes=1e3-2e3',
      'bytes=0x10-0x20',
      '',
      '   ',
    ]) {
      expect(kindOf(header)).toBe('whole')
    }
  })

  it('a negative start is not a span — the minus is what makes a suffix', () => {
    // "bytes=-5-10" does not match the shape at all.
    expect(kindOf('bytes=-5-10')).toBe('whole')
  })

  it('a number too large to be exact is answered whole, not mis-sliced', () => {
    expect(kindOf('bytes=99999999999999999999-')).toBe('whole')
    expect(kindOf('bytes=0-99999999999999999999')).toBe('whole')
  })
})

describe('the headers that go back', () => {
  it('Content-Range on a 206 names the span and the total', () => {
    expect(contentRangeHeader({ start: 0, end: 99, length: 100 }, 1000)).toBe('bytes 0-99/1000')
    expect(contentRangeHeader({ start: 900, end: 999, length: 100 }, 1000)).toBe(
      'bytes 900-999/1000',
    )
  })

  it('Content-Range on a 416 names the size and nothing else', () => {
    expect(unsatisfiableRangeHeader(1000)).toBe('bytes */1000')
  })
})

describe('a resolved range is always inside the file', () => {
  /**
   * The property that matters, checked exhaustively over a small file rather
   * than argued about: whatever comes back can be sliced without reaching past
   * either end, and its stated length is the length of that slice.
   */
  it('every satisfiable range over a 32-byte file slices cleanly', () => {
    const size = 32

    const headers: string[] = []
    for (let a = 0; a <= size + 1; a += 1) {
      headers.push(`bytes=${a}-`)
      headers.push(`bytes=-${a}`)
      for (let b = 0; b <= size + 1; b += 1) headers.push(`bytes=${a}-${b}`)
    }

    for (const header of headers) {
      const outcome = resolveRange(header, size)
      if (outcome.kind !== 'partial') continue

      const { start, end, length } = outcome.range
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeLessThan(size)
      expect(end).toBeGreaterThanOrEqual(start)
      expect(length).toBe(end - start + 1)

      const slice = new Uint8Array(size).slice(start, end + 1)
      expect(slice.length).toBe(length)
    }
  })
})
