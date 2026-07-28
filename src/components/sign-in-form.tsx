'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { signInWithPasswordAction } from '@/actions/auth'
import { type ActionState, idleState } from '@/components/admin/action-state'
import { Field, TextInput } from '@/components/admin/ui'

function SignInButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink transition-colors hover:bg-orange-soft disabled:cursor-progress disabled:opacity-60 sm:w-auto"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  )
}

/**
 * The email is controlled so React's post-action form reset clears the secret
 * password but does not make a known person retype their address. `initialEmail`
 * also powers private, person-specific sign-in links without placing a password
 * or any other credential in the URL.
 */
export function SignInForm({
  initialEmail,
  initialError,
}: {
  initialEmail: string
  initialError: string | null
}) {
  const initialState: ActionState = initialError
    ? { status: 'error', message: initialError }
    : idleState
  const [state, formAction] = useActionState(signInWithPasswordAction, initialState)
  const [email, setEmail] = useState(initialEmail)

  return (
    <form action={formAction} noValidate>
      {state.status === 'error' ? (
        <div
          role="alert"
          className="mb-6 border-l-2 border-warn pl-3 text-sm leading-relaxed text-warn"
        >
          {state.message}
        </div>
      ) : null}

      <Field label="Email" name="email">
        <TextInput
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          required
        />
      </Field>
      <Field label="Password" name="password">
        <TextInput
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <SignInButton />
    </form>
  )
}
