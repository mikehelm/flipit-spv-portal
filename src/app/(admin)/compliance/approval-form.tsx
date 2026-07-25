import {
  amendApprovalAction,
  recordApprovalAction,
  voidApprovalAction,
} from '@/actions/compliance'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, Notice, TextArea, TextInput } from '@/components/admin/ui'
import { BLOCS } from '@/lib/compliance'
import type { EmailTemplateKind } from '@/lib/email/templates'

/**
 * The approval forms.
 *
 * These are rendered only for the owner — and that is a courtesy, not the
 * control. `recordApprovalAction`, `amendApprovalAction` and
 * `voidApprovalAction` each re-check the role on the server and audit the
 * attempt when they refuse. An operator who posts to them directly is turned
 * away by the action, not by the absence of this component.
 *
 * The live template hash travels in a hidden field so the action can refuse if
 * the template changed while the form was open. Approving a hash the owner did
 * not see would defeat the point of hashing it.
 */

function Fields({
  kind,
  templateHash,
  defaults,
}: {
  kind: EmailTemplateKind
  templateHash: string
  defaults?: {
    approverName?: string
    approverRole?: string
    approverFirm?: string | null
    jurisdictions?: readonly string[]
    conditions?: string | null
  }
}) {
  return (
    <>
      <input type="hidden" name="templateKind" value={kind} />
      <input type="hidden" name="templateHash" value={templateHash} />

      <Field label="Approver name" name={`approverName-${kind}`}>
        <TextInput
          name="approverName"
          id={`approverName-${kind}`}
          defaultValue={defaults?.approverName ?? ''}
          autoComplete="off"
          required
        />
      </Field>

      <Field label="Their role" name={`approverRole-${kind}`}>
        <TextInput
          name="approverRole"
          id={`approverRole-${kind}`}
          defaultValue={defaults?.approverRole ?? ''}
          placeholder="Partner, General Counsel, Solicitor"
          autoComplete="off"
          required
        />
      </Field>

      <Field label="Firm" name={`approverFirm-${kind}`} hint="Optional, if they are not in-house.">
        <TextInput
          name="approverFirm"
          id={`approverFirm-${kind}`}
          defaultValue={defaults?.approverFirm ?? ''}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Approval date"
        name={`approvedAt-${kind}`}
        hint="The date on the approval itself, not today. A future date is refused."
      >
        <TextInput type="date" name="approvedAt" id={`approvedAt-${kind}`} required />
      </Field>

      <Field
        label="Evidence reference"
        name={`evidenceReference-${kind}`}
        hint="Where the approval can be found: a letter reference, an email subject and date, or a document id. The application stores the reference, not the document."
      >
        <TextInput
          name="evidenceReference"
          id={`evidenceReference-${kind}`}
          autoComplete="off"
          required
        />
      </Field>

      <Field
        label="Jurisdictions cleared"
        name={`jurisdictions-${kind}`}
        hint={
          <>
            Two-letter ISO country codes, separated by commas — <code>GB, AU, FR, TH</code>.
            Blocs are expanded to their member countries when this is saved:{' '}
            {BLOCS.map((bloc) => bloc.token).join(', ')}. Anything else is refused rather
            than interpreted. A country that is not on this list blocks that recipient
            alone.
          </>
        }
      >
        <TextArea
          name="jurisdictions"
          id={`jurisdictions-${kind}`}
          defaultValue={(defaults?.jurisdictions ?? []).join(', ')}
          required
        />
      </Field>

      <Field
        label="Conditions or restrictions"
        name={`conditions-${kind}`}
        hint="Anything the approver noted. Stored verbatim and shown here; the application does not interpret it."
      >
        <TextArea
          name="conditions"
          id={`conditions-${kind}`}
          defaultValue={defaults?.conditions ?? ''}
        />
      </Field>

      <div className="mt-4">
        <Checkbox
          name="acknowledged"
          id={`acknowledged-${kind}`}
          label="A qualified person has signed this off and I am recording their decision. I understand this application does not assess whether that approval is adequate, and that recording it is what makes sending possible."
        />
      </div>
    </>
  )
}

export function RecordApprovalForm({
  kind,
  templateHash,
}: {
  kind: EmailTemplateKind
  templateHash: string
}) {
  return (
    <ActionForm action={recordApprovalAction} submitLabel="Record approval">
      <Fields kind={kind} templateHash={templateHash} />
    </ActionForm>
  )
}

export function AmendApprovalForm({
  kind,
  templateHash,
  defaults,
}: {
  kind: EmailTemplateKind
  templateHash: string
  defaults: {
    approverName: string
    approverRole: string
    approverFirm: string | null
    jurisdictions: readonly string[]
    conditions: string | null
  }
}) {
  return (
    <ActionForm action={amendApprovalAction} submitLabel="Amend approval" tone="quiet">
      <Notice>
        Amending voids the approval currently in force and records a new one in its place.
        Nothing is edited and nothing is deleted, so the audit trail shows what was in
        force at every moment.
      </Notice>

      <div className="mt-4">
        <Field
          label="What is being amended, and why"
          name={`amendmentReason-${kind}`}
          hint="Goes on the audit trail."
        >
          <TextArea name="amendmentReason" id={`amendmentReason-${kind}`} required />
        </Field>
      </div>

      <Fields kind={kind} templateHash={templateHash} defaults={defaults} />
    </ActionForm>
  )
}

export function VoidApprovalForm({
  approvalId,
  kind,
}: {
  approvalId: string
  kind: EmailTemplateKind
}) {
  return (
    <ActionForm
      action={voidApprovalAction}
      submitLabel="Void this approval"
      tone="danger"
      hidden={{ approvalId }}
    >
      <Notice tone="warn">
        Voiding disables sending immediately. The record is kept — an approval is never
        deleted.
      </Notice>
      <div className="mt-4">
        <Field label="Why is it being withdrawn?" name={`voidReason-${kind}`}>
          <TextArea name="reason" id={`voidReason-${kind}`} required />
        </Field>
      </div>
    </ActionForm>
  )
}
