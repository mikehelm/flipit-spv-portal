/**
 * `every`, for a check that is asserting something about rows it found.
 *
 * `Array.prototype.every` returns **true** for an empty array. That is correct
 * for the language and wrong for a verification script, where the array is
 * almost always the result of a query and emptiness means *the thing this check
 * is about was not there to look at*. The check then reports `ok`, and what it
 * has actually established is nothing.
 *
 * The shape reads harmlessly:
 *
 *     check("the neighbour's messages are untouched",
 *       bobMessages.every((row) => row.body !== ERASED_MARKER))
 *
 * An erasure bug that destroyed the neighbour's messages **entirely** empties
 * that array, and the check that exists to catch exactly that turns green. The
 * worse the defect, the more likely it is to be invisible — which is the
 * opposite of what a check is for.
 *
 * This is the same defect as the one found in `verify-viewport.ts`, where an
 * assertion that the overview banner had disappeared was written with a pattern
 * that could not match the banner's singular sentence. That one was found by
 * accident. This is the same question asked deliberately, across every
 * verification script in the repository, and it had **twenty-one** answers.
 *
 * So: empty is a failure. If a check genuinely means *"there are none of these,
 * and none is the right answer"*, that is a count and should be written as one —
 * `rows.filter(bad).length === 0` says what it means and stays true when the
 * table is empty because the table is supposed to be empty.
 *
 * A test in `vacuous.test.ts` enforces that no verification script calls
 * `.every(` on anything but an inline array literal, the way `chromium.test.ts`
 * enforces that only one file launches a browser. The fix that is written once
 * and applied to some of the places that need it is how this repository got
 * here twice already.
 */

/**
 * Anything with a length and an `every` — an array, or a `Uint8Array` of the
 * bytes a store handed back, which is one of the places this matters most and
 * is not an `Array`.
 */
interface HasEvery<T> {
  readonly length: number
  every(predicate: (row: T, index: number) => boolean): boolean
}

/**
 * Every row satisfies the predicate, **and there is at least one row**.
 *
 * @param rows the rows a query returned
 * @param predicate what must be true of each
 */
export function everyOf<T>(rows: HasEvery<T>, predicate: (row: T, index: number) => boolean): boolean {
  if (rows.length === 0) return false
  return rows.every((row, index) => predicate(row, index))
}

/**
 * Nothing here matches `absent` — **and there was something here to look at**.
 *
 * The mirror image of `everyOf`, and it hides in the negation. `some` returns
 * `false` for an empty collection, so
 *
 *     check("and Bruno's document is not in Alice's list",
 *       !aliceList.some((d) => d.id === brunoDoc.id))
 *
 * passes when Alice's list is empty — which is what a defect in the query that
 * builds it would produce. Every one of these in this repository is a
 * checklist-point-5 claim: *no investor-facing page reveals that another
 * investor exists.* A version of that claim satisfied by showing Alice nothing
 * at all is not the claim.
 *
 * `present` is the control. It defaults to *"at least one row that is not the
 * thing we are saying is absent"*, which is the weakest honest guard and is
 * automatic. Where the fixture supports something stronger — *Alice's own
 * document is there and Bruno's is not* — pass it, because that one also proves
 * the list is being filtered rather than merely built empty.
 *
 * Where absence is genuinely the whole answer and there is no control to be
 * had, this is the wrong function and a comment saying so is the right answer.
 * A control invented to satisfy a helper is worse than an honest gap.
 */
export function noneOf<T>(
  rows: readonly T[],
  absent: (row: T, index: number) => boolean,
  present: (row: T, index: number) => boolean = (row, index) => !absent(row, index),
): boolean {
  if (!rows.some((row, index) => present(row, index))) return false
  return !rows.some((row, index) => absent(row, index))
}

/** An array, a `Map`, a `Set` — anything a check counts. */
type Countable = { readonly length: number } | { readonly size: number }

function countOf(value: Countable): number {
  return 'length' in value ? value.length : value.size
}

/**
 * This collection is empty — **beside one that is not**.
 *
 * The third coat of the same defect, and the one the fix for the first two
 * pointed straight at. `everyOf`'s own header says it:
 *
 * > If a check genuinely means *"there are none of these, and none is the right
 * > answer"*, that is a count and should be written as one —
 * > `rows.filter(bad).length === 0`.
 *
 * True, and incomplete. `rows.filter(bad).length === 0` is honest when `rows`
 * being empty is a legitimate state. It is exactly as vacuous as `.every()` when
 * `rows` being empty is **the defect**:
 *
 *     check('every session was ended', liveSessions.length === 0)
 *
 * A fixture that never created a session passes that. So does a query whose
 * `where` clause stopped matching after a column was renamed. The check exists
 * to prove that changing an address *revokes* a live session, and it is
 * satisfied by there never having been one.
 *
 * The control is whatever proves there was something to make empty: the same
 * query run before the act, or the same loader run for somebody the act did not
 * touch. Both forms are in use — before-and-after in `verify-email-change.ts`,
 * a live neighbour in `verify-qa.ts` — and the second is the stronger, because
 * it also proves the emptiness belongs to *this* investor rather than to the
 * loader having stopped working.
 *
 * Where there is genuinely no control — the check is that an upload the
 * application refused left nothing behind, and a refused upload leaves nothing
 * to compare against — this is the wrong function and a comment saying so is
 * the right answer, exactly as with `noneOf`.
 *
 * @param rows the collection that must be empty
 * @param control a collection that must not be, in the same run
 */
export function emptyBeside(rows: Countable, control: Countable): boolean {
  if (countOf(control) === 0) return false
  return countOf(rows) === 0
}

/**
 * `a` appears before `b`, **and both appear**.
 *
 * `text.indexOf(a) < text.indexOf(b)` is the same defect wearing a different
 * coat, and `verify-health.ts` carried it: the remedy for a stuck reminder is
 * supposed to send the reader to the lock probe *before* it suggests
 * rescheduling, and the check was
 *
 *     stuck.out.indexOf('reminders:lock') < stuck.out.indexOf('reschedule')
 *
 * Delete the lock probe from the remedy and `indexOf` returns `-1`, which is
 * less than any real index, so the check passes — **the ordering assertion is
 * satisfied by the earlier thing not being there at all.** That is precisely the
 * change somebody makes while rewording a remedy.
 */
export function appearsBefore(haystack: string, first: string, second: string): boolean {
  const a = haystack.indexOf(first)
  const b = haystack.indexOf(second)
  if (a === -1 || b === -1) return false
  return a < b
}
