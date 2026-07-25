/**
 * Writes ACCEPTANCE.md from the verified table in `src/lib/acceptance.ts`.
 *
 * The table is generated rather than typed, so the document and the checks
 * cannot disagree — `acceptance.test.ts` asserts every citation in the source
 * resolves to a real test, and this only renders what it verified.
 *
 *   pnpm acceptance
 */

import { writeFileSync } from 'node:fs'
import { ACCEPTANCE_CRITERIA } from '@/lib/acceptance'

const KIND_LABEL: Record<string, string> = {
  unit: 'unit',
  database: 'database',
  browser: 'browser',
}

function render(): string {
  const covered = ACCEPTANCE_CRITERIA.filter((c) => c.covered.length > 0).length
  const notes = ACCEPTANCE_CRITERIA.filter((c) => c.manual).length

  const lines: string[] = [
    '# Acceptance criteria — BUILD_SPEC §22',
    '',
    '**This file is generated. Do not edit it — run `pnpm acceptance`.**',
    '',
    'Every criterion below is quoted word for word from BUILD_SPEC §22; a test',
    'reads the specification and fails if this table paraphrases it. Every',
    'citation names a test or check that exists — the same test resolves each one',
    'against the real label in the real file, so a renamed or deleted test breaks',
    'the map rather than leaving a citation pointing at nothing.',
    '',
    `${covered} of 48 criteria have at least one automated check. ${notes} carry a written note.`,
    '',
    'Where a check runs:',
    '',
    '- **unit** — `pnpm test`.',
    '- **database** — `pnpm tsx scripts/verify-*.ts`, against real Postgres.',
    '- **browser** — `pnpm verify:viewport`, in Chromium at 375px.',
    '',
  ]

  for (const c of ACCEPTANCE_CRITERIA) {
    lines.push(`## ${c.n}. ${c.criterion}`, '')

    if (c.covered.length === 0) {
      lines.push('_No automated check._', '')
    } else {
      for (const cov of c.covered) {
        lines.push(`- \`${cov.file}\` — ${KIND_LABEL[cov.kind]} — "${cov.name}"`)
      }
      lines.push('')
    }

    if (c.manual) lines.push(`**Note.** ${c.manual}`, '')
  }

  return lines.join('\n')
}

writeFileSync('ACCEPTANCE.md', render())
console.log(`ACCEPTANCE.md written — ${ACCEPTANCE_CRITERIA.length} criteria.`)
