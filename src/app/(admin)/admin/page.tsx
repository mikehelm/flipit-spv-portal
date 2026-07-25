import Link from 'next/link'
import { Card, Pill, SectionHeading, SecretState } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { onboardingProgress } from '@/lib/auth/onboarding'
import { readOnboardingSnapshot } from '@/lib/auth/onboarding-store'
import { isSendingAccountConfigured, readServiceConfig } from '@/lib/auth/service-config'
import { maskConfigured } from '@/lib/crypto'

/**
 * Admin overview.
 *
 * Deliberately thin. The review table, the summary cards, the compliance state
 * and the mail connection health that BUILD_SPEC §12 puts on the main screen
 * are WP6 and WP7; this is the shell they land in, plus the two configuration
 * facts WP2 owns.
 */
export default async function AdminHomePage() {
  const admin = await requireOnboardedAdmin()
  const config = await readServiceConfig()

  const sendingConfigured = isSendingAccountConfigured(config)

  const onboarding =
    admin.role === 'OPERATOR'
      ? onboardingProgress(await readOnboardingSnapshot(admin.id))
      : null

  return (
    <>
      <SectionHeading eyebrow="Overview" title={`Good to see you, ${admin.name ?? admin.email}`}>
        The invitation workflow — recipients, review, sending and the investor timeline —
        arrives on this screen as it is built. What is here now is the configuration the
        rest of it depends on.
      </SectionHeading>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Service mode">
          <p className="text-sm text-[#e7e9f5]">
            <Pill tone={config.serviceMode === 'ACTIVE' ? 'ok' : 'warn'}>
              {config.serviceMode.replace('_', ' ')}
            </Pill>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[#9498b5]">
            {config.serviceMode === 'ACTIVE'
              ? 'Investors can view and respond. Sending is permitted once the other gates pass.'
              : 'Sending is unavailable in this mode. Inviting someone into a portal that will not accept their response is a contradiction the application refuses to allow.'}
          </p>
        </Card>

        <Card title="Sending account">
          <SecretState
            label="Gmail app password"
            state={maskConfigured(config.smtpPasswordEncrypted)}
          />
          <p className="mt-3 text-sm leading-relaxed text-[#9498b5]">
            {sendingConfigured
              ? 'Stored, encrypted. The connection still has to be tested before anything can be sent.'
              : 'Not connected. Nothing can be sent until it is.'}
          </p>
        </Card>

        {admin.role === 'OWNER' ? (
          <Card title="AI-assisted import">
            <SecretState
              label="OpenAI key"
              state={maskConfigured(config.openAiKeyEncrypted)}
            />
            <p className="mt-3 text-sm leading-relaxed text-[#9498b5]">
              Import works either way — without a key the operator maps columns by hand.
            </p>
            <p className="mt-3">
              <Link href="/admin/settings" className="text-sm font-semibold text-[#F59A23]">
                Settings
              </Link>
            </p>
          </Card>
        ) : null}

        {admin.role === 'OWNER' ? (
          <Card title="Approved jurisdictions">
            <p className="text-sm text-[#e7e9f5]">
              {config.approvedJurisdictions.length === 0
                ? 'None configured'
                : config.approvedJurisdictions.join(', ')}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#9498b5]">
              Configuration only. A recorded compliance approval is what actually clears
              a recipient, and that control is owner-only and separate from this page.
            </p>
          </Card>
        ) : null}

        {onboarding ? (
          <Card title="Your setup">
            <p className="text-sm text-[#e7e9f5]">
              {onboarding.completedCount} of {onboarding.totalCount} steps complete
            </p>
            <p className="mt-3">
              <Link
                href="/admin/onboarding"
                className="text-sm font-semibold text-[#F59A23]"
              >
                Review your setup
              </Link>
            </p>
          </Card>
        ) : null}
      </div>
    </>
  )
}
