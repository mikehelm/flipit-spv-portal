'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import {
  SIGN_IN_FAILED_MESSAGE,
  SIGN_IN_LOCKED_MESSAGE,
  SIGN_IN_UNAVAILABLE_MESSAGE,
  attemptPasswordSignIn,
} from '@/lib/auth/credentials'
import { drizzleCredentialStore } from '@/lib/auth/credential-store'
import { requireAdmin, requireOwner } from '@/lib/auth/guards'
import {
  OPERATOR_INVITE_TTL_HOURS,
  acceptOperatorInvite,
  issueOperatorInvite,
  revokeOperatorInvite,
  type InviteRefusal,
} from '@/lib/auth/invites'
import { signInRateLimitStore } from '@/lib/auth/rate-limit'
import {
  createAdminSession,
  destroyAdminSession,
  readAdminSession,
} from '@/lib/auth/session'
import { env } from '@/lib/env'

/**
 * Authentication and operator-access actions. BUILD_SPEC §2, §2.2.
 *
 * Every one of these re-establishes who is calling before it does anything. The
 * page having hidden the button is not a reason to trust the request.
 */

/**
 * The address a request appears to come from, for rate limiting.
 *
 * Behind a proxy this is a header and therefore forgeable, which is exactly why
 * the address key exists alongside it: someone rotating a forged IP still runs
 * into the per-address counter. Never used for anything but throttling.
 */
async function clientIp(): Promise<string> {
  const headerList = await headers()
  const forwarded = headerList.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return headerList.get('x-real-ip') ?? 'unknown'
}

const signInSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
})

export async function signInWithPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  // A malformed submission fails exactly like a wrong password. There is no
  // shortcut out of this function that is faster or more informative than any
  // other. BUILD_SPEC §22 AC18.
  const email = parsed.success ? parsed.data.email : String(formData.get('email') ?? '')
  const password = parsed.success ? parsed.data.password : ''

  const result = await attemptPasswordSignIn(
    { email, password, ip: await clientIp() },
    { store: drizzleCredentialStore(), rateLimit: signInRateLimitStore() },
  )

  if (!result.ok) {
    // Audited with the real reason. Shown with the generic one.
    await audit({
      actor: { kind: 'system', label: 'sign-in' },
      entityType: 'access',
      entityId: null,
      action: 'access.sign_in_refused',
      metadata: {
        outcome: result.reason,
        detail: result.detail,
        attemptedEmail: email.trim().toLowerCase() || null,
      },
    })

    if (result.reason === 'LOCKED') return actionError(SIGN_IN_LOCKED_MESSAGE)
    if (result.reason === 'UNAVAILABLE') return actionError(SIGN_IN_UNAVAILABLE_MESSAGE)
    return actionError(SIGN_IN_FAILED_MESSAGE)
  }

  await createAdminSession(result.userId)

  await audit({
    actor: { kind: 'user', id: result.userId, label: result.email },
    entityType: 'user',
    entityId: result.userId,
    action: 'access.sign_in',
    metadata: { method: 'password', role: result.role },
  })

  redirect('/admin')
}

export async function signOutAction(): Promise<void> {
  const session = await readAdminSession()

  if (session) {
    await audit({
      actor: { kind: 'user', id: session.userId, label: 'signed-out administrator' },
      entityType: 'user',
      entityId: session.userId,
      action: 'access.sign_out',
    })
  }

  await destroyAdminSession()
  redirect('/signin')
}

// ---------------------------------------------------------------------------
// Operator invites
// ---------------------------------------------------------------------------

const emailSchema = z.object({
  email: z.email('Enter a valid email address.'),
})

export async function issueOperatorInviteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = emailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    return actionError('That address could not be read.', {
      email: parsed.error.issues[0]?.message ?? 'Enter a valid email address.',
    })
  }

  try {
    const invite = await issueOperatorInvite({ owner, email: parsed.data.email })
    const base = env().APP_URL.replace(/\/+$/, '')
    revalidatePath('/admin/invites')
    return actionOk(
      `Invitation issued for ${invite.email}. It can be used once, by that address, ` +
        `within ${OPERATOR_INVITE_TTL_HOURS} hours. Send it over a channel you trust.`,
      `${base}/admin/invite/accept?token=${encodeURIComponent(invite.token)}`,
    )
  } catch (error) {
    return actionError(
      error instanceof Error
        ? error.message
        : 'The invitation could not be issued. Nothing was changed.',
    )
  }
}

const inviteIdSchema = z.object({ inviteId: z.string().min(1) })

export async function revokeOperatorInviteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owner = await requireOwner()

  const parsed = inviteIdSchema.safeParse({ inviteId: formData.get('inviteId') })
  if (!parsed.success) {
    return actionError('That invitation could not be identified.')
  }

  const revoked = await revokeOperatorInvite({ owner, inviteId: parsed.data.inviteId })
  revalidatePath('/admin/invites')

  return revoked
    ? actionOk('Invitation revoked. Its link no longer works.')
    : actionError(
        'That invitation was already used, already revoked, or no longer exists. Nothing was changed.',
      )
}

/**
 * Deliberately identical wording for an unknown token and a token belonging to
 * someone else — presenting a stolen invite must not confirm that it was real.
 */
const REFUSAL_MESSAGES: Record<InviteRefusal, string> = {
  NOT_FOUND: 'This invitation is not valid for the account you are signed in as.',
  WRONG_ACCOUNT: 'This invitation is not valid for the account you are signed in as.',
  REVOKED: 'This invitation has been revoked. Ask the owner to issue a new one.',
  ALREADY_USED: 'This invitation has already been used. It works exactly once.',
  EXPIRED: 'This invitation has expired. Ask the owner to issue a new one.',
}

const tokenSchema = z.object({ token: z.string().min(1) })

export async function acceptOperatorInviteAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAdmin()

  const parsed = tokenSchema.safeParse({ token: formData.get('token') })
  if (!parsed.success) {
    return actionError(REFUSAL_MESSAGES.NOT_FOUND)
  }

  const result = await acceptOperatorInvite({ user, token: parsed.data.token })
  if (!result.ok) {
    return actionError(REFUSAL_MESSAGES[result.reason])
  }

  redirect('/admin/onboarding')
}
