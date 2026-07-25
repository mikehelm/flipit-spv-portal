/**
 * Who an update goes to. BUILD_SPEC §6.
 *
 * *"Audience: all active investors, a filtered subset (by status), or a single
 * investor."*
 *
 * The audience is resolved **once, at publication**, into `update_deliveries`
 * rows — one per account. That is deliberate rather than resolving it on every
 * page load:
 *
 *   - An update is immutable once published (§6). If the audience were a live
 *     query, an account that changed status the next morning would silently
 *     gain or lose a published notice, which is a different update from the one
 *     that was published.
 *   - The investor's feed then reads its own delivery rows and nothing else, so
 *     "a targeted update reaches only its intended recipients" is a join, not a
 *     filter somebody could forget to write.
 *
 * Pure. Encoding, decoding, and the rule about who is eligible.
 */

import { z } from 'zod'
import type { AccountStatus } from '@/lib/portal/access'

export type UpdateAudience =
  /** Every account that can currently read the portal. */
  | { kind: 'ALL' }
  /** A subset by account status (§6). */
  | { kind: 'STATUS'; statuses: AccountStatus[] }
  /** One named investor. */
  | { kind: 'ONE'; accountId: string }

/**
 * Statuses an update may be addressed to.
 *
 * `SUSPENDED` and `ARCHIVED` are absent and cannot be selected. Both are states
 * in which §4.2 gives the account no portal access at all, so an update
 * addressed to them would be delivered to somewhere nobody can look — and the
 * delivery row would then be a record of a communication that never happened.
 * Where the spec is silent on which statuses "filtered by status" includes, the
 * conservative reading is the ones that can actually read it.
 *
 * `CLOSED` is included because the default `closed_account_access` is
 * `READ_ONLY` — §4.2: "an investor who has sent money should not lose the
 * record of it." Whether a particular closed account can read is decided at
 * delivery time, not here.
 */
export const ADDRESSABLE_STATUSES: readonly AccountStatus[] = [
  'INVITED',
  'ACTIVE',
  'CLOSED',
] as const

export const NON_ADDRESSABLE_NOTE =
  'Suspended and archived accounts are never included. Neither has portal access, so an update ' +
  'addressed to one would be recorded as delivered somewhere nobody can look.'

/**
 * `ALL` means every account that can read the portal, which is the addressable
 * set. §6 says "all active investors"; an account in `INVITED` has been sent an
 * invitation and has not yet opened it, and excluding them would mean the first
 * thing they see on claiming is a feed with a hole in it.
 */
export function statusesFor(audience: UpdateAudience): readonly AccountStatus[] {
  if (audience.kind === 'STATUS') {
    return audience.statuses.filter((status) => ADDRESSABLE_STATUSES.includes(status))
  }
  return ADDRESSABLE_STATUSES
}

export function isAddressable(status: AccountStatus): boolean {
  return ADDRESSABLE_STATUSES.includes(status)
}

// ---------------------------------------------------------------------------
// Encoding — `portal_updates.audience_filter` is one text column
// ---------------------------------------------------------------------------

const audienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }),
  z.object({
    kind: z.literal('STATUS'),
    statuses: z
      .array(z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED']))
      .min(1),
  }),
  z.object({ kind: z.literal('ONE'), accountId: z.string().min(1) }),
])

export function encodeAudience(audience: UpdateAudience): string {
  return JSON.stringify(audience)
}

/**
 * Decode, or fall back to `ALL`.
 *
 * A published update whose audience column is unreadable is a real problem, but
 * the resolution has already happened — the delivery rows are the authority for
 * who received it, and this value is only ever used to describe the audience on
 * screen. Falling back keeps a corrupt column from taking down the page that
 * would let somebody notice it.
 */
export function decodeAudience(value: string | null): UpdateAudience {
  if (!value) return { kind: 'ALL' }
  try {
    const parsed = audienceSchema.safeParse(JSON.parse(value))
    return parsed.success ? (parsed.data as UpdateAudience) : { kind: 'ALL' }
  } catch {
    return { kind: 'ALL' }
  }
}

/** Operator-facing description. Never shown to an investor. */
export function describeAudience(
  audience: UpdateAudience,
  recipientName?: string | null,
): string {
  switch (audience.kind) {
    case 'ALL':
      return 'Everyone who can read the portal'
    case 'STATUS':
      return `Accounts that are ${audience.statuses.map((status) => status.toLowerCase()).join(' or ')}`
    case 'ONE':
      return recipientName ? `${recipientName} only` : 'One investor only'
  }
}
