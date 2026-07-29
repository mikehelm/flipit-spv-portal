import { recordTohuDecisionAction } from '@/actions/investor-plan'
import {
  GMAIL_ALIAS_HELP_URL,
  TOHU_ALIAS_EMAIL,
} from '@/lib/investor-plan/tohu-decision'

function Choice({
  decision,
  title,
  description,
  recommended = false,
}: {
  decision: 'PLUS_ALIAS' | 'COMBINE' | 'DECIDE_LATER'
  title: string
  description: string
  recommended?: boolean
}) {
  return (
    <form action={recordTohuDecisionAction}>
      <input type="hidden" name="decision" value={decision} />
      <button
        type="submit"
        className={`w-full rounded-sm border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-orange ${
          recommended
            ? 'border-orange/70 bg-orange/10 hover:bg-orange/15'
            : 'hairline bg-bg hover:border-orange/50'
        }`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ftext">{title}</span>
          {recommended ? (
            <span className="rounded-full bg-orange px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink">
              Recommended
            </span>
          ) : null}
        </span>
        <span className="mt-2 block text-sm leading-relaxed text-dim">
          {description}
        </span>
      </button>
    </form>
  )
}

export function TohuEmailDecisionDialog() {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tohu-email-title"
      aria-describedby="tohu-email-description"
    >
      <section className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-md border border-orange/35 bg-bg2 p-5 shadow-2xl sm:p-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange">
          One investor-list decision
        </p>
        <h1 id="tohu-email-title" className="mt-3 text-2xl font-bold text-ftext">
          David and Tohu currently share one email
        </h1>
        <div
          id="tohu-email-description"
          className="mt-4 space-y-3 text-sm leading-relaxed text-silver2"
        >
          <p>
            The spreadsheet contains a personal allocation for David and a
            separate company allocation for Tohu Bohu, but both currently use{' '}
            <strong className="text-ftext">serenedavid@gmail.com</strong>.
          </p>
          <p>
            The portal needs one distinct email per investor record so the two
            allocations, responses, documents and audit histories cannot become
            mixed. Mike asked us not to combine them automatically for that
            reason.
          </p>
          <p>
            Gmail supports plus aliases. Mail sent to{' '}
            <strong className="break-all text-orange">{TOHU_ALIAS_EMAIL}</strong>{' '}
            still arrives in David&apos;s normal Gmail inbox, while this portal
            can treat it as Tohu&apos;s separate address.{' '}
            <a
              href={GMAIL_ALIAS_HELP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-orange underline underline-offset-2"
            >
              Read Google&apos;s official explanation
            </a>
            .
          </p>
        </div>

        <div className="mt-6 grid gap-3">
          <Choice
            decision="PLUS_ALIAS"
            title={`Use ${TOHU_ALIAS_EMAIL}`}
            description="Keep the personal and company investments separate while delivering both sets of messages to David’s existing Gmail inbox."
            recommended
          />
          <Choice
            decision="COMBINE"
            title="Combine David and Tohu"
            description="Create one investor record totaling USD 10,973. Choose this only if the personal and company allocations truly should become one record."
          />
          <Choice
            decision="DECIDE_LATER"
            title="Decide later"
            description="Close this first-login question without changing or importing either record."
          />
        </div>
      </section>
    </div>
  )
}
