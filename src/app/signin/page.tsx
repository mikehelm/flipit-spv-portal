import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { signInWithPasswordAction } from '@/actions/auth'
import { ActionForm } from '@/components/admin/action-form'
import { Field, TextInput } from '@/components/admin/ui'
import { currentAdmin } from '@/lib/auth/guards'

export const metadata: Metadata = {
  title: 'Sign in — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * Administrator sign-in. BUILD_SPEC §2, §2.2.
 *
 * Email and password, for exactly two people. No OAuth, no Google Cloud
 * project, no consent screen, and no third party in the path of the owner
 * reaching his own application.
 *
 * Investors do not sign in here. They claim an emailed single-use link or
 * request a fresh one from their own portal (§4.1, WP8).
 *
 * Every failure produces the same sentence and the same delay, whether the
 * address is unknown, has no password set, or the password is simply wrong.
 */

const GENERIC = 'That sign-in could not be completed. Try again.'

function messageFor(code: string | undefined): string | null {
  if (!code) return null
  if (code === 'SetupLink') {
    return 'That setup link is not usable — it may have been used already, revoked, or expired. Ask for a fresh one.'
  }
  return GENERIC
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const admin = await currentAdmin()
  if (admin) redirect('/admin')

  const params = await searchParams
  const rawError = params.error
  const error = messageFor(Array.isArray(rawError) ? rawError[0] : rawError)

  return (
    <main className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#F59A23]">
        Flipit Global SPV
      </p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">Sign in</h1>
      <div className="mt-5 h-[3px] w-12 bg-[#F59A23]" />

      <p className="mt-5 text-sm leading-relaxed text-[#9498b5]">
        This is the administration side of the investor portal. Access is limited to two
        named accounts.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-6 border-l-2 border-[#ff5b52] pl-3 text-sm leading-relaxed text-[#ff5b52]"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-8">
        <ActionForm action={signInWithPasswordAction} submitLabel="Sign in">
          <Field label="Email" name="email">
            <TextInput
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
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
        </ActionForm>
      </div>

      {/*
        There is deliberately no "forgotten password?" link and no hint about
        which accounts exist. Both would answer the one question this page is
        built not to answer.
      */}

      <p className="mt-8 text-xs leading-relaxed text-[#9498b5]">
        Investors do not sign in here. If you are an investor, use the link in your
        invitation or request a fresh one from your portal.
      </p>
    </main>
  )
}
