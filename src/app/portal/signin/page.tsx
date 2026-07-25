import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requestSignInLinkAction } from '@/actions/portal'
import { ActionForm } from '@/components/admin/action-form'
import { Field, TextInput } from '@/components/admin/ui'
import { readInvestorAccount } from '@/lib/portal/session'

export const metadata: Metadata = {
  title: 'Your private portal — Flipit',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * Passwordless return sign-in. BUILD_SPEC §4.1, PORTAL_COPY.
 *
 * There are no passwords for investors, so there is nothing to forget and no
 * recovery path other than the verified email address itself.
 *
 * The response to a submitted address is one sentence and has no variants. An
 * address with a record, one without, a suspended account and an archived one
 * all produce it.
 */
export default async function PortalSignInPage() {
  const account = await readInvestorAccount()
  if (account) redirect('/portal')

  return (
    <main id="main" className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
        Flipit Global SPV
      </p>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        Your private portal
      </h1>
      <div className="mt-5 h-[3px] w-12 bg-orange" />

      <p className="mt-6 text-sm leading-relaxed text-dim">
        This is your private portal. You can return to it at any time by entering your
        email address below — we will send you a fresh sign-in link. Only the email address
        this invitation was sent to can access this record.
      </p>

      <div className="mt-8">
        <ActionForm action={requestSignInLinkAction} submitLabel="Email me a link">
          <Field label="Your email address" name="email">
            <TextInput
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              required
            />
          </Field>
        </ActionForm>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-dim">
        Not sure whether a message you received is really from us? Check our{' '}
        <Link href="/verify" className="text-orange">
          verification page
        </Link>
        . We will never email you a change of bank details.
      </p>
    </main>
  )
}
