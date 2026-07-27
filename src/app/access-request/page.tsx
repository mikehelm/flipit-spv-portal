import type { Metadata } from 'next'
import Link from 'next/link'
import { AccessRequestForm } from './request-form'

export const metadata: Metadata = {
  title: 'Request access',
  robots: { index: false, follow: false, nocache: true },
}

export default function AccessRequestPage() {
  return (
    <>
      <main
        id="main"
        className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-5 py-10"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          Private access
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">
          Request access
        </h1>
        <div className="mt-5 h-[3px] w-12 bg-orange" />

        <p className="mt-5 text-sm leading-relaxed text-dim">
          If you were asked to use this private service but cannot sign in, submit
          your contact details. The administrator may call to verify your identity.
          Submitting this form does not grant access.
        </p>

        <div className="mt-8">
          <AccessRequestForm />
        </div>

        <p className="mt-8 text-sm text-dim">
          <Link href="/signin" className="font-semibold text-orange">
            Return to sign in
          </Link>
        </p>
      </main>
    </>
  )
}
