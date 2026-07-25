import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIGN_IN_LINK_FLOOR_MS } from './claim'

/**
 * BUILD_SPEC §4.1 and PORTAL_COPY: *"If the address is unknown, the response
 * must be identical to a known address."*
 *
 * The sentence was already identical. The **work** was not, and that is the
 * same leak wearing a different hat. Three paths through `requestSignInLink`
 * did measurably different amounts of it:
 *
 *   unknown address        one SELECT
 *   known but suspended    one SELECT, one audit INSERT
 *   known and eligible     one SELECT, one UPDATE, two INSERTs
 *
 * The portal sign-in form is public, unauthenticated and unthrottled, so an
 * attacker can sample it as often as they like. A consistently slower response
 * for `bob@example.com` identifies Bob as somebody holding a private securities
 * invitation — which is precisely the fact §15 exists to protect, and the
 * identical sentence does nothing to hide it.
 *
 * The admin sign-in path has done this correctly since WP2: it always verifies
 * a hash, real or dummy, and sleeps to a floor. This is the same idea applied
 * where the work differs by row count rather than by hashing.
 *
 * These tests are structural rather than statistical on purpose. A timing test
 * that measures real elapsed time is a flaky test — it fails on a loaded CI box
 * and passes on a fast one, which is the wrong way round for a security
 * property. What is asserted instead is that every exit is padded, which is the
 * thing that would have to be removed for the leak to come back.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The body of `requestSignInLink`, up to the next top-level export. */
function requestSignInLinkBody(): string {
  const code = withoutComments(read('src/lib/portal/claim.ts'))
  const start = code.indexOf('export async function requestSignInLink(')
  expect(start).toBeGreaterThan(-1)
  const rest = code.slice(start)
  const end = rest.indexOf('\nexport ', 1)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('every exit from a sign-in-link request costs the same', () => {
  it('pads to a floor rather than trying to equalise the work', () => {
    // Equal work has to be re-established every time somebody adds a query,
    // and nothing fails when they forget. A floor keeps holding.
    expect(SIGN_IN_LINK_FLOOR_MS).toBeGreaterThanOrEqual(100)
  })

  it('has a floor that exceeds the slowest legitimate path', () => {
    // Four round trips to a same-region Postgres. If the floor were below the
    // real cost of the longest branch, that branch would overrun it and the
    // padding would achieve nothing for the one case that matters most.
    expect(SIGN_IN_LINK_FLOOR_MS).toBeGreaterThan(4 * 25)
  })

  it('settles on every single return, with none left unpadded', () => {
    const lines = requestSignInLinkBody().split('\n')

    let checked = 0
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      if (!/^\s*(?:if \(.*\) )?return /.test(line)) continue
      checked += 1

      // Either it returns through `nothing(...)`, which settles inside itself,
      // or the three lines above it settle first.
      const viaNothing = line.includes('nothing(')
      const settledAbove = lines
        .slice(Math.max(0, index - 3), index)
        .some((above) => above.includes('await settle()'))

      expect(viaNothing || settledAbove, `unpadded return: ${line.trim()}`).toBe(true)
    }

    expect(checked).toBeGreaterThan(3)
  })

  it('settles before the successful outcome is returned', () => {
    const body = requestSignInLinkBody()
    const settle = body.lastIndexOf('await settle()')
    const success = body.indexOf("detail: 'ISSUED'")
    expect(settle).toBeGreaterThan(-1)
    expect(success).toBeGreaterThan(settle)
  })

  it('builds the padding before the first query, not after it', () => {
    // The floor is measured from the start of the request. Building it after
    // the lookup would exclude the lookup from the measurement, which is the
    // one query whose cost differs between a known and an unknown address.
    const body = requestSignInLinkBody()
    const built = body.indexOf('deps.settle ?? settleTo(')
    const firstQuery = body.indexOf('db.query.investorAccounts.findFirst')
    expect(built).toBeGreaterThan(-1)
    expect(firstQuery).toBeGreaterThan(built)
  })

  it('keeps returning one sentence, so the padding is the only change', () => {
    const action = withoutComments(read('src/actions/portal.ts'))
    const start = action.indexOf('export async function requestSignInLinkAction(')
    const rest = action.slice(start)
    const end = rest.indexOf('\nexport ', 1)
    const body = end === -1 ? rest : rest.slice(0, end)

    // One return, one sentence, no branch on the outcome.
    const returns = body.match(/^\s*return .*$/gm) ?? []
    expect(returns).toHaveLength(1)
    expect(returns[0]).toContain('SIGN_IN_ACCEPTED_MESSAGE')
  })
})
