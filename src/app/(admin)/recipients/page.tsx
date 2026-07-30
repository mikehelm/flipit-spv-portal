import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, Pill, SectionHeading } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { formatMoney, formatPercentage } from '@/lib/money'

/** Every figure on this screen is USD, and says so. See lib/portal/data.ts. */
const money = (value: string) => formatMoney(value, { currencyCode: 'USD' })
import { loadBatchContext } from '@/lib/sending/data'
import {
  applyFilters,
  anyFilterSet,
  jurisdictionsIn,
  REVIEW_FILTER_CONTROLS,
  summarise,
  type ReviewFilters,
  type ReviewRow,
} from '@/lib/sending/review'
import { PreflightPanel } from './preflight-panel'
import { SendControl } from './send-row'

/** One class for every filter control, so they line up on a narrow screen. */
const SELECT =
  'w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext focus:border-orange'

export const metadata: Metadata = {
  title: 'People — Flipit SPV',
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

function personStatus(row: ReviewRow): {
  label: string
  tone: 'ok' | 'neutral' | 'warn' | 'accent'
} {
  if (row.emailStatus === 'FAILED' || row.emailStatus === 'BLOCKED') {
    return { label: 'Needs attention', tone: 'warn' }
  }
  if (row.emailStatus !== 'SENT') return { label: 'Not sent', tone: 'neutral' }
  if (row.responseChoice === 'INTERESTED') return { label: 'Interested', tone: 'ok' }
  if (row.responseChoice === 'QUESTION') return { label: 'Has a question', tone: 'accent' }
  if (row.responseChoice === 'NOT_INTERESTED') return { label: 'Not interested', tone: 'neutral' }
  return { label: 'Invited', tone: 'ok' }
}

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
  const status = personStatus(row)

  return (
    <li className="rounded-sm border hairline bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{row.name}</p>
          <p className="truncate text-xs text-dim">{row.email}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Pill tone={status.tone}>{status.label}</Pill>
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
            {row.responseDeadline || 'Not set'}
          </dd>
        </div>
      </dl>

      <details className="mt-3 rounded-sm border hairline bg-bg2/35 px-3 py-2.5">
        <summary className="cursor-pointer text-xs font-semibold text-silver2">
          Offer and history details
        </summary>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted">Account</dt>
            <dd className="mt-0.5 text-silver2">
              {row.accountStatus === 'ACTIVE' ? 'Active' : 'Needs attention'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Progress</dt>
            <dd className="mt-0.5 text-silver2">
              {row.stage.toLowerCase().replaceAll('_', ' ')}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Response</dt>
            <dd className="mt-0.5 text-silver2">
              {row.responseChoice === 'NO_RESPONSE'
                ? 'Waiting'
                : row.responseChoice.toLowerCase().replaceAll('_', ' ')}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Last activity</dt>
            <dd className="mt-0.5 text-silver2">
              {row.lastActivityAt ? row.lastActivityAt.toISOString().slice(0, 10) : 'None yet'}
            </dd>
          </div>
        </dl>
      </details>

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
          href={`/recipients/${row.offerId}#draft-invitation-details`}
          className="inline-flex min-h-11 items-center rounded-sm bg-orange px-3 text-sm font-bold text-bg transition-opacity hover:opacity-90"
        >
          Review &amp; edit
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
            Sending unlocks when the remaining checks are complete.
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
  const admin = await requireReader()

  const params = await searchParams
  const context = await loadBatchContext()

  if (context.rows.length === 0) {
    return (
      <>
        <SectionHeading eyebrow="People" title="Add the investor list">
          Upload the spreadsheet once. The application will flag only the rows that need
          attention before anybody can be invited.
        </SectionHeading>
        <Card title="No investors have been added yet">
          <p className="text-sm leading-relaxed text-dim">
            Start with the spreadsheet. Nothing is sent when it is uploaded.
          </p>
          {admin.role !== 'VIEWER' ? (
            <Link
              href="/import"
              className="mt-4 inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink"
            >
              Upload spreadsheet
            </Link>
          ) : (
            <p className="mt-3 text-xs text-dim">
              Mike or David will upload the investor list.
            </p>
          )}
        </Card>
      </>
    )
  }

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
      <SectionHeading eyebrow="People" title="Prepare and invite">
        Fix only the people who need attention, review each invitation, then send one at
        a time.
      </SectionHeading>

      <ol className="mb-6 grid grid-cols-2 overflow-hidden rounded-sm border hairline bg-bg2/45 sm:grid-cols-4">
        {[
          ['1', 'Upload spreadsheet', 'Complete'],
          ['2', 'Fix flagged rows', context.gate.blocked.length > 0 ? 'Needs you' : 'Ready'],
          ['3', 'Review people', summary.sent > 0 ? 'Complete' : 'Current'],
          ['4', 'Invited people', `${summary.sent} sent`],
        ].map(([number, label, state], index) => (
          <li key={label} className={`p-3 ${index > 0 ? 'border-l hairline' : ''}`}>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
              {number}. {label}
            </span>
            <span className="mt-1 block text-xs font-semibold text-silver2">{state}</span>
          </li>
        ))}
      </ol>

      <div className="mb-6">
        <PreflightPanel
          preflight={context.preflight}
          names={names}
          canSendTest={admin.role === 'OPERATOR'}
        />
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label="People" value={String(summary.totalRecipients)} />
        <StatCard label="Sent" value={String(summary.sent)} />
        <StatCard label="Interested" value={String(summary.interested)} />
      </div>

      <details className="mb-6 rounded-sm border hairline bg-bg2/35 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-silver2">
          Round totals and connection details
        </summary>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total proposed" value={money(summary.totalProposedUsd)} />
          <StatCard label="Total committed" value={money(summary.totalCommittedUsd)} />
          <StatCard label="Total accepted" value={money(summary.totalAcceptedUsd)} />
          <StatCard label="Funds received" value={money(summary.totalReceivedUsd)} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-sm border hairline bg-paper p-4">
            <p className="text-xs font-semibold text-ftext">Required approval</p>
            <p className="mt-2"><Pill tone={approvalState.tone}>{approvalState.text}</Pill></p>
            <p className="mt-2 text-xs text-dim">{context.drift.message}</p>
          </div>
          <div className="rounded-sm border hairline bg-paper p-4">
            <p className="text-xs font-semibold text-ftext">Sending account</p>
            <p className="mt-2">
              <Pill tone={mailHealthy ? 'ok' : 'warn'}>
                {mailHealthy ? 'Connected' : 'Needs attention'}
              </Pill>
            </p>
            <p className="mt-2 text-xs text-dim">{context.mailConnection.summary}</p>
          </div>
        </div>
      </details>

      <Card
        title={`People (${visible.length} of ${context.rows.length})`}
        description="Search the list, then open one person to review their offer and next step."
      >
        <form method="get" className="mb-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="search"
              name="search"
              defaultValue={filters.search ?? ''}
              placeholder="Search by name or email"
              aria-label="Search by name or email"
              className="min-h-11 w-full flex-1 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext placeholder:text-muted focus:border-orange"
            />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext transition-colors hover:border-orange"
            >
              Search
            </button>
            {anyFilterSet(filters) ? (
              <Link
                href="/recipients"
                className="inline-flex min-h-11 items-center text-sm text-orange underline"
              >
                Clear
              </Link>
            ) : null}
          </div>

          <details className="mt-3 rounded-sm border hairline bg-bg2/35 px-3 py-2.5">
            <summary className="cursor-pointer text-xs font-semibold text-silver2">
              More filters
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <select
                name="emailStatus"
                defaultValue={filters.emailStatus ?? ''}
                aria-label="Filter by email status"
                className={SELECT}
              >
                <option value="">Any email status</option>
                {REVIEW_FILTER_CONTROLS[0]!.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                name="jurisdiction"
                defaultValue={filters.jurisdiction ?? ''}
                aria-label="Filter by jurisdiction"
                className={SELECT}
              >
                <option value="">Any jurisdiction</option>
                {jurisdictionsIn(context.rows).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              {REVIEW_FILTER_CONTROLS.filter((control) => control.name !== 'emailStatus').map(
                (control) => (
                  <select
                    key={control.name}
                    name={control.name}
                    defaultValue={(filters[control.name] as string | null) ?? ''}
                    aria-label={`Filter by ${control.label.toLowerCase()}`}
                    className={SELECT}
                  >
                    <option value="">{control.anyLabel}</option>
                    {control.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ),
              )}
              <label className="flex flex-col gap-1 text-xs text-muted">
                <span>Deadline on or before</span>
                <input
                  type="date"
                  name="deadlineOnOrBefore"
                  defaultValue={filters.deadlineOnOrBefore ?? ''}
                  aria-label="Filter by deadline, on or before a date"
                  className={SELECT}
                />
              </label>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext transition-colors hover:border-orange"
              >
                Apply filters
              </button>
            </div>
          </details>
        </form>

        {visible.length === 0 ? (
          <p className="text-sm leading-relaxed text-dim">
            {context.rows.length === 0
              ? 'No recipients in this round yet. Import a file first.'
              : 'No recipient matches those filters.'}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3">
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
