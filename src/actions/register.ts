'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { currentAdmin } from '@/lib/auth/guards'
import { optionalText, requiredText, zodFieldErrors } from '@/lib/form-values'
import { loadPortalView } from '@/lib/portal/data'
import { readInvestorAccount } from '@/lib/portal/session'
import { canManageQa } from '@/lib/qa/authority'
import {
  JOINED_CONFIRMATION,
  LEFT_CONFIRMATION,
} from '@/lib/register/copy'
import {
  REGISTER_PATH,
  addToRegisterManually,
  clearOrderOverride,
  issueOfferFromRegister,
  joinRegister,
  leaveRegister,
  setOrderOverride,
} from '@/lib/register/service'

/**
 * The register of interest. BUILD_SPEC §5.2.
 *
 * The investor half takes its account from the session and never from the
 * form, and returns nothing about anybody else — not a position, not a count,
 * not a total. §5.2.2 is explicit: "No one sees their own position or anyone
 * else's."
 *
 * The admin half is the operator's and the owner's. It re-checks the role on
 * every call and writes a refused attempt to the audit log before returning it.
 */

const PORTAL_PATH = '/portal'

interface Authorized {
  ok: true
  admin: { id: string; email: string }
}

async function authorize(action: string): Promise<Authorized | { ok: false; state: ActionState }> {
  const admin = await currentAdmin()

  if (admin && canManageQa(admin.role)) {
    return { ok: true, admin: { id: admin.id, email: admin.email } }
  }

  await audit({
    actor: admin
      ? { kind: 'user', id: admin.id, label: admin.email }
      : { kind: 'system', label: 'unauthenticated' },
    entityType: 'interest_register',
    entityId: null,
    action: 'register.refused',
    metadata: { attemptedAction: action },
  })

  return {
    ok: false,
    state: actionError(
      'You are not signed in as an administrator, so you cannot change the register. Sign in ' +
        'first. Nothing has been changed.',
    ),
  }
}

// ---------------------------------------------------------------------------
// The investor — joining and leaving (§5.2.3)
// ---------------------------------------------------------------------------

const joinSchema = z.object({
  indicativeAmount: z.string().trim().max(40).nullable(),
})

export async function joinRegisterAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const account = await readInvestorAccount()
  if (!account) redirect('/portal/signin')

  const view = await loadPortalView(account.id)
  if (!view) redirect('/portal/signin')

  if (view.access.capability !== 'FULL') {
    return actionError(
      'This portal is currently read-only, so the register cannot be changed at this time. ' +
        'Nothing about your existing record has changed.',
    )
  }

  const parsed = joinSchema.safeParse({
    indicativeAmount: optionalText(formData.get('indicativeAmount')),
  })
  if (!parsed.success) {
    return actionError('That could not be read.', zodFieldErrors(parsed.error))
  }

  const result = await joinRegister({
    accountId: account.id,
    indicativeAmount: parsed.data.indicativeAmount,
    actor: { kind: 'investor', id: account.id, label: 'investor' },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(PORTAL_PATH)
  return actionOk(JOINED_CONFIRMATION)
}

export async function leaveRegisterAction(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const account = await readInvestorAccount()
  if (!account) redirect('/portal/signin')

  const view = await loadPortalView(account.id)
  if (!view) redirect('/portal/signin')

  if (view.access.capability !== 'FULL') {
    return actionError(
      'This portal is currently read-only, so the register cannot be changed at this time.',
    )
  }

  const result = await leaveRegister({
    accountId: account.id,
    actor: { kind: 'investor', id: account.id, label: 'investor' },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(PORTAL_PATH)
  return actionOk(LEFT_CONFIRMATION)
}

// ---------------------------------------------------------------------------
// The operator — manual add (§5.2.3)
// ---------------------------------------------------------------------------

const addSchema = z.object({
  name: z.string().trim().min(1, 'A name is needed.').max(200),
  email: z.email('Enter a valid email address.'),
  indicativeAmount: z.string().trim().max(40).nullable(),
})

export async function addToRegisterAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('ADD')
  if (!auth.ok) return auth.state

  const parsed = addSchema.safeParse({
    name: requiredText(formData.get('name')),
    email: requiredText(formData.get('email')),
    indicativeAmount: optionalText(formData.get('indicativeAmount')),
  })
  if (!parsed.success) {
    return actionError('That could not be added.', zodFieldErrors(parsed.error))
  }

  const result = await addToRegisterManually({
    name: parsed.data.name,
    email: parsed.data.email,
    indicativeAmount: parsed.data.indicativeAmount,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(REGISTER_PATH)

  return actionOk(
    result.createdAccount
      ? 'Added. They had no record here before, so an account was created for them in the ' +
          '"invited" state — it cannot be signed into until an invitation is issued and claimed.'
      : 'Added to the register against their existing record.',
  )
}

// ---------------------------------------------------------------------------
// The operator — order overrides (§5.2.2)
// ---------------------------------------------------------------------------

const overrideSchema = z.object({
  accountId: z.string().min(1),
  position: z.coerce
    .number()
    .int('A position is a whole number.')
    .min(1, 'Positions count from one.')
    .max(10000),
  reason: z.string().trim().min(10, 'Record why. There should be a trail.').max(2000),
})

export async function setOrderOverrideAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('OVERRIDE')
  if (!auth.ok) return auth.state

  const parsed = overrideSchema.safeParse({
    accountId: requiredText(formData.get('accountId')),
    position: requiredText(formData.get('position')),
    reason: requiredText(formData.get('reason')),
  })
  if (!parsed.success) {
    return actionError('The override was not applied.', zodFieldErrors(parsed.error))
  }

  const result = await setOrderOverride({
    accountId: parsed.data.accountId,
    position: parsed.data.position,
    reason: parsed.data.reason,
    actorUserId: auth.admin.id,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(REGISTER_PATH)
  return actionOk('Order overridden. The reason is recorded and shown beside their name.')
}

export async function clearOrderOverrideAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('CLEAR_OVERRIDE')
  if (!auth.ok) return auth.state

  const accountId = requiredText(formData.get('accountId'))
  if (accountId === '') return actionError('That person could not be found.')

  await clearOrderOverride({
    accountId,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })

  revalidatePath(REGISTER_PATH)
  return actionOk('Override removed. They are back in the computed order.')
}

// ---------------------------------------------------------------------------
// The operator — issuing an offer (§5.2.3, §5.2.4)
// ---------------------------------------------------------------------------

const issueSchema = z.object({
  accountId: z.string().min(1),
  jurisdiction: z.string().trim().length(2, 'Use the two-letter country code.'),
  investmentAmountUsd: z.string().trim().min(1, 'An amount is needed.').max(40),
  spvPercentage: z.string().trim().min(1, 'An SPV percentage is needed.').max(40),
  responseDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.'),
  senderName: z.string().trim().max(200).nullable(),
  senderEmail: z.string().trim().max(320).nullable(),
  senderPhone: z.string().trim().max(60).nullable(),
  internalNotes: z.string().trim().max(2000).nullable(),
})

/**
 * Create an ordinary offer for somebody on the register.
 *
 * It does not send. The offer appears in the review screen as a draft and goes
 * out one recipient at a time behind the pre-flight checklist, through the
 * compliance gate, exactly like an imported one (§5.2.4, §14).
 */
export async function issueOfferFromRegisterAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await authorize('ISSUE_OFFER')
  if (!auth.ok) return auth.state

  const parsed = issueSchema.safeParse({
    accountId: requiredText(formData.get('accountId')),
    jurisdiction: requiredText(formData.get('jurisdiction')),
    investmentAmountUsd: requiredText(formData.get('investmentAmountUsd')),
    spvPercentage: requiredText(formData.get('spvPercentage')),
    responseDeadline: requiredText(formData.get('responseDeadline')),
    senderName: optionalText(formData.get('senderName')),
    senderEmail: optionalText(formData.get('senderEmail')),
    senderPhone: optionalText(formData.get('senderPhone')),
    internalNotes: optionalText(formData.get('internalNotes')),
  })
  if (!parsed.success) {
    return actionError('The offer was not created.', zodFieldErrors(parsed.error))
  }

  const result = await issueOfferFromRegister({
    ...parsed.data,
    actor: { kind: 'user', id: auth.admin.id, label: auth.admin.email },
  })
  if (!result.ok) return actionError(result.message)

  revalidatePath(REGISTER_PATH)
  revalidatePath('/recipients')

  if (result.blocked) {
    return actionOk(
      'The offer was created and is blocked by the jurisdiction gate, exactly as an imported ' +
        `row in the same country would be. ${result.blockDetail ?? ''} Nothing has been sent, ` +
        'and no other recipient is affected.',
    )
  }

  return actionOk(
    'The offer was created as a draft. Nothing has been sent — it now sits in Review and send ' +
      'with every other recipient and goes out one at a time behind the pre-flight checklist.',
  )
}
