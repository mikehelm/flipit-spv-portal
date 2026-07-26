import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Notice, SectionHeading } from '@/components/admin/ui'
import { requireReader } from '@/lib/auth/guards'
import { loadOwnThreads, loadQaEntry } from '@/lib/qa/data'
import { previewAnswerReply } from '@/lib/qa/service'
import { UNPUBLISH_NOTICE } from '@/lib/qa/anonymity'
import {
  AnswerForm,
  PublicationControls,
  ReplyPreview,
  RetryNotification,
  StatePills,
} from '../parts'

export const metadata: Metadata = {
  title: 'Answer a question — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * One question, with everything needed to answer it (§6.7.2).
 *
 * The three things the spec keeps apart are kept apart on the page too, in
 * their own cards and with their own buttons: **save the answer**, **publish
 * it**, **send the reply**. There is no single button that does two of them.
 */

function formatDate(value: Date | null): string | null {
  if (!value) return null
  return value.toISOString().slice(0, 10)
}

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ entryId: string }>
}) {
  await requireReader()

  const { entryId } = await params
  const entry = await loadQaEntry(entryId)
  if (!entry) notFound()

  const thread = entry.asker ? await loadOwnThreads(entry.asker.accountId) : []
  const messages = thread.find((item) => item.entryId === entry.id)?.messages ?? []

  const preview = entry.answer?.trim() ? await previewAnswerReply(entry.id) : null
  const isPublished = entry.isPublished && entry.unpublishedAt === null

  return (
    <>
      <SectionHeading eyebrow="Questions and answers" title="Answer a question">
        <Link href="/questions" className="text-orange">
          Back to the queue
        </Link>
      </SectionHeading>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">
                {entry.asker ? entry.asker.name : 'Written by you'}
              </p>
              {entry.asker ? (
                <p className="text-xs text-muted">
                  {entry.asker.email} · account {entry.asker.status.toLowerCase()} · asked{' '}
                  {formatDate(entry.createdAt)}
                </p>
              ) : null}
            </div>
            <StatePills
              awaitingAnswer={entry.awaitingAnswer}
              isPublished={isPublished}
              replySentAt={formatDate(entry.answerEmailSentAt)}
              pinned={entry.pinned}
            />
          </div>

          {entry.offerSummary ? (
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Investment amount</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-white">
                  {entry.offerSummary.proposedAmount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Share of the SPV</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-white">
                  {entry.offerSummary.spvPercentage}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Indirect Flipit interest</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-white">
                  {entry.offerSummary.indirectPercentage}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Response deadline</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-white">
                  {entry.offerSummary.responseDeadline}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Stage</dt>
                <dd className="mt-0.5 font-semibold text-white">
                  {entry.offerSummary.stage.toLowerCase().replace(/_/g, ' ')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Round</dt>
                <dd className="mt-0.5 font-semibold text-white">
                  {entry.offerSummary.roundName}
                </dd>
              </div>
            </dl>
          ) : null}
        </Card>

        {entry.notifyFailure ? (
          <Card tone="warn" title="The notification did not get out">
            <p className="text-sm leading-relaxed text-dim">{entry.notifyFailure}</p>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              The question itself is recorded and nothing has been lost. The person who asked
              was not told anything about this.
            </p>
            <div className="mt-4">
              <RetryNotification entryId={entry.id} />
            </div>
          </Card>
        ) : null}

        <Card title="The conversation">
          {messages.length === 0 ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ftext">
              {entry.questionOriginal}
            </p>
          ) : (
            <ol className="grid grid-cols-1 gap-4">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={`border-l-2 pl-3 ${
                    message.from === 'YOU' ? 'border-orange' : 'border-ok'
                  }`}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
                    {message.from === 'YOU' ? 'They asked' : 'You replied'} ·{' '}
                    {formatDate(message.at)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ftext">
                    {message.body}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card
          title="Your answer"
          description="Saving stores it. Publishing puts an anonymised version on the shared page. Emailing the person who asked is a third, separate press."
        >
          <AnswerForm
            entry={{
              id: entry.id,
              questionOriginal: entry.questionOriginal,
              questionPublic: entry.questionPublic,
              answer: entry.answer,
              isInvestorAsked: entry.asker !== null,
              isPublished,
            }}
          />
        </Card>

        {preview && entry.asker ? (
          <ReplyPreview
            entryId={entry.id}
            to={preview.to}
            subject={preview.subject}
            text={preview.text}
          />
        ) : entry.asker ? (
          <Card>
            <Notice>
              Write and save the answer first — there is nothing to preview or send yet.
            </Notice>
          </Card>
        ) : null}

        {isPublished ? (
          <Card title="On the shared page" description={UNPUBLISH_NOTICE}>
            <PublicationControls entryId={entry.id} pinned={entry.pinned} />
          </Card>
        ) : null}
      </div>
    </>
  )
}
