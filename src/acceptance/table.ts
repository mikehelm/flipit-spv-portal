import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACCEPTANCE_CRITERIA, EXPECTED_CRITERIA_COUNT, type AcceptanceCriterion } from './criteria'

/**
 * Reads BUILD_SPEC §22 and renders ACCEPTANCE.md from it and `criteria.ts`.
 *
 * The criterion wording is never copied — it is parsed out of the
 * specification every time the table is written, so the published table cannot
 * disagree with the document it claims to be a table of.
 *
 * `scripts/acceptance-table.ts` writes the file; `criteria.test.ts` asserts the
 * checked-in copy still equals what this produces.
 */

export interface SpecCriterion {
  id: number
  text: string
}

const SPEC = join(process.cwd(), 'BUILD_SPEC.md')

/** The numbered list under `## 22. Acceptance criteria`, with `**` stripped. */
export function specCriteria(): SpecCriterion[] {
  const source = readFileSync(SPEC, 'utf8')
  const heading = source.indexOf('## 22. Acceptance criteria')
  if (heading === -1) throw new Error('BUILD_SPEC.md has no §22 heading')

  const after = source.slice(heading)
  const nextHeading = after.slice(1).search(/\n## /)
  const section = nextHeading === -1 ? after : after.slice(0, nextHeading + 1)

  const criteria: SpecCriterion[] = []
  for (const line of section.split('\n')) {
    const match = /^(\d+)\.\s+(.*\S)\s*$/.exec(line)
    if (!match) continue
    criteria.push({ id: Number(match[1]), text: match[2].replaceAll('**', '') })
  }
  return criteria
}

function evidenceCell(criterion: AcceptanceCriterion): string {
  const parts: string[] = []

  for (const test of criterion.tests ?? []) {
    parts.push(`\`${test.file}\` — ${test.name}`)
  }
  for (const script of criterion.scripts ?? []) {
    parts.push(`\`${script.file}\` — ${script.label}`)
  }
  if (criterion.manual) parts.push(`**Manual.** ${criterion.manual}`)
  if (criterion.outstanding) parts.push(`**Outstanding.** ${criterion.outstanding}`)

  return parts.join('<br>').replaceAll('|', '\\|')
}

function how(criterion: AcceptanceCriterion): string {
  if (criterion.outstanding && !criterion.tests?.length && !criterion.scripts?.length) return 'Outstanding'
  if (criterion.outstanding) return 'Partial'
  if (criterion.manual && !criterion.tests?.length) return 'Manual'
  if (criterion.tests?.length && criterion.scripts?.length) return 'Test + script'
  if (criterion.tests?.length) return 'Test'
  return 'Script'
}

export function renderAcceptanceTable(): string {
  const spec = specCriteria()
  const byId = new Map(ACCEPTANCE_CRITERIA.map((criterion) => [criterion.id, criterion]))

  const vitest = ACCEPTANCE_CRITERIA.filter((criterion) => criterion.tests?.length).length
  const scripts = ACCEPTANCE_CRITERIA.filter((criterion) => criterion.scripts?.length).length
  const manual = ACCEPTANCE_CRITERIA.filter((criterion) => criterion.manual).length
  const outstanding = ACCEPTANCE_CRITERIA.filter((criterion) => criterion.outstanding)

  const lines: string[] = [
    '# Acceptance criteria — where each one is proved',
    '',
    '**Generated. Do not edit.** Run `pnpm acceptance:table` after changing',
    '`src/acceptance/criteria.ts`. `src/acceptance/criteria.test.ts` fails if this file',
    'is stale, if a test named below has been renamed, or if a verification-script',
    'check named below has been deleted.',
    '',
    'The criterion wording is read from `BUILD_SPEC.md` §22 at generation time, so it',
    'is the specification’s wording and not a copy of it.',
    '',
    '## In short',
    '',
    `- **${vitest} of ${EXPECTED_CRITERIA_COUNT}** are proved by tests that run in \`pnpm test\`, with no database.`,
    `- **${scripts}** are additionally proved end to end by a \`scripts/verify-*.ts\` run against a real Postgres.`,
    `- **${manual}** carries a manual note, for the part of it only a person can judge.`,
    outstanding.length === 0
      ? '- Nothing is outstanding.'
      : `- **${outstanding.length}** are outstanding: ${outstanding
          .map((criterion) => criterion.id)
          .join(', ')}. Each names what it is waiting on, in the table below.`,
    '',
    '## The table',
    '',
    '| # | Criterion | How | Where |',
    '| --- | --- | --- | --- |',
  ]

  for (const criterion of spec) {
    const entry = byId.get(criterion.id)
    if (!entry) throw new Error(`No mapping for acceptance criterion ${criterion.id}`)
    lines.push(
      `| ${criterion.id} | ${criterion.text.replaceAll('|', '\\|')} | ${how(entry)} | ${evidenceCell(entry)} |`,
    )
  }

  lines.push('')
  return lines.join('\n')
}
