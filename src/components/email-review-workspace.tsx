'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  askEmailReviewQuestionAction,
  idleEmailReviewAiState,
} from '@/actions/email-review'
import {
  EMAIL_REVIEW_MODEL_LABEL,
  MAX_EMAIL_REVIEW_QUESTION_LENGTH,
} from '@/lib/email-review/model'
import type {
  EmailReviewClause,
  EmailReviewDocument,
  EmailReviewEvidenceKind,
} from '@/lib/email-review/document'

type WorkspaceView = 'COMPARE' | 'CLAUSES' | 'ASK'
type ClauseFilter = 'ALL' | EmailReviewEvidenceKind

function EvidenceBadge({ kind }: { kind: EmailReviewEvidenceKind }) {
  const style = {
    SPEC: 'border-ok/35 bg-ok/8 text-ok',
    TEST: 'border-blue-300/30 bg-blue-300/8 text-blue-200',
    UNVERIFIED: 'border-warn/40 bg-warn/10 text-warn',
  }[kind]

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${style}`}
    >
      {kind}
    </span>
  )
}

function AskButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-sm bg-orange px-5 text-sm font-bold text-ink transition-colors hover:bg-orange-soft disabled:cursor-progress disabled:opacity-60"
    >
      {pending ? 'Reviewing the evidence…' : 'Ask about the email'}
    </button>
  )
}

function ClauseSummary({ clause }: { clause: EmailReviewClause }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-sm border hairline bg-bg/45 p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
          Original
        </p>
        <p className="mt-2 text-sm leading-relaxed text-dim">{clause.original}</p>
      </div>
      <div className="rounded-sm border hairline bg-bg/45 p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange">
          Current
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ftext">{clause.revised}</p>
      </div>
    </div>
  )
}

export function EmailReviewWorkspace({
  document,
  aiConfigured,
  canManageAi,
}: {
  document: EmailReviewDocument
  aiConfigured: boolean
  canManageAi: boolean
}) {
  const [view, setView] = useState<WorkspaceView>('COMPARE')
  const [filter, setFilter] = useState<ClauseFilter>('ALL')
  const [openClauseId, setOpenClauseId] = useState<string | null>(null)
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null)
  const [state, formAction] = useActionState(
    askEmailReviewQuestionAction,
    idleEmailReviewAiState,
  )

  const selectedClause =
    document.clauses.find((clause) => clause.id === selectedClauseId) ?? null

  const counts = useMemo(
    () => ({
      SPEC: document.clauses.filter((clause) => clause.evidenceKind === 'SPEC').length,
      TEST: document.clauses.filter((clause) => clause.evidenceKind === 'TEST').length,
      UNVERIFIED: document.clauses.filter(
        (clause) => clause.evidenceKind === 'UNVERIFIED',
      ).length,
    }),
    [document.clauses],
  )

  const visibleClauses =
    filter === 'ALL'
      ? document.clauses
      : document.clauses.filter((clause) => clause.evidenceKind === filter)

  function askAbout(clause: EmailReviewClause) {
    setSelectedClauseId(clause.id)
    setView('ASK')
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-sm border hairline bg-paper p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            Changes reviewed
          </p>
          <p className="mt-2 text-2xl font-bold text-white">{document.clauses.length}</p>
        </div>
        <div className="rounded-sm border border-ok/25 bg-ok/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ok">
            Required by spec
          </p>
          <p className="mt-2 text-2xl font-bold text-white">{counts.SPEC}</p>
        </div>
        <div className="rounded-sm border border-blue-300/20 bg-blue-300/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-200">
            Enforced by tests
          </p>
          <p className="mt-2 text-2xl font-bold text-white">{counts.TEST}</p>
        </div>
        <div className="rounded-sm border border-warn/30 bg-warn/7 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-warn">
            Reason unknown
          </p>
          <p className="mt-2 text-2xl font-bold text-white">{counts.UNVERIFIED}</p>
        </div>
      </section>

      <aside className="rounded-sm border border-warn/35 bg-warn/7 p-4">
        <p className="text-sm font-bold text-warn">Unknown means unknown</p>
        <p className="mt-1 text-sm leading-relaxed text-dim">
          Six changes have no recorded reason. They stay marked{' '}
          <strong className="text-warn">UNVERIFIED</strong>. The AI may describe what
          changed, but it is instructed never to invent the missing rationale or present
          a plausible legal explanation as history.
        </p>
      </aside>

      <nav aria-label="Email review views">
        <ul className="grid grid-cols-3 gap-2">
          {(
            [
              ['COMPARE', 'Original vs revised'],
              ['CLAUSES', 'Clause guide'],
              ['ASK', 'Ask the AI'],
            ] as const
          ).map(([id, label]) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setView(id)}
                aria-current={view === id ? 'page' : undefined}
                className={`flex min-h-12 w-full items-center justify-center rounded-sm border px-3 text-center text-xs font-bold transition-colors sm:text-sm ${
                  view === id
                    ? 'border-orange/50 bg-orange/12 text-orange'
                    : 'hairline bg-bg2 text-dim hover:border-orange/40 hover:text-ftext'
                }`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {view === 'COMPARE' ? (
        <section aria-labelledby="compare-heading" className="space-y-4">
          <div>
            <h2 id="compare-heading" className="text-xl font-bold text-white">
              Read the two complete versions
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-dim">
              These are the preserved source texts. The clause guide is the easier place
              to understand individual changes.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[document.original, document.revised].map((version, index) => (
              <article
                key={version.title}
                className={`min-w-0 rounded-sm border bg-paper ${
                  index === 0 ? 'hairline' : 'border-orange/25'
                }`}
              >
                <header className="border-b hairline p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange">
                    {index === 0 ? 'Original' : 'Current'}
                  </p>
                  <h3 className="mt-1 text-base font-bold text-white">{version.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    {version.attribution}
                  </p>
                </header>
                <div className="max-h-[42rem] overflow-y-auto p-4 sm:p-5">
                  <p className="whitespace-pre-wrap text-sm leading-7 text-dim">
                    {version.text}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'CLAUSES' ? (
        <section aria-labelledby="clauses-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="clauses-heading" className="text-xl font-bold text-white">
                Clause-by-clause guide
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-dim">
                Open one change at a time. Evidence says what is recorded—not what
                somebody might have meant.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Filter clauses">
              {(['ALL', 'SPEC', 'TEST', 'UNVERIFIED'] as ClauseFilter[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    setFilter(kind)
                    setOpenClauseId(null)
                  }}
                  aria-pressed={filter === kind}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-bold ${
                    filter === kind
                      ? 'border-orange/50 bg-orange/12 text-orange'
                      : 'hairline text-dim hover:border-orange/40 hover:text-ftext'
                  }`}
                >
                  {kind === 'ALL' ? `All ${document.clauses.length}` : `${kind} ${counts[kind]}`}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {visibleClauses.map((clause, index) => {
              const open = openClauseId === clause.id
              return (
                <article
                  key={clause.id}
                  className={`rounded-sm border bg-paper ${
                    clause.evidenceKind === 'UNVERIFIED'
                      ? 'border-warn/25'
                      : 'hairline'
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`clause-${clause.id}`}
                    onClick={() => setOpenClauseId(open ? null : clause.id)}
                    className="flex min-h-16 w-full items-center justify-between gap-4 p-4 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="text-xs tabular-nums text-muted">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="truncate text-sm font-bold text-ftext">
                        {clause.title}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <EvidenceBadge kind={clause.evidenceKind} />
                      <span
                        aria-hidden="true"
                        className={`text-xs text-muted transition-transform ${
                          open ? 'rotate-180' : ''
                        }`}
                      >
                        ▼
                      </span>
                    </span>
                  </button>

                  {open ? (
                    <div id={`clause-${clause.id}`} className="border-t hairline p-4">
                      <ClauseSummary clause={clause} />
                      <div
                        className={`mt-4 rounded-sm border-l-2 p-4 ${
                          clause.evidenceKind === 'UNVERIFIED'
                            ? 'border-l-warn bg-warn/6'
                            : 'border-l-orange bg-orange/5'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <EvidenceBadge kind={clause.evidenceKind} />
                          <p className="text-xs font-semibold text-ftext">
                            {clause.evidence}
                          </p>
                        </div>
                        <p className="mt-3 text-sm leading-relaxed text-dim">
                          {clause.reason}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => askAbout(clause)}
                        className="mt-4 inline-flex min-h-11 items-center rounded-sm border border-orange/35 px-4 text-sm font-bold text-orange transition-colors hover:bg-orange/10"
                      >
                        Ask the AI about this clause
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {view === 'ASK' ? (
        <section aria-labelledby="ask-heading" className="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">
              {EMAIL_REVIEW_MODEL_LABEL} · gpt-5.6-sol
            </p>
            <h2 id="ask-heading" className="mt-2 text-xl font-bold text-white">
              Ask about the evidence
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-dim">
              Choose the whole document or one clause. The question and relevant source
              text are sent to OpenAI with response storage disabled. This portal does not
              save the question or answer.
            </p>
          </div>

          <div className="rounded-sm border hairline bg-paper p-4 sm:p-5">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedClauseId(null)}
                aria-pressed={selectedClause === null}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-xs font-bold ${
                  selectedClause === null
                    ? 'border-orange/50 bg-orange/12 text-orange'
                    : 'hairline text-dim'
                }`}
              >
                Entire document
              </button>
              {selectedClause ? (
                <button
                  type="button"
                  aria-pressed="true"
                  className="inline-flex min-h-11 items-center rounded-full border border-orange/50 bg-orange/12 px-4 text-xs font-bold text-orange"
                >
                  {selectedClause.title}
                </button>
              ) : null}
            </div>

            {selectedClause ? (
              <div className="mt-4">
                <ClauseSummary clause={selectedClause} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <EvidenceBadge kind={selectedClause.evidenceKind} />
                  <p className="text-xs text-dim">{selectedClause.evidence}</p>
                </div>
              </div>
            ) : null}

            {!aiConfigured ? (
              <div role="status" className="mt-5 border-l-2 border-warn pl-4">
                <p className="text-sm font-bold text-warn">AI is not connected yet</p>
                <p className="mt-1 text-sm leading-relaxed text-dim">
                  The comparison remains complete. Mike needs to add an OpenAI key before
                  questions can be answered.
                  {canManageAi ? (
                    <>
                      {' '}
                      <Link href="/admin/settings" className="font-bold text-orange">
                        Open Settings
                      </Link>
                      .
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}

            <form action={formAction} className="mt-5">
              <input
                type="hidden"
                name="clauseId"
                value={selectedClause?.id ?? ''}
              />
              <label
                htmlFor="email-review-question"
                className="block text-xs font-bold uppercase tracking-[0.12em] text-dim"
              >
                Your question
              </label>
              <textarea
                id="email-review-question"
                name="question"
                required
                minLength={3}
                maxLength={MAX_EMAIL_REVIEW_QUESTION_LENGTH}
                placeholder={
                  selectedClause
                    ? 'For example: What do we know about why this sentence changed?'
                    : 'For example: Which changes have no recorded reason?'
                }
                className="mt-2 min-h-32 w-full resize-y rounded-sm border hairline bg-bg2 px-3 py-3 text-sm leading-relaxed text-ftext transition-colors placeholder:text-muted focus:border-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">
                  Evidence explainer only—not legal advice or a missing-rationale generator.
                </p>
                <AskButton />
              </div>
            </form>

            {state.status === 'error' ? (
              <div
                role="alert"
                className="mt-5 border-l-2 border-warn pl-4 text-sm leading-relaxed text-warn"
              >
                {state.message}
              </div>
            ) : null}

            {state.status === 'ok' ? (
              <article
                aria-live="polite"
                className="mt-5 rounded-sm border border-ok/25 bg-ok/5 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-ok">
                    AI explanation
                  </p>
                  <p className="text-[10px] text-muted">
                    {state.scopeLabel} · {state.model}
                  </p>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-ftext">
                  {state.answer}
                </p>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
