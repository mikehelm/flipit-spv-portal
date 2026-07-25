/**
 * The "Coming to your portal" standing line. BUILD_SPEC §13.1.
 *
 * §13.1 gives the wording and it is reproduced here word for word:
 *
 *   *"A standing line beneath the tiles: **Features shown are in development,
 *   are indicative only, and form no part of the investment being offered.**"*
 *
 * It lives in its own module, with no database import, for three reasons.
 *
 * The first is that §13.1 asks the compliance approver to look at this section
 * "along with the email", and a sentence that can be reviewed is one that sits
 * in a file by itself rather than inside a page's markup.
 *
 * The second is that the tiles are owner-configurable — they can be added,
 * renamed and hidden — and this line must not be. There is no column for it,
 * no setting, and no prop that would let a caller replace it.
 *
 * The third is the wording constraint §13.1 states plainly: the teaser "must
 * stay about tooling and communication and never drift into anything that
 * reads as a promise of returns, valuation, liquidity, or a timeline. No dates.
 * No 'soon'." `roadmap.test.ts` checks the tile labels against that, and a
 * check needs one place to import from.
 */

export const ROADMAP_DISCLAIMER =
  'Features shown are in development, are indicative only, and form no part of ' +
  'the investment being offered.'

/**
 * Words a roadmap tile may not contain. §13.1's list, plus the two forms of
 * "coming soon" that a person adding a tile in a hurry reaches for first.
 *
 * This is deliberately about *tile labels*, which are free text an owner types
 * into a form. It is not a check on the heading or the standing line, both of
 * which are constants nobody can edit.
 */
export const FORBIDDEN_IN_TILE_LABEL = [
  'soon',
  'shortly',
  'imminent',
  'return',
  'returns',
  'yield',
  'dividend',
  'valuation',
  'liquidity',
  'exit',
  'ipo',
  'guarantee',
  'guaranteed',
  'profit',
  'q1',
  'q2',
  'q3',
  'q4',
] as const

/**
 * Returns the offending words in a proposed tile label, or an empty array.
 *
 * Matching is on whole words, case-insensitively. A substring match would
 * reject "Reporting" for containing nothing in particular and accept nothing
 * useful in exchange.
 */
export function forbiddenWordsInTileLabel(label: string): string[] {
  const words = label.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const found = new Set<string>()

  for (const word of words) {
    if ((FORBIDDEN_IN_TILE_LABEL as readonly string[]).includes(word)) found.add(word)
  }

  // A four-digit year is a date, and §13.1 says no dates.
  if (/\b(19|20)\d{2}\b/.test(label)) found.add('a year')

  return [...found]
}
