import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, Notice, SectionHeading } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { readServiceConfig } from '@/lib/auth/service-config'
import { anyRoundOpen, loadQaQueue, type QaQueueEntry } from '@/lib/qa/data'
import { PUBLISH_BLOCK_MESSAGE } from '@/lib/qa/anonymity'
import { QUEUED_PUBLICATION_NOTICE } from '@/lib/qa/visibility'
import { SeedEntryForm, StatePills } from './parts'

export const metadata: Metadata = {
  title: 'Questions — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The questions queue. BUILD_SPEC §6.7.2 — "David sees a queue of open
 * questions with who asked, their offer detail, and their status, so he answers
 * with context rather than blind."
 *
 * `requireReader()` is the authorization for the page; every form on it
 * posts to a server action that checks the role again for itself.
 *
 * Cards rather than a table, mobile-first: an answer is a paragraph of prose
 * and a table row is the wrong shape for it at any width.
 */

function formatDate(value: Date | null): string | null {
  if (!value) return null
  return value.toISOString().slice(0, 10)
}

function QueueEntry({ entry }: { entry: QaQueueEntry }) {
  return (
    <article className="rounded-sm border hairline bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {entry.asker ? entry.asker.name : 'Written by you'}
          </p>
          {entry.asker ? (
            <p className="text-xs text-muted">
              {entry.asker.email} · account {entry.asker.status.toLowerCase()}
            </p>
          ) : (
            <p className="text-xs text-muted">
              This was written directly for the shared questions page.
            </p>
          )}
        </div>
        <StatePills
          awaitingAnswer={entry.awaitingAnswer}
          isPublished={entry.isPublished && entry.unpublishedAt === null}
          replySentAt={formatDate(entry.answerEmailSentAt)}
          pinned={entry.pinned}
        />
      </div>

      {entry.offerSummary ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted">Amount</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
              {entry.offerSummary.proposedAmount}
            </dd>
          </div>
          <div>
            <dt className="text-muted">SPV share</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
              {entry.offerSummary.spvPercentage}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Deadline</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
              {entry.offerSummary.responseDeadline}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Stage</dt>
            <dd className="mt-0.5 font-semibold text-ftext">
              {entry.offerSummary.stage.toLowerCase().replace(/_/g, ' ')}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="mt-4 border-l-2 border-orange pl-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
          {entry.asker ? 'Their question, as they wrote it' : 'The question'}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ftext">
          {entry.questionOriginal}
        </p>
      </div>

      {entry.notifyFailure ? (
        <p className="mt-4 border-l-2 border-warn pl-3 text-xs leading-relaxed text-warn">
          The email telling you about this question did not get out. {entry.notifyFailure}
        </p>
      ) : null}

      {entry.publishBlock ? (
        <p className="mt-4 text-xs leading-relaxed text-dim">
          {PUBLISH_BLOCK_MESSAGE[entry.publishBlock]}
        </p>
      ) : null}

      <div className="mt-5">
        <Link
          href={`/questions/${entry.id}`}
          className="inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink"
        >
          {entry.awaitingAnswer ? 'Answer this' : 'Open'}
        </Link>
      </div>
    </article>
  )
}

export default async function QuestionsPage() {
  await requireReader()

  const entries = await loadQaQueue('ALL')
  const config = await readServiceConfig()
  const roundOpen = await anyRoundOpen()
  const sharedHidden = !config.qaVisibleDuringRaise && roundOpen

  const open = entries.filter((entry) => entry.awaitingAnswer)
  const answered = entries.filter((entry) => !entry.awaitingAnswer)

  return (
    <>
      <SectionHeading eyebrow="Questions and answers" title="Questions">
        A private raise generates the same five questions twenty times. Answer once here,
        privately to the person who asked; publish the ones worth everyone seeing, with
        their identity removed.
      </SectionHeading>

      {sharedHidden ? (
        <div className="mb-6">
          <Notice>{QUEUED_PUBLICATION_NOTICE}</Notice>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">
            Waiting for an answer{open.length > 0 ? ` (${open.length})` : ''}
          </h2>
          {open.length === 0 ? (
            <Card>
              <p className="text-sm text-dim">
                Nothing is waiting. New questions appear here and email you as they arrive.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {open.map((entry) => (
                <QueueEntry key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </section>

        {answered.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">
              Answered ({answered.length})
            </h2>
            <div className="grid grid-cols-1 gap-4">
              {answered.map((entry) => (
                <QueueEntry key={entry.id} entry={entry} />
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <Card
            title="Write an entry yourself"
            description="You do not have to wait to be asked. A question-and-answer pair written here has no asker behind it, so there is nobody to anonymise — it is how the shared section looks useful on day one."
          >
            <SeedEntryForm />
          </Card>
        </section>
      </div>
    </>
  )
}
