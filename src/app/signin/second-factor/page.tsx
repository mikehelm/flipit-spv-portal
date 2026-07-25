import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { submitSecondFactorAction } from '@/actions/second-factor'
import { ActionForm } from '@/components/admin/action-form'
import { PageCurl } from '@/components/page-curl'
import { currentAdmin, pendingSecondFactorAdmin } from '@/lib/auth/guards'
import { SECOND_FACTOR_REQUIRED_MESSAGE } from '@/lib/auth/totp'

export const metadata: Metadata = {
  title: 'Sign in — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The second step. BUILD_SPEC §2.2.
 *
 * This is the only page in the application that renders for a session
 * `currentAdmin()` has refused, and it renders one form. Everything else in the
 * admin tree goes through a guard that treats a pending session as signed out,
 * so there is no second surface this page's exception could be widened into by
 * accident.
 *
 * The form takes either an authenticator code or a recovery code, in one field.
 * Two fields would tell somebody watching which one was being tried, and would
 * make a person who has lost their phone hunt for the right box while they are
 * already anxious.
 */
export default async function SecondFactorPage() {
  // Already through: nothing to do here.
  if (await currentAdmin()) redirect('/admin')

  const pending = await pendingSecondFactorAdmin()
  if (!pending) redirect('/signin')

  return (
    <main id="main" className="mx-auto w-full max-w-md px-5 py-16 sm:py-24">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
        <PageCurl size={18} />
        Flipit Global SPV
      </p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">
        One more step
      </h1>
      <div className="mt-5 h-[3px] w-12 bg-orange" />

      <p className="mt-5 text-sm leading-relaxed text-dim">
        {SECOND_FACTOR_REQUIRED_MESSAGE}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-dim">
        Signed in as <span className="text-ftext">{pending.email}</span>. You are not
        through yet — nothing on this account is reachable until this is done.
      </p>

      <div className="mt-8">
        <ActionForm action={submitSecondFactorAction} submitLabel="Continue">
          <label
            htmlFor="code"
            className="block text-xs font-semibold uppercase tracking-wider text-silver2"
          >
            Six-digit code, or a recovery code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            /*
             * `one-time-code` is what lets iOS and Android offer the code from
             * the authenticator or an SMS without the person switching apps —
             * which is the difference between this being a formality and being
             * the reason somebody signs in less often.
             */
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            required
            maxLength={64}
            className="mt-2 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 font-mono text-lg tracking-[0.3em] text-ftext placeholder:text-muted focus:border-orange"
            placeholder="000000"
          />
        </ActionForm>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-muted">
        Lost the device and the recovery codes? The portal owner can turn
        two-factor off for an account from the database. There is deliberately no
        way to do it from this screen.
      </p>
    </main>
  )
}
