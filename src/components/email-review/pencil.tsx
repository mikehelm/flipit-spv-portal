/**
 * The pencil marks.
 *
 * Every stroke is an SVG path from `markup.ts`, drawn with
 * `vector-effect="non-scaling-stroke"` so a box stretched to the width of a
 * paragraph still carries a 1.4px graphite line rather than a smeared one.
 * There are no images and no packages; the wobble is arithmetic.
 *
 * **Presentation attributes, not only CSS.** `fill="none"`, `stroke`,
 * `stroke-width` and a `width`/`height` of `100%` are set as SVG attributes as
 * well as in the stylesheet. When the stylesheet was refused by the
 * Content-Security-Policy these marks became solid black shapes larger than the
 * viewport, because an SVG path with no fill declared is filled black and a box
 * with no size declared takes the space it can reach. Attributes cannot be
 * refused: with no CSS at all the marks are now hairlines bounded by their own
 * passage.
 *
 * The marks carry no information that is not also in the balloon and in the
 * change list, so they are hidden from assistive technology rather than
 * described — a screen reader announcing "path" nine times per paragraph is
 * worse than silence.
 */

import {
  circlePath,
  marginGlyphPath,
  marginRulePath,
  tiePath,
} from './markup'
import styles from './paper.module.css'
import type { EmailDiffKind } from '@/lib/email-review/segments'

const GRAPHITE = '#3a3a46'
const WIDTH = 1.4

const svgProps = {
  'aria-hidden': true as const,
  focusable: 'false' as const,
  width: '100%',
  height: '100%',
} as const

const pathProps = {
  className: styles.stroke,
  fill: 'none',
  stroke: GRAPHITE,
  strokeWidth: WIDTH,
} as const

/** The open loop a reviewer draws around a passage they have rewritten. */
export function PencilLoop({ seed }: { seed: number }) {
  return (
    <svg
      {...svgProps}
      className={styles.loop}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <path
        {...pathProps}
        d={circlePath(seed)}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** The rule down the margin, plus the small insert/delete/revise proof mark. */
export function MarginMark({
  kind,
  seed,
}: {
  kind: EmailDiffKind
  seed: number
}) {
  const glyph = marginGlyphPath(kind, seed)
  return (
    <span className={styles.margin}>
      <svg
        {...svgProps}
        className={styles.marginRule}
        viewBox="0 0 10 100"
        preserveAspectRatio="none"
      >
        <path
          {...pathProps}
          d={marginRulePath(seed)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {glyph ? (
        <svg
          {...svgProps}
          className={styles.marginGlyph}
          viewBox="0 0 16 16"
        >
          <path {...pathProps} d={glyph} />
        </svg>
      ) : null}
    </span>
  )
}

/** The stroke across the gutter that ties a selected passage to its pair. */
export function TieStroke({ seed, on }: { seed: number; on: boolean }) {
  return (
    <span className={styles.tieStroke} data-on={on ? 'true' : 'false'}>
      <svg
        {...svgProps}
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
      >
        <path
          {...pathProps}
          d={tiePath(seed)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  )
}
