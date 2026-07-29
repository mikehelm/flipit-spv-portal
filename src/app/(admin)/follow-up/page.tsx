import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, Pill, SectionHeading } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { loadQaQueue } from '@/lib/qa/data'
import { loadQueue } from '@/lib/reminders/queue'
import { openRound, loadRoundSummary } from '@/lib/rounds/summary'

export const metadata: Metadata = {
  title: 'Follow-up — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

type FollowUpItem = {
  id: string
  person: string
  reason: string
  href: string
  action: string
}

function Bucket({
  title,
  tone,
  items,
  empty,
}: {
  title: string
  tone: 'ok' | 'warn' | 'accent' | 'neutral'
  items: FollowUpItem[]
  empty: string
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <Pill tone={tone}>{items.length}</Pill>
      </div>
      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-dim">{empty}</p>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-sm border hairline bg-paper p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ftext">{item.person}</p>
                  <p className="mt-1 text-xs leading-relaxed text-dim">{item.reason}</p>
                </div>
                <Link
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink"
                >
                  {item.action}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default async function FollowUpPage() {
  const admin = await requireReader()
  const canAct = admin.role !== 'VIEWER'
  const [round, questions] = await Promise.all([openRound(), loadQaQueue('ALL')])
  const summary = round ? await loadRoundSummary(round.id) : null
  const reminders = round ? await loadQueue(round.id) : []
  const openQuestionAccounts = new Set(
    questions
      .filter((entry) => entry.awaitingAnswer && entry.asker)
      .map((entry) => entry.asker!.accountId),
  )

  const needsReply: FollowUpItem[] = questions
    .filter((entry) => entry.awaitingAnswer && entry.asker)
    .map((entry) => ({
      id: `question-${entry.id}`,
      person: entry.asker!.name,
      reason: 'Their question is waiting for a reply.',
      href: `/questions/${entry.id}`,
      action: canAct ? 'Reply' : 'Inspect',
    }))

  const needsFollowUp: FollowUpItem[] = (summary?.participants ?? [])
    .filter(
      (person) =>
        person.emailStatus === 'SENT' &&
        person.responseChoice === 'NO_RESPONSE' &&
        !person.blocked,
    )
    .sort((left, right) =>
      (left.responseDeadline ?? '9999-12-31').localeCompare(
        right.responseDeadline ?? '9999-12-31',
      ),
    )
    .map((person) => ({
      id: `follow-${person.offerId}`,
      person: person.name,
      reason: person.deadlineReached
        ? `No response. Their ${person.responseDeadline ?? 'unset'} deadline has arrived.`
        : `No response yet. Their deadline is ${person.responseDeadline ?? 'not set'}.`,
      href: `/recipients/${person.offerId}`,
      action: canAct ? 'Review next step' : 'Inspect',
    }))

  const waiting: FollowUpItem[] = reminders
    .filter((reminder) =>
      ['QUEUED', 'HELD', 'SENDING'].includes(reminder.state),
    )
    .map((reminder) => ({
      id: `reminder-${reminder.id}`,
      person: reminder.recipientName,
      reason:
        reminder.state === 'HELD'
          ? 'A planned reminder is waiting for a blocker to be cleared.'
          : `A reminder is planned for ${reminder.scheduledFor.toISOString().slice(0, 10)}.`,
      href: '/reminders',
      action: canAct ? 'Review reminder' : 'Inspect',
    }))

  const completed: FollowUpItem[] = (summary?.participants ?? [])
    .filter(
      (person) =>
        person.responseChoice !== 'NO_RESPONSE' &&
        !openQuestionAccounts.has(person.accountId),
    )
    .map((person) => ({
      id: `complete-${person.offerId}`,
      person: person.name,
      reason:
        person.responseChoice === 'INTERESTED'
          ? 'Their interest is recorded. Their record shows the next stage.'
          : person.responseChoice === 'QUESTION'
            ? 'Their question is recorded.'
            : 'Their response is recorded; no reminder is needed.',
      href: `/recipients/${person.offerId}`,
      action: 'Open record',
    }))

  return (
    <>
      <SectionHeading eyebrow="Follow-up" title="What needs attention">
        One queue for replies, deadline follow-up, planned reminders and completed
        responses.
      </SectionHeading>

      <div className="grid grid-cols-1 gap-7">
        <Bucket
          title="Needs reply"
          tone="warn"
          items={needsReply}
          empty="No investor question is waiting for a reply."
        />
        <Bucket
          title="Needs follow-up"
          tone="accent"
          items={needsFollowUp}
          empty="Nobody currently needs deadline follow-up."
        />
        <Bucket
          title="Waiting"
          tone="neutral"
          items={waiting}
          empty="No planned reminder is waiting."
        />
        <Bucket
          title="Completed"
          tone="ok"
          items={completed}
          empty="Completed responses will appear here."
        />

        <details className="rounded-sm border hairline bg-bg2/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-silver2">
            Advanced communication tools
          </summary>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/questions" className="text-orange">All questions</Link>
            <Link href="/reminders" className="text-orange">Reminder schedule</Link>
            <Link href="/updates" className="text-orange">Updates and audiences</Link>
            <Link href="/round" className="text-orange">Round decisions</Link>
            <Link href="/investors" className="text-orange">Documents and account access</Link>
          </div>
        </details>
      </div>
    </>
  )
}
