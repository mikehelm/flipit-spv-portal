import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCEPTANCE_CRITERIA } from './acceptance'

/**
 * The map of BUILD_SPEC §22 to the checks that answer it. WP19.
 *
 * A coverage table that nobody verifies is a document that reassures and
 * decays. This is the verification.
 *
 * The first test is the important one: it reads §22 out of BUILD_SPEC.md and
 * asserts, sentence by sentence, that the table's wording is the
 * specification's wording. Without it the easiest way to make a criterion pass
 * would be to reword the criterion.
 */

const SPEC = 'BUILD_SPEC.md'

/** §22's numbered list, in order, with markdown emphasis removed. */
function specCriteria(): string[] {
  const source = readFileSync(SPEC, 'utf8')
  const start = source.indexOf('## 22. Acceptance criteria')
  expect(start, 'BUILD_SPEC has no §22').toBeGreaterThan(-1)

  const after = source.slice(start)
  const nextHeading = after.indexOf('\n## ', 1)
  const section = nextHeading === -1 ? after : after.slice(0, nextHeading)

  const out: string[] = []
  for (const line of section.split('\n')) {
    const m = line.match(/^(\d+)\.\s+(.*)$/)
    if (!m) continue
    out.push(m[2].replace(/\*\*/g, '').trim())
  }
  return out
}

describe('the table is the specification, not a paraphrase of it', () => {
  const fromSpec = specCriteria()

  it('BUILD_SPEC §22 still contains forty-eight criteria', () => {
    expect(fromSpec).toHaveLength(48)
  })

  it('the table covers 1 to 48, once each, in order', () => {
    expect(ACCEPTANCE_CRITERIA.map((c) => c.n)).toEqual(
      Array.from({ length: 48 }, (_, i) => i + 1),
    )
  })

  for (let i = 0; i < 48; i += 1) {
    it(`AC${i + 1} is quoted word for word`, () => {
      const mine = ACCEPTANCE_CRITERIA[i]
      expect(mine, `AC${i + 1} is missing from the table`).toBeDefined()
      expect(mine!.criterion).toBe(fromSpec[i])
    })
  }
})

/**
 * Every string a test or a check is labelled with, in one file.
 *
 * Matching a citation against these rather than against the file's whole text
 * is what makes the map mean something. A substring match would resolve
 * "audit" against half the tree and prove nothing — the first draft of this
 * table had fifty such citations and every one of them passed.
 */
function labelsIn(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const labels: string[] = []

  // it('…') / describe("…") / check(`…`), including the multi-line form where
  // the label sits on its own line after the paren.
  for (const m of source.matchAll(
    /\b(?:it|describe|check)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g,
  )) {
    labels.push(m[1] ?? m[2] ?? m[3] ?? '')
  }

  return labels
}

describe('every citation resolves to a real test', () => {
  const referenced = ACCEPTANCE_CRITERIA.flatMap((c) =>
    c.covered.map((cov) => ({ n: c.n, ...cov })),
  )

  it('there is at least one citation to check', () => {
    expect(referenced.length).toBeGreaterThan(90)
  })

  for (const ref of referenced) {
    it(`AC${ref.n} → ${ref.file} :: "${ref.name}"`, () => {
      expect(existsSync(ref.file), `${ref.file} does not exist`).toBe(true)

      const labels = labelsIn(ref.file)
      expect(labels.length, `${ref.file} declares no tests or checks`).toBeGreaterThan(0)

      // Exact, against the label — not a substring of the file. The one
      // concession is a label built from a template literal, where the text is
      // partly a variable and there is no exact string to match.
      const resolved =
        labels.includes(ref.name) ||
        labels.some((label) => label.includes('${') && label.includes(ref.name))

      expect(
        resolved,
        `${ref.file} has no test or check labelled "${ref.name}". ` +
          `It declares ${labels.length}; the closest are:\n  ` +
          labels
            .filter((l) => l.slice(0, 12) === ref.name.slice(0, 12))
            .slice(0, 3)
            .join('\n  '),
      ).toBe(true)
    })
  }

  it('a unit citation points at a file the vitest suite actually runs', () => {
    // vitest.config.ts: include ['src/**/*.test.ts', 'src/**/*.test.tsx'].
    for (const ref of referenced.filter((r) => r.kind === 'unit')) {
      expect(ref.file, `${ref.file} is cited as a unit test but is not one`).toMatch(
        /^src\/.*\.test\.tsx?$/,
      )
    }
  })

  it('a database or browser citation points at a verification script', () => {
    for (const ref of referenced.filter((r) => r.kind !== 'unit')) {
      expect(ref.file).toMatch(/^scripts\/verify-.*\.ts$/)
    }
  })
})

describe('nothing is silently uncovered', () => {
  it('every criterion is either covered or carries a written note', () => {
    const silent = ACCEPTANCE_CRITERIA.filter((c) => c.covered.length === 0 && !c.manual)
    expect(silent.map((c) => c.n)).toEqual([])
  })

  it('a note explains itself rather than saying "manual"', () => {
    for (const c of ACCEPTANCE_CRITERIA.filter((x) => x.manual)) {
      expect(c.manual!.length, `AC${c.n}'s note is too short to be a reason`).toBeGreaterThan(80)
    }
  })

  it('names the criteria that are not automated, so the count is honest', () => {
    // Three of the forty-eight have no automated check at all, and all three
    // are the deferred media package (§13.2's image library, §13.3's video)
    // or depend on it. Two more are partly covered and say which half.
    const uncovered = ACCEPTANCE_CRITERIA.filter((c) => c.covered.length === 0).map((c) => c.n)
    expect(uncovered).toEqual([32, 33])

    const partial = ACCEPTANCE_CRITERIA.filter(
      (c) => c.covered.length > 0 && c.manual,
    ).map((c) => c.n)
    // AC30 left this list once the tile-editing surface was built — "configurable
    // by the owner" was the half that had never existed.
    expect(partial).toEqual([34])
  })

  it('the criteria WP19 singles out are all covered by a unit test', () => {
    // CODEX_TASKS WP19 lists a minimum. Each of these must have at least one
    // `unit` citation — a database script is not enough, because these are the
    // rules that must hold before a row exists.
    const required: Record<number, string> = {
      2: 'decimal precision and the override',
      5: 'token entropy, hashing, single use and expiry',
      6: 'the compliance gate including hash drift',
      7: 'per-recipient jurisdiction blocking',
      19: 'the owner-only restriction',
      20: 'sending blocked outside active',
      21: 'pre-flight detection of unresolved variables',
      25: 'app-password encryption never serialised to the client',
      27: 'AI mapping never altering a calculated figure',
      28: 'reminder filtering and cap',
      44: 'the base-URL guard',
    }

    for (const [n, why] of Object.entries(required)) {
      const criterion = ACCEPTANCE_CRITERIA.find((c) => c.n === Number(n))
      expect(
        criterion!.covered.some((c) => c.kind === 'unit'),
        `AC${n} (${why}) has no unit test`,
      ).toBe(true)
    }
  })
})

describe('ACCEPTANCE.md is generated from this table, not maintained beside it', () => {
  it('is present and quotes every criterion', () => {
    const doc = readFileSync('ACCEPTANCE.md', 'utf8')
    expect(doc).toContain('This file is generated')

    for (const c of ACCEPTANCE_CRITERIA) {
      expect(doc, `ACCEPTANCE.md is missing AC${c.n}`).toContain(`## ${c.n}. ${c.criterion}`)
    }
  })

  it('is not stale — every citation in the table appears in it', () => {
    // If somebody adds a citation and forgets `pnpm acceptance`, the document
    // quietly understates the coverage. This is cheaper than remembering.
    const doc = readFileSync('ACCEPTANCE.md', 'utf8')
    for (const c of ACCEPTANCE_CRITERIA) {
      for (const cov of c.covered) {
        expect(doc, `ACCEPTANCE.md does not mention AC${c.n}'s "${cov.name}"`).toContain(
          `\`${cov.file}\` — ${cov.kind} — "${cov.name}"`,
        )
      }
    }
  })
})
