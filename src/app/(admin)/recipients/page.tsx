import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, Pill, SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { formatMoney, formatPercentage } from '@/lib/money'

/** Every figure on this screen is USD, and says so. See lib/portal/data.ts. */
const money = (value: string) => formatMoney(value, { currencyCode: 'USD' })
import { loadBatchContext } from '@/lib/sending/data'
import {
  applyFilters,
  jurisdictionsIn,
  summarise,
  type ReviewFilters,
  type ReviewRow,
} from '@/lib/sending/review'
import { PreflightPanel } from './preflight-panel'
import { SendControl } from './send-row'

export const metadata: Metadata = {
  title: 'Review and send — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The review table and the sending flow. BUILD_SPEC §12, §19, §14.
 *
 * Compliance approval state and mail connection health are at the top and stay
 * there — §12 puts them on the main screen because they are the two things that
 * silently break a send.
 *
 * The four money totals are the four amounts of §5 and no others. They are
 * summed with decimal.js in `lib/sending/review.ts` and arrive here as strings.
 */

function firstParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const raw = params[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return value && value !== '' ? value : null
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-sm border hairline bg-paper p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-dim">
        {label}
      </p>
      <p className="mt-1.5 text-lg font-bold tabular-nums text-white">{value}</p>
      {hint ? <p className="mt-1 text-[10px] leading-snug text-muted">{hint}</p> : null}
    </div>
  )
}

const EMAIL_STATUS_TONE = {
  SENT: 'ok',
  DRAFT: 'neutral',
  FAILED: 'warn',
  BLOCKED: 'warn',
} as const

function RecipientCard({
  row,
  decimalPlaces,
  blockedMessage,
  preflightReady,
}: {
  row: ReviewRow
  decimalPlaces: number
  blockedMessage: string | null
  preflightReady: boolean
}) {
  return (
    <li className="rounded-sm border hairline bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{row.name}</p>
          <p className="truncate text-xs text-dim">{row.email}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Pill tone={EMAIL_STATUS_TONE[row.emailStatus]}>{row.emailStatus}</Pill>
          <Pill tone="neutral">{row.jurisdiction ?? 'No country'}</Pill>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted">Investment</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
            {money(row.proposedAmountUsd)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">SPV %</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
            {formatPercentage(row.spvPercentage, { decimalPlaces })}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Indirect Flipit %</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
            {formatPercentage(row.indirectPercentage, { decimalPlaces })}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Deadline</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
            {row.responseDeadline}
          </dd>
        </div>
      </dl>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted">Account</dt>
          <dd className="mt-0.5 text-silver2">{row.accountStatus}</dd>
        </div>
        <div>
          <dt className="text-muted">Timeline</dt>
          <dd className="mt-0.5 text-silver2">{row.stage.replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt className="text-muted">Response</dt>
          <dd className="mt-0.5 text-silver2">{row.responseChoice.replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt className="text-muted">Last activity</dt>
          <dd className="mt-0.5 text-silver2">
            {row.lastActivityAt ? row.lastActivityAt.toISOString().slice(0, 10) : '—'}
          </dd>
        </div>
      </dl>

      {blockedMessage ? (
        <p className="mt-4 border-l-2 border-warn pl-3 text-xs leading-relaxed text-warn">
          {blockedMessage}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href={`/templates/preview/${row.offerId}`}
          className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-sm font-semibold text-ftext transition-colors hover:border-orange"
        >
          Preview
        </Link>

        <Link
          href={`/recipients/${row.offerId}`}
          className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-sm font-semibold text-ftext transition-colors hover:border-orange"
        >
          Their record
        </Link>

        {blockedMessage ? (
          <p className="text-xs text-dim">
            Sending is refused for this recipient. Everybody else is unaffected.
          </p>
        ) : preflightReady ? (
          <SendControl
            offerId={row.offerId}
            recipientName={row.name}
            recipientEmail={row.email}
            alreadySent={row.emailStatus === 'SENT'}
          />
        ) : (
          <p className="text-xs text-dim">
            Sending unlocks when pre-flight is complete.
          </p>
        )}
      </div>
    </li>
  )
}

export default async function RecipientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireOnboardedAdmin()

  const params = await searchParams
  const context = await loadBatchContext()
  const summary = summarise(context.rows)

  const filters: ReviewFilters = {
    emailStatus: firstParam(params, 'emailStatus') as ReviewFilters['emailStatus'],
    accountStatus: firstParam(params, 'accountStatus') as ReviewFilters['accountStatus'],
    stage: firstParam(params, 'stage'),
    responseChoice: firstParam(params, 'responseChoice') as ReviewFilters['responseChoice'],
    jurisdiction: firstParam(params, 'jurisdiction'),
    deadlineOnOrBefore: firstParam(params, 'deadlineOnOrBefore'),
    search: firstParam(params, 'search'),
  }

  const visible = applyFilters(context.rows, filters)

  const names = new Map(context.rows.map((row) => [row.offerId, row.name]))
  const blockedMessages = new Map(
    context.gate.blocked.map((decision) => [decision.offerId, decision.message]),
  )

  const approvalState = context.approval
    ? context.approval.voidedAt
      ? { tone: 'warn' as const, text: 'Voided — no invitation can be sent' }
      : context.drift.state === 'APPROVED'
        ? { tone: 'ok' as const, text: 'Recorded and current' }
        : { tone: 'warn' as const, text: 'Template has changed since approval' }
    : { tone: 'warn' as const, text: 'None recorded — no invitation can be sent' }

  const mailHealthy = context.mailConnection.state === 'HEALTHY'

  return (
    <>
      <SectionHeading eyebrow="Round" title="Review and send">
        Every recipient in the round, the four money totals, and the pre-flight that
        unlocks sending. Invitations go out one recipient at a time, each behind its own
        confirmation — there is no bulk send anywhere in this application.
      </SectionHeading>

      {/* §12: these two are always visible, because they are what silently breaks a send. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-sm border hairline bg-paper p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-dim">
            Compliance approval
          </p>
          <p className="mt-2">
            <Pill tone={approvalState.tone}>{approvalState.text}</Pill>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            {context.drift.message}
          </p>
        </div>
        <div className="rounded-sm border hairline bg-paper p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-dim">
            Mail connection
          </p>
          <p className="mt-2">
            <Pill tone={mailHealthy ? 'ok' : 'warn'}>{context.mailConnection.state}</Pill>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            {context.mailConnection.summary}
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Recipients" value={String(summary.totalRecipients)} />
        <StatCard label="Sent" value={String(summary.sent)} />
        <StatCard
          label="Portal opened"
          value={String(summary.portalOpened)}
          hint="Claimed and opened. Not an email open — there is no tracking pixel."
        />
        <StatCard label="No response" value={String(summary.noResponse)} />
        <StatCard label="Interested" value={String(summary.interested)} />
        <StatCard label="Not interested" value={String(summary.notInterested)} />
        <StatCard label="Questions" value={String(summary.questions)} />
        <StatCard label="Blocked" value={String(context.gate.blocked.length)} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total proposed" value={money(summary.totalProposedUsd)} />
        <StatCard label="Total committed" value={money(summary.totalCommittedUsd)} />
        <StatCard label="Total accepted" value={money(summary.totalAcceptedUsd)} />
        <StatCard label="Funds received" value={money(summary.totalReceivedUsd)} />
      </div>

      <div className="mb-6">
        <PreflightPanel preflight={context.preflight} names={names} />
      </div>

      <Card
        title={`Recipients (${visible.length} of ${context.rows.length})`}
        description="Filters are links, so a filtered view can be shared or bookmarked."
      >
        <form method="get" className="mb-5 grid gap-3 sm:grid-cols-3">
          <input
            type="search"
            name="search"
            defaultValue={filters.search ?? ''}
            placeholder="Name or email"
            aria-label="Search by name or email"
            className="w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext placeholder:text-muted focus:border-orange"
          />
          <select
            name="emailStatus"
            defaultValue={filters.emailStatus ?? ''}
            aria-label="Filter by email status"
            className="w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext focus:border-orange"
          >
            <option value="">Any email status</option>
            {['DRAFT', 'SENT', 'FAILED', 'BLOCKED'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            name="jurisdiction"
            defaultValue={filters.jurisdiction ?? ''}
            aria-label="Filter by jurisdiction"
            className="w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext focus:border-orange"
          >
            <option value="">Any jurisdiction</option>
            {jurisdictionsIn(context.rows).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext transition-colors hover:border-orange sm:w-auto"
          >
            Apply filters
          </button>
        </form>

        {visible.length === 0 ? (
          <p className="text-sm leading-relaxed text-dim">
            {context.rows.length === 0
              ? 'No recipients in this round yet. Import a file first.'
              : 'No recipient matches those filters.'}
          </p>
        ) : (
          <ul className="grid gap-3">
            {visible.map((row) => (
              <RecipientCard
                key={row.offerId}
                row={row}
                decimalPlaces={context.defaults.decimalPlaces}
                blockedMessage={blockedMessages.get(row.offerId) ?? null}
                preflightReady={context.preflight.ready}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
