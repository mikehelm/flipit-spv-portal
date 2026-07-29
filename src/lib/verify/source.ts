/**
 * What each character of a source file *is*: code, the inside of a string, or a
 * comment.
 *
 * ## Why this is its own file
 *
 * Four things in this repository read TypeScript source as text and make a
 * decision from it — the log sweep, the `everyOf` guard, the one-Chromium-
 * launcher guard, and the runner's prerequisite audit. Each of them had its own
 * idea of what counted as code, and every one of those ideas was a regular
 * expression over raw text.
 *
 * That is the same defect this repository already fixed once, in a different
 * costume. `chromium.test.ts` exists because a correct browser launch was
 * written twice and the two copies disagreed; its own header calls the last
 * test in it "the only thing preventing the sixth copy". Four private
 * definitions of *this is code* is the same situation, and they disagreed in
 * the same way:
 *
 *   - The log sweep read `console.log(rendered.html)` out of a **string** in
 *     `verify-mutants.ts`, where it is a mutation held as data and never run.
 *   - The `everyOf` guard read `.every(` out of the same strings.
 *   - The Chromium guard read `chromium.launch(` out of them, and the runner's
 *     audit concluded `verify-mutants.ts` drives a browser.
 *   - And in the other direction, a first draft of the log sweep read the
 *     quotation marks inside `/(?:href|src)="([^"]+)"/g` as the start of a
 *     string, opened one that never closed, and stopped seeing five hundred
 *     lines of `verify-deployment.ts` — reporting a cleaner repository than the
 *     truth.
 *
 * So there is one classifier, here, and the guards use it. A file that holds
 * broken code on purpose is not broken, and a rule that cannot tell the
 * difference will be switched off by the first person it lies to.
 *
 * ## What it does not do
 *
 * It is a tokeniser, not a parser. It knows strings, template literals with
 * their `${…}` holes, both kinds of comment, and regular expressions —
 * distinguished from division by the usual previous-token heuristic, which is
 * right on this repository and is a heuristic. It knows nothing about scope,
 * types or control flow, and it is not trying to.
 */

/**
 * What each character of a file *is*: code, the inside of a string, or a
 * comment.
 *
 * Two files in this repository make the distinction load-bearing, and both were
 * found by this scanner reporting them:
 *
 *   - `email/transport/secret.ts` contains the words `console.log(transport)`
 *     in a comment, explaining why that call is inert. A scanner that reported
 *     it would be reporting the documentation.
 *   - `scripts/verify-mutants.ts` contains `console.log(rendered.html)` as a
 *     **string**, because its job is to hold broken code as data and paste it
 *     into a file to see whether anybody notices. It never runs it. Reporting
 *     that one would be reporting the check that proves this file works.
 *
 * The honest treatment of both is the same and it is not an exclusion list:
 * text inside a comment or a string is not a log statement. One pass decides
 * it, and a template literal's `${…}` counts as code again, because that is
 * where a body would actually be interpolated.
 */
export function classify(source: string): { code: string; inString: boolean[] } {
  const inString = new Array<boolean>(source.length).fill(false)
  const out = source.split('')

  let i = 0

  const blank = (at: number): void => {
    if (out[at] !== '\n') out[at] = ' '
  }

  /**
   * Is the `/` at `at` the start of a regular expression, or a division?
   *
   * The usual heuristic: a regex may not follow a value. This matters here
   * because `scripts/verify-deployment.ts` contains
   * `/(?:href|src)="([^"]+)"/g`, and a classifier that reads those quotation
   * marks as a string opens one that never closes — which swallowed five
   * hundred lines and fourteen real console calls in the first draft. The
   * scanner reported a *cleaner* repository than the truth, which is the exact
   * failure mode this whole file exists to rule out.
   */
  const startsARegex = (at: number): boolean => {
    let j = at - 1
    while (j >= 0 && /\s/.test(source[j]!)) j -= 1
    if (j < 0) return true
    const previous = source[j]!
    if (/[A-Za-z0-9_$)\]]/.test(previous)) {
      // `return /x/`, `typeof /x/` and friends: a keyword is not a value.
      const word = /[A-Za-z0-9_$]+$/.exec(source.slice(0, j + 1))?.[0]
      return word !== undefined && ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await'].includes(word)
    }
    return true
  }

  while (i < source.length) {
    const c = source[i]!
    const next = source[i + 1]

    if (c === '/' && next !== '/' && next !== '*' && startsARegex(i)) {
      inString[i] = true
      i += 1
      let inClass = false
      while (i < source.length && source[i] !== '\n') {
        const t = source[i]!
        inString[i] = true
        if (t === '\\') {
          inString[i + 1] = true
          i += 2
          continue
        }
        if (t === '[') inClass = true
        else if (t === ']') inClass = false
        else if (t === '/' && !inClass) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }

    if (c === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) blank(i++)
      blank(i)
      blank(i + 1)
      i += 2
      continue
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') blank(i++)
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      inString[i] = true
      i += 1
      while (i < source.length && source[i] !== quote) {
        inString[i] = true
        if (source[i] === '\\') {
          inString[i + 1] = true
          i += 1
        }
        i += 1
      }
      inString[i] = true
      i += 1
      continue
    }
    if (c === '`') {
      inString[i] = true
      i += 1
      let depth = 0
      while (i < source.length) {
        const t = source[i]!
        if (t === '\\') {
          inString[i] = true
          inString[i + 1] = true
          i += 2
          continue
        }
        if (t === '$' && source[i + 1] === '{') {
          // Code again, until the matching brace.
          depth = 1
          i += 2
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth += 1
            if (source[i] === '}') depth -= 1
            i += 1
          }
          continue
        }
        if (t === '`') {
          inString[i] = true
          i += 1
          break
        }
        inString[i] = true
        i += 1
      }
      continue
    }

    i += 1
  }
  return { code: out.join(''), inString }
}

/**
 * Comments, replaced by the same number of characters of whitespace.
 *
 * Not deleted: the line numbers in a failure message have to point at the line
 * the reader will find in their editor.
 */
export function blankComments(source: string): string {
  return classify(source).code
}

/**
 * The code of a file, with every comment **and every string's contents**
 * blanked out.
 *
 * This is what a source-level guard should read. `expect(source).not.toMatch(
 * /chromium\.launch\(/)` is asking *does this file launch a browser*, and a
 * mutation table that stores the text `chromium.launch({})` as a string to
 * paste into another file does not. Line numbers and file length are preserved,
 * so a failure still points at the right line.
 */
export function codeWithoutStrings(source: string): string {
  const { code, inString } = classify(source)
  const out = code.split('')
  for (let i = 0; i < out.length; i += 1) {
    if (inString[i] && out[i] !== '\n') out[i] = ' '
  }
  return out.join('')
}

/**
 * Does this pattern occur in the file's **code**, rather than inside a string?
 *
 * `codeWithoutStrings` is the right tool when the rule is looking for a shape —
 * `.every(`, `chromium.launch(`. It is the wrong one when the rule is looking
 * for an **import**, because a module specifier *is* a string:
 * `/from 'playwright'/` finds nothing once the quotes are emptied.
 *
 * So this asks the question the other way round. The pattern is matched against
 * the source as written, and a match counts only if the position it starts at
 * is code. `from 'playwright'` at the top of a file starts on the `f` of `from`,
 * which is code; the same eleven characters inside a mutation's replacement
 * text start inside a string, and do not count.
 */
export function existsInCode(source: string, pattern: RegExp): boolean {
  // Against the comment-blanked text, not the raw source: a rule asking *does
  // this file import Playwright* must not be answered by a comment explaining
  // that it deliberately does not. Blanking preserves every position, so the
  // mask still lines up.
  const { code, inString } = classify(source)
  const search = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let match: RegExpExecArray | null
  while ((match = search.exec(code)) !== null) {
    if (!inString[match.index]) return true
    if (match.index === search.lastIndex) search.lastIndex += 1
  }
  return false
}
