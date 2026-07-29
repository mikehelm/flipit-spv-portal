'use client'

import { useState } from 'react'
import {
  advanceStageAction,
  correctStageAction,
  recordAcceptedAmountAction,
  recordCommitmentAction,
  recordFundsReceivedAction,
  reissueCertificateAction,
} from '@/actions/offers'
import { updateRecipientDraftAction } from '@/actions/recipient-draft'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, Select, TextArea, TextInput } from '@/components/admin/ui'
import { FUNDS_CONFIRMATION_NOTICE, STAGE_LABEL } from '@/lib/portal/stages'
import { OFFER_STAGES, type OfferStage } from '@/lib/portal/timeline'

/** Operator-side status advancement. BUILD_SPEC §5. */

export function AdvanceForm({
  offerId,
  nextStage,
}: {
  offerId: string
  nextStage: OfferStage
}) {
  return (
    <ActionForm
      action={advanceStageAction}
      submitLabel={`Record “${STAGE_LABEL[nextStage]}”`}
      hidden={{ offerId, toStage: nextStage }}
    >
      <Field
        label="Note for the investor"
        name="investorNote"
        hint="Optional. Shown beside this step on their timeline."
      >
        <TextArea name="investorNote" rows={2} />
      </Field>
      <Field label="Internal note" name="internalNote" hint="Optional. Never shown to them.">
        <TextArea name="internalNote" rows={2} />
      </Field>
    </ActionForm>
  )
}

export function RecipientDraftForm({
  offerId,
  name,
  email,
  jurisdiction,
  responseDeadline,
}: {
  offerId: string
  name: string
  email: string
  jurisdiction: string | null
  responseDeadline: string | null
}) {
  return (
    <ActionForm
      action={updateRecipientDraftAction}
      submitLabel="Save draft details"
      hidden={{ offerId }}
    >
      <Field label="Name" name="name">
        <TextInput name="name" defaultValue={name} required />
      </Field>
      <Field
        label="Email"
        name="email"
        hint="Shared addresses are allowed while preparing, but sending stays blocked until each offer has the intended address."
      >
        <TextInput name="email" type="email" defaultValue={email} required />
      </Field>
      <Field
        label="Jurisdiction"
        name="jurisdiction"
        hint="Leave blank until known, or enter a country name or two-letter ISO code."
      >
        <TextInput
          name="jurisdiction"
          defaultValue={jurisdiction ?? ''}
          className="uppercase"
        />
      </Field>
      <Field
        label="Response deadline"
        name="responseDeadline"
        hint="Leave blank until David is ready to set the invitation deadline."
      >
        <TextInput
          name="responseDeadline"
          type="date"
          defaultValue={responseDeadline ?? ''}
        />
      </Field>
    </ActionForm>
  )
}

export function CommitmentForm({
  offerId,
  committedAmount,
}: {
  offerId: string
  committedAmount: string | null
}) {
  return (
    <ActionForm
      action={recordCommitmentAction}
      submitLabel="Record the commitment"
      hidden={{ offerId }}
    >
      <Field
        label="Committed amount"
        name="amount"
        hint="Stored separately from the proposed amount. The four figures are never collapsed into one."
      >
        <TextInput name="amount" inputMode="decimal" defaultValue={committedAmount ?? ''} required />
      </Field>
      <Field label="Date agreed" name="agreedOn">
        <TextInput name="agreedOn" type="date" required />
      </Field>
      <Field label="Note" name="note" hint="Optional, internal.">
        <TextArea name="note" rows={2} />
      </Field>
    </ActionForm>
  )
}

export function AcceptedAmountForm({
  offerId,
  acceptedAmount,
}: {
  offerId: string
  acceptedAmount: string | null
}) {
  return (
    <ActionForm
      action={recordAcceptedAmountAction}
      submitLabel="Record the accepted amount"
      hidden={{ offerId }}
    >
      <Field label="Accepted amount" name="amount">
        <TextInput name="amount" inputMode="decimal" defaultValue={acceptedAmount ?? ''} required />
      </Field>
    </ActionForm>
  )
}

/**
 * §5: "Funds received requires two-step confirmation in the operator UI, with
 * the amount re-typed to confirm."
 *
 * Both halves are re-checked in `recordFundsReceived`. The live comparison
 * below is a courtesy so the operator sees the mismatch before submitting; it
 * is not what enforces it.
 */
export function FundsReceivedForm({
  offerId,
  receivedAmount,
  corrected,
}: {
  offerId: string
  receivedAmount: string | null
  corrected: boolean
}) {
  const [amount, setAmount] = useState(receivedAmount ?? '')
  const [confirmation, setConfirmation] = useState('')

  const bothTyped = amount.trim() !== '' && confirmation.trim() !== ''
  const mismatch = bothTyped && amount.trim() !== confirmation.trim()

  return (
    <ActionForm
      action={recordFundsReceivedAction}
      submitLabel={corrected ? 'Correct the recorded receipt' : 'Record funds received'}
      hidden={{ offerId }}
    >
      <p className="mb-4 border-l-2 border-warn pl-3 text-xs leading-relaxed text-dim">
        {FUNDS_CONFIRMATION_NOTICE}
      </p>

      <Field label="Amount received" name="amount">
        <TextInput
          name="amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
          autoComplete="off"
        />
      </Field>

      <Field
        label="Re-type the amount"
        name="amountConfirmation"
        hint="Check it against the bank statement, not against the box above."
      >
        <TextInput
          name="amountConfirmation"
          inputMode="decimal"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          autoComplete="off"
        />
      </Field>

      {mismatch ? (
        <p className="mb-4 border-l-2 border-warn pl-3 text-xs text-warn">
          These do not match yet. Nothing will be recorded until they do.
        </p>
      ) : null}

      <Field label="Currency" name="currency">
        <TextInput name="currency" defaultValue="USD" maxLength={3} required />
      </Field>

      <Field label="Value date" name="valueDate" hint="When the funds actually settled. Not in the future.">
        <TextInput name="valueDate" type="date" required />
      </Field>

      <Field
        label="Payment reference"
        name="reference"
        hint="Goes on their certificate. It is how they reconcile this against their own records."
      >
        <TextInput name="reference" required autoComplete="off" />
      </Field>

      <div className="mb-4 rounded-sm border border-warn/40 bg-warn/6 p-4">
        <Checkbox
          name="confirmed"
          label="I confirm these funds have arrived and this is the amount received."
        />
      </div>
    </ActionForm>
  )
}

export function CorrectionForm({
  offerId,
  currentStage,
}: {
  offerId: string
  currentStage: OfferStage
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-warn hover:text-warn"
      >
        Correct the recorded step
      </button>
    )
  }

  return (
    <div className="rounded-sm border hairline bg-bg2 p-4">
      <ActionForm
        action={correctStageAction}
        submitLabel="Record the correction"
        tone="danger"
        hidden={{ offerId }}
      >
        <Field
          label="Correct it to"
          name="toStage"
          hint="The original step is kept on the record. Corrections are never silent overwrites."
        >
          <Select
            name="toStage"
            defaultValue={currentStage}
            options={OFFER_STAGES.map((stage) => ({ value: stage, label: STAGE_LABEL[stage] }))}
          />
        </Field>
        <Field
          label="Reason"
          name="reason"
          hint="At least ten characters. The investor has already been shown the step you are correcting."
        >
          <TextArea name="reason" rows={3} required minLength={10} />
        </Field>
      </ActionForm>
    </div>
  )
}

export function ReissueCertificateForm({ offerId }: { offerId: string }) {
  return (
    <ActionForm
      action={reissueCertificateAction}
      submitLabel="Reissue the certificate"
      tone="quiet"
      hidden={{ offerId }}
    />
  )
}
