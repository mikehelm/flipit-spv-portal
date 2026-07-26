import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { disabledFlags, flagEnabled, PORTAL_FLAGS, type PortalFlag } from './flags'

/**
 * Feature flags. BUILD_SPEC §7, §17.
 *
 * The table shipped with four rows naming four already-built features, each
 * with a spec reference in its note, and nothing anywhere read it. Setting one
 * to `false` changed nothing. A switch with no wire is worse than no switch,
 * because eventually somebody turns it and believes the result.
 *
 * Wiring it makes the opposite failure possible for the first time, so both
 * directions are pinned here: that a missing row can never take a section away,
 * and that a flag which is off never removes something an investor wrote.
 */

function rows(entries: Record<string, boolean>): ReadonlyMap<string, boolean> {
  return new Map(Object.entries(entries))
}

const ALL = Object.values(PORTAL_FLAGS)

describe('a missing row', () => {
  it.each(ALL)('leaves %s on', (key) => {
    // §7's sentence is about switching functionality *on for a later round*. A
    // flag is a gate in front of something not yet wanted, not a licence every
    // feature has to hold.
    expect(flagEnabled(new Map(), key)).toBe(true)
  })

  it('is not confused with a row set to false', () => {
    expect(flagEnabled(rows({ qa_shared: false }), 'qa_shared')).toBe(false)
    expect(flagEnabled(new Map(), 'qa_shared')).toBe(true)
  })

  it('means an unseeded deployment behaves exactly as it did before flags', () => {
    expect(disabledFlags(new Map())).toEqual([])
  })

  it('is not affected by a row naming something this application does not consult', () => {
    expect(disabledFlags(rows({ something_else: false }))).toEqual([])
  })
})

describe('a row', () => {
  it.each(ALL)('turns %s off when it says false', (key) => {
    expect(flagEnabled(rows({ [key]: false }), key)).toBe(false)
  })

  it.each(ALL)('leaves %s on when it says true', (key) => {
    expect(flagEnabled(rows({ [key]: true }), key)).toBe(true)
  })

  it('reports every consulted flag that is off, and only those', () => {
    const off = disabledFlags(rows({ qa_shared: false, roadmap_tiles: false, operator_video: true }))
    expect(new Set(off)).toEqual(new Set(['qa_shared', 'roadmap_tiles']))
  })
})

describe('what a flag is wired to', () => {
  function source(path: string): string {
    return readFileSync(join(process.cwd(), path), 'utf8')
  }

  it('has a consumer for every key it declares', () => {
    // The defect this whole file exists for: a flag that is declared, seeded,
    // and read by nothing. Each key must be reachable from a call site.
    const consumers = [
      'src/lib/portal/data.ts',
      'src/lib/qa/data.ts',
      'src/lib/register/data.ts',
      'src/app/portal/page.tsx',
    ]
      .map(source)
      .join('\n')

    for (const [name] of Object.entries(PORTAL_FLAGS)) {
      expect(consumers, name).toContain(`PORTAL_FLAGS.${name}`)
    }
  })

  it('is seeded for every key it declares', () => {
    // And the reverse: a seeded flag naming something nothing consults would
    // put the same lie back, one row along.
    const seed = source('src/db/seed.ts')
    for (const key of ALL) expect(seed).toContain(key)
  })

  it('never gates the documents an investor has been issued', () => {
    // Their subscription agreement is not a phase-two module. §5 status 3 puts
    // it on their record and no flag may take it off.
    const page = source('src/app/portal/page.tsx')
    const documentsLine = page
      .split('\n')
      .find((line) => line.includes('<DocumentsSection'))
    expect(documentsLine).toBeDefined()
    expect(documentsLine).not.toContain('flagEnabled')
  })

  it('never gates their certificates, their timeline or their offer', () => {
    const data = source('src/lib/portal/data.ts')
    const offerBlock = data.slice(data.indexOf('portalOffers.push({'), data.indexOf('// §13.1'))
    expect(offerBlock).not.toContain('flagEnabled')
  })
})

describe('a flag off never removes what an investor already has', () => {
  it('closes the door on the question thread rather than the room', () => {
    // `canAsk` is gated and `canReadOwn` is not: what they wrote and what was
    // answered stays on the screen. This is the same narrowing a read-only
    // service mode already does.
    const qa = readFileSync(join(process.cwd(), 'src/lib/qa/data.ts'), 'utf8')
    expect(qa).toMatch(/canAsk:[^\n]*flagEnabled/)
    expect(qa).not.toMatch(/canReadOwn:[^\n]*flagEnabled/)
  })

  it('does the same for the register', () => {
    const register = readFileSync(join(process.cwd(), 'src/lib/register/data.ts'), 'utf8')
    expect(register).toMatch(/canChange:[\s\S]{0,200}flagEnabled/)
    expect(register).not.toMatch(/onRegister:[^\n]*flagEnabled/)
    expect(register).not.toMatch(/indicativeAmount:[^\n]*flagEnabled/)
  })
})

describe('the keys themselves', () => {
  it('are snake_case, matching the rows', () => {
    for (const key of ALL) expect(key).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('are distinct', () => {
    expect(new Set<PortalFlag>(ALL).size).toBe(ALL.length)
  })
})
