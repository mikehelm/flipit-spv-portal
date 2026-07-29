/**
 * Checklist point 8, over the whole repository: **does any log line contain a
 * token, an email body, or the OpenAI key?**
 *
 * Four PROGRESS.md entries recorded this as the one point of the twelve with no
 * mutation, each of them giving the same reason: it is a property of every log
 * statement rather than of one function, so there is nothing to break. The
 * reason is sound and the conclusion was wrong. A property of every statement
 * is a property of the *set*, and this enumerates the set.
 *
 * Three rules, and each of them can fail:
 *
 *   1. **Nothing in `src/` or `scripts/` names a credential or a message body
 *      in the argument position of a console call.** This is the sweep.
 *   2. **The shipped application logs from two files and no others**, at an
 *      exact count, each with a reason written here. A new log line in a
 *      request path is a decision, not a detail, and this makes somebody state
 *      it.
 *   3. **The one deliberate exception is named** — `db/seed.ts` prints a
 *      one-time setup link, token and all, to the console of the administrator
 *      who ran it. It is the only place in this repository where a credential
 *      is printed on purpose, and an unstated exception is how a rule rots.
 *
 * Each of the three has a control below it: a synthetic source that the rule is
 * asserted to *catch*. Six of this repository's negated checks are on record as
 * having no control, and a sweep that reports "no offenders" over a scanner
 * that silently found no files would read exactly the same as this one.
 *
 * The runtime half of point 8 — `Secret`, `scrubSecrets`, `assertNoSecrets` —
 * lives in three functions with tests of their own, and `verify:mutants` breaks
 * all three.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  consoleCalls,
  judge,
  scanForLogCalls,
  separateLiterals,
  sourceFiles,
  splitIdentifierWords,
  FORBIDDEN_IN_A_LOG,
  LITERAL_LOOKS_LIKE_A_CREDENTIAL,
} from './log-scan'

const ROOTS = ['src', 'scripts'] as const

/**
 * Every console call in the shipped application, by file, with the reason it is
 * allowed to be there.
 *
 * An exact count rather than a ceiling. A ceiling permits a log line to be
 * added silently, and the whole value of this entry is that adding one to a
 * request path costs somebody a sentence.
 */
const ALLOWED_IN_SRC: ReadonlyArray<{ file: string; calls: number; because: string }> = [
  {
    file: 'src/app/api/health/route.ts',
    calls: 1,
    because:
      'The health endpoint reports 503 when its own report cannot be built. It prints a ' +
      'fixed sentence and no data — deliberately, because this is the one line in a ' +
      'request path that survives to a hosting provider’s log aggregator.',
  },
  {
    file: 'src/db/seed.ts',
    calls: 17,
    because:
      'The seed is a command an administrator runs on their own machine and reads the ' +
      'output of. It is not a request path. It prints what it created, and the one-time ' +
      'setup links — see the exception below.',
  },
]

describe('rule 1 — nothing logs a credential or a message body', () => {
  const calls = scanForLogCalls(ROOTS)

  it('found something to judge', () => {
    // The control on the sweep itself. A scanner that resolved no files, or
    // whose call pattern had drifted, would report a clean repository in
    // exactly the words a clean repository reports itself in.
    expect(calls.length).toBeGreaterThan(300)
    expect(calls.some((call) => call.file === 'src/db/seed.ts')).toBe(true)
    expect(calls.some((call) => call.file.startsWith('scripts/'))).toBe(true)
  })

  it('names no credential and no body in any of them', () => {
    const offenders = calls
      .map((call) => ({ call, why: judge(call) }))
      .filter((entry) => entry.why !== null)
      .map((entry) => `${entry.call.file}:${entry.call.line} ${entry.why} — ${entry.call.call.slice(0, 120)}`)

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('catches one that does — the control', () => {
    const planted = consoleCalls(
      'planted.ts',
      [
        'const snapshotId = snapshot.id',
        'console.log(rendered.html)',
        'console.warn("sending as", credentials.appPassword)',
        'console.error(`issued ${portalToken}`)',
        'console.info("body:", snapshot.htmlBody)',
      ].join('\n'),
    )

    expect(planted).toHaveLength(4)
    expect(planted.map(judge)).toEqual([
      'logs `html`',
      'logs `Password`',
      // `portalToken` is the name this repository actually uses. A rule with a
      // word boundary on both sides reads straight past it, and the first draft
      // of this file did. That is what a control is for.
      'logs `Token`',
      'logs `html Body`',
    ])
  })

  it('splits a camel hump but not a word that merely ends in one', () => {
    expect(splitIdentifierWords('portalToken')).toBe('portal Token')
    expect(splitIdentifierWords('somebody')).toBe('somebody')
    expect(FORBIDDEN_IN_A_LOG.test(splitIdentifierWords('somebody'))).toBe(false)
    expect(FORBIDDEN_IN_A_LOG.test(splitIdentifierWords('nobodyElse'))).toBe(false)
    for (const name of ['setupToken', 'sessionToken', 'resetToken', 'openAiApiKey', 'smtpPassword']) {
      expect(FORBIDDEN_IN_A_LOG.test(splitIdentifierWords(name)), name).toBe(true)
    }
  })

  it('does not cry wolf on prose, a label, or an innocent identifier', () => {
    const innocent = consoleCalls(
      'innocent.ts',
      [
        "console.log('  one question per line, and the answer beneath it')",
        'console.log(`  ${count} rows, ${elapsed}ms`)',
        "console.log('\\n  Deletes are permanent — versioning is off.' + '\\n  Nothing to do.')",
        'console.error("Seed failed:", error)',
      ].join('\n'),
    )

    expect(innocent).toHaveLength(4)
    expect(innocent.map(judge)).toEqual([null, null, null, null])
  })

  it('reads the code of a concatenation and the prose of it separately', () => {
    const separated = separateLiterals("'a body of text ' + entry.answer + ' more prose'")
    expect(separated.literals).toEqual(['a body of text ', ' more prose'])
    expect(FORBIDDEN_IN_A_LOG.test(separated.code)).toBe(true)
    expect(separated.code).not.toContain('prose')
  })

  it('ignores a console call that is only mentioned in a comment', () => {
    // `email/transport/secret.ts` documents why `console.log(transport)` is
    // inert. A scanner that reported it would be reporting its own reasoning.
    const documented = consoleCalls(
      'documented.ts',
      ['/**', ' * A stray `console.log(transport)` cannot reach the value.', ' */', 'export const x = 1'].join('\n'),
    )
    expect(documented).toEqual([])

    const real = readFileSync('src/lib/email/transport/secret.ts', 'utf8')
    expect(real).toContain('console.log(transport)')
    expect(consoleCalls('src/lib/email/transport/secret.ts', real)).toEqual([])
  })

  it('reads a console call written inside a string as data, not as a log line', () => {
    // `scripts/verify-mutants.ts` holds broken code as strings and pastes it
    // into a file to see whether anybody notices. Two of those strings are log
    // lines that print a body — deliberately, and it never runs them.
    const asData = consoleCalls(
      'holder.ts',
      ['const mutation = {', "  replace: 'console.log(rendered.html)',", '}'].join('\n'),
    )
    expect(asData).toEqual([])

    const real = readFileSync('scripts/verify-mutants.ts', 'utf8')
    expect(real).toContain('console.log(rendered.html)')
    expect(consoleCalls('scripts/verify-mutants.ts', real).map(judge).filter(Boolean)).toEqual([])
  })

  it('does not mistake a quotation mark inside a regular expression for a string', () => {
    // The first draft did, and the consequence was the wrong direction: an
    // unclosed string swallowed five hundred lines of `verify-deployment.ts`
    // and fourteen real console calls with them. The sweep reported a cleaner
    // repository than the truth, which is the one failure this file cannot
    // have.
    const withARegex = consoleCalls(
      'regex.ts',
      ['for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {}', 'console.log(session.appPassword)'].join('\n'),
    )
    expect(withARegex).toHaveLength(1)
    expect(judge(withARegex[0]!)).toBe('logs `Password`')

    const deployment = readFileSync('scripts/verify-deployment.ts', 'utf8')
    expect(deployment).toContain('(?:href|src)=')
    expect(consoleCalls('scripts/verify-deployment.ts', deployment).length).toBeGreaterThan(10)
  })

  it('tells a regular expression from a division', () => {
    const divided = consoleCalls(
      'maths.ts',
      ['const half = total / 2', 'const rest = other / 4', 'console.log(message.textBody)'].join('\n'),
    )
    expect(divided).toHaveLength(1)
    expect(judge(divided[0]!)).toBe('logs `text Body`')
  })

  it('knows a base64 secret from a sentence', () => {
    expect(LITERAL_LOOKS_LIKE_A_CREDENTIAL.test('sk-proj-0123456789abcdefghij')).toBe(true)
    expect(LITERAL_LOOKS_LIKE_A_CREDENTIAL.test('kZ8sNq2hR4tVwXy7BdFgJlMnPqStUvWxYz0123456789+/AB=')).toBe(true)
    expect(LITERAL_LOOKS_LIKE_A_CREDENTIAL.test('  created reminder schedule (7 and 2 days before, cap 2)')).toBe(false)
  })
})

describe('rule 2 — the shipped application logs from two files', () => {
  const inSrc = scanForLogCalls(['src'])

  it('logs from exactly the files named here, at exactly the counts named here', () => {
    const actual = new Map<string, number>()
    for (const call of inSrc) actual.set(call.file, (actual.get(call.file) ?? 0) + 1)

    const expected = new Map(ALLOWED_IN_SRC.map((entry) => [entry.file, entry.calls]))

    const unexpected = [...actual.keys()].filter((file) => !expected.has(file))
    expect(
      unexpected,
      `A new file in the application writes to a console:\n  ${unexpected.join('\n  ')}\n` +
        'Add it to ALLOWED_IN_SRC with the reason it is allowed to, or take it out.',
    ).toEqual([])

    for (const [file, count] of expected) {
      expect(actual.get(file) ?? 0, `${file} — the count in ALLOWED_IN_SRC is stale`).toBe(count)
    }
  })

  it('gives a reason for every one of them', () => {
    for (const entry of ALLOWED_IN_SRC) {
      expect(entry.because.length, entry.file).toBeGreaterThan(80)
    }
  })

  it('would notice a new one — the control', () => {
    const files = sourceFiles('src')
    expect(files.length).toBeGreaterThan(100)

    // The inventory is a set comparison, so the control is to show the
    // comparison rejecting a file that is not in it.
    const expected = new Set(ALLOWED_IN_SRC.map((entry) => entry.file))
    expect(expected.has('src/actions/media.ts')).toBe(false)
    expect(files).toContain('src/actions/media.ts')
  })

  it('has no route handler, server action or component among them', () => {
    // The distinction that matters. A console call in `seed.ts` is read by the
    // administrator who ran it; one in a request path is written to whatever
    // the host collects, for as long as the host keeps it.
    for (const entry of ALLOWED_IN_SRC) {
      if (entry.file === 'src/app/api/health/route.ts') continue
      expect(entry.file.startsWith('src/app/'), entry.file).toBe(false)
      expect(entry.file.startsWith('src/actions/'), entry.file).toBe(false)
    }
  })
})

describe('rule 3 — the one place a token is printed on purpose', () => {
  const seed = readFileSync('src/db/seed.ts', 'utf8')

  it('is the seed, and it says what the link is', () => {
    expect(seed).toContain('One-time setup links. Each works once, expires, and is not recoverable')
    expect(seed).toContain('${link.url}')
  })

  it('is the only console call in the application that prints a URL', () => {
    const printsAUrl = scanForLogCalls(['src']).filter((call) =>
      call.expressions.some((expression) => /\burl\b/i.test(expression)),
    )
    expect(printsAUrl.map((call) => call.file)).toEqual(['src/db/seed.ts'])
  })

  it('mints a link rather than printing a password, and stores only a hash', () => {
    // The exception is bounded by what the printed thing *is*. A setup link is
    // single-use and expiring; a password would not be either, and the seed
    // never sees one — `.env.example` says so in as many words.
    // Read as the scanner reads it: the seed says the word *password* in prose
    // — "every administrator already has a password" — and prose is not a
    // value. What must not appear is a password in the argument position.
    const seedCalls = consoleCalls('src/db/seed.ts', seed)
    for (const call of seedCalls) {
      for (const expression of call.expressions) {
        expect(splitIdentifierWords(expression), `${call.file}:${call.line}`).not.toMatch(/password/i)
      }
    }
    // The seed mints nothing itself: it calls the one function that issues a
    // setup link, and that function stores a hash and returns the token once.
    expect(seed).toContain('issueAdminSetupLink')
    const bootstrap = readFileSync('src/lib/auth/bootstrap.ts', 'utf8')
    expect(bootstrap).toContain('tokenHash: hash')
    expect(bootstrap).not.toMatch(/tokenHash:\s*token\b/)
    expect(readFileSync('.env.example', 'utf8')).toContain('A password is never read from this file.')
  })
})
