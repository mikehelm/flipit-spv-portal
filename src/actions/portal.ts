'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { offers } from '@/db/schema'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { canRespond, SIGN_IN_ACCEPTED_MESSAGE } from '@/lib/portal/access'
import { requestSignInLink, SIGN_IN_TOKEN_TTL_MINUTES } from '@/lib/portal/claim'
import { deliverSignInLink } from '@/lib/portal/send-sign-in-link'
import {
  EMAIL_CHANGE_READ_ONLY_MESSAGE,
  EMAIL_CHANGE_REQUESTED_MESSAGE,
  EMAIL_CHANGE_SAME_ADDRESS_MESSAGE,
  EMAIL_CHANGE_TOKEN_TTL_MINUTES,
  EMAIL_CHANGE_UNREADABLE_MESSAGE,
  requestEmailChange,
} from '@/lib/portal/email-change'
import { deliverEmailChangeLink } from '@/lib/portal/send-email-change-link'
import { loadPortalView } from '@/lib/portal/data'
import { destroyInvestorSession, readInvestorAccount } from '@/lib/portal/session'
import { isoToday } from '@/lib/money'

/**
 * Investor-facing actions. BUILD_SPEC §4, §6.
 *
 * Two rules run through all of these:
 *
 *   1. The account comes from the session, never from the form. There is no
 *      parameter anywhere in this file naming whose record to act on.
 *   2. No response, and no error, distinguishes one investor's situation from
 *      another's — or reveals that another investor exists at all.
 */

const emailSchema = z.object({ email: z.string().max(320) })

/**
 * Request a fresh sign-in link.
 *
 * Returns the same sentence whatever happened: address unknown, account
 * suspended, account archived, service disabled, or a link genuinely on its
 * way. §4.1 and PORTAL_COPY are explicit that the unknown-address response must
 * be identical to the known-address one, and the other refusals are "unknown"
 * as far as anybody outside is concerned.
 */
export async function requestSignInLinkAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailSchema.safeParse({ email: formData.get('email') })

  // Even a malformed submission gets the same answer. An early return with a
  // different message would be a way to tell valid addresses from invalid ones.
  if (parsed.success) {
    const outcome = await requestSignInLink({ email: parsed.data.email })

    if (outcome.issued && outcome.token) {
      await audit({
        actor: { kind: 'investor', id: outcome.accountId!, label: 'investor' },
        entityType: 'investor_account',
        entityId: outcome.accountId,
        action: 'portal.sign_in_link_requested',
      })

      // `after` runs once the response has been sent, and that placement is
      // the point rather than a performance nicety.
      //
      // `requestSignInLink` pads every path to a fixed floor precisely so that
      // a known address cannot be told from an unknown one by timing. Awaiting
      // an SMTP round trip here would undo all of it: the issued path would
      // take seconds and the other two would not, which is a far louder signal
      // than the one that was just closed. So the sentence goes back
      // immediately, identically, and the delivery happens afterwards.
      //
      // The token is passed straight through and never returned to the browser,
      // never logged, and never written anywhere but the email itself.
      const token = outcome.token
      const accountId = outcome.accountId!
      after(async () => {
        await deliverSignInLink({
          accountId,
          token,
          expiresInMinutes: SIGN_IN_TOKEN_TTL_MINUTES,
        })
      })
    }
  }

  return actionOk(SIGN_IN_ACCEPTED_MESSAGE)
}

const emailChangeSchema = z.object({ newEmail: z.string().max(320) })

/**
 * Ask to move the contact address on this account. §13.
 *
 * The account comes from the session; the form carries only the address to move
 * to. Three of the outcomes return the same sentence — issued, address already
 * held by another record, and account gone — for the reason set out in
 * `email-change.ts`: a signed-in investor who could tell an available address
 * from a taken one could walk a list of addresses and learn who else was
 * invited into a private round.
 *
 * The two that get their own sentence are the two that reveal nothing. "That is
 * already your address" is about a value already on the screen in front of
 * them, and "that is not an address we can send to" is about what they just
 * typed.
 */
export async function requestEmailChangeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const account = await readInvestorAccount()
  if (!account) redirect('/portal/signin')

  const view = await loadPortalView(account.id)
  if (!view) redirect('/portal/signin')

  const parsed = emailChangeSchema.safeParse({ newEmail: formData.get('newEmail') })
  if (!parsed.success) {
    return actionError(EMAIL_CHANGE_UNREADABLE_MESSAGE)
  }

  const outcome = await requestEmailChange({
    accountId: account.id,
    newEmail: parsed.data.newEmail,
  })

  if (outcome.detail === 'UNREADABLE') return actionError(EMAIL_CHANGE_UNREADABLE_MESSAGE)
  if (outcome.detail === 'SAME_ADDRESS') return actionError(EMAIL_CHANGE_SAME_ADDRESS_MESSAGE)
  if (outcome.detail === 'NOT_PERMITTED') return actionError(EMAIL_CHANGE_READ_ONLY_MESSAGE)

  if (outcome.issued && outcome.token && outcome.requestId) {
    // `after`, so the sentence goes back immediately and identically whether or
    // not there was an email to send. Awaiting an SMTP round trip on the issued
    // path and not on the collision path would tell the two apart by latency,
    // which is the leak the identical sentence exists to close.
    //
    // The token is passed straight through: never returned to the browser,
    // never logged, and never written anywhere but the email itself.
    const token = outcome.token
    const requestId = outcome.requestId
    after(async () => {
      await deliverEmailChangeLink({
        requestId,
        token,
        expiresInMinutes: EMAIL_CHANGE_TOKEN_TTL_MINUTES,
      })
    })
  }

  revalidatePath('/portal')
  return actionOk(EMAIL_CHANGE_REQUESTED_MESSAGE)
}

export async function portalSignOutAction(): Promise<void> {
  await destroyInvestorSession()
  redirect('/portal/signin')
}

const responseSchema = z.object({
  offerId: z.string().min(1),
  choice: z.enum(['INTERESTED', 'NOT_INTERESTED', 'QUESTION']),
  note: z.string().max(2000).optional(),
})

/**
 * Record or change a response. §6, PORTAL_COPY.
 *
 * Changeable until the deadline. The deadline is a date, not a timestamp, and
 * the edge resolves in the investor's favour: a deadline of the tenth is still
 * open all through the tenth.
 */
export async function recordResponseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const account = await readInvestorAccount()
  if (!account) redirect('/portal/signin')

  const view = await loadPortalView(account.id)
  if (!view) redirect('/portal/signin')

  if (!canRespond(view.access)) {
    return actionError(
      'This portal is currently read-only. You can view your record and download your ' +
        'documents, but responses are not being accepted at this time.',
    )
  }

  const parsed = responseSchema.safeParse({
    offerId: formData.get('offerId'),
    choice: formData.get('choice'),
    note: formData.get('note') ?? undefined,
  })
  if (!parsed.success) {
    return actionError('That response could not be read. Nothing was changed.')
  }

  // The offer must be one of this account's own. Looking it up within the
  // session's own view rather than by id alone is what makes a guessed id
  // useless — and the refusal is worded so it does not confirm that some other
  // record exists under that id.
  const offer = view.offers.find((row) => row.offerId === parsed.data.offerId)
  if (!offer) {
    return actionError('That response could not be recorded. Nothing was changed.')
  }

  if (offer.responseDeadline < isoToday()) {
    return actionError(
      `The deadline for this response was ${offer.responseDeadline}, so it can no longer be ` +
        'changed here. If you need to say something, use the questions section below and ' +
        'David will pick it up.',
    )
  }

  const note = parsed.data.note?.trim() ?? ''

  await db
    .update(offers)
    .set({
      responseChoice: parsed.data.choice,
      responseNote: note === '' ? null : note,
      responseAt: new Date(),
      // §5 step 2. The stage only ever moves forward, and only from step 1.
      ...(offer.stage === 'INVITATION_SENT' ? { stage: 'RESPONSE_RECORDED' as const } : {}),
    })
    .where(eq(offers.id, offer.offerId))

  await audit({
    actor: { kind: 'investor', id: account.id, label: 'investor' },
    entityType: 'offer',
    entityId: offer.offerId,
    action: 'portal.response_recorded',
    // The choice, never the message the investor wrote.
    metadata: { choice: parsed.data.choice, hasNote: note !== '' },
  })

  revalidatePath('/portal')

  return actionOk(
    'Thank you. Your response has been recorded. You may update it through this private ' +
      `portal until ${offer.responseDeadline}.`,
  )
}
