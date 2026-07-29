/**
 * The FLIPIT page curl, used as a brand mark. BUILD_SPEC §13.2.
 *
 * *"The page curl is FLIPIT's signature. Use it as a restrained brand mark
 * somewhere in the portal chrome. Do not animate it aggressively; this is an
 * investment document, not the product demo."*
 *
 * So: drawn once, in the silver gradient §13.2 names for it, at the size of a
 * line of text, and it does not move. There is no transform, no transition and
 * no keyframe anywhere in this file — the restraint is structural rather than
 * a setting somebody could turn up.
 *
 * It carries no information, so it is `aria-hidden` and has `focusable="false"`
 * — without the latter, Internet Explorer and some assistive technologies put
 * an SVG in the tab order, which would put a decoration between an investor and
 * the button they are reaching for.
 *
 * Pure markup. No state, no client boundary, no database.
 */

export function PageCurl({
  size = 28,
  className = '',
}: {
  size?: number
  className?: string
}) {
  // Unique enough within a document that two marks on one page do not share a
  // gradient definition, without needing `useId` and a client component.
  const gradientId = `flipit-curl-${size}`
  const faceGradientId = `flipit-page-face-${size}`
  const recessGradientId = `flipit-curl-recess-${size}`
  const shadowId = `flipit-curl-shadow-${size}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id={faceGradientId} x1="4" y1="30" x2="27" y2="2">
          <stop offset="0%" stopColor="var(--color-bg2)" />
          <stop offset="58%" stopColor="var(--color-bg)" />
          <stop offset="100%" stopColor="var(--color-silver1)" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id={recessGradientId} x1="20" y1="2" x2="27" y2="10">
          <stop offset="0%" stopColor="var(--color-bg)" />
          <stop offset="55%" stopColor="var(--color-orange)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-bg2)" />
        </linearGradient>
        <linearGradient id={gradientId} x1="19" y1="3" x2="28" y2="11">
          <stop offset="0%" stopColor="var(--color-silver1)" />
          <stop offset="38%" stopColor="var(--color-silver3)" />
          <stop offset="68%" stopColor="var(--color-orange)" />
          <stop offset="100%" stopColor="var(--color-silver2)" />
        </linearGradient>
        <filter id={shadowId} x="-35%" y="-35%" width="180%" height="190%">
          <feDropShadow
            dx="-1.5"
            dy="2"
            stdDeviation="1.8"
            floodColor="#000"
            floodOpacity="0.72"
          />
        </filter>
      </defs>

      {/* The page, with its top-right corner peeled back. */}
      <path
        d="M4 2h16.5L28 9.5V30H4z"
        fill={`url(#${faceGradientId})`}
        stroke="var(--color-edge)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Recess under the lifted corner and the dimensional folded face. */}
      <path d="M20.5 2H28v7.5z" fill={`url(#${recessGradientId})`} />
      <path
        d="M20.5 2C23.2 3.3 25.8 6.1 28 9.5L20.5 9z"
        fill={`url(#${gradientId})`}
        filter={`url(#${shadowId})`}
      />
      <path
        d="M20.5 2C23.2 3.3 25.8 6.1 28 9.5"
        fill="none"
        stroke="var(--color-silver1)"
        strokeWidth="0.8"
        strokeLinecap="round"
      />

      {/* Two ruled lines, so the sheet reads as a page rather than a shape. */}
      <path
        d="M9 13h14M9 18.5h10"
        stroke="var(--color-edge)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
