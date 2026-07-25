import type { Metadata } from 'next'
import { signOutAction } from '@/actions/auth'
import { AdminNav } from '@/components/admin/admin-nav'
import { PageCurl } from '@/components/page-curl'
import { SiteFooter } from '@/components/site-footer'
import { requireAdmin } from '@/lib/auth/guards'
import { env } from '@/lib/env'

export const metadata: Metadata = {
  title: 'Admin — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The admin shell. FLIPIT palette (BUILD_SPEC §13.2), mobile-first — the
 * layout is designed at 375px and widened from there.
 *
 * `requireAdmin()` runs here so no admin route can render for a signed-out
 * visitor, but it is not the only check: every page and every server action
 * repeats its own. A layout guard is a convenience, not an authorization
 * boundary, because a nested route handler never runs it.
 *
 * The header is a `<header>` and the content is a `<main id="main">` so that
 * the skip link in the root layout has somewhere to land, and so a screen
 * reader can jump the navigation on every one of the fourteen admin screens
 * rather than hearing it fourteen times.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = await requireAdmin()
  const config = env()

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <header>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
                <PageCurl size={16} />
                Flipit Global SPV
              </p>
              <p className="mt-1 text-sm break-words text-dim">
                Signed in as <span className="text-ftext">{admin.email}</span>{' '}
                <span className="text-orange">
                  ({admin.role === 'OWNER' ? 'Owner' : 'Operator'})
                </span>
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

          {!config.isProductionDeployment ? (
            <p className="mt-4 border-l-2 border-warn pl-3 text-xs leading-relaxed text-dim">
              Testing deployment. Portal links embed this domain, so real invitations are
              refused from here. Test sends to the operator&rsquo;s own address remain
              available.
            </p>
          ) : null}

          <div className="mt-6 border-t hairline pt-3">
            <AdminNav role={admin.role} />
          </div>
        </header>

        <main id="main" className="mt-8">
          {children}
        </main>
      </div>

      <SiteFooter surface="ADMIN" />
    </div>
  )
}
