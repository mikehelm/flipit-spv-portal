import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'

/**
 * Whether the operator's account has two-factor switched on. BUILD_SPEC §2.2.
 *
 * *"TOTP two-factor for both privileged accounts … mandatory before the
 * production deployment sends anything real."*
 *
 * The send gate reads this. It is the operator's account rather than whoever
 * happens to be clicking, for two reasons: the scheduled sends — reminders,
 * update notifications — have no acting user at all, and §2.2 names the stake
 * as *"the ability to send mail as the operator"*. Every message this
 * application produces leaves from the operator's mailbox.
 *
 * The role comes from the `users` row rather than from the environment
 * allowlist because this runs in a scheduled job where there is no request.
 * The two agree; where they could not, this is the conservative one — an
 * account that is an operator in the database and no longer on the allowlist
 * cannot sign in at all, so requiring its two-factor is never wrong.
 */
export async function operatorTwoFactorEnrolled(): Promise<boolean> {
  const operator = await db.query.users.findFirst({
    where: and(eq(users.role, 'OPERATOR'), isNotNull(users.totpConfirmedAt)),
    columns: { id: true },
  })

  return operator !== undefined
}
