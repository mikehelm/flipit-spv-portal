import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { checkTemplateDrift } from '@/lib/compliance/drift'
import { readMailConnectionHealth } from '@/lib/email/transport'
import { readServiceConfig } from '@/lib/auth/service-config'
import { currentRound, loadQueue, loadSchedule, type QueueRow } from '@/lib/reminders/queue'
import { REMINDER_HOUR_UTC } from '@/lib/reminders/schedule'
import { CancelButton, CancelManyForm, RefreshButton, RescheduleForm, ScheduleForm } from './parts'

export const metadata: Metadata = {
  title: 'Reminders — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The reminder queue. BUILD_SPEC §6.5.
 *
 * *"Visible and cancellable."* Every queued reminder is on this page with its
 * date, its recipient, and — when it will not send — the reason, evaluated now
 * rather than when the row was written.
 *
 * There is no send button anywhere on this page. Reminders are the one
 * unattended sender in the system and they go out from the scheduled job, under
 * the §6.5 constraints. A second path into the same transport with a different
 * set of checks in front of it is how the two eventually disagree.
 */

function formatWhen(value: Date): string {
  return `${value.toISOString().slice(0, 10)} ${value.toISOString().slice(11, 16)} UTC`
}

function forInput(value: Date): string {
  return value.toISOString().slice(0, 16)
}

function StatePill({ row }: { row: QueueRow }) {
  switch (row.state) {
    case 'SENT':
      return <Pill tone="ok">Sent {row.sentAt ? formatWhen(row.sentAt) : ''}</Pill>
    case 'CANCELLED':
      return <Pill tone="neutral">Cancelled</Pill>
    case 'SKIPPED':
      return <Pill tone="warn">Skipped</Pill>
    case 'HELD':
      return <Pill tone="warn">Will not send</Pill>
    default:
      return <Pill tone="accent">Queued</Pill>
  }
}

function QueueEntry({ row }: { row: QueueRow }) {
  const pending = row.state === 'QUEUED' || row.state === 'HELD'

  return (
    <li className="rounded-sm border hairline bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{row.recipientName}</p>
          <p className="text-xs text-muted">
            {row.recipientEmail} · reminder {row.sequence} · deadline {row.responseDeadline}
          </p>
          <p className="mt-1 text-xs tabular-nums text-silver2">
            {formatWhen(row.scheduledFor)}
          </p>
        </div>
        <StatePill row={row} />
      </div>

      {!row.eligibility.eligible ? (
        <p className="mt-3 border-l-2 border-warn pl-3 text-xs leading-relaxed text-dim">
          {row.eligibility.message}
        </p>
      ) : null}

      {row.skippedReason ? (
        <p className="mt-3 border-l-2 border-orange pl-3 text-xs leading-relaxed text-dim">
          {row.skippedReason}
        </p>
      ) : null}

      {pending ? (
        <div className="mt-4 flex flex-wrap items-start gap-2">
          <CancelButton reminderId={row.id} />
          <RescheduleForm reminderId={row.id} scheduledFor={forInput(row.scheduledFor)} />
        </div>
      ) : null}
    </li>
  )
}

export default async function RemindersPage() {
  await requireOnboardedAdmin()

  const round = await currentRound()
  const config = await readServiceConfig()
  const mail = await readMailConnectionHealth()
  const drift = await checkTemplateDrift('REMINDER')

  const schedule = round ? await loadSchedule(round.id) : null
  const queue = round ? await loadQueue(round.id) : []

  const pending = queue.filter((row) => row.state === 'QUEUED' || row.state === 'HELD')
  const done = queue.filter((row) => row.state !== 'QUEUED' && row.state !== 'HELD')

  return (
    <>
      <SectionHeading eyebrow="Reminders" title="Reminders">
        The only thing in this application that sends without somebody pressing send at that
        moment. Everything below exists so that it is never a surprise: the queue is visible,
        every row says whether it will go and why, and any of them can be cancelled or moved
        until it does.
      </SectionHeading>

      <div className="mb-6 grid gap-3">
        {config.serviceMode !== 'ACTIVE' ? (
          <Notice tone="warn">
            The service mode is {config.serviceMode}. Nothing sends outside active mode — the
            queue below is what would go out if it were active.
          </Notice>
        ) : null}

        {drift.state !== 'APPROVED' ? (
          <Notice tone="warn">
            {drift.message} The reminder has its own compliance approval, separate from the
            invitation&rsquo;s, and no reminder sends without it.{' '}
            <Link href="/compliance" className="text-orange">
              Compliance
            </Link>
          </Notice>
        ) : null}

        {mail.state !== 'HEALTHY' ? (
          <Notice tone="warn">{mail.summary}</Notice>
        ) : null}

        <Notice>
          Reminders carry no amounts, no percentages and no offer terms — only the deadline and
          the portal link. Those figures live in the portal, which is where the investor should
          be looking.
        </Notice>
      </div>

      <div className="grid gap-6">
        <Card
          title="The schedule"
          description={`Reminders go out at ${String(REMINDER_HOUR_UTC).padStart(2, '0')}:00 UTC on the day they are due.`}
        >
          {round ? (
            <ScheduleForm
              daysBefore={schedule?.daysBefore ?? [7, 2]}
              maxPerRecipient={schedule?.maxPerRecipient ?? 2}
              enabled={schedule?.enabled ?? true}
            />
          ) : (
            <p className="text-sm text-dim">
              There is no open round, so there is nothing to schedule.
            </p>
          )}
        </Card>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">
              Upcoming{pending.length > 0 ? ` (${pending.length})` : ''}
            </h2>
            <div className="w-full sm:w-auto">
              <RefreshButton />
            </div>
          </div>

          {pending.length === 0 ? (
            <Card>
              <p className="text-sm leading-relaxed text-dim">
                Nothing is queued. A reminder is planned only for somebody who has been sent an
                invitation, has not responded, is not blocked, and whose deadline has not
                passed — so an empty queue usually means everybody has answered.
              </p>
            </Card>
          ) : (
            <ul className="grid gap-3">
              {pending.map((row) => (
                <QueueEntry key={row.id} row={row} />
              ))}
            </ul>
          )}
        </section>

        {pending.length > 1 ? (
          <Card
            title="Cancel several at once"
            description="Cancelling in bulk removes messages. There is no button anywhere that sends several."
          >
            <CancelManyForm
              reminders={pending.map((row) => ({
                id: row.id,
                label: `${row.recipientName} — ${formatWhen(row.scheduledFor)}`,
              }))}
            />
          </Card>
        ) : null}

        {done.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">
              Sent, cancelled and skipped ({done.length})
            </h2>
            <ul className="grid gap-3">
              {done.map((row) => (
                <QueueEntry key={row.id} row={row} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  )
}
