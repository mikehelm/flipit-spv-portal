import type { Metadata } from 'next'
import Link from 'next/link'
import { signOutAction } from '@/actions/auth'
import { AccountCurlMenu } from '@/components/account-curl-menu'
import { AdminMainFrame } from '@/components/admin/admin-main-frame'
import { AdminNav } from '@/components/admin/admin-nav'
import { PortalPreviewSwitch } from '@/components/portal-preview-switch'
import { SiteFooter } from '@/components/site-footer'
import { UsabilityTracker } from '@/components/usability-tracker'
import { requireReader } from '@/lib/auth/guards'
import { countSubmittedEmailReviewProposals } from '@/lib/email-review/data'
import { ROLE_LABELS, VIEWER_BANNER } from '@/lib/roles'
import { env } from '@/lib/env'
import { DAVID_EMAIL, USABILITY_RETENTION_DAYS } from '@/lib/usability'

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
  // `requireReader`, not `requireAdmin` — the shell has to render for a viewer
  // or they cannot reach the pages that are open to them. It remains a
  // convenience rather than an authorization boundary: every page repeats its
  // own guard, and a nested route handler never runs this at all.
  const admin = await requireReader()
  const config = env()
  const emailReviewPendingCount =
    admin.role === 'OWNER' ? await countSubmittedEmailReviewProposals() : 0
  const accountName =
    admin.name?.trim() ||
    (admin.role === 'OWNER'
      ? 'Mike'
      : admin.role === 'OPERATOR'
        ? 'David'
        : 'Read-only account')
  const usabilityTestActive =
    admin.role === 'OPERATOR' &&
    admin.email.toLowerCase() === DAVID_EMAIL

  return (
    <div className="flex min-h-full flex-col">
      {usabilityTestActive ? <UsabilityTracker basePath={config.BASE_PATH} /> : null}
      <AccountCurlMenu
        name={accountName}
        email={admin.email}
        roleLabel={ROLE_LABELS[admin.role]}
      >
        <div className="grid grid-cols-1 gap-2">
          <Link
            href="/admin/password"
            className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
          >
            Password
          </Link>
          <Link
            href="/admin/security"
            className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
          >
            Two-factor security
          </Link>
          <form action={signOutAction} className="mt-4">
            <button
              type="submit"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
            >
              Sign out
            </button>
          </form>
        </div>
      </AccountCurlMenu>

      <PortalPreviewSwitch mode="ADMIN" role={admin.role} />

      <div className="w-full flex-1 py-6 sm:py-10">
        <header className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <p className="pr-24 text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
            Flipit Global SPV
          </p>

          {/*
            A read-only session says so, permanently and on every screen.
            §22 AC19's refusal page is the control; this is so nobody meets it
            by surprise. It is a banner rather than a hidden button because
            around fifty controls sit behind these pages and hiding each one is
            a list somebody eventually falls off — the refusal is enforced by
            the guards and by the type of `currentAdmin()`, and this explains
            it before it happens.
          */}
          {admin.role === 'VIEWER' ? (
            <p className="mt-4 border-l-2 border-orange bg-orange/6 p-3 text-xs leading-relaxed text-silver2">
              {VIEWER_BANNER}
            </p>
          ) : null}

          {usabilityTestActive ? (
            <p className="mt-4 border-l-2 border-orange bg-orange/6 p-3 text-xs leading-relaxed text-silver2">
              <strong className="text-ftext">Test help is active.</strong> To help
              Mike spot a broken or confusing page, this site counts page visits,
              time, clicks, rapid clicking and browser errors for{' '}
              {USABILITY_RETENTION_DAYS} days. It never records what you type,
              read, ask AI, or click on, and it does not record your screen.
            </p>
          ) : null}

          <div className="mt-6 border-t hairline pt-3">
            <AdminNav
              role={admin.role}
              emailReviewPendingCount={emailReviewPendingCount}
            />
          </div>
        </header>

        <AdminMainFrame>{children}</AdminMainFrame>
      </div>

      <SiteFooter surface="ADMIN" />

      {!config.isProductionDeployment ? (
        <aside
          role="status"
          className="fixed bottom-4 left-1/2 z-30 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full border border-warn/30 bg-bg2/95 px-5 py-3 text-center text-xs leading-relaxed text-dim shadow-2xl backdrop-blur-md"
        >
          <span className="font-semibold text-warn">
            Review-only deployment.
          </span>{' '}
          Use this site to review the service, contracts and invitation wording. Real
          investor invitations are refused from this address, and no sending account is
          connected.
        </aside>
      ) : null}
    </div>
  )
}
