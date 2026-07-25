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
        <linearGradient id={gradientId} x1="32" y1="32" x2="10" y2="10">
          <stop offset="0%" stopColor="var(--color-silver3)" />
          <stop offset="55%" stopColor="var(--color-silver2)" />
          <stop offset="100%" stopColor="var(--color-silver1)" />
        </linearGradient>
      </defs>

      {/* The sheet: a page with its lower-right corner lifted away. */}
      <path
        d="M4 2h24v18.5L20.5 30H4z"
        stroke="var(--color-edge)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* The curl itself — the folded corner, silver, the signature. */}
      <path d="M28 20.5H20.5V30z" fill={`url(#${gradientId})`} />

      {/* Two ruled lines, so the sheet reads as a page rather than a shape. */}
      <path
        d="M9 10.5h14M9 16h10"
        stroke="var(--color-edge)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
