import { describe, expect, it } from 'vitest'
import { ACCENT_TOKENS, brand, SURFACES, TEXT_TOKENS } from './brand'
import { AA_LARGE, AA_TEXT, contrastRatio, parseHex, reportRatio } from './contrast'

/**
 * "WCAG AA contrast, checking `--dim` on `--bg` specifically." — §13.2.
 *
 * The specification names one pairing. This checks all fifty, because the one
 * it names turns out to be comfortably fine and two it does not name were not.
 */

describe('the contrast arithmetic itself', () => {
  it('matches the values WCAG publishes', () => {
    // The two anchors in the standard: black on white is exactly 21, and any
    // colour against itself is exactly 1.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 10)

    // #767676 on white is the canonical worked example of the 4.5 boundary.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5)
  })

  it('is symmetric, so a pairing cannot pass in one direction only', () => {
    expect(contrastRatio(brand.dim, brand.bg)).toBe(contrastRatio(brand.bg, brand.dim))
  })

  it('reports rounded down, so a stated figure never overstates', () => {
    expect(reportRatio('#000000', '#ffffff')).toBe(21)
    expect(reportRatio(brand.dim, brand.bg)).toBeLessThanOrEqual(contrastRatio(brand.dim, brand.bg))
  })

  it('refuses a colour it cannot parse rather than defaulting', () => {
    expect(() => parseHex('rgb(1,2,3)')).toThrow(/Not a hex colour/)
    expect(() => parseHex('#12345')).toThrow(/Not a hex colour/)
    expect(parseHex('#abc')).toEqual([0xaa, 0xbb, 0xcc])
  })
})

describe('every text token on every surface meets WCAG AA', () => {
  for (const token of TEXT_TOKENS) {
    for (const surface of SURFACES) {
      it(`${token} on ${surface}`, () => {
        const ratio = contrastRatio(brand[token], brand[surface])
        expect(
          ratio,
          `${token} (${brand[token]}) on ${surface} (${brand[surface]}) is ${reportRatio(
            brand[token],
            brand[surface],
          )}:1, below AA's ${AA_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT)
      })
    }
  }
})

describe('every accent on every surface meets AA for its use', () => {
  for (const token of ACCENT_TOKENS) {
    for (const surface of SURFACES) {
      it(`${token} on ${surface}`, () => {
        expect(contrastRatio(brand[token], brand[surface])).toBeGreaterThanOrEqual(AA_LARGE)
      })
    }
  }
})

describe('the pairings §13.2 and WP18 single out', () => {
  it('dim on bg — the one the specification names', () => {
    expect(reportRatio(brand.dim, brand.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('muted on paper — the pairing that was actually failing', () => {
    // #6c7290, the colour `muted` replaced, was 3.75:1 here and appeared in
    // nineteen files, including the four figures on the investor's own portal.
    expect(contrastRatio('#6c7290', brand.paper)).toBeLessThan(AA_TEXT)
    expect(contrastRatio(brand.muted, brand.paper)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('edge as a border — a graphical object under 1.4.11', () => {
    expect(contrastRatio('#2a2d52', brand.paper)).toBeLessThan(AA_LARGE)
    expect(contrastRatio(brand.edge, brand.paper)).toBeGreaterThanOrEqual(AA_LARGE)
  })

  it('the focus ring is visible on every surface', () => {
    // globals.css: `:focus-visible { outline: 2px solid var(--color-orange) }`.
    // A focus ring is a graphical object; 1.4.11 wants 3:1.
    for (const surface of SURFACES) {
      expect(contrastRatio(brand.orange, brand[surface])).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  it('the primary button reads: ink on orange', () => {
    expect(contrastRatio(brand.ink, brand.orange)).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('muted stays a visible step below dim rather than collapsing into it', () => {
    // If the fix for contrast were simply "make it brighter", `muted` would
    // become `dim` and the type hierarchy on the portal would flatten.
    expect(contrastRatio(brand.muted, brand.dim)).toBeGreaterThan(1.15)
    expect(contrastRatio(brand.muted, brand.bg)).toBeLessThan(contrastRatio(brand.dim, brand.bg))
  })
})
