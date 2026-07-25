/**
 * Changing an investor account's state. BUILD_SPEC §4.2.
 *
 *   "Every state change writes an `AccountStatusEvent` with actor, timestamp,
 *   reason, and whether the investor was notified. Suspension and closure take
 *   effect immediately — active sessions are terminated, outstanding links are
 *   revoked."
 *
 * Both halves of that last sentence happen here, in one function, so that a
 * later caller cannot do one and forget the other. That is the entire reason
 * this module exists rather than the two updates living in an action.
 *
 * A reason is required by the type, not merely by a form. "Close and Archive
 * require a reason" (§12), and a required field on a screen is a thing somebody
 * can route around by calling the function from somewhere else.
 */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { accountStatusEvents, investorAccounts } from '@/db/schema'
import { audit } from '@/lib/audit'
import type { AdminIdentity } from '@/lib/auth/guards'
import type { AccountStatus } from './access'
import { revokeAllPortalAccess } from './claim'

/** Statuses whose arrival kills every session and link the account holds. */
const REVOKES_ACCESS: ReadonlySet<AccountStatus> = new Set<AccountStatus>([
  'SUSPENDED',
  'CLOSED',
  'ARCHIVED',
])

export type LifecycleRefusal =
  | 'NO_SUCH_ACCOUNT'
  | 'NO_REASON_GIVEN'
  | 'OPERATOR_CANNOT_ARCHIVE'
  | 'ALREADY_IN_THAT_STATE'

export type LifecycleResult =
  | { ok: true; from: AccountStatus; to: AccountStatus }
  | { ok: false; reason: LifecycleRefusal; message: string }

const MESSAGES: Record<LifecycleRefusal, string> = {
  NO_SUCH_ACCOUNT: 'That account could not be found. Nothing was changed.',
  NO_REASON_GIVEN:
    'A reason is required for this change, and it is written to the record. Nothing was changed.',
  OPERATOR_CANNOT_ARCHIVE:
    'Archiving an account is the owner’s decision. The attempt has been recorded. Nothing was changed.',
  ALREADY_IN_THAT_STATE: 'The account is already in that state. Nothing was changed.',
}

export interface ChangeStatusInput {
  accountId: string
  to: AccountStatus
  reason: string
  actor: AdminIdentity
  /** Whether the investor was told. Recorded either way — §4.2. */
  investorNotified?: boolean
}

export async function changeAccountStatus(
  input: ChangeStatusInput,
): Promise<LifecycleResult> {
  const reason = input.reason.trim()

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, input.accountId),
  })
  if (!account) {
    return { ok: false, reason: 'NO_SUCH_ACCOUNT', message: MESSAGES.NO_SUCH_ACCOUNT }
  }

  const from = account.status as AccountStatus
  if (from === input.to) {
    return {
      ok: false,
      reason: 'ALREADY_IN_THAT_STATE',
      message: MESSAGES.ALREADY_IN_THAT_STATE,
    }
  }

  if (reason === '') {
    return { ok: false, reason: 'NO_REASON_GIVEN', message: MESSAGES.NO_REASON_GIVEN }
  }

  // §4.2: "The owner can suspend or close any account... An operator cannot
  // close the owner's access." Archiving is retention policy rather than
  // day-to-day process management, so it stays with the owner.
  if (input.to === 'ARCHIVED' && input.actor.role !== 'OWNER') {
    await audit({
      actor: { kind: 'user', id: input.actor.id, label: input.actor.email },
      entityType: 'investor_account',
      entityId: input.accountId,
      action: 'access.refused',
      metadata: { attempted: 'investor_account.archive', actualRole: input.actor.role },
    })
    return {
      ok: false,
      reason: 'OPERATOR_CANNOT_ARCHIVE',
      message: MESSAGES.OPERATOR_CANNOT_ARCHIVE,
    }
  }

  await db
    .update(investorAccounts)
    .set({ status: input.to })
    .where(eq(investorAccounts.id, input.accountId))

  // Immediately, and before anything else can happen on this request.
  if (REVOKES_ACCESS.has(input.to)) {
    await revokeAllPortalAccess(input.accountId)
  }

  await db.insert(accountStatusEvents).values({
    accountId: input.accountId,
    fromStatus: from,
    toStatus: input.to,
    reason,
    actorUserId: input.actor.id,
    investorNotified: input.investorNotified ?? false,
  })

  await audit({
    actor: { kind: 'user', id: input.actor.id, label: input.actor.email },
    entityType: 'investor_account',
    entityId: input.accountId,
    action: 'investor_account.status_changed',
    // The reason is on the status event, which is the investor's own record.
    // It is not repeated here, because it may name a person or a circumstance.
    metadata: {
      from,
      to: input.to,
      accessRevoked: REVOKES_ACCESS.has(input.to),
    },
  })

  return { ok: true, from, to: input.to }
}

export { REVOKES_ACCESS }
