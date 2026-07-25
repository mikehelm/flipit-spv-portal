import type { ReactNode } from 'react'
import { Notice, Pill } from '@/components/admin/ui'
import { jurisdictionLabel, partLabel, type BlockExplanation, type TemplateDiff } from '@/lib/compliance'

/**
 * Presentational pieces of the compliance screen. Server components — no
 * state, no handlers, no data access.
 *
 * The diff view renders email body text on screen and nowhere else. It is
 * never passed to `audit()` and never logged: §15 forbids an email body in a
 * log line, and a diff is two email bodies.
 */

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t hairline py-2 sm:flex-row sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-wider text-dim sm:w-48 sm:shrink-0">
        {label}
      </dt>
      <dd className="text-sm break-words text-ftext">{children}</dd>
    </div>
  )
}

export function JurisdictionList({ codes }: { codes: readonly string[] }) {
  if (codes.length === 0) {
    return (
      <span className="text-warn">
        None. No recipient is cleared by this approval.
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {codes.map((code) => (
        <span
          key={code}
          title={jurisdictionLabel(code)}
          className="rounded-sm bg-white/6 px-2 py-0.5 font-mono text-xs text-ftext"
        >
          {code}
        </span>
      ))}
    </span>
  )
}

export function Hash({ value }: { value: string | null }) {
  if (!value) return <span className="text-dim">—</span>
  return (
    <code className="block break-all font-mono text-xs text-silver2">{value}</code>
  )
}

export function DiffView({ diff }: { diff: TemplateDiff }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ftext">{diff.summary}</p>

      {diff.parts
        .filter((part) => part.changed)
        .map((part) => (
          <div key={part.part}>
            <p className="text-xs font-semibold uppercase tracking-wider text-orange">
              {partLabel(part.part)} — {part.added} added, {part.removed} removed
            </p>
            <div className="mt-2 overflow-x-auto rounded-sm border hairline bg-bg2">
              <pre className="min-w-max p-3 font-mono text-[11px] leading-relaxed">
                {part.lines.map((line, index) => (
                  <div
                    key={`${part.part}-${index}`}
                    className={
                      line.kind === 'ADDED'
                        ? 'text-ok'
                        : line.kind === 'REMOVED'
                          ? 'text-warn'
                          : 'text-muted'
                    }
                  >
                    <span aria-hidden className="select-none pr-2">
                      {line.kind === 'ADDED' ? '+' : line.kind === 'REMOVED' ? '-' : ' '}
                    </span>
                    {line.text === '' ? ' ' : line.text}
                  </div>
                ))}
              </pre>
            </div>
            {part.truncated ? (
              <p className="mt-1 text-xs text-dim">
                Unchanged sections between the differences are not shown.
              </p>
            ) : null}
          </div>
        ))}

      <Notice tone="warn">
        Approved text is shown in red, current text in green. Read this against the
        approver&rsquo;s letter, not instead of it.
      </Notice>
    </div>
  )
}

export function Explanation({ explanation }: { explanation: BlockExplanation }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-silver2">
      <p className="font-semibold text-white">{explanation.headline}</p>

      {explanation.paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-orange">
          What unblocking requires
        </p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          {explanation.unblockingRequires.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>

      <p className="text-dim">{explanation.recommendation}</p>

      <Notice tone="warn">{explanation.notLegalAdvice}</Notice>
    </div>
  )
}

export function StatePill({ state }: { state: 'NO_APPROVAL' | 'APPROVED' | 'DRIFTED' }) {
  if (state === 'APPROVED') return <Pill tone="ok">Approved — sending permitted</Pill>
  if (state === 'DRIFTED') return <Pill tone="warn">Drifted — sending disabled</Pill>
  return <Pill tone="warn">No approval — sending disabled</Pill>
}
