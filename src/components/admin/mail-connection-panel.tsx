import { ActionForm } from '@/components/admin/action-form'
import { Card, Notice, Pill } from '@/components/admin/ui'
import {
  disconnectSendingAccountAction,
  testMailConnectionAction,
} from '@/actions/mail-connection'
import type { MailConnectionHealth } from '@/lib/email/transport'

/**
 * Mail connection health. BUILD_SPEC §8.1 and §12.
 *
 * WP5 built `readMailConnectionHealth()` and the two actions; nothing rendered
 * them, which meant an operator could save an app password and never be able to
 * test it — and §19's pre-flight requires a verification the operator had no way
 * to perform. This is that surface, in one component so the dashboard and the
 * onboarding step cannot drift apart.
 *
 * The authenticated address is decrypted to build this object, so this component
 * is only ever rendered inside `(admin)`, behind `requireAdmin()`. The app
 * password has no path to it: `MailConnectionHealth` does not carry one.
 */

const TONE: Record<MailConnectionHealth['state'], 'ok' | 'warn' | 'neutral'> = {
  HEALTHY: 'ok',
  STALE: 'warn',
  FAILED: 'warn',
  NEVER_VERIFIED: 'neutral',
  NOT_CONFIGURED: 'neutral',
  TRANSPORT_UNAVAILABLE: 'warn',
}

const LABEL: Record<MailConnectionHealth['state'], string> = {
  HEALTHY: 'Verified',
  STALE: 'Verification stale',
  FAILED: 'Failing',
  NEVER_VERIFIED: 'Never tested',
  NOT_CONFIGURED: 'Not connected',
  TRANSPORT_UNAVAILABLE: 'Transport unavailable',
}

export function MailConnectionPanel({
  health,
  showDisconnect = false,
}: {
  health: MailConnectionHealth
  /** The onboarding step offers it; the overview does not. */
  showDisconnect?: boolean
}) {
  const connected = health.authenticatedAddress !== null

  return (
    <Card title="Mail connection">
      <p className="text-sm text-ftext">
        <Pill tone={TONE[health.state]}>{LABEL[health.state]}</Pill>
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-1 text-sm text-dim sm:grid-cols-[10rem_1fr]">
        <dt>Sends as</dt>
        <dd className="break-all text-ftext">
          {health.authenticatedAddress ?? 'No account connected'}
        </dd>
        <dt>Server</dt>
        <dd className="text-ftext">
          {health.host ? `${health.host}:${health.port}` : '—'}
        </dd>
        <dt>Last verified</dt>
        <dd className="text-ftext">
          {health.lastVerifiedAt ? health.lastVerifiedAt.toISOString() : 'Never'}
        </dd>
      </dl>

      <p className="mt-3 text-sm leading-relaxed text-dim">{health.summary}</p>

      {connected ? (
        <div className="mt-4">
          <ActionForm
            action={testMailConnectionAction}
            submitLabel="Test connection"
            tone="quiet"
          />
          <div className="mt-3">
            <Notice>
              The test authenticates against Gmail and stops. It sends no email to
              anybody, including you.
            </Notice>
          </div>
        </div>
      ) : null}

      {connected && showDisconnect ? (
        <div className="mt-6 border-t hairline pt-4">
          <ActionForm
            action={disconnectSendingAccountAction}
            submitLabel="Disconnect sending account"
            tone="danger"
          />
        </div>
      ) : null}
    </Card>
  )
}
