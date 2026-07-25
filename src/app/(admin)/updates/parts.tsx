'use client'

import { useState } from 'react'
import {
  createDraftAction,
  deleteDraftAction,
  editDraftAction,
  notifyRecipientAction,
  publishUpdateAction,
  withdrawUpdateAction,
} from '@/actions/updates'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, Select, TextArea, TextInput } from '@/components/admin/ui'
import { NON_ADDRESSABLE_NOTE, type UpdateAudience } from '@/lib/updates/audience'
import { WITHDRAWAL_NOTICE } from '@/lib/updates/copy'

/**
 * The operator's update surfaces. BUILD_SPEC §6.
 *
 * Draft, preview, publish, withdraw, notify — five buttons, and none of them
 * does two of those things. In particular publishing does not send: §14 forbids
 * a bulk send anywhere, and a notification that reached forty people from one
 * press is a bulk send whatever the button says.
 */

export interface AccountOption {
  id: string
  name: string
  email: string
  status: string
}

function AudienceChooser({
  accounts,
  initial,
}: {
  accounts: AccountOption[]
  initial: UpdateAudience
}) {
  const [kind, setKind] = useState<UpdateAudience['kind']>(initial.kind)

  return (
    <div className="mb-4">
      <Field
        label="Audience"
        name="audienceKind"
        hint={NON_ADDRESSABLE_NOTE}
      >
        <Select
          name="audienceKind"
          value={kind}
          onChange={(event) => setKind(event.target.value as UpdateAudience['kind'])}
          options={[
            { value: 'ALL', label: 'Everyone who can read the portal' },
            { value: 'STATUS', label: 'A subset, by account status' },
            { value: 'ONE', label: 'One investor' },
          ]}
        />
      </Field>

      {kind === 'STATUS' ? (
        <fieldset className="mb-4 rounded-sm border hairline bg-bg2 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-silver2">
            Statuses
          </legend>
          {(['INVITED', 'ACTIVE', 'CLOSED'] as const).map((status) => (
            <div key={status} className="mb-2">
              <Checkbox
                name="statuses"
                value={status}
                id={`status-${status}`}
                label={status.charAt(0) + status.slice(1).toLowerCase()}
                defaultChecked={
                  initial.kind === 'STATUS' && initial.statuses.includes(status)
                }
              />
            </div>
          ))}
        </fieldset>
      ) : null}

      {kind === 'ONE' ? (
        <Field label="Investor" name="audienceAccountId">
          <Select
            name="audienceAccountId"
            defaultValue={initial.kind === 'ONE' ? initial.accountId : ''}
            options={[
              { value: '', label: 'Choose one…' },
              ...accounts.map((account) => ({
                value: account.id,
                label: `${account.name} — ${account.email} (${account.status.toLowerCase()})`,
              })),
            ]}
          />
        </Field>
      ) : null}
    </div>
  )
}

export function DraftForm({
  accounts,
  update,
}: {
  accounts: AccountOption[]
  update?: {
    id: string
    title: string
    body: string
    audience: UpdateAudience
    notifyByEmail: boolean
  }
}) {
  return (
    <ActionForm
      action={update ? editDraftAction : createDraftAction}
      submitLabel={update ? 'Save the draft' : 'Save as a draft'}
      hidden={update ? { updateId: update.id } : undefined}
    >
      <Field label="Title" name="title">
        <TextInput name="title" defaultValue={update?.title ?? ''} required maxLength={200} />
      </Field>

      <Field
        label="The update"
        name="body"
        hint="Written as you would say it. It appears in the portal exactly as typed."
      >
        <TextArea name="body" rows={8} defaultValue={update?.body ?? ''} required />
      </Field>

      <AudienceChooser accounts={accounts} initial={update?.audience ?? { kind: 'ALL' }} />

      <div className="mb-4 rounded-sm border hairline bg-bg2 p-4">
        <Checkbox
          name="notifyByEmail"
          label="Notify recipients by email once it is published."
          defaultChecked={update?.notifyByEmail ?? true}
        />
        <p className="mt-2 text-xs leading-relaxed text-dim">
          Ticking this does not send anything. Publishing lists the recipients and you send each
          notification yourself, one at a time — the same rule as invitations. The email says only
          that an update is available and links to the portal; it carries no amounts, no
          percentages and nothing personal.
        </p>
      </div>
    </ActionForm>
  )
}

export function PublishControls({ updateId }: { updateId: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ActionForm
        action={publishUpdateAction}
        submitLabel="Publish it"
        hidden={{ updateId }}
      />
      <ActionForm
        action={deleteDraftAction}
        submitLabel="Discard the draft"
        tone="quiet"
        hidden={{ updateId }}
      />
    </div>
  )
}

export function WithdrawForm({ updateId }: { updateId: string }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-sm border border-warn px-3 text-xs font-semibold text-warn transition-colors hover:bg-warn/10"
      >
        Withdraw this update
      </button>
    )
  }

  return (
    <div className="rounded-sm border border-warn/40 bg-warn/6 p-4">
      <p className="mb-3 text-xs leading-relaxed text-dim">{WITHDRAWAL_NOTICE}</p>
      <ActionForm
        action={withdrawUpdateAction}
        submitLabel="Withdraw it"
        tone="danger"
        hidden={{ updateId }}
      >
        <Field
          label="Reason"
          name="reason"
          hint="At least ten characters. It goes in the audit log, not on anybody’s screen."
        >
          <TextArea name="reason" rows={3} required minLength={10} />
        </Field>
      </ActionForm>
    </div>
  )
}

export function NotifyButton({
  updateId,
  accountId,
}: {
  updateId: string
  accountId: string
}) {
  return (
    <ActionForm
      action={notifyRecipientAction}
      submitLabel="Send the notification"
      tone="quiet"
      hidden={{ updateId, accountId }}
    />
  )
}
