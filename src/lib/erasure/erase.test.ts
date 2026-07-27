import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The two properties of the executor that are worth pinning at the source.
 *
 * Everything about what an erasure *does* is proved against a real database by
 * `pnpm verify:erasure`, which is the only honest way to make those claims.
 * What a database test cannot catch is a shape regression — an ordering that
 * still passes but is no longer safe, or a loop that still returns the right
 * answer and takes seven hundred queries to do it. Both of those have a right
 * answer that is invisible in the output, so they are checked here.
 */

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const erase = read('src/lib/erasure/erase.ts')
const investors = read('src/app/(admin)/investors/page.tsx')

describe('the order of operations', () => {
  it('the stored bytes are destroyed before the database is written', () => {
    /*
     * The keys that name them are about to be overwritten. If this half
     * succeeds and the transaction then fails, a retry finds the objects
     * already gone and carries on. The reverse order would leave a signed
     * subscription agreement in a bucket with nothing pointing at it — and
     * nothing anywhere to say it was ever meant to go.
     */
    const remove = erase.indexOf('await store.remove(key)')
    const transaction = erase.indexOf('await db.transaction(')

    expect(remove).toBeGreaterThan(-1)
    expect(transaction).toBeGreaterThan(-1)
    expect(remove).toBeLessThan(transaction)
  })

  it('every refusal happens before either of them', () => {
    const refusals = [
      "reason: 'NO_SUCH_ACCOUNT'",
      "reason: 'ALREADY_ERASED'",
      "reason: 'MEDIA_STORE_UNREACHABLE'",
    ]
    const transaction = erase.indexOf('await db.transaction(')
    for (const refusal of refusals) {
      const at = erase.indexOf(refusal)
      expect(at, `${refusal} is not in the executor`).toBeGreaterThan(-1)
      expect(at, `${refusal} is decided after the database write`).toBeLessThan(transaction)
    }
  })

  it('the audit row is written after the transaction, not inside it', () => {
    // So it cannot be caught by its own sweep. True either way — the sweep
    // matches actorAccountId and this row is the owner's — but the ordering
    // makes it true by construction rather than by argument.
    const transaction = erase.indexOf('await db.transaction(')
    const auditRow = erase.indexOf("action: 'investor_account.erased'")
    expect(auditRow).toBeGreaterThan(transaction)
  })

  it('sessions and links are revoked, and by the one function that does both', () => {
    expect(erase).toContain('await revokeAllPortalAccess(accountId)')
  })
})

describe('the preview costs a fixed number of queries', () => {
  /*
   * The first version of this looped `previewErasure` over every account on
   * `/investors`, at about eighteen counting queries each. It was correct, and
   * on a real round of forty investors it was seven hundred queries on a page
   * that had been running three. Nothing in the output would ever have said so.
   */
  it('the investors page batches, and does not call the single-account version', () => {
    expect(investors).toContain('previewErasureMany(')
    expect(
      /\bpreviewErasure\(/.test(investors),
      'the investors page calls previewErasure per account again — use previewErasureMany',
    ).toBe(false)
  })

  it('and it is called once, not inside a loop', () => {
    expect(investors.match(/previewErasureMany\(/g)).toHaveLength(1)
    // A `for` over accounts awaiting anything is the shape that regressed.
    expect(investors).not.toMatch(/for\s*\(const account of accounts\)[\s\S]{0,200}await/)
  })

  it('every count is grouped in the database rather than counted in JavaScript', () => {
    // `tallyBy` is the only counting path, and it groups. A `.length` on a
    // fetched row set would be a full read of somebody's conversation to
    // discover how many messages it has.
    expect(erase).toContain('.groupBy(key)')
    expect(erase).toContain('n: count()')
  })
})

describe('the executor writes no figure', () => {
  it('none of the seven money or percentage columns appears as a write', () => {
    // Duplicated deliberately from open-decisions.test.ts. That one is a claim
    // about the document; this one is a claim about the code, and the rule that
    // will not bend deserves to fail in both places.
    for (const column of [
      'proposedAmountUsd',
      'committedAmountUsd',
      'acceptedAmountUsd',
      'receivedAmountUsd',
      'spvPercentage',
      'indirectPercentage',
      'indicativeAmountUsd',
      'amountUsd',
    ]) {
      expect(erase, `the erasure writes ${column}`).not.toContain(`${column}:`)
    }
  })

  it('and no Number() or parseFloat anywhere near it', () => {
    // decimal.js or nothing. There is no arithmetic in an erasure at all, and
    // the only Numbers in the module are row counts.
    expect(erase).not.toContain('parseFloat')
    expect(erase).not.toContain('parseInt')
  })
})
