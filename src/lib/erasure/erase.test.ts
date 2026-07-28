import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { partiallyDestroyedMessage } from './erase'

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
    const auditRow = erase.indexOf('action: ERASURE_COMPLETED_ACTION')
    expect(auditRow).toBeGreaterThan(-1)
    expect(auditRow).toBeGreaterThan(transaction)
  })

  it('the line saying an erasure started is written before anything is destroyed', () => {
    /*
     * The whole point of it. An erasure destroys bytes, then writes the
     * database, then revokes sessions, then records itself — and a kill at any
     * point in that sequence used to leave nothing behind at all. A row written
     * after the first `remove()` would miss exactly the failure it exists for.
     */
    const began = erase.indexOf('action: ERASURE_BEGAN_ACTION')
    const remove = erase.indexOf('await store.remove(key)')
    expect(began).toBeGreaterThan(-1)
    expect(began).toBeLessThan(remove)
  })

  it('and after the refusals, so an attempt that could not start is not one that vanished', () => {
    const began = erase.indexOf('action: ERASURE_BEGAN_ACTION')
    for (const refusal of [
      "reason: 'NO_SUCH_ACCOUNT'",
      "reason: 'ALREADY_ERASED'",
      "reason: 'MEDIA_STORE_UNREACHABLE'",
    ]) {
      expect(erase.indexOf(refusal), refusal).toBeLessThan(began)
    }
  })

  it('the incomplete row is written before the refusal returns, not by the caller', () => {
    // The result is the thing most likely to be dropped: the only surface that
    // reads it is a form somebody may have navigated away from. The record has
    // to exist whether or not anybody looks at the return value.
    const record = erase.indexOf('await auditErasureIncomplete(')
    const returns = erase.indexOf("reason: 'OBJECTS_PARTIALLY_DESTROYED'")
    expect(record).toBeGreaterThan(-1)
    expect(record).toBeLessThan(returns)
  })
})

describe('a refusal that already destroyed something says so', () => {
  it('the partial refusal has a reason of its own', () => {
    // It used to share OBJECT_NOT_DESTROYED, and with it a message reading
    // "Nothing was changed" — true of the database and false of the bucket, on
    // the one action in this application that cannot be undone.
    expect(erase).toContain("reason: 'OBJECTS_PARTIALLY_DESTROYED'")
  })

  it('and the partial branch is actually wired to the partial message', () => {
    /*
     * Written after breaking it: reverting the branch to
     * `MESSAGES.OBJECT_NOT_DESTROYED` left every test in this file green,
     * because they all examined the message builder rather than its use. Three
     * checks in `pnpm verify:erasure` caught it, which is the right place for
     * the proof and the wrong place for the only proof.
     */
    // Forward from the reason only. A window that reached backwards caught the
    // neighbouring zero-destroyed branch, which legitimately uses the other
    // message — a check that fails on correct code is a check that gets deleted.
    const at = erase.indexOf("reason: 'OBJECTS_PARTIALLY_DESTROYED'")
    expect(at).toBeGreaterThan(-1)
    const branch = erase.slice(at, at + 200)
    expect(branch).toContain('partiallyDestroyedMessage(objectsDestroyed, remaining)')
    expect(branch).not.toContain('MESSAGES.OBJECT_NOT_DESTROYED')
  })

  it('and its message does not claim nothing was changed', () => {
    const message = partiallyDestroyedMessage(2, 1)
    expect(message).not.toMatch(/Nothing was changed/i)
    expect(message).toMatch(/cannot be recovered/)
    expect(message).toMatch(/^2 stored files were destroyed/)
  })

  it('and it says which half of the erasure did not happen', () => {
    // "Some files are gone" without "and the record is untouched" leaves the
    // reader believing the investor has been dealt with.
    const message = partiallyDestroyedMessage(2, 1)
    expect(message).toMatch(/database was NOT changed/)
    expect(message).toMatch(/run the erasure again/)
  })

  it('and it counts rather than naming, so no storage key can reach a screen', () => {
    // The key is a capability — the image route serves one with no session —
    // and this sentence is rendered on a form. The function takes two numbers
    // and there is nothing else for it to put in.
    const message = partiallyDestroyedMessage(2, 1)
    expect(message).not.toMatch(/\b(img|vid|doc)_/)
  })

  it('and it reads correctly for a single file', () => {
    const message = partiallyDestroyedMessage(1, 1)
    expect(message).toMatch(/^1 stored file was destroyed/)
    expect(message).toContain('the one that is gone')
    expect(message).toContain('1 file remains')
  })

  it('every refusal reports how many objects are gone, as a number', () => {
    // On the shape, not only in the sentence. A caller acting on this should
    // not have to read English to find out that the irreversible half happened.
    const refusals = erase.match(/ok: false,/g) ?? []
    const counts = erase.match(/objectsDestroyed: \d|objectsDestroyed,/g) ?? []
    expect(refusals.length).toBeGreaterThan(3)
    expect(counts.length).toBeGreaterThanOrEqual(refusals.length)
  })
})

describe('the order the objects are destroyed in', () => {
  it('is fixed, so a failure part way through is reproducible', () => {
    /*
     * Without an `order by`, a `select` may hand the keys back in any order —
     * so an erasure that stops half way destroys a different subset on each
     * attempt, and the one failure worth investigating cannot be reproduced.
     */
    expect(erase).toContain('orderBy(asc(documentPackages.storageKey))')
    expect(erase).toContain('orderBy(asc(participationCertificates.storageKey))')
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
