'use client'

import { useState } from 'react'
import {
  closeRoundAction,
  extendOneDeadlineAction,
  extendRoundDeadlineAction,
  reopenRoundAction,
  sendRoundDigestAction,
} from '@/actions/rounds'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, TextArea, TextInput } from '@/components/admin/ui'
import { CLOSE_CONFIRMATION_NOTICE } from '@/lib/rounds/copy'

/** Closing and extending. BUILD_SPEC §6.6. */

export function ExtendAllForm({ roundId }: { roundId: string }) {
  return (
    <ActionForm
      action={extendRoundDeadlineAction}
      submitLabel="Extend for everyone who has not responded"
      hidden={{ roundId }}
    >
      <Field
        label="New deadline"
        name="newDeadline"
        hint="Only people who have not responded are moved. Somebody who already answered keeps the date they were given."
      >
        <TextInput name="newDeadline" type="date" required />
      </Field>
      <Field label="Reason" name="reason" hint="Optional, internal. Recorded in the audit log.">
        <TextArea name="reason" rows={2} />
      </Field>
    </ActionForm>
  )
}

export function ExtendOneForm({
  offerId,
  currentDeadline,
}: {
  offerId: string
  currentDeadline: string
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
      >
        Give them longer
      </button>
    )
  }

  return (
    <div className="w-full rounded-sm border hairline bg-bg2 p-3">
      <ActionForm
        action={extendOneDeadlineAction}
        submitLabel="Extend"
        tone="quiet"
        hidden={{ offerId }}
      >
        <Field
          label="New deadline"
          name="newDeadline"
          hint={`Currently ${currentDeadline}. This screen only extends — bringing a deadline forward would take away time they have already been told they have.`}
        >
          <TextInput name="newDeadline" type="date" defaultValue={currentDeadline} required />
        </Field>
        <Field label="Reason" name="reason" hint="Optional, internal.">
          <TextArea name="reason" rows={2} />
        </Field>
      </ActionForm>
    </div>
  )
}

export function CloseRoundForm({
  roundId,
  outstanding,
}: {
  roundId: string
  outstanding: number
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-sm border border-warn px-4 text-sm font-semibold text-warn transition-colors hover:bg-warn/10"
      >
        Close the round
      </button>
    )
  }

  return (
    <div className="rounded-sm border border-warn/40 bg-warn/6 p-4">
      <p className="mb-4 text-xs leading-relaxed text-dim">
        {CLOSE_CONFIRMATION_NOTICE}
      </p>

      <ActionForm
        action={closeRoundAction}
        submitLabel="Close it"
        tone="danger"
        hidden={{ roundId }}
      >
        <div className="mb-3">
          <Checkbox name="confirmed" label="I mean to close this round now." />
        </div>

        {outstanding > 0 ? (
          <div className="mb-3">
            <Checkbox
              name="closingEarly"
              label={`I understand ${outstanding} ${outstanding === 1 ? 'person still has' : 'people still have'} time left to respond, and closing ends that.`}
            />
          </div>
        ) : null}
      </ActionForm>
    </div>
  )
}

export function ReopenRoundForm({ roundId }: { roundId: string }) {
  return (
    <ActionForm
      action={reopenRoundAction}
      submitLabel="Reopen the round"
      tone="quiet"
      hidden={{ roundId }}
    >
      <Field
        label="Reason"
        name="reason"
        hint="At least ten characters, recorded in the audit log."
      >
        <TextArea name="reason" rows={3} required minLength={10} />
      </Field>
    </ActionForm>
  )
}

export function SendDigestForm({ roundId }: { roundId: string }) {
  return (
    <ActionForm
      action={sendRoundDigestAction}
      submitLabel="Send the summary to the operator now"
      tone="quiet"
      hidden={{ roundId }}
    />
  )
}
