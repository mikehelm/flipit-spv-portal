'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState, type FormEvent } from 'react'
import { useFormStatus } from 'react-dom'
import {
  askEmailReviewQuestionAction,
  reviewEmailProposalAction,
  submitEmailReviewProposalAction,
  type EmailReviewAiState,
} from '@/actions/email-review'
import { idleState } from '@/components/admin/action-state'
import { PaperReview } from '@/components/email-review/paper-review'
import {
  ReviewViewSwitch,
  type ReviewView,
} from '@/components/email-review/view-switch'
import type {
  EmailReviewClause,
  EmailReviewDocument,
  EmailReviewEvidenceKind,
} from '@/lib/email-review/document'
import type {
  EmailReviewProposalView,
  EmailReviewWorkspaceData,
} from '@/lib/email-review/data'
import {
  EMAIL_REVIEW_MODEL_LABEL,
  MAX_EMAIL_REVIEW_QUESTION_LENGTH,
} from '@/lib/email-review/model'
import type { EmailDiffKind, EmailDiffUnit } from '@/lib/email-review/segments'

type InspectorTab = 'EVIDENCE' | 'AI' | 'PROPOSE' | 'REVIEW'
type ChangeFilter = 'ALL' | 'CHANGED' | 'UNVERIFIED' | 'EDITABLE'
type PracticeProposal = {
  sectionLabel: string
  beforeText: string
  proposedText: string
  reason: string
}
const idleEmailReviewAiState: EmailReviewAiState = { status: 'idle' }

function EvidenceBadge({ kind }: { kind: EmailReviewEvidenceKind }) {
  const style = {
    SPEC: 'border-ok/35 bg-ok/8 text-ok',
    TEST: 'border-blue-300/30 bg-blue-300/8 text-blue-200',
    UNVERIFIED: 'border-warn/40 bg-warn/10 text-warn',
  }[kind]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.13em] ${style}`}
    >
      {kind}
    </span>
  )
}

function SubmitButton({
  idle,
  pending,
}: {
  idle: string
  pending: string
}) {
  const { pending: isPending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={isPending}
      className="inline-flex min-h-11 items-center justify-center rounded-sm bg-orange px-4 text-xs font-bold text-ink transition-colors hover:bg-orange-soft disabled:cursor-progress disabled:opacity-60"
    >
      {isPending ? pending : idle}
    </button>
  )
}

function StateMessage({
  state,
}: {
  state: { status: 'idle' } | { status: 'ok' | 'error'; message: string }
}) {
  if (state.status === 'idle') return null
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={`mt-3 border-l-2 pl-3 text-xs leading-relaxed ${
        state.status === 'error'
          ? 'border-warn text-warn'
          : 'border-ok text-ok'
      }`}
    >
      {state.message}
    </p>
  )
}

const KIND_STYLE: Record<
  EmailDiffKind,
  { original: string; current: string; label: string }
> = {
  UNCHANGED: {
    original: 'border-transparent text-dim',
    current: 'border-transparent text-dim',
    label: 'Unchanged',
  },
  REMOVED: {
    original: 'border-warn/45 bg-warn/8 text-ftext',
    current: 'border-warn/15 bg-warn/[0.025] text-muted',
    label: 'Removed',
  },
  ADDED: {
    original: 'border-ok/15 bg-ok/[0.025] text-muted',
    current: 'border-ok/45 bg-ok/8 text-ftext',
    label: 'Added',
  },
  CHANGED: {
    original: 'border-warn/35 bg-warn/7 text-ftext',
    current: 'border-ok/35 bg-ok/7 text-ftext',
    label: 'Changed',
  },
}

function DiffCell({
  unit,
  side,
  selected,
  onSelect,
}: {
  unit: EmailDiffUnit
  side: 'original' | 'current'
  selected: boolean
  onSelect: () => void
}) {
  const content = unit[side]
  const style = KIND_STYLE[unit.kind][side]
  const symbol =
    unit.kind === 'UNCHANGED'
      ? '·'
      : side === 'original'
        ? unit.kind === 'ADDED'
          ? '↳'
          : '−'
        : unit.kind === 'REMOVED'
          ? '↳'
          : '+'

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-diff-unit={unit.id}
      data-diff-side={side}
      className={`relative min-h-20 w-full border-l-2 p-4 text-left transition-all ${style} ${
        selected ? 'ring-2 ring-inset ring-orange/70' : 'hover:bg-white/[0.035]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-2 top-3 text-xs font-bold ${
          unit.kind === 'REMOVED' && side === 'original'
            ? 'text-warn'
            : unit.kind === 'ADDED' && side === 'current'
              ? 'text-ok'
              : 'text-muted'
        }`}
      >
        {symbol}
      </span>
      <span className="block pl-4">
        {content.length > 0 ? (
          content.map((paragraph, index) => (
            <span
              key={`${unit.id}-${side}-${index}`}
              className={`block whitespace-pre-wrap text-sm leading-7 ${
                index > 0 ? 'mt-4' : ''
              } ${
                unit.kind === 'REMOVED' && side === 'original'
                  ? 'decoration-warn/60 line-through'
                  : ''
              }`}
            >
              {paragraph}
            </span>
          ))
        ) : (
          <span className="block py-3 text-xs italic text-muted">
            {unit.kind === 'ADDED'
              ? 'No equivalent in David’s original'
              : 'Removed from the current invitation'}
          </span>
        )}
      </span>
    </button>
  )
}

function ProposalCard({
  proposal,
  canReview,
  reviewAction,
}: {
  proposal: EmailReviewProposalView
  canReview: boolean
  reviewAction: (payload: FormData) => void
}) {
  const failed = proposal.policyResults.filter((entry) => !entry.passed)
  const statusStyle = {
    SUBMITTED: 'border-orange/35 bg-orange/8 text-orange',
    CHANGES_REQUESTED: 'border-warn/35 bg-warn/8 text-warn',
    REJECTED: 'border-red-400/30 bg-red-400/8 text-red-300',
    PROMOTED: 'border-ok/35 bg-ok/8 text-ok',
    WITHDRAWN: 'hairline bg-bg2 text-muted',
  }[proposal.status]

  return (
    <article className="rounded-sm border hairline bg-bg/55 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ftext">{proposal.sectionLabel}</p>
          <p className="mt-1 text-[10px] text-muted">
            {proposal.createdByName} ·{' '}
            {new Date(proposal.submittedAt).toLocaleString()}
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${statusStyle}`}
        >
          {proposal.status.replaceAll('_', ' ')}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="border-l-2 border-warn/50 bg-warn/6 p-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-warn">
            Current
          </p>
          <p className="mt-2 text-xs leading-6 text-dim">{proposal.beforeText}</p>
        </div>
        <div className="border-l-2 border-ok/50 bg-ok/6 p-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ok">
            Proposed
          </p>
          <p className="mt-2 text-xs leading-6 text-ftext">{proposal.proposedText}</p>
        </div>
      </div>

      <div className="mt-3 rounded-sm border hairline p-3">
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-orange">
          Why
        </p>
        <p className="mt-2 text-xs leading-6 text-dim">{proposal.reason}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-ok/30 bg-ok/7 px-2 py-1 text-[9px] font-bold text-ok">
          {proposal.policyResults.length - failed.length} rules passed
        </span>
        {failed.length > 0 ? (
          <span className="rounded-full border border-warn/30 bg-warn/7 px-2 py-1 text-[9px] font-bold text-warn">
            {failed.length} failed
          </span>
        ) : null}
      </div>

      {proposal.aiReview ? (
        <details className="mt-3 rounded-sm border border-blue-300/20 bg-blue-300/5 p-3">
          <summary className="cursor-pointer text-xs font-bold text-blue-200">
            Automated review · {proposal.aiModel}
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-dim">
            {proposal.aiReview}
          </p>
          <p className="mt-2 text-[10px] text-muted">
            Advisory only. It cannot approve, promote or replace qualified review.
          </p>
        </details>
      ) : null}

      {proposal.reviewNote ? (
        <div className="mt-3 border-l-2 border-orange pl-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-orange">
            Mike’s note
          </p>
          <p className="mt-1 text-xs leading-6 text-dim">{proposal.reviewNote}</p>
        </div>
      ) : null}

      {canReview && proposal.status === 'SUBMITTED' ? (
        <form action={reviewAction} className="mt-4 border-t hairline pt-4">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <label className="block text-[10px] font-bold uppercase tracking-[0.13em] text-dim">
            Note to David
            <textarea
              name="note"
              maxLength={2_000}
              className="mt-2 min-h-20 w-full resize-y rounded-sm border hairline bg-bg2 p-3 text-xs leading-6 text-ftext"
              placeholder="Required when requesting changes or rejecting."
            />
          </label>
          <label className="mt-3 flex gap-2 text-[10px] leading-5 text-dim">
            <input
              type="checkbox"
              name="acknowledged"
              className="mt-1 size-4 accent-orange"
            />
            <span>
              I understand promotion disables sending until a new compliance
              approval matches the exact new hash.
            </span>
          </label>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              name="decision"
              value="REQUEST_CHANGES"
              className="min-h-11 rounded-sm border border-warn/35 px-2 text-[10px] font-bold text-warn"
            >
              Request changes
            </button>
            <button
              name="decision"
              value="REJECT"
              className="min-h-11 rounded-sm border border-red-400/30 px-2 text-[10px] font-bold text-red-300"
            >
              Reject
            </button>
            <button
              name="decision"
              value="PROMOTE"
              className="min-h-11 rounded-sm bg-orange px-2 text-[10px] font-bold text-ink"
            >
              Promote version
            </button>
          </div>
        </form>
      ) : null}
    </article>
  )
}

function PracticeProposalCard({
  proposal,
}: {
  proposal: PracticeProposal
}) {
  return (
    <article
      data-testid="practice-proposal"
      className="rounded-sm border border-blue-300/25 bg-blue-300/5 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-ftext">{proposal.sectionLabel}</p>
        <span className="rounded-full border border-blue-300/30 bg-blue-300/8 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-blue-200">
          Practice only
        </span>
      </div>
      <div className="mt-4 grid gap-3">
        <div className="border-l-2 border-warn/50 bg-warn/6 p-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-warn">
            Current
          </p>
          <p className="mt-2 text-xs leading-6 text-dim">{proposal.beforeText}</p>
        </div>
        <div className="border-l-2 border-ok/50 bg-ok/6 p-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-ok">
            Your practice wording
          </p>
          <p className="mt-2 text-xs leading-6 text-ftext">{proposal.proposedText}</p>
        </div>
      </div>
      <div className="mt-3 rounded-sm border hairline p-3">
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-orange">
          Practice reason
        </p>
        <p className="mt-2 text-xs leading-6 text-dim">{proposal.reason}</p>
      </div>
      <p className="mt-3 text-[10px] leading-5 text-blue-200">
        This exists only in this browser tab. It was not saved, sent to Mike,
        checked as a real proposal or used to change the invitation.
      </p>
    </article>
  )
}

export function EmailReviewWorkspace({
  document,
  workspace,
  aiConfigured,
  canManageAi,
  testMode,
}: {
  document: EmailReviewDocument
  workspace: EmailReviewWorkspaceData
  aiConfigured: boolean
  canManageAi: boolean
  testMode: boolean
}) {
  const firstChanged =
    workspace.diffUnits.find((unit) => unit.kind !== 'UNCHANGED') ??
    workspace.diffUnits[0] ??
    null
  const [selectedId, setSelectedId] = useState<string | null>(firstChanged?.id ?? null)
  const [filter, setFilter] = useState<ChangeFilter>('CHANGED')
  const [tab, setTab] = useState<InspectorTab>('EVIDENCE')
  // Paper is the default. The technical comparison is unchanged and one click
  // away; nothing about the selection, the evidence record or the proposal
  // flow depends on which of the two is on screen.
  const [view, setView] = useState<ReviewView>('PAPER')
  const [markup, setMarkup] = useState(true)
  const [aiScope, setAiScope] = useState<'SELECTION' | 'DOCUMENT'>('SELECTION')
  const [practiceProposal, setPracticeProposal] =
    useState<PracticeProposal | null>(null)
  const selected =
    workspace.diffUnits.find((unit) => unit.id === selectedId) ?? firstChanged
  const selectedClauses = document.clauses.filter((clause) =>
    selected?.clauseIds.includes(clause.id),
  )
  const selectedSection = workspace.sections.find(
    (section) => section.id === selected?.editableSectionId,
  )
  const editableSections = workspace.sections.filter((section) => section.editable)
  const [proposalSectionId, setProposalSectionId] = useState(
    selectedSection?.id ?? editableSections[0]?.id ?? '',
  )
  const proposalSection =
    editableSections.find((section) => section.id === proposalSectionId) ??
    editableSections[0] ??
    null

  const [aiState, aiAction] = useActionState(
    askEmailReviewQuestionAction,
    idleEmailReviewAiState,
  )
  const [proposalState, proposalAction] = useActionState(
    submitEmailReviewProposalAction,
    idleState,
  )
  const [reviewState, reviewAction] = useActionState(
    reviewEmailProposalAction,
    idleState,
  )

  const counts = useMemo(
    () => ({
      changed: workspace.diffUnits.filter((unit) => unit.kind !== 'UNCHANGED').length,
      unverified: document.clauses.filter(
        (clause) => clause.evidenceKind === 'UNVERIFIED',
      ).length,
      editable: workspace.diffUnits.filter((unit) => unit.editableSectionId).length,
    }),
    [workspace.diffUnits, document.clauses],
  )

  const visibleUnits = workspace.diffUnits.filter((unit) => {
    if (filter === 'ALL') return true
    if (filter === 'CHANGED') return unit.kind !== 'UNCHANGED'
    if (filter === 'EDITABLE') return unit.editableSectionId !== null
    return unit.clauseIds.some(
      (id) =>
        document.clauses.find((clause) => clause.id === id)?.evidenceKind ===
        'UNVERIFIED',
    )
  })

  function chooseUnit(
    unit: EmailDiffUnit,
    nextTab?: InspectorTab,
    bringIntoView = false,
  ) {
    setSelectedId(unit.id)
    if (unit.editableSectionId) setProposalSectionId(unit.editableSectionId)
    if (nextTab) setTab(nextTab)
    if (bringIntoView) {
      // `scroll-behavior: auto !important` in globals.css cannot reach a
      // scroll asked for in JavaScript, so the preference is read here too.
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.requestAnimationFrame(() => {
        window.document.getElementById(unit.id)?.scrollIntoView({
          behavior: still ? 'auto' : 'smooth',
          block: 'center',
        })
      })
    }
  }

  function rehearseProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const sectionId = String(form.get('sectionId') ?? '')
    const section = editableSections.find((entry) => entry.id === sectionId)
    const proposedText = String(form.get('proposedText') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    if (!section || proposedText.length < 3 || reason.length < 10) return

    setPracticeProposal({
      sectionLabel: section.title,
      beforeText: section.currentText,
      proposedText,
      reason,
    })
    setTab('REVIEW')
  }

  const driftTone = workspace.drift.sendingPermitted
    ? 'border-ok/35 bg-ok/8 text-ok'
    : 'border-warn/40 bg-warn/9 text-warn'

  return (
    <div className="space-y-4">
      <ReviewViewSwitch
        view={view}
        onView={setView}
        markup={markup}
        onMarkup={setMarkup}
      />

      {testMode ? (
        <section
          role="status"
          data-testid="experience-test-mode"
          className="rounded-sm border border-blue-300/30 bg-blue-300/7 px-4 py-3 text-xs leading-6 text-blue-100"
        >
          <strong className="font-bold text-blue-200">Graham test mode.</strong>{' '}
          Explore both emails, select changes, ask the AI and rehearse a proposal.
          Anything typed as a proposal remains only in this browser tab: it cannot be
          saved, sent to Mike, promoted or emailed to an investor.
        </section>
      ) : null}

      <section
        aria-label="Invitation safety status"
        className={`sticky top-2 z-20 grid gap-2 rounded-sm border px-4 py-3 shadow-2xl backdrop-blur-md lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${driftTone}`}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em]">
            {workspace.drift.sendingPermitted ? 'Exact wording approved' : 'Sending disabled'}
          </p>
          <p className="mt-1 line-clamp-2 text-[10px] leading-5 text-dim" title={workspace.drift.message}>
            {workspace.drift.message}
          </p>
        </div>
        <div className="text-right text-[10px] text-muted">
          <p>
            {workspace.liveTemplate.origin === 'STORED'
              ? `Stored version ${workspace.liveTemplate.version}`
              : 'Built-in version'}
          </p>
          <p className="mt-1 font-mono">
            {workspace.liveTemplate.hash.slice(0, 12)}…
          </p>
        </div>
      </section>

      <div
        className={`grid min-h-[72vh] grid-cols-1 lg:grid-cols-[11rem_minmax(0,1fr)_18rem] 2xl:grid-cols-[14rem_minmax(0,1fr)_22rem] ${
          // Paper wants air around it: the sheets have to read as objects on a
          // desk rather than as a third panel butted against two others.
          view === 'PAPER' ? 'gap-4 xl:gap-6' : 'gap-3'
        }`}
      >
        <aside className="rounded-sm border hairline bg-paper lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <header className="border-b hairline p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-orange">
              Change map
            </p>
            <p className="mt-2 text-xs leading-5 text-dim">
              Select a change to focus both versions and its tools.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1 text-center">
              <div className="rounded-sm bg-bg2 p-2">
                <strong className="block text-sm text-white">{counts.changed}</strong>
                <span className="text-[8px] uppercase text-muted">changes</span>
              </div>
              <div className="rounded-sm bg-bg2 p-2">
                <strong className="block text-sm text-warn">{counts.unverified}</strong>
                <span className="text-[8px] uppercase text-muted">unknown</span>
              </div>
              <div className="rounded-sm bg-bg2 p-2">
                <strong className="block text-sm text-ok">{counts.editable}</strong>
                <span className="text-[8px] uppercase text-muted">editable</span>
              </div>
            </div>
          </header>

          <div className="flex flex-wrap gap-1 border-b hairline p-2">
            {(['CHANGED', 'UNVERIFIED', 'EDITABLE', 'ALL'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                aria-pressed={filter === item}
                className={`min-h-9 rounded-full border px-2 text-[9px] font-bold ${
                  filter === item
                    ? 'border-orange/45 bg-orange/12 text-orange'
                    : 'hairline text-muted'
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <nav aria-label="Document changes" className="p-2">
            <ol className="space-y-1">
              {visibleUnits.map((unit) => {
                const clauses = document.clauses.filter((clause) =>
                  unit.clauseIds.includes(clause.id),
                )
                const label =
                  clauses[0]?.title ??
                  unit.current[0]?.slice(0, 52) ??
                  unit.original[0]?.slice(0, 52) ??
                  KIND_STYLE[unit.kind].label
                const unverified = clauses.some(
                  (clause) => clause.evidenceKind === 'UNVERIFIED',
                )
                return (
                  <li key={unit.id}>
                    <button
                      type="button"
                      onClick={() => chooseUnit(unit, undefined, true)}
                      aria-current={selected?.id === unit.id ? 'true' : undefined}
                      data-change-map-unit={unit.id}
                      className={`flex min-h-11 w-full items-center gap-2 rounded-sm border px-2 text-left text-[10px] ${
                        selected?.id === unit.id
                          ? 'border-orange/45 bg-orange/10 text-ftext'
                          : 'border-transparent text-dim hover:bg-white/[0.035]'
                      }`}
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${
                          unit.kind === 'ADDED'
                            ? 'bg-ok'
                            : unit.kind === 'REMOVED'
                              ? 'bg-warn'
                              : unit.kind === 'CHANGED'
                                ? 'bg-orange'
                                : 'bg-muted'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {unverified ? (
                        <span className="font-bold text-warn">?</span>
                      ) : null}
                      {unit.editableSectionId ? (
                        <span className="text-ok" title="Editable">
                          ✎
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>
        </aside>

        {view === 'PAPER' ? (
          <PaperReview
            diffUnits={workspace.diffUnits}
            clauses={document.clauses}
            selectedId={selected?.id ?? null}
            markup={markup}
            onSelect={(unit) => chooseUnit(unit)}
          />
        ) : (
        <section className="min-w-0 overflow-hidden rounded-sm border hairline bg-paper">
          <header className="sticky top-0 z-10 grid grid-cols-2 border-b hairline bg-paper/95 backdrop-blur-md">
            <div className="border-r hairline p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-warn">
                David’s original
              </p>
              <p className="mt-1 truncate text-xs text-muted">
                Preserved from Gmail · 25 July 2026
              </p>
            </div>
            <div className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ok">
                Current invitation
              </p>
              <p className="mt-1 truncate text-xs text-muted">
                Derived from the email source that would actually be sent
              </p>
            </div>
          </header>

          <div className="divide-y divide-white/[0.055]">
            {workspace.diffUnits.map((unit) => (
              <div key={unit.id} id={unit.id} className="grid grid-cols-2">
                <div className="min-w-0 border-r hairline">
                  <DiffCell
                    unit={unit}
                    side="original"
                    selected={selected?.id === unit.id}
                    onSelect={() => chooseUnit(unit)}
                  />
                </div>
                <div className="min-w-0">
                  <DiffCell
                    unit={unit}
                    side="current"
                    selected={selected?.id === unit.id}
                    onSelect={() => chooseUnit(unit)}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        )}

        <aside className="rounded-sm border hairline bg-paper lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <nav
            aria-label="Selected-change tools"
            className="sticky top-0 z-10 grid grid-cols-4 border-b hairline bg-paper/95 p-2 backdrop-blur-md"
          >
            {(
              [
                ['EVIDENCE', 'Evidence'],
                ['AI', 'Ask AI'],
                ['PROPOSE', testMode ? 'Practice' : 'Propose'],
                [
                  'REVIEW',
                  testMode
                    ? 'Practice'
                    : canManageAi
                      ? `Review ${workspace.proposals.filter((p) => p.status === 'SUBMITTED').length}`
                      : 'Status',
                ],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`min-h-10 rounded-sm px-1 text-[9px] font-bold ${
                  tab === id ? 'bg-orange/12 text-orange' : 'text-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              {selected ? KIND_STYLE[selected.kind].label : 'Select a change'} ·{' '}
              {selected?.id.replace('change-', '')}
            </p>

            {tab === 'EVIDENCE' ? (
              <div className="mt-4 space-y-4">
                {selectedClauses.length > 0 ? (
                  selectedClauses.map((clause: EmailReviewClause) => (
                    <article key={clause.id} className="rounded-sm border hairline p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-bold text-ftext">{clause.title}</h3>
                        <EvidenceBadge kind={clause.evidenceKind} />
                      </div>
                      <p className="mt-3 text-xs leading-6 text-dim">{clause.reason}</p>
                      <p className="mt-3 text-[10px] leading-5 text-muted">
                        {clause.evidence}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-xs leading-6 text-dim">
                    This passage is part of the complete mechanical comparison. No
                    separate recorded rationale is attached to it.
                  </p>
                )}
                {selectedSection ? (
                  <button
                    type="button"
                    onClick={() => setTab('PROPOSE')}
                    className="min-h-11 w-full rounded-sm border border-orange/35 text-xs font-bold text-orange"
                  >
                    {testMode
                      ? 'Practice wording for this section'
                      : 'Propose wording for this section'}
                  </button>
                ) : (
                  <div className="border-l-2 border-warn pl-3 text-xs leading-6 text-dim">
                    This selection is informational or structurally protected. You can
                    ask about it, but it is not directly editable here.
                  </div>
                )}
              </div>
            ) : null}

            {tab === 'AI' ? (
              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-200">
                  {EMAIL_REVIEW_MODEL_LABEL}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(
                    [
                      ['SELECTION', 'Selected change'],
                      ['DOCUMENT', 'Whole document'],
                    ] as const
                  ).map(([scope, label]) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setAiScope(scope)}
                      aria-pressed={aiScope === scope}
                      className={`min-h-10 rounded-sm border px-2 text-[10px] font-bold ${
                        aiScope === scope
                          ? 'border-blue-300/35 bg-blue-300/10 text-blue-200'
                          : 'hairline text-muted'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-6 text-dim">
                  {aiScope === 'SELECTION'
                    ? 'Only this paired change and its recorded evidence are sent.'
                    : 'David’s original, the actual current invitation and the evidence record are sent.'}{' '}
                  Response storage is disabled.
                </p>
                {!aiConfigured ? (
                  <p className="mt-3 border-l-2 border-warn pl-3 text-xs text-warn">
                    AI is not connected.
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
                ) : null}
                <form action={aiAction} className="mt-4">
                  <input
                    type="hidden"
                    name="changeId"
                    value={aiScope === 'SELECTION' ? selected?.id ?? '' : ''}
                  />
                  <input
                    type="hidden"
                    name="clauseId"
                    value={
                      aiScope === 'SELECTION' ? selectedClauses[0]?.id ?? '' : ''
                    }
                  />
                  <textarea
                    name="question"
                    required
                    minLength={3}
                    maxLength={MAX_EMAIL_REVIEW_QUESTION_LENGTH}
                    className="min-h-28 w-full resize-y rounded-sm border hairline bg-bg2 p-3 text-xs leading-6 text-ftext"
                    placeholder={
                      aiScope === 'SELECTION'
                        ? 'What changed here, what evidence explains it, and what remains unknown?'
                        : 'Which changes have recorded reasons, and which decisions still need confirmation?'
                    }
                  />
                  <div className="mt-3 flex justify-end">
                    <SubmitButton
                      idle={
                        aiScope === 'SELECTION'
                          ? 'Ask about this change'
                          : 'Ask about both emails'
                      }
                      pending="Reviewing…"
                    />
                  </div>
                </form>
                {aiState.status === 'error' ? (
                  <p className="mt-3 border-l-2 border-warn pl-3 text-xs text-warn">
                    {aiState.message}
                  </p>
                ) : null}
                {aiState.status === 'ok' ? (
                  <article className="mt-4 rounded-sm border border-blue-300/20 bg-blue-300/5 p-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-blue-200">
                      Automated explanation · {aiState.model}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-ftext">
                      {aiState.answer}
                    </p>
                  </article>
                ) : null}
              </div>
            ) : null}

            {tab === 'PROPOSE' ? (
              <div className="mt-4">
                <p className="text-xs leading-6 text-dim">
                  {testMode
                    ? 'Try the same wording exercise David uses. This practice copy stays in this browser tab and never enters Mike’s review queue.'
                    : 'Proposals change the real subject, HTML and plain-text invitation together. They do not change the live version until Mike promotes them.'}
                </p>
                <form
                  action={testMode ? undefined : proposalAction}
                  onSubmit={testMode ? rehearseProposal : undefined}
                  className="mt-4"
                >
                  <label className="block text-[10px] font-bold uppercase tracking-[0.13em] text-dim">
                    Section
                    <select
                      name="sectionId"
                      value={proposalSectionId}
                      onChange={(event) => setProposalSectionId(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-sm border hairline bg-bg2 px-3 text-xs text-ftext"
                    >
                      {editableSections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-3 rounded-sm border border-warn/20 bg-warn/5 p-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-warn">
                      Current
                    </p>
                    <p className="mt-2 text-xs leading-6 text-dim">
                      {proposalSection?.currentText}
                    </p>
                  </div>
                  <label className="mt-3 block text-[10px] font-bold uppercase tracking-[0.13em] text-dim">
                    Proposed wording
                    <textarea
                      key={proposalSection?.id}
                      name="proposedText"
                      required
                      minLength={3}
                      maxLength={2_000}
                      defaultValue={proposalSection?.currentText ?? ''}
                      className="mt-2 min-h-40 w-full resize-y rounded-sm border hairline bg-bg2 p-3 text-xs leading-6 text-ftext focus:border-orange"
                    />
                  </label>
                  <label className="mt-3 block text-[10px] font-bold uppercase tracking-[0.13em] text-dim">
                    Why are you proposing this?
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      maxLength={2_000}
                      className="mt-2 min-h-24 w-full resize-y rounded-sm border hairline bg-bg2 p-3 text-xs leading-6 text-ftext focus:border-orange"
                      placeholder="Mike will see this explanation beside the exact change."
                    />
                  </label>
                  <p className="mt-3 text-[10px] leading-5 text-muted">
                    {testMode
                      ? 'Practice mode does not submit or run the real promotion workflow. Use Ask AI for an explanation; Mike and David retain the protected review path.'
                      : 'Protected rules run before submission. Passing them is not legal approval.'}
                  </p>
                  <div className="mt-3 flex justify-end">
                    <SubmitButton
                      idle={testMode ? 'Try proposal — nothing saved' : 'Send proposal to Mike'}
                      pending={testMode ? 'Preparing practice view…' : 'Checking every rule…'}
                    />
                  </div>
                </form>
                {!testMode ? <StateMessage state={proposalState} /> : null}
              </div>
            ) : null}

            {tab === 'REVIEW' ? (
              <div className="mt-4 space-y-3">
                <p className="text-xs leading-6 text-dim">
                  {testMode
                    ? 'Your latest practice proposal appears here only until this tab closes or reloads. Mike and David cannot see it.'
                    : canManageAi
                    ? 'Mike sees every submitted change, David’s reason, deterministic checks and the automated review.'
                    : 'Your proposals and Mike’s decisions appear here. The live invitation changes only after Mike promotes a version.'}
                </p>
                {!testMode ? <StateMessage state={reviewState} /> : null}
                {testMode && practiceProposal ? (
                  <PracticeProposalCard proposal={practiceProposal} />
                ) : workspace.proposals.length === 0 ? (
                  <p className="rounded-sm border hairline p-3 text-xs text-muted">
                    {testMode
                      ? 'No practice proposal yet. Choose Practice, type a change and try it.'
                      : 'No proposals yet.'}
                  </p>
                ) : (
                  workspace.proposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      canReview={canManageAi}
                      reviewAction={reviewAction}
                    />
                  ))
                )}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}
