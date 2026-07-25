'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { idleState, type ActionState } from './action-state'

/**
 * A form bound to a server action.
 *
 * The action is the authority: it re-checks the session and the role itself
 * (see lib/auth/guards.ts). Anything this component hides is a courtesy, never
 * a control.
 */

function SubmitButton({
  label,
  tone = 'primary',
}: {
  label: string
  tone?: 'primary' | 'quiet' | 'danger'
}) {
  const { pending } = useFormStatus()

  const styles = {
    primary: 'bg-orange text-ink hover:bg-orange-soft',
    quiet: 'border hairline bg-transparent text-ftext hover:border-orange',
    danger: 'border border-warn bg-transparent text-warn hover:bg-warn/10',
  }[tone]

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex min-h-11 w-full items-center justify-center rounded-sm px-4 text-sm font-semibold transition-colors disabled:cursor-progress disabled:opacity-60 sm:w-auto ${styles}`}
    >
      {pending ? 'Working…' : label}
    </button>
  )
}

export function ActionForm({
  action,
  submitLabel,
  tone = 'primary',
  children,
  hidden,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  submitLabel: string
  tone?: 'primary' | 'quiet' | 'danger'
  children?: React.ReactNode
  /** Fixed values the action needs, e.g. a record id. */
  hidden?: Record<string, string>
}) {
  const [state, formAction] = useActionState(action, idleState)

  const fieldErrors =
    state.status === 'error' && state.fieldErrors ? Object.entries(state.fieldErrors) : []

  return (
    <form action={formAction} noValidate>
      {hidden
        ? Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}

      {children}

      <div className="mt-4">
        <SubmitButton label={submitLabel} tone={tone} />
      </div>

      {state.status === 'error' ? (
        <div
          role="alert"
          className="mt-4 border-l-2 border-warn pl-3 text-sm leading-relaxed text-warn"
        >
          <p>{state.message}</p>
          {fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc pl-4 text-xs text-warn">
              {fieldErrors.map(([field, message]) => (
                <li key={field}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {state.status === 'ok' ? (
        <div
          role="status"
          className="mt-4 border-l-2 border-ok pl-3 text-sm leading-relaxed text-ok"
        >
          <p>{state.message}</p>
          {state.revealOnce ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-silver2">
                Shown once — copy it now
              </p>
              <code className="mt-1 block break-all rounded-sm border hairline bg-bg2 p-3 text-xs text-ftext">
                {state.revealOnce}
              </code>
              <p className="mt-2 text-xs text-dim">
                Only a hash of this is stored, so it cannot be shown again. If it is
                lost, issue a new one — doing so revokes this one.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
