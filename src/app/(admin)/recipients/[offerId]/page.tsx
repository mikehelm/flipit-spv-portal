import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, offers, rounds } from '@/db/schema'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { readServiceConfig } from '@/lib/auth/service-config'
import { listCertificates } from '@/lib/certificate/issue'
import { formatMoney, formatPercentage } from '@/lib/money'
import { loadStageHistory } from '@/lib/portal/advance'
import { STAGE_LABEL, nextStage } from '@/lib/portal/stages'
import { OFFER_STAGES, type OfferStage } from '@/lib/portal/timeline'
import {
  AcceptedAmountForm,
  AdvanceForm,
  CommitmentForm,
  CorrectionForm,
  FundsReceivedForm,
  ReissueCertificateForm,
} from './parts'

export const metadata: Metadata = {
  title: 'Investor record — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * One investor's record, and the controls that move it along. BUILD_SPEC §5.
 *
 * The four amounts are shown as four amounts, never summed and never collapsed.
 * §5: "Proposed, committed, accepted, and received are four distinct numbers."
 */

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export default async function OfferPage({
  params,
}: {
  params: Promise<{ offerId: string }>
}) {
  await requireReader()

  const { offerId } = await params

  const rows = await db
    .select({
      offer: offers,
      name: investorAccounts.name,
      email: investorAccounts.email,
      accountStatus: investorAccounts.status,
      roundName: rounds.name,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .innerJoin(rounds, eq(offers.roundId, rounds.id))
    .where(eq(offers.id, offerId))
    .limit(1)

  const row = rows[0]
  if (!row) notFound()

  const config = await readServiceConfig()
  const stage = row.offer.stage as OfferStage
  const next = nextStage(stage)
  const history = await loadStageHistory(offerId)
  const certificates = await listCertificates(offerId)

  const decimalPlaces = config.decimalPlaces

  return (
    <>
      <SectionHeading eyebrow="Investor record" title={row.name}>
        <Link href="/recipients" className="text-orange">
          Back to review and send
        </Link>
      </SectionHeading>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-dim">{row.email}</p>
              <p className="text-xs text-muted">
                {row.roundName} · account {row.accountStatus.toLowerCase()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill tone="accent">{STAGE_LABEL[stage]}</Pill>
              {row.offer.blocked ? <Pill tone="warn">Blocked</Pill> : null}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:grid-cols-4">
            {(
              [
                ['Proposed', row.offer.proposedAmountUsd],
                ['Committed', row.offer.committedAmountUsd],
                ['Accepted', row.offer.acceptedAmountUsd],
                ['Received', row.offer.receivedAmountUsd],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-white">
                  {value ? formatMoney(value) : '—'}
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-muted">SPV share</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-white">
                {formatPercentage(row.offer.spvPercentage, { decimalPlaces })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Indirect Flipit</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-white">
                {formatPercentage(row.offer.indirectPercentage, { decimalPlaces })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Deadline</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-white">
                {row.offer.responseDeadline}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Response</dt>
              <dd className="mt-0.5 font-semibold text-white">
                {row.offer.responseChoice.toLowerCase().replace(/_/g, ' ')}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Where they are">
          <ol className="grid grid-cols-1 gap-2">
            {OFFER_STAGES.map((item, index) => {
              const currentIndex = OFFER_STAGES.indexOf(stage)
              const tone =
                index < currentIndex
                  ? 'text-ok'
                  : index === currentIndex
                    ? 'text-orange'
                    : 'text-muted'
              return (
                <li key={item} className={`text-sm ${tone}`}>
                  {index + 1}. {STAGE_LABEL[item]}
                  {index === currentIndex ? ' — where they are now' : ''}
                </li>
              )
            })}
          </ol>
        </Card>

        {next && next !== 'FUNDS_RECEIVED' ? (
          <Card
            title={`Next step: ${STAGE_LABEL[next]}`}
            description="Steps advance one at a time, so their timeline never claims something happened that nobody recorded."
          >
            <AdvanceForm offerId={offerId} nextStage={next} />
          </Card>
        ) : null}

        <Card
          title="Commitment agreed"
          description="The committed amount is stored separately from the proposed one. §5 keeps all four figures distinct."
        >
          <CommitmentForm offerId={offerId} committedAmount={row.offer.committedAmountUsd} />
        </Card>

        <Card title="Allocation accepted">
          <AcceptedAmountForm offerId={offerId} acceptedAmount={row.offer.acceptedAmountUsd} />
        </Card>

        <Card tone="warn" title="Funds received">
          <FundsReceivedForm
            offerId={offerId}
            receivedAmount={row.offer.receivedAmountUsd}
            corrected={row.offer.receivedAmountUsd !== null}
          />
        </Card>

        <Card
          title="Participation certificate"
          description="Issued once funds are received. A correction reissues it and the superseded version is kept on their record."
        >
          {certificates.length === 0 ? (
            <Notice>
              None issued yet. It is generated automatically when funds received is recorded.
            </Notice>
          ) : (
            <ul className="mb-4 grid grid-cols-1 gap-2">
              {certificates.map((certificate) => (
                <li
                  key={certificate.id}
                  className="rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm"
                >
                  <span className="text-ftext">
                    Version {certificate.version} · {certificate.currency}{' '}
                    {certificate.amountReceived} · value date {certificate.valueDate}
                  </span>
                  <span className="ml-2 text-xs text-muted">
                    issued {certificate.issuedAt.toISOString().slice(0, 10)}
                    {certificate.supersededAt ? ' · superseded' : ' · current'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ReissueCertificateForm offerId={offerId} />
        </Card>

        <Card
          title="Corrections"
          description="A reversal is recorded as a correction with a reason, never as a silent overwrite."
        >
          <CorrectionForm offerId={offerId} currentStage={stage} />
        </Card>

        {history.length > 0 ? (
          <Card title="History">
            <ol className="grid grid-cols-1 gap-3">
              {history.map((event) => (
                <li key={event.id} className="border-l-2 border-edge pl-3">
                  <p className="text-sm text-ftext">
                    {event.fromStage ? `${STAGE_LABEL[event.fromStage as OfferStage]} → ` : ''}
                    {STAGE_LABEL[event.toStage as OfferStage]}
                    {event.isCorrection ? ' (correction)' : ''}
                  </p>
                  <p className="text-xs text-muted">{formatDate(event.createdAt)}</p>
                  {event.reason ? (
                    <p className="mt-1 text-xs leading-relaxed text-dim">{event.reason}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        ) : null}
      </div>
    </>
  )
}
