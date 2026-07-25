import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CLAIM_FAILED_MESSAGE, claimPortalToken } from '@/lib/portal/claim'
import { createInvestorSession } from '@/lib/portal/session'

export const metadata: Metadata = {
  title: 'Your private invitation — Flipit',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * Claiming an emailed portal link. BUILD_SPEC §4.1.
 *
 * Opening the link is what verifies control of the mailbox, so the claim
 * happens on GET rather than behind a button — the same shape as the
 * administrator setup link.
 *
 * Every way of failing produces the same page. An unknown token, a spent one,
 * an expired one, one belonging to a suspended account and one belonging to an
 * account that never existed are indistinguishable from here. The list of
 * people invited into a private securities round is itself confidential, and a
 * page that says "this link has expired" rather than "this link is not valid"
 * confirms the address it was sent to.
 */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await claimPortalToken(decodeURIComponent(token))

  if (result.ok) {
    await createInvestorSession(result.accountId)
    redirect('/portal')
  }

  return (
    <main className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#F59A23]">
        Flipit Global SPV
      </p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        This link cannot be opened
      </h1>
      <div className="mt-5 h-[3px] w-12 bg-[#F59A23]" />

      <p className="mt-6 text-sm leading-relaxed text-[#9498b5]">{CLAIM_FAILED_MESSAGE}</p>

      <p className="mt-8">
        <Link
          href="/portal/signin"
          className="inline-flex min-h-11 items-center rounded-sm bg-[#F59A23] px-4 text-sm font-semibold text-[#0b0c22]"
        >
          Request a fresh link
        </Link>
      </p>

      <p className="mt-8 text-xs leading-relaxed text-[#9498b5]">
        If you were not expecting this, you can ignore it. You can check that a message
        claiming to be from us is genuine on our{' '}
        <Link href="/verify" className="text-[#F59A23]">
          verification page
        </Link>
        .
      </p>
    </main>
  )
}
