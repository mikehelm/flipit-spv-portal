'use client'

import { useActionState, useState } from 'react'
import {
  submitAccessRequestAction,
  type AccessRequestActionState,
  type SubmittedAccessRequestDetails,
} from './action'

const EMPTY: SubmittedAccessRequestDetails = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
}

const INITIAL_STATE: AccessRequestActionState = { status: 'idle' }

const inputClass =
  'w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext ' +
  'placeholder:text-muted focus:border-orange'

function sameDetails(
  left: SubmittedAccessRequestDetails,
  right: SubmittedAccessRequestDetails,
): boolean {
  return (
    left.firstName === right.firstName &&
    left.lastName === right.lastName &&
    left.email === right.email &&
    left.phone === right.phone
  )
}

function Label({
  name,
  children,
}: {
  name: keyof SubmittedAccessRequestDetails
  children: React.ReactNode
}) {
  return (
    <label
      htmlFor={name}
      className="block text-xs font-semibold uppercase tracking-wider text-silver2"
    >
      {children}
    </label>
  )
}

export function AccessRequestForm() {
  const [state, formAction, pending] = useActionState(
    submitAccessRequestAction,
    INITIAL_STATE,
  )
  const [draft, setDraft] = useState<SubmittedAccessRequestDetails>(EMPTY)
  const [editing, setEditing] = useState(false)

  const submitted =
    state.status === 'ok'
      ? state.details
      : state.status === 'error'
        ? state.submittedDetails
        : null
  const submittedMessage = state.status === 'ok' ? state.message : ''
  const showSummary =
    state.status === 'ok' && submitted !== null && !editing && !pending
  const changed = submitted ? !sameDetails(draft, submitted) : true

  function update(
    field: keyof SubmittedAccessRequestDetails,
    value: string,
  ): void {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  if (showSummary) {
    return (
      <section
        aria-labelledby="request-recorded-heading"
        className="rounded-sm border hairline bg-paper p-5"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ok">
          Request submitted
        </p>
        <h2
          id="request-recorded-heading"
          className="mt-2 text-xl font-semibold text-white"
        >
          Please review your details
        </h2>
        <p role="status" className="mt-3 text-sm leading-relaxed text-dim">
          {submittedMessage}
        </p>

        <dl className="mt-5 divide-y divide-white/8 rounded-sm border hairline bg-bg2 px-4">
          <div className="grid grid-cols-[6rem_1fr] gap-3 py-3 text-sm">
            <dt className="text-dim">Name</dt>
            <dd className="break-words text-ftext">
              {submitted.firstName} {submitted.lastName}
            </dd>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-3 py-3 text-sm">
            <dt className="text-dim">Email</dt>
            <dd className="break-all text-ftext">{submitted.email}</dd>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-3 py-3 text-sm">
            <dt className="text-dim">Phone</dt>
            <dd className="break-words text-ftext">{submitted.phone}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => {
            setDraft(submitted)
            setEditing(true)
          }}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext transition-colors hover:border-orange"
        >
          Edit details
        </button>
      </section>
    )
  }

  const errors = state.status === 'error' ? state.fieldErrors : {}
  const editMode = submitted !== null

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={() => setEditing(false)}
    >
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <div className="mb-4">
          <Label name="firstName">First name</Label>
          <div className="mt-2">
            <input
              id="firstName"
              name="firstName"
              autoComplete="given-name"
              required
              maxLength={80}
              value={draft.firstName}
              onChange={(event) => update('firstName', event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(errors.firstName)}
            />
          </div>
          {errors.firstName ? (
            <p className="mt-2 text-xs text-warn">{errors.firstName}</p>
          ) : null}
        </div>

        <div className="mb-4">
          <Label name="lastName">Last name</Label>
          <div className="mt-2">
            <input
              id="lastName"
              name="lastName"
              autoComplete="family-name"
              required
              maxLength={80}
              value={draft.lastName}
              onChange={(event) => update('lastName', event.target.value)}
              className={inputClass}
              aria-invalid={Boolean(errors.lastName)}
            />
          </div>
          {errors.lastName ? (
            <p className="mt-2 text-xs text-warn">{errors.lastName}</p>
          ) : null}
        </div>
      </div>

      <div className="mb-4">
        <Label name="email">Email</Label>
        <div className="mt-2">
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            required
            value={draft.email}
            onChange={(event) => update('email', event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(errors.email)}
          />
        </div>
        {errors.email ? <p className="mt-2 text-xs text-warn">{errors.email}</p> : null}
      </div>

      <div className="mb-4">
        <Label name="phone">Phone number</Label>
        <div className="mt-2">
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            maxLength={40}
            value={draft.phone}
            onChange={(event) => update('phone', event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby="phone-hint"
          />
        </div>
        <p id="phone-hint" className="mt-2 text-xs leading-relaxed text-dim">
          Include the country code so the administrator can reach you.
        </p>
        {errors.phone ? <p className="mt-2 text-xs text-warn">{errors.phone}</p> : null}
      </div>

      <input
        name="website"
        type="text"
        hidden
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      {state.status !== 'idle' && state.editCapability ? (
        <input
          name="editCapability"
          type="hidden"
          value={state.editCapability}
        />
      ) : null}

      <button
        type="submit"
        disabled={pending || (editMode && !changed)}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink transition-colors hover:bg-orange-soft disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {pending
          ? 'Submitting…'
          : editMode
            ? changed
              ? 'Resubmit changes'
              : 'No changes to submit'
            : 'Submit request'}
      </button>

      {state.status === 'error' ? (
        <p role="alert" className="mt-4 border-l-2 border-warn pl-3 text-sm text-warn">
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
