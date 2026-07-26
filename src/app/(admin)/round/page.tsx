import type { Metadata } from 'next'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { DIGEST_CADENCE_DAYS, lastDigestAt } from '@/lib/rounds/digest'
import { loadRoundSummary } from '@/lib/rounds/summary'
import { db } from '@/db'
import { desc } from 'drizzle-orm'
import { rounds } from '@/db/schema'
import {
  CloseRoundForm,
  ExtendAllForm,
  ExtendOneForm,
  ReopenRoundForm,
  SendDigestForm,
} from './parts'

export const metadata: Metadata = {
  title: 'The round — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * Where the round stands, and the three things §6.6 says the operator can do
 * about it: close it, extend it for everyone, or extend it for named people.
 *
 * The fourth option is doing nothing, and the page says so in as many words,
 * because §6.6 is emphatic that silence closes nobody's opportunity.
 */
export default async function RoundPage() {
  const admin = await requireReader()

  const round = await db.query.rounds.findFirst({ orderBy: desc(rounds.createdAt) })
  if (!round) {
    return (
      <>
        <SectionHeading eyebrow="The round" title="No round yet" />
        <Card>
          <p className="text-sm text-dim">
            Seed the database or import a recipient list to create the first round.
          </p>
        </Card>
      </>
    )
  }

  const summary = await loadRoundSummary(round.id)
  if (!summary) return null

  const lastDigest = await lastDigestAt(round.id)
  const outstanding = summary.participants.filter(
    (row) => !row.deadlineReached && row.responseChoice === 'NO_RESPONSE',
  ).length

  const chasing = summary.participants.filter(
    (row) => row.responseChoice === 'NO_RESPONSE',
  )

  return (
    <>
      <SectionHeading eyebrow="The round" title={summary.name}>
        A deadline passing changes nothing on its own. It emails you a summary and waits.
        Closing the round is a button, and doing nothing is a legitimate answer.
      </SectionHeading>

      <div className="mb-6 grid grid-cols-1 gap-3">
        {summary.closedAt ? (
          <Notice tone="warn">
            This round was closed on {summary.closedAt.toISOString().slice(0, 10)}. Responses are
            no longer accepted. Investors can still read their own records.
          </Notice>
        ) : null}

        {summary.totals.overCommitted ? (
          <Notice tone="warn">
            Committed ({summary.totals.committed}) exceeds the aggregate raise (
            {summary.totals.aggregate}). This is a warning, not a block — you may be modelling.
          </Notice>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card title="Where it stands">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:grid-cols-4">
            {(
              [
                ['Invited', String(summary.counts.total)],
                ['Responded', String(summary.counts.responded)],
                ['Not responded', String(summary.counts.notResponded)],
                ['Asked for more time', String(summary.counts.extended)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-white">{value}</dd>
              </div>
            ))}
          </dl>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t hairline pt-5 text-sm sm:grid-cols-4">
            {(
              [
                ['Proposed', summary.totals.proposed],
                ['Committed', summary.totals.committed],
                ['Accepted', summary.totals.accepted],
                ['Received', summary.totals.received],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-white">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-xs leading-relaxed text-dim">
            Against an aggregate raise of {summary.totals.aggregate}.{' '}
            {summary.nextDeadline
              ? `The next deadline is ${summary.nextDeadline}.`
              : 'Every deadline has passed.'}
          </p>
        </Card>

        <Card
          title="The deadline summary"
          description={`Emailed to the operator and to nobody else when a deadline is reached, then every ${DIGEST_CADENCE_DAYS} days while the round stays open. No investor is ever told a deadline has passed.`}
        >
          <p className="mb-4 text-sm text-dim">
            {lastDigest
              ? `Last sent ${lastDigest.toISOString().slice(0, 10)}.`
              : 'Not sent yet.'}
          </p>
          <SendDigestForm roundId={round.id} />
        </Card>

        {!summary.closedAt ? (
          <Card
            title="Extend for everyone"
            description="Only people who have not responded are moved."
          >
            <ExtendAllForm roundId={round.id} />
          </Card>
        ) : null}

        {!summary.closedAt && chasing.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">
              Still to respond ({chasing.length})
            </h2>
            <ul className="grid grid-cols-1 gap-3">
              {chasing.map((row) => (
                <li
                  key={row.offerId}
                  className="rounded-sm border hairline bg-paper p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{row.name}</p>
                      <p className="text-xs text-muted">
                        {row.email} · deadline {row.responseDeadline}
                        {row.originalDeadline && row.responseDeadline > row.originalDeadline
                          ? ` · extended from ${row.originalDeadline}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.deadlineReached ? (
                        <Pill tone="warn">Deadline passed</Pill>
                      ) : (
                        <Pill tone="neutral">Time left</Pill>
                      )}
                      {row.emailStatus !== 'SENT' ? (
                        <Pill tone="neutral">Not sent</Pill>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3">
                    <ExtendOneForm
                      offerId={row.offerId}
                      currentDeadline={row.responseDeadline}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {admin.role === 'OWNER' ? (
          <Card
            tone="warn"
            title={summary.closedAt ? 'Reopen the round' : 'Close the round'}
            description={
              summary.closedAt
                ? 'Reopening is recorded with a reason, so a round closed by mistake is recoverable rather than permanent.'
                : 'Nothing closes on its own. This is the only thing that closes it.'
            }
          >
            {summary.closedAt ? (
              <ReopenRoundForm roundId={round.id} />
            ) : (
              <CloseRoundForm roundId={round.id} outstanding={outstanding} />
            )}
          </Card>
        ) : (
          <Card title="Closing the round">
            <Notice>
              Closing and reopening a round are the owner&rsquo;s. Extending a deadline, for one
              person or for everyone, is yours.
            </Notice>
          </Card>
        )}
      </div>
    </>
  )
}
