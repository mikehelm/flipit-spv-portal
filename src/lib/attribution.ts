import { readServiceConfig } from '@/lib/auth/service-config'

/**
 * The "Made by Make with Mike" credit. BUILD_SPEC §13.2.
 *
 * The specification spends more words on how this should *not* look than on
 * what it says, which is the requirement:
 *
 *   - *"Subtle is the requirement, not a nicety. Small, in `--dim`, below the
 *     legal footer notice, no logo competing with FLIPIT's, no colour, no
 *     animation."*
 *   - *"Present on both the admin side and the investor portal. Configurable so
 *     it can be switched off per-surface if it ever feels wrong beside the
 *     offer figures."*
 *   - *"Optionally a link, opening in a new tab, but never styled to draw the
 *     eye."*
 *   - *"It does not appear inside the invitation email or on the participation
 *     certificate. Those are formal instruments about someone's money, and a
 *     maker's credit does not belong on either."*
 *
 * Two surfaces, two switches, and no third switch for the two places the
 * credit must never appear. That last sentence of §13.2 is not a default; it
 * is a rule, so there is nothing here that could turn it on.
 */

export const ATTRIBUTION_TEXT = 'Made by Make with Mike'

/** The surfaces the credit may appear on. There are exactly two, by §13.2. */
export type AttributionSurface = 'ADMIN' | 'PORTAL'

export interface Attribution {
  show: boolean
  text: string
  /** Absent unless the owner has configured one and it is http(s). */
  href: string | null
}

/**
 * A stored URL is only used if it is `http:` or `https:`. Anything else —
 * `javascript:`, `data:`, a relative path — is dropped rather than rendered,
 * because this string reaches an anchor on a page an investor is reading.
 */
export function safeAttributionHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export async function loadAttribution(surface: AttributionSurface): Promise<Attribution> {
  const config = await readServiceConfig()

  const show =
    surface === 'ADMIN' ? config.attributionOnAdmin : config.attributionOnPortal

  return {
    show,
    text: ATTRIBUTION_TEXT,
    href: show ? safeAttributionHref(config.attributionUrl) : null,
  }
}
