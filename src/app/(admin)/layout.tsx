import type { Metadata } from 'next'
import { signOutAction } from '@/actions/auth'
import { AdminNav } from '@/components/admin/admin-nav'
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
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = await requireAdmin()
  const config = env()

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#F59A23]">
            Flipit Global SPV
          </p>
          <p className="mt-1 text-sm text-[#9498b5]">
            Signed in as{' '}
            <span className="text-[#e7e9f5]">{admin.email}</span>{' '}
            <span className="text-[#F59A23]">
              ({admin.role === 'OWNER' ? 'Owner' : 'Operator'})
            </span>
          </p>
        </div>

        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex min-h-9 items-center rounded-sm border hairline px-3 text-xs font-semibold text-[#9498b5] transition-colors hover:border-[#F59A23] hover:text-[#e7e9f5]"
          >
            Sign out
          </button>
        </form>
      </div>

      {!config.isProductionDeployment ? (
        <p className="mt-4 border-l-2 border-[#ff5b52] pl-3 text-xs leading-relaxed text-[#9498b5]">
          Testing deployment. Portal links embed this domain, so real invitations are
          refused from here. Test sends to the operator&rsquo;s own address remain
          available.
        </p>
      ) : null}

      <div className="mt-6 border-t hairline pt-3">
        <AdminNav role={admin.role} />
      </div>

      <div className="mt-8">{children}</div>
    </div>
  )
}
