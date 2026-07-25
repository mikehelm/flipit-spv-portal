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

describe('the editing surface — §13.1, AC30', () => {
  /**
   * `forbiddenWordsInTileLabel` was written in WP18 as a gate ahead of a
   * surface that did not exist. This is the surface, and these are the tests
   * that it calls the gate — which is the whole reason the gate was written.
   */
  const actions = readFileSync('src/actions/roadmap.ts', 'utf8')

  it('checks the wording at write time, on every path that writes a label', () => {
    // Add and update both. A gate on one of the two would be no gate at all.
    const add = actions.slice(actions.indexOf('addRoadmapTileAction'), actions.indexOf('updateRoadmapTileAction'))
    const update = actions.slice(actions.indexOf('updateRoadmapTileAction'), actions.indexOf('removeRoadmapTileAction'))

    expect(add).toContain('refuseForbiddenWords')
    expect(update).toContain('refuseForbiddenWords')
    expect(actions).toContain('forbiddenWordsInTileLabel')
  })

  it('refuses out loud and names the word', () => {
    // §13.1 calls this "the easiest place in the build to say something
    // unintended", so a silent drop would be the wrong shape entirely: the
    // owner would believe it had saved.
    expect(actions).toMatch(/actionError\(/)
    expect(actions).toContain('found')
    expect(actions).toContain('roadmap_tile.refused')
  })

  it('is owner-only, as §13.1 says', () => {
    expect(actions).toContain('requireOwner()')
    expect(actions).not.toContain('requireOperator')
    expect(actions).not.toMatch(/requireAdmin\(\)/)
  })

  it('audits every change, including the one it refused', () => {
    for (const action of [
      'roadmap_tile.added',
      'roadmap_tile.updated',
      'roadmap_tile.removed',
      'roadmap_tile.refused',
    ]) {
      expect(actions, `${action} is not audited`).toContain(action)
    }
  })

  it('keeps the read-time filter as well, rather than replacing it', () => {
    // Two layers: refused loudly at write, dropped quietly at read for
    // anything that reached the table another way.
    const data = readFileSync('src/lib/portal/data.ts', 'utf8')
    expect(data).toContain('forbiddenWordsInTileLabel')
  })

  it('the standing line is shown on the editing screen and is not a field', () => {
    const page = readFileSync('src/app/(admin)/admin/roadmap/page.tsx', 'utf8')
    expect(page).toContain('ROADMAP_DISCLAIMER')
    // Rendered, never bound to an input.
    expect(page).not.toMatch(/name="disclaimer"|defaultValue=\{ROADMAP_DISCLAIMER\}/)
  })
})
