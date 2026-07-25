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
    primary: 'bg-[#F59A23] text-[#0b0c22] hover:bg-[#ffb84d]',
    quiet: 'border hairline bg-transparent text-[#e7e9f5] hover:border-[#F59A23]',
    danger: 'border border-[#ff5b52] bg-transparent text-[#ff5b52] hover:bg-[#ff5b52]/10',
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
          className="mt-4 border-l-2 border-[#ff5b52] pl-3 text-sm leading-relaxed text-[#ff5b52]"
        >
          <p>{state.message}</p>
          {fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc pl-4 text-xs text-[#ff5b52]">
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
          className="mt-4 border-l-2 border-[#35d07f] pl-3 text-sm leading-relaxed text-[#35d07f]"
        >
          <p>{state.message}</p>
          {state.revealOnce ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#cbd1de]">
                Shown once — copy it now
              </p>
              <code className="mt-1 block break-all rounded-sm border hairline bg-[#0d0f2e] p-3 text-xs text-[#e7e9f5]">
                {state.revealOnce}
              </code>
              <p className="mt-2 text-xs text-[#9498b5]">
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
