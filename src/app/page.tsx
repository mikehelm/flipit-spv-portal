import Link from 'next/link'
import { env } from '@/lib/env'

/**
 * The public front door.
 *
 * It says what this is and links to sign-in. It deliberately does not say who
 * the administrators are, does not hint at whether any particular address has
 * access, and shows nothing about investors: the allowlist check (§2.2) lives
 * behind the sign-in form, and this page must not leak any part of it.
 */
export default function Home() {
  const config = env()

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-5 py-16 sm:py-24">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
        Flipit Global SPV
      </p>

      <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
        Investor Portal
      </h1>

      <div className="mt-5 h-[3px] w-12 bg-orange" />

      <p className="mt-5 max-w-lg text-silver2">
        A private system for managing the Flipit SPV investment process — from
        the first invitation through to confirmed receipt of funds.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link
          href="/signin"
          className="inline-flex min-h-11 items-center justify-center rounded-sm bg-orange px-5 text-sm font-semibold text-ink transition-colors hover:bg-orange-soft"
        >
          Sign in
        </Link>
        <p className="text-xs leading-relaxed text-dim">
          Administrator access only. Investors reach their own portal through the
          link in their invitation email — there is no sign-in for them here.
        </p>
      </div>

      <p className="mt-6 text-sm leading-relaxed text-dim">
        Received an unexpected invitation and want to check it is genuine?{' '}
        <Link href="/verify" className="text-orange">
          How to verify a message from us
        </Link>
        . That page is public, needs no sign-in, and is safe to reach by typing.
      </p>

      <div className="mt-10 rounded-sm border hairline bg-paper p-5">
        <p className="text-sm font-semibold text-white">Deployment</p>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm text-dim sm:grid-cols-[9rem_1fr]">
          <dt>Serving from</dt>
          <dd className="break-all text-ftext">{config.APP_URL}</dd>
          <dt>Base path</dt>
          <dd className="text-ftext">
            {config.BASE_PATH === '' ? '(domain root)' : config.BASE_PATH}
          </dd>
          <dt>Sending</dt>
          <dd
            className={
              config.isProductionDeployment
                ? 'text-ok'
                : 'text-warn'
            }
          >
            {config.isProductionDeployment
              ? 'Permitted — this is the production deployment'
              : 'Blocked — testing deployment, invitations cannot be sent'}
          </dd>
        </dl>
        {!config.isProductionDeployment && (
          <p className="mt-4 border-l-2 border-warn pl-3 text-xs leading-relaxed text-dim">
            Portal links embed the domain. Anything issued from a testing
            deployment would stop working the moment the app moves, so real
            invitations are refused here by design.
          </p>
        )}
      </div>
    </main>
  )
}
