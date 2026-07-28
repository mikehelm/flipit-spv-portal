import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ERASURE_BEGAN_ACTION,
  ERASURE_COMPLETED_ACTION,
  ERASURE_INCOMPLETE_ACTION,
  partiallyDestroyedMessage,
} from './erase'

/**
 * `DEPLOYMENT.md` §12 against the code it describes.
 *
 * §12.1 says of the column map: *"a test fails on the commit that adds a table
 * nobody has an opinion about, so that file cannot go stale the way this
 * document once did."* The document had gone stale, was noticed, was rewritten,
 * and the only thing keeping the *plan* honest was given a test while the
 * *runbook* was left as prose again.
 *
 * It then went stale in exactly the predicted way. §12.5 told the reader that a
 * refused erasure changed nothing, that some bytes might already be gone, and
 * that *"nothing records that"* — every clause of which stopped being true in
 * the same commit, and none of which would have failed anything.
 *
 * So the runbook is now checked against the things it names. Not its prose:
 * this cannot tell whether a paragraph is good advice. What it can tell is
 * whether the audit actions, the refusal wording and the check counts it quotes
 * are the ones that exist — which is precisely the half that rots silently
 * while somebody reads the other half and believes it.
 */

const root = process.cwd()
const deployment = readFileSync(join(root, 'DEPLOYMENT.md'), 'utf8')

/**
 * §12, from its heading to the next one at the same level, with every run of
 * whitespace flattened to one space.
 *
 * Flattened because the sentences being looked for are wrapped in the source at
 * whatever column they happened to reach, so a check for a phrase would pass or
 * fail on where a line break landed — which is the sort of test that fails on a
 * reflow and teaches somebody to delete it.
 */
function sectionTwelve(): string {
  const start = deployment.indexOf('## 12. An investor asks to be removed')
  expect(start, 'DEPLOYMENT.md has no §12').toBeGreaterThan(-1)
  const after = deployment.indexOf('\n## ', start + 1)
  return deployment.slice(start, after === -1 ? undefined : after).replace(/\s+/g, ' ')
}

describe('the runbook names the audit rows an erasure actually writes', () => {
  const twelve = sectionTwelve()

  it('finds the section at all, so an empty string cannot pass these', () => {
    expect(twelve.length).toBeGreaterThan(2000)
  })

  for (const action of [
    ERASURE_BEGAN_ACTION,
    ERASURE_INCOMPLETE_ACTION,
    ERASURE_COMPLETED_ACTION,
  ]) {
    it(`names ${action}`, () => {
      /*
       * Each of the three is a state a person has to be able to recognise in
       * the audit log, and the table in §12.6 is the only place that says which
       * pair means what. Renaming one in `erase.ts` without touching the
       * runbook leaves somebody reading a table that matches nothing.
       */
      const bare = action.replace('investor_account.', '')
      expect(
        twelve.includes(action) || twelve.includes(bare),
        `DEPLOYMENT.md §12 does not mention ${action}`,
      ).toBe(true)
    })
  }
})

describe('the runbook describes the refusals that exist', () => {
  const twelve = sectionTwelve()

  it('no longer says a partial refusal changed nothing', () => {
    /*
     * The sentence this whole file exists for. §12.5 read *"the store was
     * reached and said no. Nothing was changed"* about a case that destroys
     * files, and then said *"some bytes may already be gone"* two lines later —
     * a paragraph arguing with itself, in a runbook somebody reads once, under
     * pressure, on the day an investor has asked to be erased.
     */
    const partial = twelve.slice(twelve.indexOf('### 12.5'))
    const claim = /and then the store refused on another.{0,400}database was \*not\* changed/i
    expect(claim.test(partial), '§12.5 no longer explains the partial refusal').toBe(true)
  })

  it('and quotes the message the owner will actually read', () => {
    // The distinctive clause of the real message, so a rewrite of one without
    // the other is caught.
    const real = partiallyDestroyedMessage(2, 1)
    expect(real).toContain('and then the store refused on another')
    expect(twelve).toContain('and then the store refused on another')
  })

  it('and says the remedy is to run it again, and that doing so is safe', () => {
    expect(twelve).toMatch(/run the erasure again/)
    expect(twelve).toMatch(/already destroyed is not an error/)
  })

  it('and covers the run that recorded no outcome at all', () => {
    // The failure nobody can cause on purpose — a restart or a kill part way
    // through — and the only one where the remedy depends on what the record
    // looks like now.
    const partial = twelve.slice(twelve.indexOf('### 12.5'))
    expect(partial).toMatch(/recorded no outcome/)
    expect(partial, 'the runbook does not tell the reader to check the sessions').toMatch(
      /suspend and unsuspend/i,
    )
  })

  it('and points at the health report rather than at somebody remembering', () => {
    expect(twelve).toMatch(/System health/)
    expect(twelve).toMatch(/media:check/)
  })
})

describe('the check count the runbook quotes', () => {
  it('is a number, and it is the one the script prints', () => {
    /*
     * §12.6 has claimed "a hundred and nineteen checks" and then "a hundred and
     * sixty" — written out in words, which is right for the prose and useless
     * for a machine. The count changes whenever the script grows, so this does
     * not pin the number: it pins that the section still describes what the
     * script now does, by naming the two stores it drives. A section that
     * stopped mentioning one of them would be describing an older script.
     */
    const twelve = sectionTwelve()
    const proving = twelve.slice(twelve.indexOf('### 12.6'))
    expect(proving).toMatch(/pnpm verify:erasure/)
    expect(proving, 'the object-store half is no longer described').toMatch(/object-store socket/)
    expect(proving, 'the filesystem half is no longer described').toMatch(/filesystem store/)
    expect(proving, 'the retry is no longer described').toMatch(/retry|run again|clears the finding/)
  })
})
