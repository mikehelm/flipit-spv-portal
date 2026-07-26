import type { PortalNotice } from './access'

/**
 * The address on a notice an investor cannot get past. BUILD_SPEC §4.2, §7.
 *
 * §4.2 says a suspended account gets a *"neutral notice page with a contact
 * route"*. §7 says a disabled service returns *"a neutral closed page with a
 * contact address"*. §7 goes further and says what `service_contact_email` is
 * for: it is *"shown once the portal is closed and after the operator's own
 * address stops being monitored"*.
 *
 * All three notices existed and none of them carried an address. Each ended
 * "please contact David", to somebody who has just been locked out of the only
 * page that ever named him — an instruction with no way to follow it, which is
 * worse than saying nothing, because it reads as a route and is not one.
 *
 * Two addresses, and which leads depends on what has happened:
 *
 *   - **The account is in an unusual state and the portal is still running.**
 *     Suspended, closed, read-only. The operator is there; write to him. The
 *     standing address is offered underneath, for the case where nobody
 *     answers — which is Open Decision 7, *"fallback contact if David is
 *     unavailable"*, and the reason it is a decision is that being suspended by
 *     a person and being unable to reach that person are the same experience
 *     from outside.
 *   - **The portal itself is closing or closed.** Sunset, service closed,
 *     archived. This is precisely the case §7 names: the operator's address has
 *     stopped being monitored, so the standing address leads and his is not
 *     offered at all. Offering an address nobody reads is the failure this file
 *     exists to fix, reintroduced one state later.
 *
 * Pure, and it never invents. With nothing configured it returns nothing, and
 * the page says nothing rather than naming a person the reader cannot reach.
 * That absence is a finding in the health report, where somebody can fix it.
 */

/** Which of the two an address is being shown as, in this state. */
export type ContactUse = 'PRIMARY' | 'FALLBACK'

export interface PortalContact {
  address: string
  use: ContactUse
}

export interface PortalContactInput {
  notice: PortalNotice
  /** The operator's own address — `default_sender_email`. */
  operatorEmail: string | null
  /** The standing address — `service_contact_email`. */
  serviceContactEmail: string | null
}

/**
 * The notices where the portal itself is winding down or gone.
 *
 * On these the operator's address is deliberately absent even when it is
 * configured. §7's whole reason for a second address is that the first has
 * stopped being read, and a closed portal offering an unmonitored address is a
 * dead end dressed as a route.
 */
const PORTAL_IS_ENDING: ReadonlySet<PortalNotice> = new Set<PortalNotice>([
  'SUNSET',
  'SERVICE_CLOSED',
  'ARCHIVED',
])

/**
 * The notices that need an address at all.
 *
 * `READ_ONLY` is not one of them. The portal is open, the record is on the
 * screen, and the reader can see everything they came for — there is nothing
 * for a contact line to rescue, and a standing invitation to write during a
 * deliberate quiet period is an invitation to be written to.
 */
const NEEDS_A_ROUTE: ReadonlySet<PortalNotice> = new Set<PortalNotice>([
  'SUSPENDED',
  'CLOSED',
  'SUNSET',
  'SERVICE_CLOSED',
  'ARCHIVED',
])

function clean(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** Case-insensitively the same address, so it is never shown twice. */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function portalContacts(input: PortalContactInput): PortalContact[] {
  if (!NEEDS_A_ROUTE.has(input.notice)) return []

  const operator = clean(input.operatorEmail)
  const standing = clean(input.serviceContactEmail)

  if (PORTAL_IS_ENDING.has(input.notice)) {
    // The standing address, or the operator's as the only thing left. Never
    // both: on these notices his is either the answer or unread, and offering
    // an unread address underneath a read one is worse than offering neither.
    const address = standing ?? operator
    return address === null ? [] : [{ address, use: 'PRIMARY' }]
  }

  if (operator === null) {
    return standing === null ? [] : [{ address: standing, use: 'PRIMARY' }]
  }

  const contacts: PortalContact[] = [{ address: operator, use: 'PRIMARY' }]
  if (standing !== null && !same(standing, operator)) {
    contacts.push({ address: standing, use: 'FALLBACK' })
  }
  return contacts
}

/**
 * The words around each address, in one place because they are investor-facing.
 *
 * Deliberately plain, and deliberately without a promise. "Is also monitored"
 * is a statement about an inbox; "somebody will reply within two days" would be
 * a commitment this application cannot keep on anybody's behalf.
 *
 * No name. The copy used to say "David" and the address makes the name
 * unnecessary — and a hard-coded first name in a notice is a thing that goes
 * wrong quietly on the day somebody else is answering.
 */
export const CONTACT_COPY: Record<ContactUse, { before: string; after: string }> = {
  PRIMARY: {
    before: 'For anything you need about your record, write to ',
    after: '.',
  },
  FALLBACK: {
    before: 'If you do not hear back, ',
    after: ' is also monitored.',
  },
}
