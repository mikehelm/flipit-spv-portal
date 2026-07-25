'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { changeAccountStatus } from '@/lib/portal/lifecycle'
import type { AccountStatus } from '@/lib/portal/access'

/**
 * Changing an investor account's state. BUILD_SPEC §4.2.
 *
 * `changeAccountStatus` has existed since WP8 and was correct — it writes the
 * status, revokes every session and every unspent link in the same function,
 * writes the `AccountStatusEvent` with actor, reason and whether the investor
 * was told, and refuses an operator who tries to archive. **Nothing called it.**
 * There was no action, no route and no screen, so §4.2's "suspension takes
 * effect immediately" was unreachable code, and TEST_ME told the reader to try
 * suspending somebody and watch their session die.
 *
 * This is the caller. It adds no rule of its own: every refusal below comes
 * back from the lifecycle function, so a future second caller cannot get a
 * different answer from this one.
 *
 * **The role check is deliberately not repeated here.** `changeAccountStatus`
 * takes the admin identity and decides, which is what makes it the authority.
 * Re-checking in the action would create a second place that has to agree, and
 * two places that have to agree are one place that eventually will not.
 */

const ACCOUNT_PATH = '/investors'

const STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED'] as const

const changeSchema = z.object({
  accountId: z.string().min(1),
  to: z.enum(STATUSES),
  /**
   * §12: "Close and Archive require a reason." It is required for every change
   * here, because a status event with no reason is a record of something having
   * happened and no record of why — which is the half that is worth keeping.
   */
  reason: z.string().trim().min(10, 'Give a reason of at least ten characters. It goes on the record.'),
  investorNotified: z.boolean(),
  /** The word SUSPEND, CLOSE or similar, typed out. Never one stray click. */
  confirmation: z.string().min(1),
})

/**
 * The word the operator has to type, per destination.
 *
 * Suspension and closure end somebody's access to the record of money they may
 * already have sent. A checkbox confirms that a click happened; typing the word
 * confirms which change was meant.
 */
export async function confirmationWordFor(status: string): Promise<string> {
  return status.toUpperCase()
}

export async function changeAccountStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const parsed = changeSchema.safeParse({
    accountId: formData.get('accountId'),
    to: formData.get('to'),
    reason: formData.get('reason') ?? '',
    investorNotified: formData.get('investorNotified') === 'on',
    confirmation: formData.get('confirmation') ?? '',
  })

  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ??
        'That change could not be read, so nothing was changed.',
    )
  }

  const { accountId, to, reason, investorNotified, confirmation } = parsed.data

  if (confirmation.trim().toUpperCase() !== to) {
    return actionError(
      `Type ${to} to confirm. Nothing was changed. The word is what confirms which change ` +
        'you meant, since a click on the wrong row looks exactly like a click on the right one.',
    )
  }

  const result = await changeAccountStatus({
    accountId,
    to: to as AccountStatus,
    reason,
    actor: admin,
    investorNotified,
  })

  revalidatePath(ACCOUNT_PATH)

  if (!result.ok) return actionError(result.message)

  const revoked = to === 'SUSPENDED' || to === 'CLOSED' || to === 'ARCHIVED'

  return actionOk(
    `Moved from ${result.from.toLowerCase()} to ${result.to.toLowerCase()}.` +
      (revoked
        ? ' Every session they hold has ended and every unspent link has been revoked, ' +
          'as of now. Asking for a new link is accepted politely and produces nothing.'
        : '') +
      (investorNotified
        ? ' Recorded as: the investor was told.'
        : ' Recorded as: the investor was not told. Telling them is a separate act — this ' +
          'application sends nothing on a status change.'),
  )
}
