'use client'

/**
 * The import wizard. BUILD_SPEC §9.1 mapping flow, steps 1–5.
 *
 * The proposal is shown, never applied (step 4). Every column has a dropdown
 * the operator can change, every ambiguity is an explicit question with the
 * consequence of each answer spelled out, and the review table shows the
 * converted values as they would be stored before anything is created.
 *
 * The file stays in the browser between steps and is posted with each request.
 * Nothing here decides anything: every check shown on this screen is made
 * again on the server, in the action that acts on it.
 */

import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import { analyseImportFile, confirmImport, previewImport } from '@/actions/import'
import {
  FIELD_HELP,
  FIELD_LABEL,
  IGNORE_COLUMN,
  REQUIRED_FIELDS,
  TARGET_FIELDS,
  type TargetField,
} from '@/lib/import/fields'
import { MAX_FILE_BYTES, importTooLargeMessage } from '@/lib/import/limits'
import type { ColumnAnswer, ColumnQuestion } from '@/lib/import/mapping'
import type {
  ActionFailure,
  AnalysisSuccess,
  ConfirmSuccess,
  PreviewSuccess,
} from '@/lib/import/results'

type Step = 'upload' | 'map' | 'review' | 'done'

type Assignment = Record<string, string>

export function ImportWizard() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisSuccess | null>(null)
  const [assignment, setAssignment] = useState<Assignment>({})
  const [answers, setAnswers] = useState<Record<string, ColumnAnswer>>({})
  const [preview, setPreview] = useState<PreviewSuccess | null>(null)
  const [confirmed, setConfirmed] = useState<ConfirmSuccess | null>(null)

  const currentFile = () => fileRef.current?.files?.[0] ?? null

  /**
   * The chosen file, or nothing — having said why.
   *
   * All three steps post the file again, so all three go through here. The size
   * is checked **before** the body is built, because a body over the server
   * action limit in `next.config.ts` never reaches the action: the action's own
   * refusal is never written, the promise rejects, and the wizard loses every
   * step the operator has taken instead of saying "that file is too big".
   *
   * `readTable` and the action's schema both check the same number against the
   * bytes. This is the courtesy; those are the control.
   */
  const fileToPost = (): File | null => {
    const file = currentFile()
    if (!file) return null
    if (file.size > MAX_FILE_BYTES) {
      setError(importTooLargeMessage(file.size))
      return null
    }
    return file
  }

  const mappingPayload = useMemo(
    () =>
      JSON.stringify({
        assignments: Object.entries(assignment)
          .filter(([, field]) => field !== IGNORE_COLUMN)
          .map(([sourceColumn, targetField]) => ({ sourceColumn, targetField })),
        answers,
      }),
    [assignment, answers],
  )

  const handleFailure = useCallback((result: ActionFailure) => {
    setError(result.message)
  }, [])

  const upload = (sheet?: string) => {
    if (!currentFile()) {
      setError('Choose a .csv or .xlsx file first.')
      return
    }
    setError(null)
    const file = fileToPost()
    if (!file) return
    const form = new FormData()
    form.set('file', file)
    if (sheet) form.set('sheetName', sheet)

    startTransition(async () => {
      const result = await analyseImportFile(form)
      if (!result.ok) {
        handleFailure(result)
        return
      }
      setAnalysis(result)
      const initial: Assignment = {}
      for (const column of result.proposal.columns) {
        initial[column.sourceColumn] = column.targetField ?? IGNORE_COLUMN
      }
      setAssignment(initial)
      setAnswers({})
      setPreview(null)
      setStep('map')
    })
  }

  const check = () => {
    if (!currentFile() || !analysis) {
      setError('The file is no longer available. Choose it again.')
      setStep('upload')
      return
    }
    setError(null)
    const file = fileToPost()
    if (!file) return
    const form = new FormData()
    form.set('file', file)
    if (analysis.sheetName) form.set('sheetName', analysis.sheetName)
    form.set('importJobId', analysis.importJobId)
    form.set('mapping', mappingPayload)

    startTransition(async () => {
      const result = await previewImport(form)
      if (!result.ok) {
        handleFailure(result)
        return
      }
      setPreview(result)
      // Mapping problems (including an unanswered question) keep us on the
      // columns. File-level errors do not — they belong in the review, beside
      // the rows they came from.
      setStep(result.mappingProblems.length === 0 ? 'review' : 'map')
    })
  }

  const doImport = () => {
    if (!currentFile() || !analysis || !preview?.canImport) return
    setError(null)
    const file = fileToPost()
    if (!file) return
    const form = new FormData()
    form.set('file', file)
    if (analysis.sheetName) form.set('sheetName', analysis.sheetName)
    form.set('importJobId', analysis.importJobId)
    form.set('mapping', mappingPayload)
    if (analysis.aiProposalId) form.set('aiProposalId', analysis.aiProposalId)

    startTransition(async () => {
      const result = await confirmImport(form)
      if (!result.ok) {
        handleFailure(result)
        return
      }
      setConfirmed(result)
      setStep('done')
    })
  }

  const restart = () => {
    setStep('upload')
    setAnalysis(null)
    setPreview(null)
    setConfirmed(null)
    setAssignment({})
    setAnswers({})
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const questions: ColumnQuestion[] = preview?.questions ?? analysis?.questions ?? []
  const unanswered = questions.filter((question) => !isAnswered(question, answers))

  return (
    <div className="space-y-6">
      <Steps current={step} />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-warn bg-warn-surface px-4 py-3 text-sm text-ftext"
        >
          {error}
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      <section className="rounded-lg border hairline bg-paper p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-dim">
          1 · The file
        </h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,.xlsm"
            className="block min-h-11 w-full text-sm text-ftext file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-orange file:px-4 file:text-sm file:font-medium file:text-ink"
            onChange={() => {
              setStep('upload')
              setAnalysis(null)
              setPreview(null)
              setError(null)
            }}
          />
          <button
            type="button"
            onClick={() => upload()}
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-orange px-4 text-sm font-medium text-ink disabled:opacity-50"
          >
            {pending && step === 'upload' ? 'Reading…' : 'Read the file'}
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-dim">
          .csv, .xlsx or .xls, up to {MAX_FILE_BYTES / (1024 * 1024)} MB. Extra columns are
          fine and the order does not matter.
        </p>
        {analysis && analysis.sheetNames.length > 1 && (
          <div className="mt-3">
            <label htmlFor="sheet" className="text-xs text-dim">
              This workbook has {analysis.sheetNames.length} sheets. Reading{' '}
              <span className="text-ftext">{analysis.sheetName}</span>.
            </label>
            <select
              id="sheet"
              value={analysis.sheetName ?? ''}
              onChange={(event) => upload(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-md border hairline bg-bg2 px-2 py-2 text-sm text-ftext sm:w-64"
            >
              {analysis.sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {analysis && step !== 'done' && (
        <section className="rounded-lg border hairline bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-dim">
            2 · Confirm every column
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            {analysis.rowCount} row(s) in <span className="text-ftext">{analysis.filename}</span>
            {analysis.sheetName ? `, sheet "${analysis.sheetName}"` : ''}. Matched by{' '}
            {analysis.aiUsed ? `the model (${analysis.proposal.model})` : 'column name'}. Nothing is
            imported until you confirm.
          </p>
          {analysis.aiMessage && (
            <p className="mt-2 rounded-md border hairline px-3 py-2 text-xs leading-relaxed text-dim">
              {analysis.aiMessage}
            </p>
          )}
          {analysis.notices.map((notice) => (
            <p key={notice} className="mt-2 text-xs text-dim">
              {notice}
            </p>
          ))}
          {analysis.proposal.notes.map((note) => (
            <p key={note} className="mt-2 text-xs text-dim">
              {note}
            </p>
          ))}

          <ul className="mt-4 space-y-3">
            {analysis.headers.map((header, index) => {
              const proposed = analysis.proposal.columns.find(
                (column) => column.sourceColumn === header,
              )
              const chosen = assignment[header] ?? IGNORE_COLUMN
              const changed = (proposed?.targetField ?? IGNORE_COLUMN) !== chosen
              const samples = analysis.sampleRows
                .map((row) => row[index] ?? '')
                .filter((cell) => cell !== '')
                .slice(0, 3)

              return (
                <li
                  key={header}
                  className="rounded-md border hairline p-3 sm:flex sm:items-start sm:gap-4"
                >
                  <div className="min-w-0 sm:w-1/2">
                    <p className="truncate text-sm font-medium text-ftext">{header}</p>
                    <p className="mt-1 truncate text-xs text-dim">
                      {samples.length > 0 ? samples.join(' · ') : 'no values'}
                    </p>
                    {proposed?.rationale && (
                      <p className="mt-1 text-xs text-dim">{proposed.rationale}</p>
                    )}
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-1/2">
                    <label className="sr-only" htmlFor={`map-${index}`}>
                      Field for {header}
                    </label>
                    <select
                      id={`map-${index}`}
                      value={chosen}
                      onChange={(event) => {
                        setAssignment((current) => ({
                          ...current,
                          [header]: event.target.value,
                        }))
                        setPreview(null)
                        setStep('map')
                      }}
                      /*
                       * `min-h-11` is WCAG 2.5.5's 44px, and it was missing.
                       *
                       * These two selects were 36px tall for as long as the
                       * wizard has existed, and `verify:viewport` — which fails
                       * any tap target under 44px on every other screen in the
                       * application — had never seen them: they are step 2 of a
                       * client-side wizard, and the audit only ever loaded
                       * step 1. Eight of them at once, on the screen where an
                       * operator maps the columns of a file of real investors.
                       */
                      className="min-h-11 w-full rounded-md border hairline bg-bg2 px-2 py-2 text-sm text-ftext"
                    >
                      <option value={IGNORE_COLUMN}>Do not import this column</option>
                      {TARGET_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {FIELD_LABEL[field]}
                          {REQUIRED_FIELDS.includes(field) ? ' *' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-dim">
                      {chosen !== IGNORE_COLUMN && isTarget(chosen)
                        ? FIELD_HELP[chosen]
                        : 'Ignored.'}
                      {changed && <span className="ml-1 text-orange">Corrected.</span>}
                      {!changed && proposed?.targetField && (
                        <span className="ml-1 text-dim">
                          Confidence {proposed.confidence.toLowerCase()}.
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>

          {preview?.mappingProblems.map((problem) => (
            <p key={problem.message} className="mt-3 text-sm text-warn">
              {problem.message}
            </p>
          ))}

          {questions.length > 0 && (
            <div className="mt-6 space-y-4">
              <h3 className="text-sm font-semibold text-ftext">
                Questions the importer will not answer for you
              </h3>
              {questions.map((question) => (
                <QuestionCard
                  key={`${question.sourceColumn}-${question.ambiguity.kind}`}
                  question={question}
                  answer={answers[question.sourceColumn] ?? {}}
                  onAnswer={(next) => {
                    setAnswers((current) => ({
                      ...current,
                      [question.sourceColumn]: {
                        ...current[question.sourceColumn],
                        ...next,
                      },
                    }))
                    setPreview(null)
                    setStep('map')
                  }}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={check}
            disabled={pending || unanswered.length > 0}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-orange px-4 text-sm font-medium text-ink disabled:opacity-50"
          >
            {pending ? 'Checking…' : 'Check the file'}
          </button>
          {unanswered.length > 0 && (
            <p className="mt-2 text-xs text-dim">
              Answer {unanswered.length} question(s) above first.
            </p>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {preview && step === 'review' && (
        <ReviewPanel
          preview={preview}
          pending={pending}
          onImport={doImport}
          onBack={() => setStep('map')}
        />
      )}

      {/* ---------------------------------------------------------------- */}
      {confirmed && step === 'done' && (
        <section className="rounded-lg border hairline bg-paper p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-dim">
            4 · Imported
          </h2>
          <p className="mt-3 text-sm text-ftext">
            {confirmed.createdRecipients} recipient(s) and {confirmed.createdOffers} offer(s)
            created. {confirmed.createdAccounts} new investor account(s) in the invited state
            {confirmed.reusedAccounts > 0
              ? `, ${confirmed.reusedAccounts} existing account(s) reused`
              : ''}
            .
          </p>
          {confirmed.blockedOffers > 0 && (
            <p className="mt-2 text-sm text-warn">
              {confirmed.blockedOffers} recipient(s) are held because their jurisdiction is not on
              the compliance-approved list. They are on the dashboard with the reason shown, and
              every other recipient is unaffected.
            </p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-dim">
            Nothing has been emailed. Sending is a separate step, one recipient at a time, behind
            the compliance and connection gates.
          </p>
          <button
            type="button"
            onClick={restart}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md border hairline px-4 text-sm text-ftext"
          >
            Import another file
          </button>
        </section>
      )}
    </div>
  )
}

function isTarget(value: string): value is TargetField {
  return (TARGET_FIELDS as readonly string[]).includes(value)
}

function isAnswered(question: ColumnQuestion, answers: Record<string, ColumnAnswer>): boolean {
  const answer = answers[question.sourceColumn]
  if (!answer) return false
  if (question.ambiguity.kind === 'PERCENTAGE_SCALE') return Boolean(answer.percentageInterpretation)
  if (question.ambiguity.kind === 'DECIMAL_SEPARATOR') return Boolean(answer.decimalSeparator)
  return Boolean(answer.dateOrder)
}

function QuestionCard({
  question,
  answer,
  onAnswer,
}: {
  question: ColumnQuestion
  answer: ColumnAnswer
  onAnswer: (next: ColumnAnswer) => void
}) {
  const { ambiguity } = question
  const selected =
    ambiguity.kind === 'PERCENTAGE_SCALE'
      ? answer.percentageInterpretation
      : ambiguity.kind === 'DECIMAL_SEPARATOR'
        ? answer.decimalSeparator
        : answer.dateOrder

  const choose = (id: string) => {
    if (ambiguity.kind === 'PERCENTAGE_SCALE') {
      onAnswer({ percentageInterpretation: id === 'FRACTION' ? 'FRACTION' : 'PERCENT' })
    } else if (ambiguity.kind === 'DECIMAL_SEPARATOR') {
      onAnswer({ decimalSeparator: id === ',' ? ',' : '.' })
    } else {
      onAnswer({ dateOrder: id === 'MDY' ? 'MDY' : 'DMY' })
    }
  }

  return (
    <fieldset className="rounded-md border border-orange p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-orange">
        {question.sourceColumn} → {FIELD_LABEL[question.targetField]}
      </legend>
      <p className="text-sm leading-relaxed text-ftext">{ambiguity.question}</p>
      {ambiguity.samples.length > 0 && (
        <p className="mt-1 text-xs text-dim">
          Values in this column: {ambiguity.samples.join(' · ')}
        </p>
      )}
      {ambiguity.reasoning && (
        <p className="mt-1 text-xs text-dim">{ambiguity.reasoning}</p>
      )}
      <div className="mt-3 space-y-2">
        {ambiguity.options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-2 rounded-md border hairline p-2 text-sm text-ftext"
          >
            <input
              type="radio"
              name={`${question.sourceColumn}-${ambiguity.kind}`}
              value={option.id}
              checked={selected === option.id}
              onChange={() => choose(option.id)}
              className="mt-1"
            />
            <span>
              {option.label}
              {option.preview.length > 0 && (
                <span className="mt-0.5 block text-xs text-dim">
                  reads as {option.preview.join(' · ')}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ReviewPanel({
  preview,
  pending,
  onImport,
  onBack,
}: {
  preview: PreviewSuccess
  pending: boolean
  onImport: () => void
  onBack: () => void
}) {
  return (
    <section className="rounded-lg border hairline bg-paper p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-dim">
        3 · Review every value
      </h2>

      {preview.fileErrors.length > 0 && (
        <div className="mt-3 rounded-md border border-warn p-3">
          <p className="text-sm font-semibold text-warn">
            {preview.fileErrors.length} error(s) stop this whole file
          </p>
          <p className="mt-1 text-xs leading-relaxed text-dim">
            Nothing can be imported until these are fixed in the spreadsheet. This is deliberate —
            a file with a bad address or a duplicate in it is not a file to send offers from.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-ftext">
            {preview.fileErrors.map((fileError, index) => (
              <li key={`${fileError.code}-${fileError.sourceRowNumber}-${index}`}>
                {fileError.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.warnings.length > 0 && (
        <div className="mt-3 rounded-md border hairline p-3">
          <p className="text-sm font-semibold text-ftext">Worth a look</p>
          <ul className="mt-1 space-y-1 text-xs text-dim">
            {preview.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-dim">
                <th className="border-b hairline px-2 py-2">Row</th>
                <th className="border-b hairline px-2 py-2">Name</th>
                <th className="border-b hairline px-2 py-2">Email</th>
                <th className="border-b hairline px-2 py-2">Jurisdiction</th>
                <th className="border-b hairline px-2 py-2 text-right">Amount</th>
                <th className="border-b hairline px-2 py-2 text-right">SPV %</th>
                <th className="border-b hairline px-2 py-2 text-right">Indirect %</th>
                <th className="border-b hairline px-2 py-2">Deadline</th>
                <th className="border-b hairline px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.sourceRowNumber} className="align-top text-ftext">
                  <td className="border-b hairline px-2 py-2 text-dim">{row.sourceRowNumber}</td>
                  <td className="border-b hairline px-2 py-2">{row.name}</td>
                  <td className="border-b hairline px-2 py-2 break-all">{row.email}</td>
                  <td className="border-b hairline px-2 py-2">
                    {row.jurisdiction}
                    {row.jurisdictionReadFrom && (
                      <span className="block text-xs text-dim">
                        read from &ldquo;{row.jurisdictionReadFrom}&rdquo;
                      </span>
                    )}
                  </td>
                  <td className="border-b hairline px-2 py-2 text-right tabular-nums">
                    {row.display.amount}
                  </td>
                  <td className="border-b hairline px-2 py-2 text-right tabular-nums">
                    {row.display.spvPercentage}
                  </td>
                  <td className="border-b hairline px-2 py-2 text-right tabular-nums">
                    {row.display.indirectPercentage}
                    {row.indirectOverridden && (
                      <span className="block text-xs text-dim">override</span>
                    )}
                  </td>
                  <td className="border-b hairline px-2 py-2">{row.display.deadline}</td>
                  <td className="border-b hairline px-2 py-2">
                    {row.blocked ? (
                      <span className="text-warn">Blocked</span>
                    ) : (
                      <span className="text-ok">Ready</span>
                    )}
                    {row.blockDetail && (
                      <span className="block text-xs text-dim">{row.blockDetail}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wider text-dim">Rows</dt>
          <dd className="text-ftext">{preview.totals.rowCount}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-dim">Blocked</dt>
          <dd className={preview.totals.blockedCount > 0 ? 'text-warn' : 'text-ftext'}>
            {preview.totals.blockedCount}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-dim">Total proposed</dt>
          <dd className="text-ftext tabular-nums">{preview.totalsDisplay.proposedAmountUsd}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-dim">Total SPV</dt>
          <dd className="text-ftext tabular-nums">{preview.totalsDisplay.spvPercentage}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onImport}
          disabled={pending || !preview.canImport}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-orange px-4 text-sm font-medium text-ink disabled:opacity-50"
        >
          {pending ? 'Importing…' : `Import ${preview.totals.rowCount} recipient(s)`}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center justify-center rounded-md border hairline px-4 text-sm text-ftext"
        >
          Back to the columns
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-dim">
        Importing creates recipient records, investor accounts in the invited state, and offers.
        It sends nothing.
      </p>
    </section>
  )
}

function Steps({ current }: { current: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: 'upload', label: 'File' },
    { id: 'map', label: 'Columns' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Imported' },
  ]
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {steps.map((step, index) => {
        const active = step.id === current
        return (
          <li
            key={step.id}
            className={`rounded-full border px-3 py-1 ${
              active ? 'border-orange text-orange' : 'hairline text-dim'
            }`}
          >
            {index + 1}. {step.label}
          </li>
        )
      })}
    </ol>
  )
}
