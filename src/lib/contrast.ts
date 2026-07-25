/**
 * WCAG 2.1 contrast, computed rather than asserted.
 *
 * BUILD_SPEC §13.2 asks for "WCAG AA contrast, checking `--dim` on `--bg`
 * specifically". A palette table in a document is a claim; this is the
 * arithmetic, and `brand.contrast.test.ts` runs it over every pairing the
 * application actually uses.
 *
 * Pure functions, no dependencies, no database. Safe in a client component,
 * a test, or a script.
 *
 * These are ratios of light, not money, so a JavaScript number is the correct
 * type here — the rule in CODEX_TASKS is about monetary values and percentages
 * of ownership, neither of which appears in this file.
 */

/** WCAG 2.1 minimum for body text (1.4.3). */
export const AA_TEXT = 4.5

/**
 * WCAG 2.1 minimum for text at 18.66px bold or 24px regular and above (1.4.3),
 * and for user-interface components and graphical objects (1.4.11).
 */
export const AA_LARGE = 3

export type Hex = `#${string}`

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Expands `#abc` to `#aabbcc` and rejects anything that is not a six-digit
 * hex colour. Throws rather than returning a fallback: a colour that cannot be
 * parsed is a mistake in the palette, and a silent default would hide it.
 */
export function parseHex(hex: string): [number, number, number] {
  const raw = hex.trim().replace(/^#/, '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${JSON.stringify(hex)}`)
  }

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.1 contrast ratio, between 1 and 21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Rounded down to two places, so a reported figure never overstates. */
export function reportRatio(a: string, b: string): number {
  return Math.floor(contrastRatio(a, b) * 100) / 100
}

export function meetsAA(a: string, b: string): boolean {
  return contrastRatio(a, b) >= AA_TEXT
}

export function meetsAALarge(a: string, b: string): boolean {
  return contrastRatio(a, b) >= AA_LARGE
}
