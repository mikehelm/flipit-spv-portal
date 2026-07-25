import { describe, expect, it } from 'vitest'
import {
  correctionRefusalMessage,
  lineagesOf,
  nextVersion,
  versionLabel,
  whyNotCorrectable,
  type VersionedDocument,
} from './versions'

/**
 * The rules a corrected document has to obey, before any of them touch a
 * database. BUILD_SPEC §5 — a correction is never a silent overwrite.
 */

const JANUARY = new Date('2026-01-10T09:00:00.000Z')
const FEBRUARY = new Date('2026-02-10T09:00:00.000Z')
const MARCH = new Date('2026-03-10T09:00:00.000Z')

function document(overrides: Partial<VersionedDocument> & { id: string }): VersionedDocument {
  return {
    version: 1,
    issuedAt: null,
    supersededAt: null,
    supersedesId: null,
    ...overrides,
  }
}

describe('what may be corrected', () => {
  const issued = document({ id: 'a', issuedAt: JANUARY })

  it('an issued, current document may be', () => {
    expect(whyNotCorrectable(issued, [issued])).toBeNull()
  })

  it('a draft may not — it is removed and replaced, which loses nothing', () => {
    const draft = document({ id: 'b' })
    expect(whyNotCorrectable(draft, [draft])).toBe('NEVER_ISSUED')
    expect(correctionRefusalMessage('NEVER_ISSUED')).toMatch(/Remove it/)
  })

  it('an already superseded version may not — correct the current one', () => {
    const old = document({ id: 'a', issuedAt: JANUARY, supersededAt: FEBRUARY })
    expect(whyNotCorrectable(old, [old])).toBe('ALREADY_SUPERSEDED')
    expect(correctionRefusalMessage('ALREADY_SUPERSEDED')).toMatch(/current version/)
  })

  it('not twice at once — one waiting correction is enough', () => {
    const waiting = document({ id: 'b', version: 2, supersedesId: 'a' })
    expect(whyNotCorrectable(issued, [issued, waiting])).toBe('CORRECTION_ALREADY_WAITING')
    expect(correctionRefusalMessage('CORRECTION_ALREADY_WAITING')).toMatch(/Issue it or remove it/)
  })

  it('but a correction that was issued does not block the next one', () => {
    const v1 = document({ id: 'a', issuedAt: JANUARY, supersededAt: FEBRUARY })
    const v2 = document({ id: 'b', version: 2, issuedAt: FEBRUARY, supersedesId: 'a' })

    expect(whyNotCorrectable(v2, [v1, v2])).toBeNull()
  })

  it('a correction of some other document does not block this one', () => {
    const other = document({ id: 'z', version: 2, supersedesId: 'somebody-else' })
    expect(whyNotCorrectable(issued, [issued, other])).toBeNull()
  })

  it('every refusal has a message that says what to do instead', () => {
    for (const reason of ['NEVER_ISSUED', 'ALREADY_SUPERSEDED', 'CORRECTION_ALREADY_WAITING'] as const) {
      const message = correctionRefusalMessage(reason)
      expect(message.length).toBeGreaterThan(40)
      // Never generic. §8's rule about blocked actions applies here too.
      expect(message).not.toMatch(/something went wrong|try again later/i)
    }
  })

  it('a version number goes up by one, and only by one', () => {
    expect(nextVersion(document({ id: 'a' }))).toBe(2)
    expect(nextVersion(document({ id: 'a', version: 7 }))).toBe(8)
  })
})

describe('grouping a flat list into chains', () => {
  it('a document nobody corrected is a chain of one', () => {
    const only = document({ id: 'a', issuedAt: JANUARY })
    const [lineage] = lineagesOf([only])

    expect(lineage!.current).toBe(only)
    expect(lineage!.superseded).toEqual([])
    expect(lineage!.pending).toBeNull()
  })

  it('three versions come back current-first, with the history newest-first', () => {
    const v1 = document({ id: 'a', issuedAt: JANUARY, supersededAt: FEBRUARY })
    const v2 = document({ id: 'b', version: 2, issuedAt: FEBRUARY, supersededAt: MARCH, supersedesId: 'a' })
    const v3 = document({ id: 'c', version: 3, issuedAt: MARCH, supersedesId: 'b' })

    const [lineage] = lineagesOf([v1, v2, v3])

    expect(lineage!.current.id).toBe('c')
    expect(lineage!.superseded.map((d) => d.id)).toEqual(['b', 'a'])
    expect(lineage!.pending).toBeNull()
  })

  it('order in the input does not matter', () => {
    const v1 = document({ id: 'a', issuedAt: JANUARY, supersededAt: FEBRUARY })
    const v2 = document({ id: 'b', version: 2, issuedAt: FEBRUARY, supersedesId: 'a' })

    expect(lineagesOf([v2, v1])[0]!.current.id).toBe('b')
    expect(lineagesOf([v1, v2])[0]!.current.id).toBe('b')
  })

  it('an unissued correction is pending, not current', () => {
    const v1 = document({ id: 'a', issuedAt: JANUARY })
    const v2 = document({ id: 'b', version: 2, supersedesId: 'a' })

    const [lineage] = lineagesOf([v1, v2])

    // The investor still holds version 1, so version 1 is what the screen calls
    // current. Calling the draft current would be the same lie as showing it
    // to the investor.
    expect(lineage!.current.id).toBe('a')
    expect(lineage!.pending?.id).toBe('b')
    expect(lineage!.superseded).toEqual([])
  })

  it('two separate documents are two chains, not one', () => {
    const one = document({ id: 'a', issuedAt: JANUARY })
    const two = document({ id: 'b', issuedAt: JANUARY })

    expect(lineagesOf([one, two])).toHaveLength(2)
  })

  /**
   * The investor's list is issued-only, so a chain it receives may be missing
   * its earlier links. It must still group rather than fragment, and it must
   * never surface a draft.
   */
  it('a chain whose root is filtered out still groups from the first version present', () => {
    const v2 = document({ id: 'b', version: 2, issuedAt: FEBRUARY, supersededAt: MARCH, supersedesId: 'gone' })
    const v3 = document({ id: 'c', version: 3, issuedAt: MARCH, supersedesId: 'b' })

    const lineages = lineagesOf([v2, v3])

    expect(lineages).toHaveLength(1)
    expect(lineages[0]!.current.id).toBe('c')
    expect(lineages[0]!.superseded.map((d) => d.id)).toEqual(['b'])
  })

  it('a cycle terminates rather than hanging', () => {
    const a = document({ id: 'a', issuedAt: JANUARY, supersedesId: 'b' })
    const b = document({ id: 'b', version: 2, issuedAt: FEBRUARY, supersedesId: 'a' })

    // Nothing can create this, and a walk that trusts data to be acyclic is a
    // walk that hangs when it is not.
    expect(() => lineagesOf([a, b])).not.toThrow()
    expect(lineagesOf([a, b]).length).toBeGreaterThanOrEqual(0)
  })

  it('an empty list is an empty list', () => {
    expect(lineagesOf([])).toEqual([])
  })
})

describe('what a screen says about a version', () => {
  it('says nothing at all about a document nobody corrected', () => {
    expect(versionLabel(document({ id: 'a', issuedAt: JANUARY }), 0)).toBe('')
  })

  it('names the version once there is a history', () => {
    expect(versionLabel(document({ id: 'b', version: 2, issuedAt: FEBRUARY }), 1)).toBe('Version 2')
    // Version 1 of a document that HAS been corrected still says which it is.
    expect(versionLabel(document({ id: 'a', issuedAt: JANUARY }), 1)).toBe('Version 1')
  })
})
