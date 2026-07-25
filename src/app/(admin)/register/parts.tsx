'use client'

import { useState } from 'react'
import {
  addToRegisterAction,
  clearOrderOverrideAction,
  issueOfferFromRegisterAction,
  setOrderOverrideAction,
} from '@/actions/register'
import { ActionForm } from '@/components/admin/action-form'
import { Field, TextArea, TextInput } from '@/components/admin/ui'
import { ISSUE_COMPLIANCE_NOTICE } from '@/lib/register/copy'
import { MIN_OVERRIDE_REASON_LENGTH } from '@/lib/register/order'

/**
 * The operator's register controls. BUILD_SPEC §5.2.2, §5.2.3.
 *
 * Every form here posts to a server action that re-checks the role and
 * re-applies the rule. In particular the override's reason is required by the
 * service function's signature, not only by the `required` attribute below — a
 * required field on a screen is something a future caller can route around.
 */

export function AddToRegisterForm() {
  return (
    <ActionForm action={addToRegisterAction} submitLabel="Add to the register">
      <Field label="Name" name="name">
        <TextInput name="name" required autoComplete="off" />
      </Field>
      <Field
        label="Email"
        name="email"
        hint="If this address has no record here, an account is created in the “invited” state. It cannot be signed into until an invitation is issued and claimed."
      >
        <TextInput name="email" type="email" required autoComplete="off" />
      </Field>
      <Field
        label="Indicative amount"
        name="indicativeAmount"
        hint="Optional. Indicative only — never treated as a commitment."
      >
        <TextInput name="indicativeAmount" inputMode="decimal" autoComplete="off" />
      </Field>
    </ActionForm>
  )
}

export function OverrideForm({
  accountId,
  currentPosition,
  overridden,
}: {
  accountId: string
  currentPosition: number
  overridden: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
        >
          {overridden ? 'Change the override' : 'Override this position'}
        </button>
        {overridden ? (
          <ActionForm
            action={clearOrderOverrideAction}
            submitLabel="Remove the override"
            tone="quiet"
            hidden={{ accountId }}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="rounded-sm border hairline bg-bg2 p-4">
      <ActionForm
        action={setOrderOverrideAction}
        submitLabel="Record the override"
        hidden={{ accountId }}
      >
        <Field
          label="Position"
          name="position"
          hint="Counting from one. This is where they appear in your list; no investor ever sees an order."
        >
          <TextInput
            name="position"
            type="number"
            min={1}
            defaultValue={String(currentPosition)}
            required
          />
        </Field>
        <Field
          label="Reason"
          name="reason"
          hint={`At least ${MIN_OVERRIDE_REASON_LENGTH} characters. There will be legitimate cases; there should be a trail. This is recorded in the audit log and shown beside their name.`}
        >
          <TextArea name="reason" rows={3} required minLength={MIN_OVERRIDE_REASON_LENGTH} />
        </Field>
      </ActionForm>
    </div>
  )
}

export function IssueOfferForm({
  accountId,
  name,
  jurisdiction,
  suggestedAmount,
  suggestedPercentage,
}: {
  accountId: string
  name: string
  jurisdiction: string | null
  suggestedAmount: string | null
  suggestedPercentage: string | null
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-sm bg-orange/12 px-3 text-xs font-semibold text-orange transition-colors hover:bg-orange/20"
      >
        Issue an offer to {name}
      </button>
    )
  }

  return (
    <div className="rounded-sm border hairline bg-bg2 p-4">
      <p className="mb-4 border-l-2 border-orange pl-3 text-xs leading-relaxed text-dim">
        {ISSUE_COMPLIANCE_NOTICE}
      </p>

      <ActionForm
        action={issueOfferFromRegisterAction}
        submitLabel="Create the offer"
        hidden={{ accountId }}
      >
        <Field
          label="Jurisdiction"
          name="jurisdiction"
          hint="Two-letter ISO country code. The compliance gate reads this and has nothing to check without it."
        >
          <TextInput
            name="jurisdiction"
            defaultValue={jurisdiction ?? ''}
            maxLength={2}
            required
            autoComplete="off"
            style={{ textTransform: 'uppercase' }}
          />
        </Field>

        <Field label="Investment amount (USD)" name="investmentAmountUsd">
          <TextInput
            name="investmentAmountUsd"
            inputMode="decimal"
            defaultValue={suggestedAmount ?? ''}
            required
            autoComplete="off"
          />
        </Field>

        <Field
          label="SPV percentage"
          name="spvPercentage"
          hint="The indirect Flipit percentage is computed from this and the round’s share. It is never typed."
        >
          <TextInput
            name="spvPercentage"
            inputMode="decimal"
            defaultValue={suggestedPercentage ?? ''}
            required
            autoComplete="off"
          />
        </Field>

        <Field label="Response deadline" name="responseDeadline">
          <TextInput name="responseDeadline" type="date" required />
        </Field>

        <Field label="Internal notes" name="internalNotes" hint="Optional. Never shown to the investor.">
          <TextArea name="internalNotes" rows={2} />
        </Field>
      </ActionForm>
    </div>
  )
}
