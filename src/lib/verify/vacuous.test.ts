import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appearsBefore, emptyBeside, everyOf, noneOf } from './vacuous'
import { codeWithoutStrings } from './source'

const root = join(import.meta.dirname, '../../..')

describe('every, for a check that found nothing', () => {
  it('is false on an empty collection, which is the whole point', () => {
    expect(everyOf([], () => true)).toBe(false)
    expect([].every(() => true)).toBe(true)
  })

  it('is the ordinary answer on a collection with rows in it', () => {
    expect(everyOf([1, 2, 3], (n) => n > 0)).toBe(true)
    expect(everyOf([1, 2, 3], (n) => n > 1)).toBe(false)
  })

  it('passes the index through', () => {
    expect(everyOf(['a', 'b'], (row, index) => row === ['a', 'b'][index])).toBe(true)
  })

  it('works on bytes, which are not an Array', () => {
    // `verify-erasure-bytes` compares what the store handed back against what
    // was put in, and a store that hands back nothing at all is the failure it
    // is looking for.
    expect(everyOf(new Uint8Array([1, 2, 3]), (byte) => byte > 0)).toBe(true)
    expect(everyOf(new Uint8Array(), () => true)).toBe(false)
  })

  it('does not stop early in a way that changes the answer', () => {
    let seen = 0
    everyOf([1, 2, 3], (n) => {
      seen += 1
      return n < 2
    })
    // Same short-circuit as `every`. Recorded because a check that counted its
    // own calls would be surprised otherwise.
    expect(seen).toBe(2)
  })
})

describe('nothing here matches, on a list that had something in it', () => {
  it('is false on an empty collection, where the negation says true', () => {
    /*
     * The claim being defended is *"Alice cannot see Bruno's document"*. A
     * version of it satisfied by Alice seeing nothing at all is not the claim,
     * and an empty list is exactly what a defect in the query that builds it
     * produces.
     */
    expect(![].some(() => true)).toBe(true)
    expect(noneOf([], () => true)).toBe(false)
  })

  it('is true when the row is absent and something else is there', () => {
    expect(noneOf(['alice'], (row) => row === 'bruno')).toBe(true)
  })

  it('is false when the row is there', () => {
    expect(noneOf(['alice', 'bruno'], (row) => row === 'bruno')).toBe(false)
  })

  it('is false when the only rows present are the ones said to be absent', () => {
    // The default control is "something here is not the thing we are excluding".
    // A list of nothing but excluded rows fails on both counts.
    expect(noneOf(['bruno'], (row) => row === 'bruno')).toBe(false)
  })

  it('takes a stronger control when the fixture has one', () => {
    const list = ['alice-doc']
    expect(
      noneOf(
        list,
        (row) => row === 'bruno-doc',
        (row) => row === 'alice-doc',
      ),
    ).toBe(true)
    // The named control missing is a failure even though the excluded row is
    // also missing — which is the point: the list is not the list it should be.
    expect(
      noneOf(
        ['somebody-elses-doc'],
        (row) => row === 'bruno-doc',
        (row) => row === 'alice-doc',
      ),
    ).toBe(false)
  })
})

describe('empty, beside something that is not', () => {
  it('is true when the collection is empty and the control is not', () => {
    expect(emptyBeside([], [1])).toBe(true)
  })

  it('is false when the collection is not empty', () => {
    expect(emptyBeside([1], [1, 2])).toBe(false)
  })

  it('is false when the control is empty, whatever the collection says', () => {
    // The whole reason it exists. `liveSessions.length === 0` passes when the
    // fixture never made a session, and reports that revocation works.
    expect(emptyBeside([], [])).toBe(false)
  })

  it('counts a Map and a Set as well as an array', () => {
    expect(emptyBeside(new Map(), new Set([1]))).toBe(true)
    expect(emptyBeside(new Map(), new Set())).toBe(false)
    expect(emptyBeside(new Set([1]), new Map([[1, 1]]))).toBe(false)
  })

  it('reports the defect the plain count reports as ok — the control', () => {
    // Both halves of a revocation check, run against a fixture whose session
    // insert silently did nothing.
    const before: unknown[] = []
    const after: unknown[] = []

    expect(after.length === 0).toBe(true) // the old form: green, and worthless
    expect(emptyBeside(after, before)).toBe(false) // the new one: red, correctly
  })
})

describe('one thing appearing before another', () => {
  it('is true when both are there in that order', () => {
    expect(appearsBefore('run the lock probe, then reschedule', 'lock', 'reschedule')).toBe(true)
  })

  it('is false when they are the wrong way round', () => {
    expect(appearsBefore('reschedule it, or run the lock probe', 'lock', 'reschedule')).toBe(false)
  })

  it('is false when the first one is missing, which indexOf calls true', () => {
    /*
     * The defect this exists for. `-1 < 4` is true, so the raw comparison is
     * satisfied by the earlier thing not being in the text at all — and that is
     * exactly what happens when somebody rewords a remedy and drops a sentence.
     */
    expect('reschedule it'.indexOf('lock') < 'reschedule it'.indexOf('reschedule')).toBe(true)
    expect(appearsBefore('reschedule it', 'lock', 'reschedule')).toBe(false)
  })

  it('is false when the second one is missing', () => {
    expect(appearsBefore('run the lock probe', 'lock', 'reschedule')).toBe(false)
  })

  it('is false when neither is there', () => {
    expect(appearsBefore('something else entirely', 'lock', 'reschedule')).toBe(false)
  })
})

/**
 * The source-level guard, in the shape `chromium.test.ts` established.
 *
 * The fix that is written once and applied to *some* of the places that need it
 * is how this repository lost three verification scripts to a browser path and
 * then lost the overview banner to a plural. Twenty-one call sites had the
 * empty-array defect; a twenty-second added next month would look exactly like
 * the twenty-one that were fixed.
 */
describe('no verification script calls every() on a query result', () => {

  /**
   * The scripts, with comments and **string contents** blanked out.
   *
   * These rules ask *does this file launch a browser* and *does this file call
   * `.every()` on a query result*. `verify-mutants.ts` holds broken code as
   * strings — `chromium.launch({})`, `.every(`, a `console.log` of an email
   * body — and pastes them into other files to check that somebody notices. It
   * runs none of them. A guard that reads them is reporting the check that
   * proves the guard works, which is how a rule gets switched off.
   *
   * One classifier, in `@/lib/verify/source`, shared by every source-level
   * rule here. Line numbers survive, so a failure still points at the line.
   */
  function scriptSources(): Array<{ name: string; source: string }> {
    const out: Array<{ name: string; source: string }> = []
    for (const dir of ['scripts', 'scripts/lib']) {
      for (const name of readdirSync(join(root, dir))) {
        if (!name.endsWith('.ts')) continue
        out.push({
          name: dir === 'scripts' ? name : `lib/${name}`,
          source: codeWithoutStrings(readFileSync(join(root, dir, name), 'utf8')),
        })
      }
    }
    return out
  }

  it('finds the scripts at all, so an empty directory cannot pass this', () => {
    expect(scriptSources().length).toBeGreaterThan(20)
  })

  it('and every one of them goes through everyOf', () => {
    /*
     * The one form still allowed is `[...].every(`, on an **inline array
     * literal** — a fixed list written on the spot, which cannot be empty by
     * surprise because it is right there to count.
     *
     * Anything else is a collection whose size came from somewhere else: a
     * query, a filter, a page. Those are the ones where empty means "there was
     * nothing to check" and `every` says `ok`.
     */
    for (const { name, source } of scriptSources()) {
      const offending = source
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => /\.every\(/.test(line))
        .filter(({ line }) => !/\]\.every\(/.test(line))

      expect(
        offending.map((row) => `${name}:${row.number}${row.line}`),
        `${name} calls .every() on something that could be empty — use everyOf() from ` +
          '@/lib/verify/vacuous, or write it as a count if none is the right answer',
      ).toEqual([])
    }
  })

  it('and none of them compares two indexOf results', () => {
    // The same defect in its other coat. `appearsBefore` is the replacement.
    for (const { name, source } of scriptSources()) {
      expect(
        source,
        `${name} orders two indexOf results — a missing needle is -1 and passes. ` +
          'Use appearsBefore() from @/lib/verify/vacuous',
      ).not.toMatch(/indexOf\([^)]*\)\s*[<>]\s*[\w.]*\.indexOf\(/)
    }
  })
})
