import { confirmPreflightItemAction, resetPreflightAction } from '@/actions/send'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Notice, Pill } from '@/components/admin/ui'
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
  if (item.state === 'PASS') return item.kind === 'ENFORCED' ? 'Verified' : 'Confirmed'
  if (item.state === 'FAIL') return item.kind === 'ENFORCED' ? 'Blocking' : 'Cannot confirm'
  return 'Needs you'
}

function Row({ item, names }: { item: PreflightItem; names: Map<string, string> }) {
  const affected = (item.affectedOfferIds ?? [])
    .map((offerId) => names.get(offerId))
    .filter((name): name is string => Boolean(name))

  return (
    <li className="border-t hairline py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ftext">{item.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-dim">{item.detail}</p>

          {affected.length > 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-dim">
              <span className="text-silver2">Affects:</span> {affected.join(', ')}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Pill tone={toneFor(item)}>{stateLabel(item)}</Pill>
          {item.kind === 'ENFORCED' ? (
            <span className="text-[10px] uppercase tracking-wider text-muted">
              Enforced
            </span>
          ) : null}
        </div>
      </div>

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
}: {
  preflight: PreflightResult
  names: Map<string, string>
}) {
  return (
    <Card
      title="Pre-flight — BUILD_SPEC §19"
      description={
        preflight.ready
          ? 'Complete. Sending is unlocked for every recipient the compliance gate clears — one at a time, each with its own confirmation.'
          : 'Sending stays locked until this is complete. It unlocks per-recipient sending; it does not send anything itself.'
      }
      tone={preflight.ready ? 'ok' : 'warn'}
    >
      <ul className="mb-4">
        {preflight.items.map((item) => (
          <Row key={item.id} item={item} names={names} />
        ))}
      </ul>

      <Notice>
        Eight of these twelve are worked out by the application and cannot be ticked. A
        tick would be a way to assert something untrue about money, a jurisdiction or a
        mail server, and there is no path through this screen that offers one.
      </Notice>

      <div className="mt-5 border-t hairline pt-4">
        <p className="mb-3 text-xs leading-relaxed text-dim">
          Re-imported the recipient file, or changed the template? Clear the checklist and
          walk it again.
        </p>
        <ActionForm
          action={resetPreflightAction}
          submitLabel="Clear pre-flight"
          tone="danger"
        />
      </div>
    </Card>
  )
}
