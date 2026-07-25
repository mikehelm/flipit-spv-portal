import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { forbiddenWordsInTileLabel, ROADMAP_DISCLAIMER } from './roadmap'

/**
 * "Coming to your portal" — BUILD_SPEC §13.1.
 *
 * §13.1 says of this section: *"Have the compliance approver look at this
 * section along with the email — it is the easiest place in the build to say
 * something unintended."* That is an unusual sentence to find in a
 * specification, and it is the reason this file exists.
 *
 * The section was built in an earlier package. The standing line §13.1
 * requires was not, which is the omission this package found.
 */

describe('the standing line', () => {
  it('is §13.1s wording, word for word', () => {
    expect(ROADMAP_DISCLAIMER).toBe(
      'Features shown are in development, are indicative only, and form no part of ' +
        'the investment being offered.',
    )
  })

  it('is rendered beneath the tiles on the investor portal', () => {
    const portal = readFileSync('src/app/portal/page.tsx', 'utf8')

    const heading = portal.indexOf('Coming to your portal')
    const line = portal.indexOf('ROADMAP_DISCLAIMER', heading)

    expect(heading).toBeGreaterThan(-1)
    expect(line).toBeGreaterThan(heading)

    // Beneath the tiles, not above them: the list closes before the line.
    expect(portal.lastIndexOf('</ul>', line)).toBeGreaterThan(heading)
  })

  it('cannot be switched off', () => {
    // The tiles are owner-configurable — added, renamed, hidden, switched to
    // live. The line beside them is not. If it ever takes a prop or reads a
    // column, this is where that gets noticed.
    const source = readFileSync('src/lib/portal/roadmap.ts', 'utf8')
    expect(source).not.toContain('@/db')
    expect(source).not.toContain('serviceConfig')
    expect(ROADMAP_DISCLAIMER).toBeTypeOf('string')
  })
})

describe('what a tile label may not say', () => {
  it('accepts the four labels §13.1 suggests', () => {
    for (const label of [
      'Holdings & documents',
      'Company updates',
      'Direct line to David',
      'Reporting',
    ]) {
      expect(forbiddenWordsInTileLabel(label)).toEqual([])
    }
  })

  it('rejects a promise of return, valuation or liquidity', () => {
    expect(forbiddenWordsInTileLabel('Your returns')).toEqual(['returns'])
    expect(forbiddenWordsInTileLabel('Valuation dashboard')).toEqual(['valuation'])
    expect(forbiddenWordsInTileLabel('Liquidity window')).toEqual(['liquidity'])
    expect(forbiddenWordsInTileLabel('Guaranteed dividend')).toEqual(
      expect.arrayContaining(['guaranteed', 'dividend']),
    )
  })

  it('rejects a timeline — §13.1: "No dates. No soon."', () => {
    expect(forbiddenWordsInTileLabel('Reporting — coming soon')).toEqual(['soon'])
    expect(forbiddenWordsInTileLabel('Documents Q3')).toEqual(['q3'])
    expect(forbiddenWordsInTileLabel('Live in 2027')).toEqual(['a year'])
  })

  it('matches whole words, so an innocent label is not rejected for a substring', () => {
    // "Reporting" contains no forbidden word; a substring match on "port"
    // or on "exit" inside "exiting" would make the check useless by making it
    // unusable.
    expect(forbiddenWordsInTileLabel('Reporting')).toEqual([])
    expect(forbiddenWordsInTileLabel('Existing documents')).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(forbiddenWordsInTileLabel('IPO')).toEqual(['ipo'])
    expect(forbiddenWordsInTileLabel('Soon')).toEqual(['soon'])
  })
})
