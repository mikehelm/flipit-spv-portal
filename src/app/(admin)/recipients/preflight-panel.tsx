import { confirmPreflightItemAction, resetPreflightAction } from '@/actions/send'
import { sendTestInvitationAction } from '@/actions/send-test'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Field, Notice, Pill, Select } from '@/components/admin/ui'
import type { PreflightItem, PreflightResult } from '@/lib/sending/preflight'

/**
 * The §19 pre-flight checklist.
 *
 * Enforced items show their state and offer nothing to click. That is the
 * point: there is no tick, no override and no "proceed anyway" for a mail
 * server that is not connected or a compliance approval that does not exist.
 * The four attested items get a confirm button, and confirming records the
 * operator's name and the time in the audit log.
 */

function toneFor(item: PreflightItem): 'ok' | 'warn' | 'accent' {
  if (item.state === 'PASS') return 'ok'
  if (item.state === 'FAIL') return 'warn'
  return 'accent'
}

function stateLabel(item: PreflightItem): string {
  if (item.state === 'PASS') return 'Ready'
  if (item.state === 'FAIL') return 'Blocked'
  return 'Needs you'
}

const FRIENDLY_LABEL: Partial<Record<PreflightItem['id'], string>> = {
  SENDER_IDENTITY_RESOLVES: 'Sender contact details are complete',
  TEMPLATE_RENDERS_FOR_EVERY_RECIPIENT: 'Every invitation is complete',
  SERVICE_MODE_ACTIVE: 'The service is ready',
  MAIL_CONNECTION_VERIFIED: 'The sending account is connected',
  TEMPLATE_HASH_MATCHES_APPROVAL: 'The approved wording has not changed',
  COMPLIANCE_APPROVAL_CURRENT: 'The required approval is current',
}

function friendlyDetail(detail: string): string {
  return detail
    .replaceAll('sender_phone', 'sender phone')
    .replaceAll('sender_email', 'sender email')
    .replaceAll('sender_name', 'sender name')
    .replace(/\s*\(§\d+(?:\.\d+)?\)/g, '')
}

/**
 * §13.3's prompt, sitting on the checklist item it answers. BUILD_SPEC §22 AC34.
 *
 * *"Offer him a test email first … This should be a prompt in the flow, not a
 * feature he has to find."* So it is here, attached to the pre-flight line that
 * asks whether a test was sent, rather than on a screen of its own — and it is
 * offered before the tick rather than after it, because ticking a box about an
 * email you have not sent is the failure mode the item exists to catch.
 *
 * The address is not a field. It is the operator's own, read from the
 * allowlist, and the send gate refuses a test addressed anywhere else.
 */
function TestSendPrompt({ names }: { names: Map<string, string> }) {
  const options = [...names.entries()].map(([offerId, name]) => ({
    value: offerId,
    label: name,
  }))

  if (options.length === 0) return null

  return (
    <div className="mt-3 rounded-sm border hairline bg-bg2 p-4">
      <p className="text-sm leading-relaxed text-silver2">
        Send yourself the complete invitation &mdash; the designed email, this
        person&rsquo;s real figures, the portal link and anything behind it &mdash; and
        open it the way they will. It goes to your own address and nowhere else.
      </p>

      <div className="mt-4">
        <ActionForm action={sendTestInvitationAction} submitLabel="Send it to me" tone="quiet">
          <Field
            label="Rendered from"
            name="offerId"
            hint="Their real amount, percentages and deadline. The portal link is deliberately not a working one — a test never issues a token that could be spent."
          >
            <Select name="offerId" options={options} />
          </Field>
        </ActionForm>
      </div>
    </div>
  )
}

function Row({
  item,
  names,
  canSendTest,
}: {
  item: PreflightItem
  names: Map<string, string>
  canSendTest: boolean
}) {
  const affected = (item.affectedOfferIds ?? [])
    .map((offerId) => names.get(offerId))
    .filter((name): name is string => Boolean(name))

  return (
    <li className="border-t hairline py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ftext">
            {FRIENDLY_LABEL[item.id] ?? item.label}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-dim">
            {friendlyDetail(item.detail)}
          </p>

          {affected.length > 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-dim">
              <span className="text-silver2">Affects:</span> {affected.join(', ')}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-end">
          <Pill tone={toneFor(item)}>{stateLabel(item)}</Pill>
        </div>
      </div>

      {item.id === 'TEST_EMAIL_SENT_AND_REVIEWED' && canSendTest ? (
        <TestSendPrompt names={names} />
      ) : null}

      {item.kind === 'ATTESTED' && item.state === 'AWAITING_CONFIRMATION' ? (
        <div className="mt-3">
          <ActionForm
            action={confirmPreflightItemAction}
            submitLabel="I confirm this"
            tone="quiet"
            hidden={{ item: item.id }}
          />
        </div>
      ) : null}
    </li>
  )
}

export function PreflightPanel({
  preflight,
  names,
  canSendTest,
}: {
  preflight: PreflightResult
  names: Map<string, string>
  /** §13.3's test send is the operator's own. The action refuses anyone else. */
  canSendTest: boolean
}) {
  const unresolved = preflight.items.filter((item) => item.state !== 'PASS')
  const passed = preflight.items.filter((item) => item.state === 'PASS')

  return (
    <Card
      title={preflight.ready ? 'Ready to invite' : `${unresolved.length} things need attention`}
      description={
        preflight.ready
          ? 'The safety checks are complete. Each invitation still requires its own confirmation.'
          : 'Invitations remain locked. Complete the items below; the system will keep checking everything else.'
      }
      tone={preflight.ready ? 'ok' : 'warn'}
    >
      {unresolved.length > 0 ? (
        <ul>
          {unresolved.map((item) => (
            <Row key={item.id} item={item} names={names} canSendTest={canSendTest} />
          ))}
        </ul>
      ) : (
        <Notice>Nothing needs fixing before you review an individual invitation.</Notice>
      )}

      <details className="mt-4 rounded-sm border hairline bg-bg2/45 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-silver2">
          {passed.length} safety checks passed
        </summary>
        <ul className="mt-3">
          {passed.map((item) => (
          <Row key={item.id} item={item} names={names} canSendTest={canSendTest} />
          ))}
        </ul>
      </details>

      <details className="mt-3 rounded-sm border hairline bg-bg2/45 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted">
          Advanced checklist controls
        </summary>
        <div className="mt-3">
          <p className="mb-3 text-xs leading-relaxed text-dim">
            If the list or invitation wording changed, clear the confirmations and review
            them again.
          </p>
          <ActionForm
            action={resetPreflightAction}
            submitLabel="Clear confirmations"
            tone="danger"
          />
        </div>
      </details>
    </Card>
  )
}
