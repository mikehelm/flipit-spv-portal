'use client'

import { useState } from 'react'
import {
  createSeededEntryAction,
  moveEntryAction,
  recordAnswerAction,
  retryQuestionNotificationAction,
  sendAnswerReplyAction,
  setPinnedAction,
  unpublishEntryAction,
} from '@/actions/qa'
import { ActionForm } from '@/components/admin/action-form'
import { Card, Checkbox, Pill, TextArea, TextInput } from '@/components/admin/ui'
import {
  PUBLISH_COMPLIANCE_NOTICE,
  UNPUBLISH_NOTICE,
  scanForIdentifyingDetail,
} from '@/lib/qa/anonymity'

/**
 * The operator's Q&A surfaces. BUILD_SPEC §6.7.
 *
 * Client components, because the publish box and the side-by-side wording
 * editor react as the operator types — the identifying-detail scan is only
 * useful if it updates while he is rewriting the question, not after he saves.
 *
 * Everything here is presentation. Each form posts to a server action that
 * re-checks the role, re-runs the same scan, and re-applies the publish rules;
 * the scan below is the reminder §6.7.3 asks for, not the enforcement.
 */

const LABEL = 'block text-xs font-semibold uppercase tracking-wider text-silver2'

export interface AnswerFormEntry {
  id: string
  questionOriginal: string
  questionPublic: string | null
  answer: string | null
  isInvestorAsked: boolean
  isPublished: boolean
}

function Findings({ texts }: { texts: string[] }) {
  const findings = scanForIdentifyingDetail(...texts)
  if (findings.length === 0) {
    return (
      <p className="mt-2 text-xs leading-relaxed text-ok">
        Nothing in this wording matched the checks for amounts, percentages, addresses,
        telephone numbers, specific dates, or references to a private conversation. That is
        not the same as it being unidentifiable — read it once as a stranger would.
      </p>
    )
  }

  return (
    <div className="mt-2 border-l-2 border-warn pl-3">
      <p className="text-xs font-semibold text-warn">
        Check these before publishing — any of them can identify the person who asked:
      </p>
      <ul className="mt-1 list-disc pl-4 text-xs leading-relaxed text-dim">
        {findings.map((finding) => (
          <li key={`${finding.kind}-${finding.excerpt}`}>
            {finding.label}: <span className="text-ftext">{finding.excerpt}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * §6.7.2 and §6.7.3 in one form: the answer, the single publish checkbox
 * (unticked by default, always), the side-by-side original and public wording,
 * and the one-line compliance note.
 */
export function AnswerForm({ entry }: { entry: AnswerFormEntry }) {
  const [publish, setPublish] = useState(false)
  const [publicQuestion, setPublicQuestion] = useState(
    entry.questionPublic ?? (entry.isInvestorAsked ? '' : entry.questionOriginal),
  )
  const [answer, setAnswer] = useState(entry.answer ?? '')

  const findingsPresent = publish
    ? scanForIdentifyingDetail(publicQuestion, answer).length > 0
    : false

  return (
    <ActionForm
      action={recordAnswerAction}
      submitLabel={publish ? 'Save and publish' : 'Save answer'}
      hidden={{ entryId: entry.id }}
    >
      <div className="mb-4">
        <label htmlFor={`answer-${entry.id}`} className={LABEL}>
          Your answer
        </label>
        <div className="mt-2">
          <TextArea
            id={`answer-${entry.id}`}
            name="answer"
            rows={6}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Write the answer as you would say it."
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-dim">
          Saving does not email anybody. The reply to the person who asked is a separate
          button below, and it only goes when you press it.
        </p>
      </div>

      <div className="mb-4 rounded-sm border hairline bg-bg2 p-4">
        <Checkbox
          name="publish"
          label="Also publish this answer to the shared Q&A."
          checked={publish}
          onChange={(event) => setPublish(event.target.checked)}
        />
        <p className="mt-2 text-xs leading-relaxed text-dim">
          {PUBLISH_COMPLIANCE_NOTICE}
        </p>
      </div>

      {publish ? (
        <div className="mb-4">
          <p className={LABEL}>The question, side by side</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-sm border hairline bg-bg2 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
                As they wrote it — never published
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-dim">
                {entry.questionOriginal}
              </p>
            </div>
            <div>
              <label htmlFor={`public-${entry.id}`} className="sr-only">
                The public version of the question
              </label>
              <TextArea
                id={`public-${entry.id}`}
                name="questionPublic"
                rows={6}
                value={publicQuestion}
                onChange={(event) => setPublicQuestion(event.target.value)}
                placeholder="Rewrite it in a general form."
              />
            </div>
          </div>

          <Findings texts={[publicQuestion, answer]} />

          {findingsPresent ? (
            <div className="mt-3">
              <Checkbox
                name="acknowledged"
                label="I have read the public wording as a stranger would, and it does not identify anyone."
              />
            </div>
          ) : null}
        </div>
      ) : (
        <input type="hidden" name="questionPublic" value={publicQuestion} />
      )}
    </ActionForm>
  )
}

/** The reply email, rendered exactly as it would be sent (§6.7.2). */
export function ReplyPreview({
  entryId,
  to,
  subject,
  text,
}: {
  entryId: string
  to: string
  subject: string
  text: string
}) {
  return (
    <Card
      title="The reply email"
      description="This is the message, exactly as it would arrive. Nothing has been sent."
    >
      <dl className="text-xs text-dim">
        <div className="flex gap-2">
          <dt className="font-semibold text-silver2">To</dt>
          <dd className="text-ftext">{to}</dd>
        </div>
        <div className="mt-1 flex gap-2">
          <dt className="font-semibold text-silver2">Subject</dt>
          <dd className="text-ftext">{subject}</dd>
        </div>
      </dl>

      <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-sm border hairline bg-bg2 p-3 text-xs leading-relaxed text-silver2">
        {text}
      </pre>

      <div className="mt-4">
        <ActionForm
          action={sendAnswerReplyAction}
          submitLabel="Send this reply"
          hidden={{ entryId }}
        />
      </div>
    </Card>
  )
}

export function PublicationControls({
  entryId,
  pinned,
}: {
  entryId: string
  pinned: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <ActionForm
          action={setPinnedAction}
          submitLabel={pinned ? 'Unpin' : 'Pin to the top'}
          tone="quiet"
          hidden={{ entryId, pinned: pinned ? 'false' : 'true' }}
        />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <ActionForm
            action={moveEntryAction}
            submitLabel="Move up"
            tone="quiet"
            hidden={{ entryId, direction: 'UP' }}
          />
        </div>
        <div className="flex-1">
          <ActionForm
            action={moveEntryAction}
            submitLabel="Move down"
            tone="quiet"
            hidden={{ entryId, direction: 'DOWN' }}
          />
        </div>
      </div>
      <div className="sm:col-span-2">
        <p className="mb-2 text-xs leading-relaxed text-dim">{UNPUBLISH_NOTICE}</p>
        <ActionForm
          action={unpublishEntryAction}
          submitLabel="Remove from the shared page"
          tone="danger"
          hidden={{ entryId }}
        />
      </div>
    </div>
  )
}

export function RetryNotification({ entryId }: { entryId: string }) {
  return (
    <ActionForm
      action={retryQuestionNotificationAction}
      submitLabel="Try the notification again"
      tone="quiet"
      hidden={{ entryId }}
    />
  )
}

/** §6.7.4 — write a pair directly, so the section is not empty on day one. */
export function SeedEntryForm() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  return (
    <ActionForm action={createSeededEntryAction} submitLabel="Save entry">
      <div className="mb-4">
        <label htmlFor="seed-question" className={LABEL}>
          The question
        </label>
        <div className="mt-2">
          <TextInput
            id="seed-question"
            name="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What is the SPV?"
          />
        </div>
      </div>

      <div className="mb-4">
        <label htmlFor="seed-answer" className={LABEL}>
          The answer
        </label>
        <div className="mt-2">
          <TextArea
            id="seed-answer"
            name="answer"
            rows={5}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
        </div>
      </div>

      <Findings texts={[question, answer]} />

      <div className="mt-4 rounded-sm border hairline bg-bg2 p-4">
        <Checkbox name="publish" label="Publish it to the shared Q&A now." />
        <p className="mt-2 text-xs leading-relaxed text-dim">
          {PUBLISH_COMPLIANCE_NOTICE}
        </p>
      </div>
    </ActionForm>
  )
}

export function StatePills({
  awaitingAnswer,
  isPublished,
  replySentAt,
  pinned,
}: {
  awaitingAnswer: boolean
  isPublished: boolean
  replySentAt: string | null
  pinned: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {awaitingAnswer ? <Pill tone="warn">Waiting for an answer</Pill> : null}
      {isPublished ? <Pill tone="ok">On the shared page</Pill> : null}
      {pinned ? <Pill tone="accent">Pinned</Pill> : null}
      {replySentAt ? (
        <Pill tone="neutral">Replied {replySentAt}</Pill>
      ) : (
        <Pill tone="neutral">No reply sent</Pill>
      )}
    </div>
  )
}
