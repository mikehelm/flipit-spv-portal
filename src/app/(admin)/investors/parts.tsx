'use client'

import { useState } from 'react'
import { changeAccountStatusAction } from '@/actions/accounts'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, Select, TextArea, TextInput } from '@/components/admin/ui'

/**
 * Changing one account's state. BUILD_SPEC §4.2.
 *
 * Three things are required before anything happens, and each guards against a
 * different mistake:
 *
 *   - **The destination**, chosen from a list, because the five states are the
 *     five states.
 *   - **A reason**, at least ten characters, because it goes on the investor's
 *     own record and a record of something happening with no record of why is
 *     the half that is not worth keeping.
 *   - **The word typed out.** Suspension and closure end somebody's access to
 *     the record of money they may already have sent. A click on the wrong row
 *     looks exactly like a click on the right one; typing SUSPEND does not.
 *
 * The server re-checks all three. What is on this screen is manners.
 */

const CONSEQUENCE: Readonly<Record<string, string>> = {
  INVITED:
    'Back to invited. Their claim link becomes the way in again. Nothing they have already done is lost.',
  ACTIVE:
    'Restores full access. Any session or link revoked earlier stays revoked — they sign in again the ordinary way.',
  SUSPENDED:
    'Ends every session they hold, immediately, and revokes every unspent link. Asking for a new link is accepted politely and produces nothing. Reversible.',
  CLOSED:
    'Ends every session and link. By default they can still sign back in and read their own record — an investor who has sent money should not lose the record of it. That default is on the settings page.',
  ARCHIVED:
    'Ends every session and link, and no sign-in link is ever issued again. Owner only.',
}

export function ChangeStatusForm({
  accountId,
  currentStatus,
  liveSessions,
  liveLinks,
}: {
  accountId: string
  currentStatus: string
  liveSessions: number
  liveLinks: number
}) {
  const options = ['INVITED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED'].filter(
    (status) => status !== currentStatus,
  )

  const [to, setTo] = useState(options[0] ?? 'SUSPENDED')

  const ends = to === 'SUSPENDED' || to === 'CLOSED' || to === 'ARCHIVED'

  return (
    <ActionForm
      action={changeAccountStatusAction}
      submitLabel={`Move to ${to.toLowerCase()}`}
      tone={ends ? 'danger' : 'quiet'}
      hidden={{ accountId }}
    >
      <Field label="New status" name="to">
        <Select
          name="to"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          options={options.map((status) => ({
            value: status,
            label: status.charAt(0) + status.slice(1).toLowerCase(),
          }))}
        />
      </Field>

      <p className="mb-4 border-l-2 border-[#F59A23] pl-3 text-xs leading-relaxed text-[#9498b5]">
        {CONSEQUENCE[to]}
        {ends && (liveSessions > 0 || liveLinks > 0) ? (
          <>
            {' '}
            <span className="text-[#e7e9f5]">
              Right now that is {liveSessions} live session{liveSessions === 1 ? '' : 's'} and{' '}
              {liveLinks} unspent link{liveLinks === 1 ? '' : 's'}.
            </span>
          </>
        ) : null}
      </p>

      <Field
        label="Reason"
        name="reason"
        hint="At least ten characters. It goes on the investor's own record, with your name and the time."
      >
        <TextArea name="reason" rows={3} />
      </Field>

      <div className="mb-4">
        <Checkbox
          name="investorNotified"
          id={`notified-${accountId}`}
          label="I have told the investor about this change"
        />
        <p className="mt-2 pl-7 text-xs leading-relaxed text-[#9498b5]">
          Recorded either way. This application sends nothing on a status change — telling them
          is an update or an email you write deliberately.
        </p>
      </div>

      <Field
        label={`Type ${to} to confirm`}
        name="confirmation"
        hint="The word is what confirms which change you meant."
      >
        <TextInput name="confirmation" autoComplete="off" spellCheck={false} />
      </Field>
    </ActionForm>
  )
}
