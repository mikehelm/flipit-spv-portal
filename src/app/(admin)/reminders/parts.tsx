'use client'

import { useState } from 'react'
import {
  cancelManyAction,
  cancelReminderAction,
  refreshQueueAction,
  rescheduleReminderAction,
  updateScheduleAction,
} from '@/actions/reminders'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, TextInput } from '@/components/admin/ui'

/** The operator's reminder controls. BUILD_SPEC §6.5. */

export function ScheduleForm({
  daysBefore,
  maxPerRecipient,
  enabled,
}: {
  daysBefore: number[]
  maxPerRecipient: number
  enabled: boolean
}) {
  return (
    <ActionForm action={updateScheduleAction} submitLabel="Save the schedule">
      <Field
        label="Days before the deadline"
        name="daysBefore"
        hint="A comma-separated list. The default is 7, 2 — a week out, then a nudge two days before."
      >
        <TextInput name="daysBefore" defaultValue={daysBefore.join(', ')} required />
      </Field>

      <Field
        label="Maximum per recipient"
        name="maxPerRecipient"
        hint="A hard limit. Nobody is ever sent more than this, whatever the list above says — if the list is longer, the reminders nearest the deadline are dropped."
      >
        <TextInput
          name="maxPerRecipient"
          type="number"
          min={0}
          max={10}
          defaultValue={String(maxPerRecipient)}
          required
        />
      </Field>

      <div className="mb-4 rounded-sm border hairline bg-bg2 p-4">
        <Checkbox
          name="enabled"
          label="Send reminders for this round."
          defaultChecked={enabled}
        />
        <p className="mt-2 text-xs leading-relaxed text-dim">
          Switching this off stops every queued reminder without deleting the queue, so you can
          still see what would have gone out.
        </p>
      </div>
    </ActionForm>
  )
}

export function RefreshButton() {
  return (
    <ActionForm action={refreshQueueAction} submitLabel="Rebuild the queue" tone="quiet" />
  )
}

export function CancelButton({ reminderId }: { reminderId: string }) {
  return (
    <ActionForm
      action={cancelReminderAction}
      submitLabel="Cancel"
      tone="quiet"
      hidden={{ reminderId }}
    />
  )
}

export function RescheduleForm({
  reminderId,
  scheduledFor,
}: {
  reminderId: string
  scheduledFor: string
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
      >
        Move it
      </button>
    )
  }

  return (
    <div className="w-full rounded-sm border hairline bg-bg2 p-3">
      <ActionForm
        action={rescheduleReminderAction}
        submitLabel="Move it"
        tone="quiet"
        hidden={{ reminderId }}
      >
        <Field
          label="New time (UTC)"
          name="scheduledFor"
          hint="Must be in the future, and not after their response deadline."
        >
          <TextInput
            name="scheduledFor"
            type="datetime-local"
            defaultValue={scheduledFor}
            required
          />
        </Field>
      </ActionForm>
    </div>
  )
}

/**
 * Cancel several at once. §6.5 allows this — "individually or in bulk" — and it
 * removes messages rather than creating them, which is why it is not the bulk
 * send §14 forbids.
 */
export function CancelManyForm({
  reminders,
}: {
  reminders: Array<{ id: string; label: string }>
}) {
  if (reminders.length === 0) return null

  return (
    <ActionForm action={cancelManyAction} submitLabel="Cancel the selected" tone="danger">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-silver2">
          Select the ones to cancel
        </legend>
        {reminders.map((reminder) => (
          <div key={reminder.id} className="mb-2">
            <Checkbox
              name="reminderIds"
              value={reminder.id}
              id={`cancel-${reminder.id}`}
              label={reminder.label}
            />
          </div>
        ))}
      </fieldset>
    </ActionForm>
  )
}
