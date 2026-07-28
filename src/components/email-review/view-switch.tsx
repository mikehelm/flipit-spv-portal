'use client'

/**
 * The controls that sit above everything else: which view, and — on paper —
 * whether the pencil is on.
 *
 * Both are real buttons with pressed/checked state rather than a styled
 * checkbox, because both change what the page *is* rather than what will be
 * submitted, and neither belongs to a form.
 */

export type ReviewView = 'GUIDED' | 'PAPER' | 'TECHNICAL'

const VIEWS: ReadonlyArray<{
  id: ReviewView
  label: string
  hint: string
}> = [
  {
    id: 'GUIDED',
    label: 'Guided review',
    hint: 'One recorded change at a time',
  },
  {
    id: 'PAPER',
    label: 'Paper review',
    hint: 'Both letters as pages, marked up in pencil',
  },
  {
    id: 'TECHNICAL',
    label: 'Technical view',
    hint: 'The paired mechanical comparison',
  },
]

export function ReviewViewSwitch({
  view,
  onView,
  markup,
  onMarkup,
}: {
  view: ReviewView
  onView: (next: ReviewView) => void
  markup: boolean
  onMarkup: (next: boolean) => void
}) {
  const active = VIEWS.find((item) => item.id === view) ?? VIEWS[0]

  return (
    <section
      aria-label="Review view"
      className="flex flex-wrap items-center justify-between gap-3 rounded-sm border hairline bg-paper px-3 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Choose how the two emails are shown"
          className="flex rounded-full border hairline bg-bg2 p-1"
        >
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              aria-pressed={view === item.id}
              data-review-view={item.id}
              className={`min-h-11 rounded-full px-4 text-xs font-bold transition-colors ${
                view === item.id
                  ? 'bg-orange text-ink'
                  : 'text-dim hover:text-ftext'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="min-w-0 text-[11px] leading-5 text-muted">{active.hint}</p>
      </div>

      {view === 'PAPER' ? (
        <button
          type="button"
          role="switch"
          aria-checked={markup}
          onClick={() => onMarkup(!markup)}
          data-markup-toggle={markup ? 'on' : 'off'}
          className={`flex min-h-11 items-center gap-3 rounded-full border px-3 text-xs font-bold transition-colors ${
            markup
              ? 'border-orange/45 bg-orange/12 text-orange'
              : 'hairline text-dim'
          }`}
        >
          <span
            aria-hidden="true"
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
              markup ? 'bg-orange' : 'bg-edge/50'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-ftext transition-all ${
                markup ? 'left-[1.15rem]' : 'left-0.5'
              }`}
            />
          </span>
          Markup {markup ? 'on' : 'off'}
        </button>
      ) : null}
    </section>
  )
}
