import type { Metadata } from 'next'
import Link from 'next/link'
import { CLAIM_FAILED_MESSAGE } from '@/lib/portal/claim'

export const metadata: Metadata = {
  title: 'This link cannot be opened — Flipit',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * Where every failed claim lands. BUILD_SPEC §4.1, §15.
 *
 * One page and one message for every way of failing: a token that never
 * existed, one already used, one expired, one revoked, and one belonging to an
 * account that has been suspended. The page cannot tell them apart because it
 * is never told which happened — `claimPortalToken` keeps that to itself and
 * the route handler redirects here regardless.
 *
 * That is deliberate. The list of people invited into a private securities
 * round is itself confidential, and a page that says "this link has expired"
 * rather than "this link is not valid" confirms the address it was sent to.
 */
export default function LinkNotValidPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
        Flipit Global SPV
      </p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        This link cannot be opened
      </h1>
      <div className="mt-5 h-[3px] w-12 bg-orange" />

      <p className="mt-6 text-sm leading-relaxed text-dim">{CLAIM_FAILED_MESSAGE}</p>

      <p className="mt-8">
        <Link
          href="/portal/signin"
          className="inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink"
        >
          Request a fresh link
        </Link>
      </p>

      <p className="mt-8 text-xs leading-relaxed text-dim">
        If you were not expecting this, you can ignore it. To check that a message
        claiming to be from us is genuine, see our{' '}
        <Link href="/verify" className="text-orange">
          verification page
        </Link>
        .
      </p>
    </main>
  )
}
