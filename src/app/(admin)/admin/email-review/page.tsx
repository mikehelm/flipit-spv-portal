import type { Metadata } from 'next'
import { EmailReviewWorkspace } from '@/components/email-review-workspace'
import { requireReader } from '@/lib/auth/guards'
import { loadEmailReviewWorkspace } from '@/lib/email-review/data'
import { EMAIL_REVIEW_DOCUMENT } from '@/lib/email-review/document'
import { loadAiKey } from '@/lib/import/persist'

export const metadata: Metadata = {
  title: 'David’s email review — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * Internal source comparison for the two acting administrators.
 *
 * The route is deliberately under the guarded admin layout and repeats the
 * acting/onboarding guard before reading the source material. Nothing in the
 * investor portal imports the document or this component.
 */
export default async function EmailReviewPage() {
  // David can review and propose wording while the remaining onboarding steps
  // (SMTP, test send, optional media) are still in progress. Those gates block
  // sending, not private document preparation.
  const admin = await requireReader()
  const [aiConfigured, workspace] = await Promise.all([
    loadAiKey().then((key) => key !== null),
    loadEmailReviewWorkspace(admin),
  ])

  return (
    <div className="space-y-4">
      <header className="grid items-end gap-3 lg:grid-cols-[minmax(18rem,0.7fr)_minmax(28rem,1.3fr)]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange">
            {admin.role === 'VIEWER'
              ? 'Private experience test'
              : 'Private to Mike and David'}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Review David&rsquo;s email
          </h1>
        </div>
        <p className="max-w-4xl text-xs leading-6 text-dim">
          David&rsquo;s original is on the left. The actual invitation source is on
          the right. Select a change to inspect evidence, ask the AI or propose safer
          wording.
        </p>
      </header>

      <EmailReviewWorkspace
        document={EMAIL_REVIEW_DOCUMENT}
        workspace={workspace}
        aiConfigured={aiConfigured}
        canManageAi={admin.role === 'OWNER'}
        testMode={admin.role === 'VIEWER'}
      />
    </div>
  )
}
