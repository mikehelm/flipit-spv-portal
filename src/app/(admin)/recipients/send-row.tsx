'use client'

import { useState } from 'react'
import { sendInvitationAction } from '@/actions/send'
import { ActionForm } from '@/components/admin/action-form'
import { Field, TextInput } from '@/components/admin/ui'

/**
 * The per-recipient send control. BUILD_SPEC §14.
 *
 * Sending is one recipient at a time by design, so this is one form per row and
 * there is no "select all". The confirmation is the recipient's own address,
 * typed out — a checkbox confirms that you clicked, and typing the address
 * confirms which person you meant. On a securities invitation, those are
 * different questions.
 *
 * The action re-checks pre-flight, the compliance gate and the transport gate
 * on the server. Everything this component does is to slow the operator down at
 * the right moment.
 */
export function SendControl({
  offerId,
  recipientName,
  recipientEmail,
  alreadySent,
}: {
  offerId: string
  recipientName: string
  recipientEmail: string
  alreadySent: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-sm font-semibold text-[#e7e9f5] transition-colors hover:border-[#F59A23]"
      >
        {alreadySent ? 'Resend' : 'Send'}
      </button>
    )
  }

  return (
    <div className="w-full rounded-sm border hairline bg-[#0d0f2e] p-4">
      <p className="mb-3 text-sm leading-relaxed text-[#e7e9f5]">
        {alreadySent ? 'Send again to ' : 'Send the invitation to '}
        <span className="font-semibold">{recipientName}</span>. This is a real email
        containing a real, single-use portal link.
        {alreadySent
          ? ' They have already been sent one; a second invitation issues a fresh link.'
          : ''}
      </p>

      <ActionForm
        action={sendInvitationAction}
        submitLabel={alreadySent ? 'Send again' : 'Send now'}
        hidden={{ offerId }}
      >
        <Field
          label="Type their address to confirm"
          name={`confirmation-${offerId}`}
          hint={`Exactly as it appears in the row: ${recipientEmail}`}
        >
          <TextInput
            name="confirmation"
            id={`confirmation-${offerId}`}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </Field>
      </ActionForm>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-2 text-xs font-semibold text-[#9498b5] underline underline-offset-2"
      >
        Cancel
      </button>
    </div>
  )
}
