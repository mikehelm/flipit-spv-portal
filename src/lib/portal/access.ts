/**
 * Who may reach the investor portal, and in what state. BUILD_SPEC §4.2, §7.
 *
 * Pure. No database, no cookies, no side effects — a table of rules that can be
 * read and argued with. §4.2 spells the rules out "explicitly, because
 * revocation alone does not answer it", so they are transcribed here rather
 * than reasoned out at each call site.
 *
 * The distinction that matters throughout:
 *
 *   - **Existing** sessions and links are killed the moment the status changes.
 *     That is a write, and it happens in `lifecycle.ts`.
 *   - Whether a **new** one can be obtained is this file.
 *
 * The second rule of this file is that none of it is observable from outside.
 * A sign-in request for a suspended account, a closed account and an address
 * that has never existed all produce the same response and the same delay. The
 * `issueLink` flag is what the server does; it is never what the visitor is
 * told. See `SIGN_IN_ACCEPTED_MESSAGE`.
 */

export type AccountStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'ARCHIVED'
export type ClosedAccountAccess = 'READ_ONLY' | 'NONE'
export type ServiceMode = 'ACTIVE' | 'READ_ONLY' | 'SUNSET' | 'DISABLED'

/** What a visitor can do once they are through the door. */
export type PortalCapability =
  /** Full access to their own record — view, respond, ask, join the register. */
  | 'FULL'
  /** View and download only. Responses and messages are not accepted. */
  | 'READ_ONLY'
  /** Nothing. A neutral notice page with a way to make contact. */
  | 'NONE'

export interface PortalAccess {
  capability: PortalCapability
  /** May a fresh sign-in link be minted for this account? */
  issueLink: boolean
  /** May an unspent claim token still be redeemed? */
  allowClaim: boolean
  /**
   * The notice to show. Null when there is nothing to explain, which is the
   * normal case. Never names another investor or implies one exists.
   */
  notice: PortalNotice | null
}

export type PortalNotice =
  | 'SUSPENDED'
  | 'CLOSED'
  | 'READ_ONLY'
  | 'SUNSET'
  | 'SERVICE_CLOSED'
  | 'ARCHIVED'

export interface PortalAccessInput {
  accountStatus: AccountStatus
  closedAccountAccess: ClosedAccountAccess
  serviceMode: ServiceMode
}

/**
 * The service mode is applied on top of the account state, and it can only ever
 * narrow access. An account that is suspended stays unreachable in every mode;
 * a service in `read_only` makes an otherwise-full account read-only. Widening
 * would mean a service setting could undo a suspension, which is the wrong way
 * round — one is an operational posture, the other is a decision about a
 * person.
 */
function narrow(a: PortalCapability, b: PortalCapability): PortalCapability {
  const rank: Record<PortalCapability, number> = { FULL: 2, READ_ONLY: 1, NONE: 0 }
  return rank[a] <= rank[b] ? a : b
}

function forServiceMode(mode: ServiceMode): {
  capability: PortalCapability
  issueLink: boolean
  notice: PortalNotice | null
} {
  switch (mode) {
    case 'ACTIVE':
      return { capability: 'FULL', issueLink: true, notice: null }
    case 'READ_ONLY':
      return { capability: 'READ_ONLY', issueLink: true, notice: 'READ_ONLY' }
    case 'SUNSET':
      // §7: the portal is closing but investors can still get in to take their
      // records with them. Refusing sign-in during sunset would defeat the
      // point of announcing it.
      return { capability: 'READ_ONLY', issueLink: true, notice: 'SUNSET' }
    case 'DISABLED':
      return { capability: 'NONE', issueLink: false, notice: 'SERVICE_CLOSED' }
  }
}

function forAccountStatus(
  status: AccountStatus,
  closedAccess: ClosedAccountAccess,
): { capability: PortalCapability; issueLink: boolean; allowClaim: boolean; notice: PortalNotice | null } {
  switch (status) {
    case 'INVITED':
      // "Claim link works; nothing else exists yet." A sign-in link is not
      // offered, because the claim link is the thing that verifies the mailbox
      // and it has not been used.
      return { capability: 'NONE', issueLink: false, allowClaim: true, notice: null }

    case 'ACTIVE':
      return { capability: 'FULL', issueLink: true, allowClaim: true, notice: null }

    case 'SUSPENDED':
      // "Requesting a sign-in link is accepted silently but no link is issued."
      return { capability: 'NONE', issueLink: false, allowClaim: false, notice: 'SUSPENDED' }

    case 'CLOSED':
      // Default is READ_ONLY, and the spec says why: "an investor who has sent
      // money should not lose the record of it."
      return closedAccess === 'READ_ONLY'
        ? { capability: 'READ_ONLY', issueLink: true, allowClaim: false, notice: 'READ_ONLY' }
        : { capability: 'NONE', issueLink: false, allowClaim: false, notice: 'CLOSED' }

    case 'ARCHIVED':
      // "No portal access" and "never issues sign-in links."
      return { capability: 'NONE', issueLink: false, allowClaim: false, notice: 'ARCHIVED' }
  }
}

export function portalAccess(input: PortalAccessInput): PortalAccess {
  const account = forAccountStatus(input.accountStatus, input.closedAccountAccess)
  const service = forServiceMode(input.serviceMode)

  const capability = narrow(account.capability, service.capability)

  return {
    capability,
    // Both must agree. A disabled service issues nothing to anybody; a
    // suspended account receives nothing however the service is set.
    issueLink: account.issueLink && service.issueLink,
    // A claim is a sign-in by another name, so a disabled service refuses it
    // too. §7 disables the portal, not merely its sign-in form.
    allowClaim: account.allowClaim && input.serviceMode !== 'DISABLED',
    // The account's own notice is the more specific of the two and wins when
    // there is one. "Your access is suspended" is more use than "the service is
    // read-only" to somebody who is suspended.
    notice: account.notice ?? service.notice,
  }
}

/**
 * The one sentence every sign-in request produces.
 *
 * §4.1 and PORTAL_COPY: "If the address is unknown, the response must be
 * identical to a known address." It is therefore also identical for a suspended
 * account, a closed one, an archived one and one that has never existed — those
 * are all "unknown" as far as anybody outside is concerned.
 *
 * There is deliberately no variant of this string anywhere in the application.
 */
export const SIGN_IN_ACCEPTED_MESSAGE =
  'If that address has a record with us, a sign-in link is on its way.'

export function canRespond(access: PortalAccess): boolean {
  return access.capability === 'FULL'
}

export function canView(access: PortalAccess): boolean {
  return access.capability === 'FULL' || access.capability === 'READ_ONLY'
}
