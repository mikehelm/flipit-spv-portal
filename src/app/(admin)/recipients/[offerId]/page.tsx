import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, offers, recipients, rounds } from '@/db/schema'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { readServiceConfig } from '@/lib/auth/service-config'
import { listCertificates } from '@/lib/certificate/issue'
import { formatMoney, formatPercentage } from '@/lib/money'
import { loadStageHistory } from '@/lib/portal/advance'
import { STAGE_LABEL, nextStage, stageIndex } from '@/lib/portal/stages'
import { OFFER_STAGES, type OfferStage } from '@/lib/portal/timeline'
import {
  AcceptedAmountForm,
  AdvanceForm,
  CommitmentForm,
  CorrectionForm,
  FundsReceivedForm,
  ReissueCertificateForm,
  RecipientDraftForm,
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
  const admin = await requireReader()

  const { offerId } = await params

  const rows = await db
    .select({
      offer: offers,
      accountName: investorAccounts.name,
      accountEmail: investorAccounts.email,
      recipientId: recipients.id,
      recipientName: recipients.name,
      recipientEmail: recipients.email,
      jurisdiction: recipients.jurisdiction,
      accountStatus: investorAccounts.status,
      roundName: rounds.name,
    })
    .from(offers)
    .innerJoin(investorAccounts, eq(offers.accountId, investorAccounts.id))
    .leftJoin(recipients, eq(offers.recipientId, recipients.id))
    .innerJoin(rounds, eq(offers.roundId, rounds.id))
    .where(eq(offers.id, offerId))
    .limit(1)

  const row = rows[0]
  if (!row) notFound()

  const config = await readServiceConfig()
  const stage = row.offer.stage as OfferStage
  const next = nextStage(stage)
  const currentStage = stageIndex(stage)
  const history = await loadStageHistory(offerId)
  const certificates = await listCertificates(offerId)

  const decimalPlaces = config.decimalPlaces

  return (
    <>
      <SectionHeading eyebrow="Investor record" title={row.recipientName ?? row.accountName}>
        <Link href="/recipients" className="text-orange">
          Back to People
        </Link>
      </SectionHeading>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-dim">{row.recipientEmail ?? row.accountEmail}</p>
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
                {row.offer.responseDeadline ?? 'Not set'}
              </dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={`/templates/preview/${offerId}`}
              className="inline-flex min-h-11 items-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext hover:border-orange"
            >
              Preview invitation
            </Link>
            <Link
              href="/recipients"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-orange"
            >
              Check readiness
            </Link>
          </div>
        </Card>

        {admin.role !== 'VIEWER' && row.recipientId ? (
          <Card
            title="Draft invitation details"
            description="These details can be completed after import. Saving never sends an email."
          >
            <RecipientDraftForm
              offerId={offerId}
              name={row.recipientName ?? row.accountName}
              email={row.recipientEmail ?? row.accountEmail}
              jurisdiction={row.jurisdiction}
              responseDeadline={row.offer.responseDeadline}
            />
          </Card>
        ) : null}

        <details className="rounded-sm border hairline bg-paper p-5">
          <summary className="cursor-pointer text-sm font-semibold text-white">
            Full timeline
          </summary>
          <ol className="mt-4 grid grid-cols-1 gap-2">
            {OFFER_STAGES.map((item, index) => {
              const tone =
                index < currentStage
                  ? 'text-ok'
                  : index === currentStage
                    ? 'text-orange'
                    : 'text-muted'
              return (
                <li key={item} className={`text-sm ${tone}`}>
                  {index + 1}. {STAGE_LABEL[item]}
                  {index === currentStage ? ' — current' : ''}
                </li>
              )
            })}
          </ol>
        </details>

        {next && next !== 'FUNDS_RECEIVED' ? (
          <Card
            title={`Next step: ${STAGE_LABEL[next]}`}
            description="Steps advance one at a time, so their timeline never claims something happened that nobody recorded."
          >
            <AdvanceForm offerId={offerId} nextStage={next} />
          </Card>
        ) : null}

        {currentStage >= stageIndex('RESPONSE_RECORDED') ? (
          <Card title="Response and conversation">
            <p className="text-sm text-silver2">
              Response:{' '}
              <span className="font-semibold text-ftext">
                {row.offer.responseChoice === 'NO_RESPONSE'
                  ? 'Waiting'
                  : row.offer.responseChoice.toLowerCase().replaceAll('_', ' ')}
              </span>
            </p>
            <Link
              href="/questions"
              className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-orange"
            >
              Open questions and conversation
            </Link>
          </Card>
        ) : null}

        {currentStage >= stageIndex('DOCUMENTS_ISSUED') ? (
          <Card title="Documents">
            <p className="text-sm leading-relaxed text-dim">
              The document package and its previous versions are kept with this person’s
              account.
            </p>
            <Link
              href="/investors"
              className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-orange"
            >
              Open documents
            </Link>
          </Card>
        ) : null}

        {currentStage >= stageIndex('DOCUMENTS_ISSUED') ? (
          <Card
            title="Commitment agreed"
            description="Record the amount this person has agreed to invest. It remains separate from the amount first offered."
          >
            <CommitmentForm offerId={offerId} committedAmount={row.offer.committedAmountUsd} />
          </Card>
        ) : null}

        {currentStage >= stageIndex('COMMITMENT_AGREED') ? (
          <Card title="Allocation accepted">
            <AcceptedAmountForm offerId={offerId} acceptedAmount={row.offer.acceptedAmountUsd} />
          </Card>
        ) : null}

        {currentStage >= stageIndex('PAYMENT_INSTRUCTIONS_ISSUED') ? (
          <Card tone="warn" title="Funds received">
            <FundsReceivedForm
              offerId={offerId}
              receivedAmount={row.offer.receivedAmountUsd}
              corrected={row.offer.receivedAmountUsd !== null}
            />
          </Card>
        ) : null}

        {currentStage >= stageIndex('COMPLETED') ? (
          <Card
            title="Participation certificate"
            description="Issued once funds are received. A correction reissues it and keeps the previous version in the history."
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
                      {certificate.supersededAt ? ' · previous version' : ' · current'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ReissueCertificateForm offerId={offerId} />
          </Card>
        ) : null}

        <details className="rounded-sm border hairline bg-paper p-5">
          <summary className="cursor-pointer text-sm font-semibold text-white">
            Corrections and history
          </summary>
          <div className="mt-5 grid grid-cols-1 gap-6">
            <div>
              <h2 className="text-sm font-semibold text-ftext">Record a correction</h2>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                A reversal is recorded with a reason, never as a silent overwrite.
              </p>
              <div className="mt-3">
                <CorrectionForm offerId={offerId} currentStage={stage} />
              </div>
            </div>
            {history.length > 0 ? (
              <div>
                <h2 className="text-sm font-semibold text-ftext">History</h2>
                <ol className="mt-3 grid grid-cols-1 gap-3">
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
              </div>
            ) : (
              <p className="text-xs text-dim">No changes have been recorded yet.</p>
            )}
          </div>
        </details>
      </div>
    </>
  )
}
