/**
 * Writes ACCEPTANCE.md from `src/acceptance/criteria.ts` and BUILD_SPEC §22.
 *
 *   pnpm acceptance:table
 *
 * `src/acceptance/criteria.test.ts` fails when the checked-in file no longer
 * matches what this produces, so the table cannot drift from the mapping and
 * the mapping cannot drift from the specification.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderAcceptanceTable } from '@/acceptance/table'

const target = join(process.cwd(), 'ACCEPTANCE.md')
writeFileSync(target, renderAcceptanceTable(), 'utf8')
console.log(`Wrote ${target}`)
