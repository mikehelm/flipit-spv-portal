import Link from 'next/link'
import { GuidedStart } from '@/components/admin/guided-start'
import { InvestorListOverview } from '@/components/admin/investor-list-overview'
import { Notice } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { onboardingProgress } from '@/lib/auth/onboarding'
import { readOnboardingSnapshot } from '@/lib/auth/onboarding-store'
import { readUnattendedAlert } from '@/lib/health/report'
import { countPendingAccessRequests } from '@/lib/access-requests/store'
import { countSubmittedEmailReviewProposals } from '@/lib/email-review/data'
import { loadBatchContext } from '@/lib/sending/data'

export const dynamic = 'force-dynamic'

/**
 * Start is a control centre, not a system dashboard. It gives each role one
 * truthful next action; diagnostics and specialist tools stay available behind
 * More without competing with today's work.
 */
export default async function AdminHomePage() {
  const admin = await requireReader()
  const firstName =
    admin.name?.trim().split(/\s+/)[0] ||
    (admin.role === 'OWNER' ? 'Mike' : admin.role === 'OPERATOR' ? 'David' : 'there')

  const [alert, onboarding, pendingAccessRequests, submittedProposals, investorRows] =
    await Promise.all([
      readUnattendedAlert(),
      admin.role === 'OPERATOR'
        ? readOnboardingSnapshot(admin.id).then(onboardingProgress)
        : Promise.resolve(null),
      admin.role === 'VIEWER' ? Promise.resolve(null) : countPendingAccessRequests(),
      admin.role === 'OWNER'
        ? countSubmittedEmailReviewProposals()
        : Promise.resolve(null),
      admin.role === 'VIEWER'
        ? Promise.resolve([])
        : loadBatchContext().then((context) => context.rows),
    ])

  return (
    <>
      <GuidedStart
        role={admin.role}
        firstName={firstName}
        onboarding={onboarding}
        pendingAccessRequests={pendingAccessRequests}
        submittedProposals={submittedProposals}
      />

      <InvestorListOverview role={admin.role} rows={investorRows} />

      {alert.needsAPerson > 0 ? (
        <div className="mb-6">
          <Notice tone="warn">
            Something outside the normal workflow needs attention.{' '}
            <Link href="/health" className="font-semibold text-orange">
              See what needs fixing
            </Link>
            .
          </Notice>
        </div>
      ) : null}

      <details className="rounded-sm border hairline bg-bg2/35 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-silver2">
          Setup, completed work and system details
        </summary>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <Link href="/more" className="font-semibold text-orange">
            Open More
          </Link>
          <Link href="/health" className="font-semibold text-orange">
            System health
          </Link>
          {admin.role === 'OPERATOR' ? (
            <Link href="/admin/onboarding" className="font-semibold text-orange">
              My setup
            </Link>
          ) : null}
        </div>
      </details>
    </>
  )
}
