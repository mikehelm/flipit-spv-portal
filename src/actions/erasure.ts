'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { currentAdmin } from '@/lib/auth/guards'
import { auditErasureRefusal, eraseAccount, previewErasure } from '@/lib/erasure/erase'
import {
  authorizeErasureAction,
  erasureActionLabel,
  type ErasureAction,
} from '@/lib/erasure/authority'

/**
 * Erasing an investor's personal data. OPEN_DECISIONS.md item 12.
 *
 * `/privacy` promises an investor that they can ask for their record to be
 * removed and that "it will be dealt with by a person rather than a form". It
 * still is — this is not a self-service button and no investor can reach it.
 * What has changed is that the person now has a procedure instead of a psql
 * prompt.
 *
 * **The authorization shape is copied from `compliance.ts` on purpose.** The
 * other owner-only actions in this codebase use `requireOwner()`, which throws
 * a redirect: an operator who tries is bounced to `/admin/no-access` with no
 * explanation. That is right for a screen they should not have opened. It is
 * wrong here, because a destructive action that refuses should say what it
 * refused and why, in a sentence, on the screen they were already looking at.
 * So the refusal comes back as an `ActionState`, and it is audited either way.
 *
 * **There is no reason field.** Every other consequential action in this
 * application demands one; this one deliberately does not. An erasure is the
 * one moment when new prose about a person must not enter the record — a
 * free-text box at the top of a form that empties every other free-text box is
 * a hole in the middle of the thing. What is required instead is the account's
 * own email address, typed out, and an acknowledgement that this cannot be
 * undone. Who did it and when is on the audit row.
 */

const INVESTORS_PATH = '/investors'

async function authorize(
  action: ErasureAction,
  accountId: string | null,
): Promise<{ ok: true; admin: { id: string; email: string; role: 'OWNER' } } | { ok: false; state: ActionState }> {
  const admin = await currentAdmin()
  const decision = authorizeErasureAction(admin?.role ?? null, action)

  if (decision.allowed && admin) {
    return { ok: true, admin: { id: admin.id, email: admin.email, role: 'OWNER' } }
  }

  await auditErasureRefusal(admin ? { id: admin.id, label: admin.email } : null, accountId, {
    attemptedAction: action,
    attemptedLabel: erasureActionLabel(action),
    refusalReason: decision.allowed ? 'NOT_OWNER' : decision.reason,
    actorRole: admin?.role ?? null,
    requiredRole: 'OWNER',
  })

  return {
    ok: false,
    state: actionError(
      decision.allowed ? 'Only the owner can erase an investor’s record.' : decision.message,
    ),
  }
}

const eraseSchema = z.object({
  accountId: z.string().min(1),
  /**
   * The account's own address, typed out. The precedent is `send.ts`, where
   * confirming a send means typing the recipient. A word like ERASE confirms
   * that a click happened; the address confirms *which row*, which is the
   * mistake worth preventing on a screen that lists forty of them.
   */
  confirmation: z.string().min(1),
  acknowledged: z.literal(true, {
    message: 'Tick the box to confirm you understand this cannot be undone. Nothing was changed.',
  }),
})

export async function eraseInvestorAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const accountIdRaw = formData.get('accountId')
  const accountId = typeof accountIdRaw === 'string' && accountIdRaw !== '' ? accountIdRaw : null

  const auth = await authorize('ERASE', accountId)
  if (!auth.ok) return auth.state

  const parsed = eraseSchema.safeParse({
    accountId: formData.get('accountId'),
    confirmation: formData.get('confirmation') ?? '',
    acknowledged: formData.get('acknowledged') === 'on',
  })

  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ??
        'That request could not be read, so nothing was changed.',
    )
  }

  const preview = await previewErasure(parsed.data.accountId)
  if (!preview) {
    return actionError('That account could not be found. Nothing was changed.')
  }

  if (preview.alreadyErased) {
    return actionError(
      'That account has already been erased. Nothing was changed.',
    )
  }

  if (parsed.data.confirmation.trim().toLowerCase() !== preview.email.trim().toLowerCase()) {
    await auditErasureRefusal({ id: auth.admin.id, label: auth.admin.email }, preview.accountId, {
      refusalReason: 'CONFIRMATION_DID_NOT_MATCH',
    })
    return actionError(
      'The address you typed does not match the account. Nothing was changed. Type the ' +
        'address exactly as it appears above — it is what confirms which row you meant.',
    )
  }

  if (preview.blockedBy) {
    return actionError(preview.blockedBy)
  }

  const result = await eraseAccount({
    accountId: preview.accountId,
    actor: { id: auth.admin.id, email: auth.admin.email, name: null, role: 'OWNER' },
  })

  revalidatePath(INVESTORS_PATH)

  if (!result.ok) return actionError(result.message)

  return actionOk(
    `Erased. The record is now held under ${result.pseudonym}: every name, address and ` +
      `line of free text is gone, and ${result.offersAffected} offer` +
      `${result.offersAffected === 1 ? '' : 's'} remain as figures with no person attached. ` +
      (result.objectsDestroyed > 0
        ? `${result.objectsDestroyed} stored file${result.objectsDestroyed === 1 ? ' was' : 's were'} ` +
          'destroyed and cannot be recovered. '
        : '') +
      `${result.auditRowsRelabelled} audit row${result.auditRowsRelabelled === 1 ? '' : 's'} ` +
      'now carry the pseudonym; not one was removed. The account is archived, every session ' +
      'has ended and every unspent link is revoked.',
  )
}
