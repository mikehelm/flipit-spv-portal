import type { Metadata } from 'next'
import { EmailReviewWorkspace } from '@/components/email-review-workspace'
import { SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
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
  const admin = await requireOnboardedAdmin()
  const aiConfigured = (await loadAiKey()) !== null

  return (
    <div className="space-y-8">
      <SectionHeading eyebrow="Private to Mike and David" title="Review David’s email">
        Compare David&rsquo;s original draft with the current invitation, see what the
        repository actually records about every change, and ask the AI about the whole
        document or one selected clause.
      </SectionHeading>

      <EmailReviewWorkspace
        document={EMAIL_REVIEW_DOCUMENT}
        aiConfigured={aiConfigured}
        canManageAi={admin.role === 'OWNER'}
      />
    </div>
  )
}
