/**
 * The FLIPIT palette — BUILD_SPEC §13.2. One definition, used everywhere.
 *
 * Taken from the working FLIPIT demo, which was built to match the live site.
 * Verify against flipit.com before launch.
 *
 * Two rules govern this file:
 *
 *   1. **Every colour on an application screen comes from here.** The Tailwind
 *      theme in `globals.css` declares the same tokens under the same names,
 *      and `palette.test.ts` fails the build if a hex literal appears anywhere
 *      under `src/app` or `src/components`. A colour that is not a token is a
 *      colour nobody has checked the contrast of.
 *
 *   2. **The email templates and the participation certificate are not screens
 *      and are deliberately excluded.** They are light-mode documents with
 *      their own palette (§11.5: "dark header, light readable body"), their
 *      markup is hashed by the compliance gate (§8.2), and restyling them
 *      would invalidate an approval that has already been given. See
 *      PROGRESS.md, WP18 Decisions.
 *
 * The tokens below the spec's own table are additions this build needed. Each
 * one exists because a screen already used the colour as an undeclared hex
 * literal; naming it is what made its contrast checkable. Three of them were
 * changed in the process — see `PALETTE_CORRECTIONS`.
 */

export const brand = {
  // ---- §13.2's table, verbatim -------------------------------------------
  bg: '#070823',
  bg2: '#0d0f2e',
  paper: '#14162f',
  ink: '#0b0c22',
  orange: '#f59a23',
  orangeSoft: '#ffb84d',
  text: '#e7e9f5',
  dim: '#9498b5',
  ok: '#35d07f',
  warn: '#ff5b52',
  silver1: '#f6f8fc',
  silver2: '#cbd1de',
  silver3: '#98a0b4',

  // ---- Additions, all contrast-checked in brand.contrast.test.ts ---------

  /**
   * Tertiary text: field hints, placeholders, definition-list labels.
   * One visible step below `dim` and still clearing AA on every surface.
   * Replaces `#6c7290`, which was used in nineteen files at 4.16:1 on `bg`
   * and 3.75:1 on `paper` — below AA in both cases.
   */
  muted: '#7f849f',

  /**
   * A visible border on a raised surface: step markers, table rules, the
   * outline of a control that is not focused. Replaces `#2a2d52`, which was
   * 1.35:1 against `paper` and therefore invisible to a good many people.
   * Meets 1.4.11's 3:1 for a graphical object on every surface.
   */
  edge: '#616585',

  /** A tinted surface for a destructive or blocked state. */
  warnSurface: '#2a1116',

  /** Heading text on `warnSurface`, where `warn` itself reads as alarming. */
  warnSoft: '#ff8a84',

  /** Borders and dividers on the standard surfaces. §13.2's `--line`. */
  line: 'rgba(255,255,255,.09)',
} as const

export type BrandToken = keyof typeof brand

/**
 * The corrections this package made to colours that were in the codebase but
 * not in §13.2's table. Recorded here rather than only in PROGRESS.md because
 * anyone comparing the running application against the specification will
 * otherwise think the palette has drifted.
 */
export const PALETTE_CORRECTIONS = [
  {
    was: '#6c7290',
    now: brand.muted,
    reason: 'Tertiary text below WCAG AA on every surface (4.16:1 on bg).',
  },
  {
    was: '#2a2d52',
    now: brand.edge,
    reason: 'A state-carrying border at 1.35:1, below WCAG 1.4.11.',
  },
  {
    was: '#241326',
    now: brand.warnSurface,
    reason: 'A second, near-identical danger surface. Collapsed into one.',
  },
] as const

/**
 * Surfaces text may be placed on. The contrast test runs every text token
 * against every one of these; there is no pairing in the application that is
 * not covered.
 */
export const SURFACES = ['bg', 'bg2', 'paper', 'ink', 'warnSurface'] as const

/** Tokens used as body or label text, which must meet AA at 4.5:1. */
export const TEXT_TOKENS = ['text', 'dim', 'muted', 'silver2', 'silver3'] as const

/**
 * Tokens used for text that is bold and small, or for large headings, or as a
 * graphical object. Held to AA's 3:1 minimum, though every one of them in fact
 * clears 4.5:1 — see the test.
 */
export const ACCENT_TOKENS = [
  'orange',
  'orangeSoft',
  'ok',
  'warn',
  'warnSoft',
  'silver1',
] as const

export const fontStack =
  '"Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
