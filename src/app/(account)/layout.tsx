import type { Metadata } from 'next'
import { signOutAction } from '@/actions/auth'
import { PageCurl } from '@/components/page-curl'
import { requireOwnAccount } from '@/lib/auth/guards'
import { ROLE_LABELS } from '@/lib/roles'

export const metadata: Metadata = {
  title: 'Your account — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The shell for a session that is not yet an account.
 *
 * It exists because the admin shell cannot render one. `(admin)/layout.tsx`
 * calls `requireReader()`, which sends any account without a password to
 * `/admin/password` — including a request for `/admin/password` itself. That
 * was an infinite redirect on the one route by which a password enters this
 * system, and it stood in front of the owner's first sign-in. A guard cannot
 * fix it from inside the shell, because a layout has no way to know which route
 * is rendering beneath it; the page has to leave the shell.
 *
 * So this is deliberately not a copy of the admin shell with the navigation
 * removed. Nothing here reads a record, and the navigation is absent because
 * every destination on it would refuse this session anyway — twenty links to
 * twenty redirects is not a menu, it is a maze.
 *
 * `requireOwnAccount()` is the only guard in the application that redirects to
 * neither `/admin/password` nor `/admin/no-access`, which is what makes it the
 * only one this layout can safely call.
 *
 * **No site footer, and that is a decision rather than an omission.** §13.2
 * allows the maker's credit on two surfaces, and `attribution.test.ts` counts
 * the files that render it. Adding a third would have been defensible — this is
 * the admin surface under another shell — but the screen in question is where
 * somebody chooses a password, and a credit line is decoration on a security
 * step. The sign-in page has none either, for the same reason.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const identity = await requireOwnAccount()

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <header>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
                <PageCurl size={16} />
                Flipit Global SPV
              </p>
              <p className="mt-1 text-sm break-words text-dim">
                Signed in as <span className="text-ftext">{identity.email}</span>{' '}
                <span className="text-orange">({ROLE_LABELS[identity.role]})</span>
              </p>
            </div>

            <form action={signOutAction}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <main id="main" className="mt-8">
          {children}
        </main>
      </div>

    </div>
  )
}
