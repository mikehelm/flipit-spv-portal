import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCEPTANCE_CRITERIA, EXPECTED_CRITERIA_COUNT } from './criteria'
import { renderAcceptanceTable, specCriteria } from './table'

/**
 * WP19's own gate. BUILD_SPEC §22 lists 48 acceptance criteria; `criteria.ts`
 * says where each one is proved, and this file makes that claim falsifiable.
 *
 * A mapping table is worth nothing if it can rot. Every test name it cites is
 * checked to exist in the file it names, and every verification-script label is
 * checked to exist in the script it names — so renaming a test breaks the
 * mapping rather than quietly turning it into a claim about nothing.
 *
 * It also runs the other way round: the criterion text comes from BUILD_SPEC
 * itself, never from a copy, so a criterion edited or added in the spec shows
 * up here as a failure rather than as silence.
 */

const ROOT = process.cwd()

const fileCache = new Map<string, string>()

function read(path: string): string {
  const cached = fileCache.get(path)
  if (cached !== undefined) return cached
  const source = readFileSync(join(ROOT, path), 'utf8')
  fileCache.set(path, source)
  return source
}

function everyTestFile(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
        found.push(relative(ROOT, full))
      }
    }
  }
  walk(join(ROOT, 'src'))
  return found.sort()
}

// ---------------------------------------------------------------------------
// The list itself
// ---------------------------------------------------------------------------

describe('the mapping covers BUILD_SPEC §22, exactly once each', () => {
  it('has one entry per criterion, numbered 1 to 48', () => {
    expect(ACCEPTANCE_CRITERIA).toHaveLength(EXPECTED_CRITERIA_COUNT)
    expect(ACCEPTANCE_CRITERIA.map((criterion) => criterion.id)).toEqual(
      Array.from({ length: EXPECTED_CRITERIA_COUNT }, (_, index) => index + 1),
    )
  })

  it('numbers the same 48 the specification does', () => {
    // Parsed out of BUILD_SPEC.md §22, so a criterion added, removed or
    // renumbered in the specification fails here rather than going unmapped.
    const fromSpec = specCriteria()
    expect(fromSpec).toHaveLength(EXPECTED_CRITERIA_COUNT)
    expect(fromSpec.map((criterion) => criterion.id)).toEqual(
      ACCEPTANCE_CRITERIA.map((criterion) => criterion.id),
    )
  })

  it('holds no criterion text of its own, so there is one source of truth', () => {
    const source = readFileSync(join(ROOT, 'src/acceptance/criteria.ts'), 'utf8')
    for (const criterion of specCriteria()) {
      // The first ten words of each criterion would be enough to copy it in.
      const opening = criterion.text.split(/\s+/).slice(0, 8).join(' ')
      expect(source, `criterion ${criterion.id} text copied into the registry`).not.toContain(opening)
    }
  })

  it('leaves nothing unaccounted for', () => {
    for (const criterion of ACCEPTANCE_CRITERIA) {
      const evidence =
        (criterion.tests?.length ?? 0) +
        (criterion.scripts?.length ?? 0) +
        (criterion.manual ? 1 : 0) +
        (criterion.outstanding ? 1 : 0)
      expect(evidence, `criterion ${criterion.id} has no evidence of any kind`).toBeGreaterThan(0)
    }
  })

  it('explains itself whenever a machine is not doing the checking', () => {
    for (const criterion of ACCEPTANCE_CRITERIA) {
      // A one-word note is not an explanation. WP19 asks for "an explicit note
      // explaining why it is manual", and a sentence is the smallest thing that
      // can carry a reason.
      if (criterion.manual) {
        expect(criterion.manual.split(/\s+/).length, `criterion ${criterion.id}`).toBeGreaterThan(12)
      }
      if (criterion.outstanding) {
        expect(criterion.outstanding.split(/\s+/).length, `criterion ${criterion.id}`).toBeGreaterThan(12)
        // An outstanding item names what it waits on, or it is just a shrug.
        expect(criterion.outstanding, `criterion ${criterion.id}`).toMatch(
          /wait|defer|needs|until|blocked|missing|not met|no owner/i,
        )
      }
    }
  })

  it('never marks a criterion outstanding while also claiming it is proved', () => {
    for (const criterion of ACCEPTANCE_CRITERIA) {
      if (!criterion.outstanding) continue
      // Criterion 30 is the shape this allows: the copy rules ARE tested and
      // the missing half is named. What it must not do is carry an outstanding
      // note and no explanation of what the listed tests do and do not cover.
      const partial = (criterion.tests?.length ?? 0) + (criterion.scripts?.length ?? 0) > 0
      if (partial) {
        expect(criterion.outstanding, `criterion ${criterion.id}`).toMatch(/half|but|only|until|second/i)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Every reference resolves
// ---------------------------------------------------------------------------

describe('every test the mapping cites exists and is named as cited', () => {
  const references = ACCEPTANCE_CRITERIA.flatMap((criterion) =>
    (criterion.tests ?? []).map((test) => ({ id: criterion.id, ...test })),
  )

  it('cites at least one test for all but the deferred criteria', () => {
    const withoutTests = ACCEPTANCE_CRITERIA.filter((criterion) => !criterion.tests?.length)
    expect(withoutTests.map((criterion) => criterion.id)).toEqual([32, 33])
  })

  it('names a file that is in the suite', () => {
    const suite = new Set(everyTestFile())
    for (const reference of references) {
      expect(suite.has(reference.file), `AC${reference.id}: ${reference.file}`).toBe(true)
    }
  })

  it.each(references.map((reference) => [`AC${reference.id}`, reference.file, reference.name] as const))(
    '%s → %s: %s',
    (_label, file, name) => {
      const source = read(file)
      // The name must appear as a quoted test name, not merely somewhere in the
      // file: a phrase in a comment is not a test.
      const quoted = [`'${name}'`, `"${name}"`, `\`${name}\``]
      expect(quoted.some((form) => source.includes(form))).toBe(true)
    },
  )

  it('cites no test twice for the same criterion', () => {
    for (const criterion of ACCEPTANCE_CRITERIA) {
      const keys = (criterion.tests ?? []).map((test) => `${test.file}::${test.name}`)
      expect(new Set(keys).size, `criterion ${criterion.id}`).toBe(keys.length)
    }
  })
})

describe('every verification-script check the mapping cites exists', () => {
  const references = ACCEPTANCE_CRITERIA.flatMap((criterion) =>
    (criterion.scripts ?? []).map((script) => ({ id: criterion.id, ...script })),
  )

  it('names a script that is on disk', () => {
    for (const reference of references) {
      expect(existsSync(join(ROOT, reference.file)), `AC${reference.id}: ${reference.file}`).toBe(true)
      expect(reference.file.startsWith('scripts/verify-')).toBe(true)
    }
  })

  it.each(references.map((reference) => [`AC${reference.id}`, reference.file, reference.label] as const))(
    '%s → %s: %s',
    (_label, file, label) => {
      const source = read(file)
      // Labels are passed to `check()` as a string or a template literal.
      expect(source.includes(`'${label}'`) || source.includes(`\`${label}\``)).toBe(true)
    },
  )

  it('cites a label that is actually passed to check(), not just present', () => {
    for (const reference of references) {
      const source = read(reference.file)
      const escaped = reference.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(
        new RegExp(`check\\(\\s*['\`]${escaped}['\`]`).test(source),
        `AC${reference.id}: ${reference.label}`,
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// The published table
// ---------------------------------------------------------------------------

describe('ACCEPTANCE.md is generated, and is up to date', () => {
  it('matches what the generator produces from the registry and the specification', () => {
    const published = readFileSync(join(ROOT, 'ACCEPTANCE.md'), 'utf8')
    expect(published).toBe(renderAcceptanceTable())
  })

  it('says plainly how many criteria are proved by which means', () => {
    const table = renderAcceptanceTable()
    const vitest = ACCEPTANCE_CRITERIA.filter((criterion) => criterion.tests?.length).length
    expect(table).toContain(`${vitest} of ${EXPECTED_CRITERIA_COUNT}`)
    // The outstanding ones are named in the summary, not buried in the table.
    for (const criterion of ACCEPTANCE_CRITERIA.filter((entry) => entry.outstanding)) {
      expect(table).toMatch(new RegExp(`\\b${criterion.id}\\b`))
    }
  })
})
