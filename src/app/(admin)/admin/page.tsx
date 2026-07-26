import Link from 'next/link'
import { MailConnectionPanel } from '@/components/admin/mail-connection-panel'
import { Card, Notice, Pill, SectionHeading, SecretState } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { onboardingProgress } from '@/lib/auth/onboarding'
import { readOnboardingSnapshot } from '@/lib/auth/onboarding-store'
import { isSendingAccountConfigured, readServiceConfig } from '@/lib/auth/service-config'
import { maskConfigured } from '@/lib/crypto'
import { describeMailConnection } from '@/lib/email/transport'
import { readUnattendedAlert } from '@/lib/health/report'
import { describeAreas } from '@/lib/health/rules'

// The mail connection is read live on every load; a cached "verified" panel is
// worse than no panel.
export const dynamic = 'force-dynamic'

/**
 * Admin overview.
 *
 * Deliberately thin. The review table, the summary cards and the investor
 * timeline are WP7's; this is the shell they land in, plus the configuration
 * facts and the two things §12 says "silently break a send" — the mail
 * connection and, on the compliance screen, the approval.
 */
export default async function AdminHomePage() {
  const admin = await requireReader()
  const config = await readServiceConfig()

  const sendingConfigured = isSendingAccountConfigured(config)
  const mail = describeMailConnection(config)

  // Two queries. `readUnattendedAlert` is deliberately the cheap subset of the
  // health report — see `src/lib/health/report.ts` — because this is the page
  // people land on rather than the one they open to look at the health.
  const alert = await readUnattendedAlert()

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

      {/*
        Only when something needs a person.

        A banner that says "all is well" every day is a banner nobody reads on
        the day it says otherwise, and the health page exists precisely so that
        "nothing shown" is never ambiguous — it lists what it checked and found
        fine. Here, silence is the healthy state and the link below is always
        there, so the absence of a banner is never the absence of a check.
      */}
      {alert.needsAPerson > 0 ? (
        <div className="mb-6">
          <Notice tone="warn">
            {alert.needsAPerson === 1
              ? 'One thing needs you, and nothing else on this screen would tell you about it: '
              : `${alert.needsAPerson} things need you, and nothing else on this screen would tell you about them: `}
            {describeAreas(alert.areas)}.{' '}
            <Link href="/health" className="font-semibold text-orange">
              System health
            </Link>{' '}
            says which, and what to do.
          </Notice>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Service mode">
          <p className="text-sm text-ftext">
            <Pill tone={config.serviceMode === 'ACTIVE' ? 'ok' : 'warn'}>
              {config.serviceMode.replace('_', ' ')}
            </Pill>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-dim">
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
          <p className="mt-3 text-sm leading-relaxed text-dim">
            {sendingConfigured
              ? 'Stored, encrypted. The connection still has to be tested before anything can be sent.'
              : 'Not connected. Nothing can be sent until it is.'}
          </p>
          {admin.role === 'OPERATOR' ? (
            <p className="mt-3">
              <Link
                href="/admin/onboarding"
                className="text-sm font-semibold text-orange"
              >
                Change the sending account
              </Link>
            </p>
          ) : null}
        </Card>

        <MailConnectionPanel health={mail} />

        {admin.role === 'OWNER' ? (
          <Card title="AI-assisted import">
            <SecretState
              label="OpenAI key"
              state={maskConfigured(config.openAiKeyEncrypted)}
            />
            <p className="mt-3 text-sm leading-relaxed text-dim">
              Import works either way — without a key the operator maps columns by hand.
            </p>
            <p className="mt-3">
              <Link href="/admin/settings" className="text-sm font-semibold text-orange">
                Settings
              </Link>
            </p>
          </Card>
        ) : null}

        {admin.role === 'OWNER' ? (
          <Card title="Approved jurisdictions">
            <p className="text-sm text-ftext">
              {config.approvedJurisdictions.length === 0
                ? 'None configured'
                : config.approvedJurisdictions.join(', ')}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-dim">
              Configuration only. A recorded compliance approval is what actually clears
              a recipient, and that control is owner-only and separate from this page.
            </p>
          </Card>
        ) : null}

        <Card title="System health">
          <p className="text-sm leading-relaxed text-dim">
            {alert.needsAPerson > 0
              ? 'Something needs you. The banner above says roughly what; the page says exactly.'
              : 'Nothing needs you. The page lists what was checked and found fine, so an empty answer is never an answer that was not asked for.'}
          </p>
          <p className="mt-3">
            <Link href="/health" className="text-sm font-semibold text-orange">
              System health
            </Link>
          </p>
        </Card>

        {onboarding ? (
          <Card title="Your setup">
            <p className="text-sm text-ftext">
              {onboarding.completedCount} of {onboarding.totalCount} steps complete
            </p>
            <p className="mt-3">
              <Link
                href="/admin/onboarding"
                className="text-sm font-semibold text-orange"
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
