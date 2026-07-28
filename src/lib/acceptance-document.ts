/**
 * `ACCEPTANCE.md`, rendered from the verified table.
 *
 * **This lived inside `scripts/acceptance-table.ts` and was moved here for one
 * reason: so a test can call it.**
 *
 * `CLAIMS.md` points every reader at `ACCEPTANCE.md` and says it is *"the one
 * to trust"*, because it is generated from the tests rather than typed. That is
 * a claim about a file, and this repository has learnt twice now — with
 * `OPEN_DECISIONS.md` and again with `CLAIMS.md` itself — that a claim nobody
 * can see fail is a claim nobody should trust.
 *
 * What was checked before was that every criterion and every citation in the
 * table **appears in** the document. Both true, and both one-directional. A
 * hand-added line under a criterion —
 *
 *     - `src/lib/nothing.test.ts` — unit — "proves the thing"
 *
 * — would have passed every check in `acceptance.test.ts`, and the document
 * would have claimed coverage that nothing verified. So would an edited count in
 * the header. The document says *"Do not edit it"* and nothing enforced that.
 *
 * Rendering here, and comparing the render against the file byte for byte in
 * `acceptance.test.ts`, is what makes "generated" a fact rather than a request.
 */

import { ACCEPTANCE_CRITERIA } from '@/lib/acceptance'

const KIND_LABEL: Record<string, string> = {
  unit: 'unit',
  database: 'database',
  browser: 'browser',
}

export function renderAcceptanceDocument(): string {
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
    'And a test renders this document from that table and compares it with the',
    'file on disk, so a line added here by hand fails the suite rather than',
    'quietly claiming a check that does not exist.',
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
