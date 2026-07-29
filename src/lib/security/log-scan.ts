/**
 * Every place this repository can write to a console, and what it is allowed to
 * put there.
 *
 * BUILD_SPEC §15 and review checklist point 8: **never log a credential, an
 * email body, or an API key.**
 *
 * Four sessions have now recorded point 8 as the one claim on the twelve-point
 * checklist with nothing driving it, for a stated reason: it is a property of
 * *every log statement in the repository* rather than of one function, so there
 * is no single line to break and no single test to fail. That reasoning is
 * right about the shape of the claim and wrong about the conclusion. A property
 * of every statement is a property of the **set** of statements, and a set can
 * be enumerated.
 *
 * This module enumerates it. It is deliberately a module rather than a test, so
 * that the scanning and the judging are separable: the test states the rules,
 * this states what is actually there.
 *
 * ## What it does not claim
 *
 * This reads source text. It cannot know what a variable holds at runtime, so
 * it judges the **names** in the argument position of a console call, exactly
 * as the existing per-module scans in `qa/service.test.ts` and
 * `media/boundary.test.ts` do. That catches the defect this rule actually
 * guards against — somebody debugging a send path, printing the thing they are
 * debugging, and leaving it in — and it does not catch a body deliberately
 * aliased to an innocent name first. Nothing text-based could.
 *
 * The runtime half of point 8 is enforced elsewhere and is tested elsewhere:
 * `Secret` (email/transport/secret.ts) makes a credential inert in a template
 * literal, `scrubSecrets` removes one from text a transport handed back, and
 * `assertNoSecrets` (lib/audit.ts) throws rather than write a forbidden key to
 * the audit log. Those three are functions, they have single lines to break,
 * and `scripts/verify-mutants.ts` now breaks them.
 *
 * Together: three runtime defences with mutations, plus this inventory over
 * everything that is left. That is as close to the whole property as source
 * text can get, and the parts it cannot reach are named above rather than
 * implied.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** A single call to a console method, with enough context to report it. */
export interface LogCall {
  /** Repository-relative path. */
  file: string
  /** 1-based line of the `console.` token. */
  line: number
  /** `log`, `warn`, `error`… */
  method: string
  /** The whole call, source text, whitespace collapsed. */
  call: string
  /**
   * The parts of the argument list that are **expressions** — template
   * interpolations, and every argument that is not a plain string literal.
   * A string literal cannot carry a runtime secret, so it is judged by a
   * different rule (see `LITERAL_LOOKS_LIKE_A_CREDENTIAL`).
   */
  expressions: string[]
  /** The plain string literals passed as arguments, without their quotes. */
  literals: string[]
}

/**
 * Names that must never appear in the argument position of a console call.
 *
 * Two groups, and the distinction is worth keeping:
 *
 *   - *credentials* — `password`, `secret`, `token`, `apiKey`, `openai`,
 *     `credential`. Printing one is the defect §15 names first.
 *   - *message content* — `body`, `htmlBody`, `textBody`, `html`, `transcript`,
 *     `caption`, `question`, `answer`. An email body is not a credential, but
 *     §15 forbids it by the same sentence, and for a better reason than
 *     secrecy: a body carries an investor's name, their amount and the offer
 *     they were made, into a file nothing in this application controls the
 *     retention of.
 *
 * `text` is deliberately absent. It is the single most common innocent
 * identifier in this repository — a heading, a label, a line of a report — and
 * a rule that fires on all of them is a rule somebody switches off. `textBody`
 * is the name this application actually uses for the thing that matters.
 */
export const FORBIDDEN_IN_A_LOG =
  /\b(password|passphrase|secret|api[\s_]?key|private[\s_]?key|encryption[\s_]?key|token|open\s?ai|credential|html[\s_]?body|text[\s_]?body|body|html|transcript|caption|question|answer)\b/i

/**
 * A string literal that is itself a credential.
 *
 * The identifier rule above cannot see this one: `console.log('sk-…')` names
 * nothing. These are the prefixes of the credentials this application actually
 * handles, plus a long unbroken base64 run, which is what
 * `openssl rand -base64 32` produces and what `ENCRYPTION_KEY` and
 * `AUTH_SECRET` look like.
 */
export const LITERAL_LOOKS_LIKE_A_CREDENTIAL = /(sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|[A-Za-z0-9+/]{40,}={0,2})/

const SOURCE = /\.(ts|tsx|mts|cts)$/
const A_TEST = /\.test\.(ts|tsx)$/

/** Every source file under `dir`, tests excluded. */
export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === '.next') continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (SOURCE.test(path) && !A_TEST.test(path)) out.push(path)
  }
  return out
}

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

/** The top-level arguments of an argument list, split on commas that are not nested. */
function splitArguments(args: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''

  for (let i = 0; i < args.length; i += 1) {
    const c = args[i]!
    if (quote) {
      current += c
      if (c === '\\') {
        current += args[i + 1] ?? ''
        i += 1
      } else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      current += c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth += 1
    if (c === ')' || c === ']' || c === '}') depth -= 1
    if (c === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
      continue
    }
    current += c
  }
  if (current.trim() !== '') out.push(current.trim())
  return out
}

const PLAIN_LITERAL = /^(['"])(?:\\[\s\S]|(?!\1)[\s\S])*\1$/
const A_TEMPLATE = /^`[\s\S]*`$/

/**
 * The quoted text inside an expression, and what is left once it is gone.
 *
 * `'a report' + '\n  one question per line'` is a string, not a variable, and
 * an identifier rule that reads it reports the prose. This is not hypothetical:
 * `scripts/check-media.ts` explains bucket versioning in a concatenated
 * sentence containing the word *question*, and the first draft of this scanner
 * flagged it. A rule that cries wolf on a paragraph of documentation is a rule
 * somebody deletes.
 *
 * So quoted runs are lifted out and judged as literals — where the rule is
 * "does this look like a credential", which prose does not — and only the
 * residue is read for identifiers.
 */
export function separateLiterals(expression: string): { code: string; literals: string[] } {
  const literals: string[] = []
  let code = ''
  let quote: string | null = null
  let current = ''

  for (let i = 0; i < expression.length; i += 1) {
    const c = expression[i]!
    if (quote) {
      if (c === '\\') {
        current += expression[i + 1] ?? ''
        i += 1
        continue
      }
      if (c === quote) {
        // A template's interpolations are code, not text: keep them.
        if (quote === '`') {
          for (const interpolation of current.matchAll(/\$\{([\s\S]*?)\}/g)) code += ` ${interpolation[1]!} `
          literals.push(current.replace(/\$\{[\s\S]*?\}/g, ''))
        } else {
          literals.push(current)
        }
        quote = null
        current = ''
        continue
      }
      current += c
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    code += c
  }

  return { code, literals }
}

/** Every console call in one file's source text. */
export function consoleCalls(file: string, rawSource: string): LogCall[] {
  const { code: source, inString } = classify(rawSource)
  const found: LogCall[] = []
  /*
   * `console.*`, and the two writes that bypass it.
   *
   * `process.stdout.write` and `process.stderr.write` are the same act with a
   * different name, and both are in use here: `verify-all.ts` streams a child
   * process's output through the first, and `mint-setup-link.ts` prints a token
   * with it on purpose. Two log statements outside a set that claimed to
   * enumerate every one of them is exactly the gap this file exists to close,
   * so they are in the set and the deliberate one is declared as an exception
   * rather than left to be noticed later.
   */
  const opener =
    /(?:console\s*\.\s*(log|info|warn|error|debug|trace|dir|table|group|groupEnd)|process\s*\.\s*(stdout|stderr)\s*\.\s*(write))\s*\(/g

  let match: RegExpExecArray | null
  while ((match = opener.exec(source)) !== null) {
    // A `console.log(…)` written inside a string is data. `verify-mutants.ts`
    // holds several on purpose and executes none of them.
    if (inString[match.index]) continue

    let i = match.index + match[0].length
    let depth = 1
    let quote: string | null = null
    while (i < source.length && depth > 0) {
      const c = source[i]!
      if (quote) {
        if (c === '\\') i += 1
        else if (c === quote) quote = null
      } else if (c === "'" || c === '"' || c === '`') quote = c
      else if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      i += 1
    }

    const call = source.slice(match.index, i)
    const args = call.slice(call.indexOf('(') + 1, -1)
    const expressions: string[] = []
    const literals: string[] = []

    for (const argument of splitArguments(args)) {
      if (PLAIN_LITERAL.test(argument)) {
        literals.push(argument.slice(1, -1))
        continue
      }
      if (A_TEMPLATE.test(argument)) {
        // A template literal is inert except for what is interpolated into it.
        for (const interpolation of argument.matchAll(/\$\{([\s\S]*?)\}/g)) {
          expressions.push(interpolation[1]!)
        }
        literals.push(argument.replace(/\$\{[\s\S]*?\}/g, ''))
        continue
      }
      const separated = separateLiterals(argument)
      expressions.push(separated.code)
      literals.push(...separated.literals)
    }

    found.push({
      file,
      line: source.slice(0, match.index).split('\n').length,
      method: match[1] ?? `${match[2]!}.${match[3]!}`,
      call: call.replace(/\s+/g, ' '),
      expressions,
      literals,
    })
  }

  return found
}

/** Every console call under the given roots. */
export function scanForLogCalls(roots: readonly string[]): LogCall[] {
  const out: LogCall[] = []
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      out.push(...consoleCalls(file, readFileSync(file, 'utf8')))
    }
  }
  return out
}

/**
 * `portalToken` → `portal Token`, so that a word boundary finds the second half.
 *
 * Without this the rule reads `token` and misses `portalToken`, `setupToken`,
 * `sessionToken` and `resetToken` — which is to say, it misses every name this
 * repository actually gives a credential. The first draft did exactly that, and
 * the control below caught it, which is the entire argument for writing
 * controls for a negated check.
 *
 * It does not lowercase, and it does not split a boundary that is not a
 * camel hump: `somebody` stays one word, so `\bbody\b` does not fire on it.
 */
export function splitIdentifierWords(code: string): string {
  return code.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

/** The reason a call is a problem, or `null` if it is not one. */
export function judge(call: LogCall): string | null {
  for (const expression of call.expressions) {
    const offender = FORBIDDEN_IN_A_LOG.exec(splitIdentifierWords(expression))
    if (offender) return `logs \`${offender[1]}\``
  }
  for (const literal of call.literals) {
    if (LITERAL_LOOKS_LIKE_A_CREDENTIAL.test(literal)) return 'a literal in it looks like a credential'
  }
  return null
}
