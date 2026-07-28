/**
 * Writes ACCEPTANCE.md from the verified table in `src/lib/acceptance.ts`.
 *
 * The table is generated rather than typed, so the document and the checks
 * cannot disagree — `acceptance.test.ts` asserts every citation in the source
 * resolves to a real test, and this only renders what it verified.
 *
 * **The rendering itself lives in `src/lib/acceptance-document.ts`**, not here,
 * so that `acceptance.test.ts` can call it and compare the result with the file
 * on disk. That comparison is what turns "Do not edit it" from an instruction
 * into something that fails.
 *
 *   pnpm acceptance
 */

import { writeFileSync } from 'node:fs'
import { ACCEPTANCE_CRITERIA } from '@/lib/acceptance'
import { renderAcceptanceDocument } from '@/lib/acceptance-document'

writeFileSync('ACCEPTANCE.md', renderAcceptanceDocument())
console.log(`ACCEPTANCE.md written — ${ACCEPTANCE_CRITERIA.length} criteria.`)
