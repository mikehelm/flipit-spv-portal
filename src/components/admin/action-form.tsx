'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { maxBytesFor, tooLargeMessage, type UploadKind } from '@/lib/media/formats'
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
  fileKind,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  submitLabel: string
  tone?: 'primary' | 'quiet' | 'danger'
  children?: React.ReactNode
  /** Fixed values the action needs, e.g. a record id. */
  hidden?: Record<string, string>
  /**
   * Set on any form carrying a file input, and it is not optional in practice —
   * `file-limits.test.ts` fails the build if a form with an `input type="file"`
   * leaves it out.
   *
   * **Why a form needs to know.** A server action's request body has a limit of
   * its own, above every limit in `formats.ts` but below what a person can
   * choose from a file picker (`next.config.ts` explains the three numbers).
   * A body over it never reaches the action, so the action's careful refusal is
   * never written: Next answers 500, `useActionState` has no new state to
   * render, and the form sits there looking as though the button was not
   * pressed. That is what a 30 MB PDF did on the documents panel — the panel
   * where a securities document is issued — and doing nothing visible is the
   * worst of the available behaviours.
   *
   * So the size is checked here, before the body is built, and the refusal is
   * `tooLargeMessage` — the same sentence the server would have used. Anything
   * within the limit still posts and is still judged by `ingest`, which reads
   * the bytes. This guard reads a number the browser reported and is therefore
   * a courtesy, exactly like `hidden`: it makes a refusal legible, it does not
   * make one trustworthy.
   */
  fileKind?: UploadKind
}) {
  const [state, formAction] = useActionState(action, idleState)
  const [tooLarge, setTooLarge] = useState<string | null>(null)

  const fieldErrors =
    state.status === 'error' && state.fieldErrors ? Object.entries(state.fieldErrors) : []

  /**
   * Runs before the action. Returning early with `preventDefault` is what stops
   * React from posting the body.
   *
   * Every file input in the form, not the first: the documents panel renders a
   * form per card, and a future one may take two files.
   */
  function guardTheFiles(event: React.FormEvent<HTMLFormElement>): void {
    if (!fileKind) return

    const limit = maxBytesFor(fileKind)
    const inputs = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    )

    for (const input of inputs) {
      for (const file of Array.from(input.files ?? [])) {
        if (file.size > limit) {
          event.preventDefault()
          setTooLarge(tooLargeMessage(fileKind, file.size))
          return
        }
      }
    }

    setTooLarge(null)
  }

  return (
    <form action={formAction} onSubmit={guardTheFiles} noValidate>
      {hidden
        ? Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}

      {children}

      <div className="mt-4">
        <SubmitButton label={submitLabel} tone={tone} />
      </div>

      {/*
        The file was refused here rather than by the action, and it is rendered
        in the same place, in the same words and with the same `role="alert"`.
        An operator has one question — was my file accepted — and does not need
        to learn that the answer arrives from two directions.
      */}
      {tooLarge !== null ? (
        <div
          role="alert"
          className="mt-4 border-l-2 border-warn pl-3 text-sm leading-relaxed text-warn"
        >
          <p>{tooLarge}</p>
          <p className="mt-2 text-xs text-warn">
            It was not sent. Choose a smaller file and press the button again.
          </p>
        </div>
      ) : state.status === 'error' ? (
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

      {tooLarge === null && state.status === 'ok' ? (
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
