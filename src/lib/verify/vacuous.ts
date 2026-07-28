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
