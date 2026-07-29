import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { classify, codeWithoutStrings, existsInCode } from './source'

/**
 * The one classifier, with its contract written down.
 *
 * It arrived inside the log sweep and was pulled out when three other rules
 * turned out to need it. It is now load-bearing for seven source-level rules
 * across three files — the log inventory, the `everyOf` guard, the
 * one-Chromium-launcher guard and the runner's prerequisite audit — and it is
 * the single point at which all seven fail together.
 *
 * That is the thing worth stating plainly: **when this is wrong, every rule
 * built on it is wrong quietly.** Not one loud failure — seven checks that go on
 * reporting success about a repository they have stopped reading properly. Both
 * directions have already happened here:
 *
 *   - reading *too much* — three guards read `chromium.launch({})` out of a
 *     mutation table, where it is a string pasted into other files and never
 *     run;
 *   - reading *too little* — a regular expression containing quotation marks
 *     opened a string that never closed, and five hundred lines of
 *     `verify-deployment.ts` stopped being scanned; and later, blanking string
 *     contents outright made `from 'playwright'` unfindable, so four
 *     prerequisite audits passed over an empty set.
 *
 * The second direction is the dangerous one, and it is the one this file spends
 * most of its length on. A rule that reports nothing looks exactly like a rule
 * with nothing to report.
 */

const root = process.cwd()

/** Where in `source` is character `index` — code, or the inside of a string? */
function stringMask(source: string): string {
  const { inString } = classify(source)
  return source
    .split('')
    .map((character, index) => (inString[index] ? 's' : character === '\n' ? '\n' : 'c'))
    .join('')
}

describe('what the classifier promises about shape', () => {
  it('returns a string of exactly the same length, with the newlines where they were', () => {
    // Both properties are load-bearing: a failure message names a line number,
    // and the callers index into the mask by position.
    const source = "const a = 1\n// gone\nconst b = 'x'\n"
    const { code, inString } = classify(source)
    expect(code).toHaveLength(source.length)
    expect(inString).toHaveLength(source.length)
    expect(code.split('\n')).toHaveLength(source.split('\n').length)
  })

  it('blanks a line comment and a block comment, and nothing else', () => {
    const { code } = classify('const a = 1 // note\n/* gone */ const b = 2\n')
    expect(code).toContain('const a = 1')
    expect(code).toContain('const b = 2')
    expect(code).not.toContain('note')
    expect(code).not.toContain('gone')
  })

  it('does not treat the // of a URL inside a string as a comment', () => {
    const { code } = classify("const home = 'https://spv.flipit.com/verify'\nconst after = 1\n")
    expect(code).toContain('after')
    expect(stringMask("const u = 'https://x'").endsWith('sssssssssssc')).toBe(false)
  })
})

describe('what counts as the inside of a string', () => {
  it('a single-quoted and a double-quoted run', () => {
    expect(stringMask("a='b'")).toBe('ccsss')
    expect(stringMask('a="b"')).toBe('ccsss')
  })

  it('an escaped quote does not end it', () => {
    const mask = stringMask("a='b\\'c' + d")
    expect(mask.endsWith('c+ccc'.replace('+', 'c'))).toBe(false)
    // The `d` after the string is code, which is the whole question.
    expect(mask[mask.length - 1]).toBe('c')
  })

  it('a template literal is a string, except for what is interpolated into it', () => {
    const mask = stringMask('a=`x ${count} y`')
    expect(mask).toContain('s')
    // `count` is code again.
    const source = 'a=`x ${count} y`'
    const { inString } = classify(source)
    expect(inString[source.indexOf('count')]).toBe(false)
  })

  it('a nested brace inside an interpolation does not end it early', () => {
    const source = 'a=`${ {b: 1}.b } tail`'
    const { inString } = classify(source)
    expect(inString[source.indexOf('tail')]).toBe(true)
    expect(inString[source.indexOf('{b: 1}')]).toBe(false)
  })

  it('a regular expression is data, quotation marks and all', () => {
    // The one that cost five hundred lines of verify-deployment.ts.
    const source = 'for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) { after() }'
    const { inString } = classify(source)
    expect(inString[source.indexOf('(?:href')]).toBe(true)
    expect(inString[source.indexOf('after')]).toBe(false)
  })

  it('a slash used as division is not a regular expression', () => {
    const source = "const half = total / 2\nconst rest = other / 4\nconst s = 'tail'"
    const { inString } = classify(source)
    expect(inString[source.indexOf('rest')]).toBe(false)
    expect(inString[source.indexOf('tail')]).toBe(true)
  })

  it('a regular expression after return, or at the start of a line, is still one', () => {
    const afterReturn = 'function f() { return /a"b/.test(x) }\nconst tail = 1'
    expect(classify(afterReturn).inString[afterReturn.indexOf('tail')]).toBe(false)

    const assigned = 'const pattern = /a"b/\nconst tail = 1'
    expect(classify(assigned).inString[assigned.indexOf('tail')]).toBe(false)
  })

  it('a character class holding a slash does not end the expression early', () => {
    const source = 'const p = /[/"]x/g\nconst tail = 1'
    expect(classify(source).inString[source.indexOf('tail')]).toBe(false)
  })
})

describe('codeWithoutStrings — for a rule looking for a shape', () => {
  it('removes the contents of a string and keeps the code around it', () => {
    const out = codeWithoutStrings("const a = 'chromium.launch()'\nchromium.launch()\n")
    expect(out).not.toMatch(/'chromium\.launch\(\)'/)
    expect(out).toContain('chromium.launch()')
  })

  it('keeps the line numbers, because a failure message names one', () => {
    const source = "a\n'a very long string indeed'\nb\n"
    const out = codeWithoutStrings(source)
    expect(out.split('\n')).toHaveLength(source.split('\n').length)
    expect(out).toHaveLength(source.length)
  })

  it('is the wrong tool for a rule looking for an import — the recorded trap', () => {
    /*
     * This is not a hypothetical, it is what happened. Four prerequisite audits
     * were switched to this and went green while measuring nothing: the module
     * specifier is itself a string, so `from 'playwright'` is unfindable once
     * the quotes are emptied, every file is skipped, and the rule passes over
     * an empty set.
     */
    const importer = "import { chromium } from 'playwright'\n"
    expect(/from 'playwright'/.test(importer)).toBe(true)
    expect(/from 'playwright'/.test(codeWithoutStrings(importer))).toBe(false)
    expect(existsInCode(importer, /from 'playwright'/)).toBe(true)
  })
})

describe('existsInCode — for a rule looking for an import', () => {
  it('finds a pattern that starts in code', () => {
    expect(existsInCode("import { chromium } from 'playwright'", /from 'playwright'/)).toBe(true)
  })

  it('does not find one that starts inside a string', () => {
    const holder = "const mutation = { replace: \"import { chromium } from 'playwright'\" }"
    expect(existsInCode(holder, /from 'playwright'/)).toBe(false)
  })

  it('does not find one that is only in a comment', () => {
    expect(existsInCode("// import { chromium } from 'playwright'", /from 'playwright'/)).toBe(false)
  })

  it('keeps looking past a match that was inside a string', () => {
    // The first occurrence is data and the second is real. A version that
    // returned on the first match would report false.
    const both = ["const s = \"from 'playwright'\"", "import { chromium } from 'playwright'"].join('\n')
    expect(existsInCode(both, /from 'playwright'/)).toBe(true)
  })

  it('accepts a pattern with or without the global flag, and does not hang on an empty match', () => {
    expect(existsInCode('const a = 1', /a/g)).toBe(true)
    expect(existsInCode('const a = 1', /(?:)/)).toBe(true)
  })
})

describe('the repository it is actually pointed at', () => {
  const mutants = readFileSync(join(root, 'scripts/verify-mutants.ts'), 'utf8')
  const deployment = readFileSync(join(root, 'scripts/verify-deployment.ts'), 'utf8')
  const browser = readFileSync(join(root, 'scripts/lib/browser.ts'), 'utf8')

  it('reads the mutation table’s broken code as data, which is what it is', () => {
    // It holds these as strings and pastes them into other files. It runs none
    // of them, and three guards concluded otherwise before this existed.
    expect(mutants).toContain('chromium.launch({})')
    expect(existsInCode(mutants, /chromium\.launch\(/)).toBe(false)
    expect(existsInCode(mutants, /from 'playwright'/)).toBe(false)
    expect(codeWithoutStrings(mutants)).not.toContain('chromium.launch({})')
  })

  it('still reads the file that really does launch a browser', () => {
    // The other half, and the half that goes quiet rather than loud when this
    // is wrong.
    expect(existsInCode(browser, /from 'playwright'/)).toBe(true)
    expect(existsInCode(browser, /chromium\.launch\(/)).toBe(true)
  })

  it('scans the whole of verify-deployment.ts, quotation-marked regex and all', () => {
    expect(deployment).toContain('(?:href|src)=')
    const { inString } = classify(deployment)
    const codeCharacters = inString.filter((yes) => !yes).length
    // Before regular expressions were handled, one unclosed string swallowed
    // five hundred lines of this file. A ratio is the blunt way to notice that
    // happening again; the sharper check is in logging.test.ts, which counts
    // the console calls it finds here.
    expect(codeCharacters / deployment.length).toBeGreaterThan(0.6)
  })
})
