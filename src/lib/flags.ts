import { db } from '@/db'
import { featureFlags } from '@/db/schema'

/**
 * Feature flags. BUILD_SPEC §7, §17.
 *
 * §7: *"Phase-two modules ship behind feature flags so functionality can be
 * switched on for a later round without redeployment risk."*
 *
 * The table existed, the seed wrote four rows naming four **shipped** features
 * with a spec reference in each note, and nothing anywhere read it. Setting
 * `register_of_interest` to `false` changed nothing at all. A switch with no
 * wire behind it is worse than no switch, because eventually somebody turns it
 * and believes the result.
 *
 * Two rules shape what a flag is allowed to do here, and they are not
 * negotiable in the way the rest of this file is.
 *
 * **A missing row means on.** §7's sentence is about switching functionality
 * *on for a later round* — a flag is a gate in front of something not yet
 * wanted, not a licence every feature needs. So an unseeded deployment, or one
 * whose row was deleted, behaves exactly as it did before flags existed. A
 * missing row must never be able to take a section off an investor's portal.
 *
 * **A flag off never removes what an investor already has.** For the two
 * sections that are entirely ours — the roadmap tiles and David's video —
 * turning the flag off removes the section, and nothing of theirs goes with it.
 * For the two that hold their own record — the register of interest and the
 * question thread — the flag closes the *door*: no new question, no new join.
 * What they have written and what has been answered stays on the screen. That
 * is the same narrowing `portalAccess` already does for a read-only service
 * mode, for the same reason: an operational posture may stop somebody acting,
 * and may not take away what they have done.
 *
 * A flag that is off is a finding on the health report. Somebody turning one
 * off by hand in a database, months later, is the situation this whole table
 * was built for and the one in which nobody remembers it was turned off.
 */

/** The flags this application actually consults, and what each gates. */
export const PORTAL_FLAGS = {
  /** §5.2. Off: the section still shows, and cannot be joined or left. */
  registerOfInterest: 'register_of_interest',
  /** §13.3. Off: the section is absent. Nothing of the investor's is in it. */
  operatorVideo: 'operator_video',
  /** §6.7. Off: existing threads remain readable; no new question is accepted. */
  sharedQa: 'qa_shared',
  /** §13.1. Off: the tiles are absent. They are the same for everybody. */
  roadmapTiles: 'roadmap_tiles',
} as const

export type PortalFlag = (typeof PORTAL_FLAGS)[keyof typeof PORTAL_FLAGS]

/** What the table says, as `key → enabled`. Absent keys are not in it. */
export type FlagRows = ReadonlyMap<string, boolean>

/**
 * On unless a row says otherwise.
 *
 * Written as one function rather than inline so there is exactly one place the
 * default lives. A second `?? true` somewhere else is how a default becomes two
 * defaults.
 */
export function flagEnabled(rows: FlagRows, key: PortalFlag): boolean {
  return rows.get(key) ?? true
}

/** Every flag this application consults that is switched off. */
export function disabledFlags(rows: FlagRows): PortalFlag[] {
  return Object.values(PORTAL_FLAGS).filter((key) => !flagEnabled(rows, key))
}

export async function readFeatureFlags(): Promise<FlagRows> {
  const rows = await db
    .select({ key: featureFlags.key, enabled: featureFlags.enabled })
    .from(featureFlags)

  return new Map(rows.map((row) => [row.key, row.enabled]))
}
