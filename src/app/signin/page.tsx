import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CurlCorner } from '@/components/effects/CurlCorner'
import { PublicMakerCredit } from '@/components/public-maker-credit'
import { SignInForm } from '@/components/sign-in-form'
import { SIGN_IN_FAILED_MESSAGE } from '@/lib/auth/credentials'
import { currentAdmin } from '@/lib/auth/guards'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The private sign-in surface says nothing about the service behind it or the
 * people whose addresses are allowed. Every failure uses the same copy and the
 * same delay, whether the address is unknown, awaiting setup, or simply wrong.
 */

function messageFor(code: string | undefined): string | null {
  if (!code) return null
  return SIGN_IN_FAILED_MESSAGE
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
  const rawEmail = params.email
  const initialEmail = (Array.isArray(rawEmail) ? rawEmail[0] : rawEmail ?? '')
    .trim()
    .slice(0, 254)

  return (
    <>
      <CurlCorner />
      <PublicMakerCredit />
      <main
        id="main"
        className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-5 py-10"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          Private access
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">Sign in</h1>
        <div className="mt-5 h-[3px] w-12 bg-orange" />

        <p className="mt-5 text-sm leading-relaxed text-dim">
          Use the email address and password associated with your invitation.
        </p>

        <div className="mt-8">
          <SignInForm initialEmail={initialEmail} initialError={error} />
        </div>

        <p className="mt-8 text-sm leading-relaxed text-dim">
          Cannot sign in?{' '}
          <Link href="/access-request" className="font-semibold text-orange">
            Request access
          </Link>
          . The administrator may call to verify your identity before deciding
          whether to issue an invitation.
        </p>
      </main>
    </>
  )
}
