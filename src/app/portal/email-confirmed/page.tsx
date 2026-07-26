import type { Metadata } from 'next'
import Link from 'next/link'
import { EMAIL_CHANGE_CONFIRMED_MESSAGE } from '@/lib/portal/email-change'

export const metadata: Metadata = {
  title: 'Contact address confirmed — Flipit',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * Where a successful contact-address confirmation lands. BUILD_SPEC §13, §15.
 *
 * It names no address, no account and no record, and it is reachable by typing
 * the path — so its copy has to be safe for somebody who holds no token at all.
 * The confirmation itself already happened in the route handler; this page is
 * the receipt, and a receipt that recited the address would put it on a screen
 * in whatever room the link was opened in.
 *
 * The sign-in prompt is here because confirming deliberately does not sign
 * anybody in, and because every session and outstanding link was revoked when
 * the address moved — so anybody who was signed in elsewhere needs to come back
 * through the front door, which is the point of revoking them.
 */
export default function EmailConfirmedPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
        Flipit Global SPV
      </p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        Contact address confirmed
      </h1>
      <div className="mt-5 h-[3px] w-12 bg-orange" />

      <p className="mt-6 text-sm leading-relaxed text-dim">
        {EMAIL_CHANGE_CONFIRMED_MESSAGE}
      </p>

      <p className="mt-8">
        <Link
          href="/portal/signin"
          className="inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink"
        >
          Sign in
        </Link>
      </p>

      <p className="mt-8 text-xs leading-relaxed text-dim">
        To check that a message claiming to be from us is genuine, see our{' '}
        <Link href="/verify" className="text-orange">
          verification page
        </Link>
        .
      </p>
    </main>
  )
}
