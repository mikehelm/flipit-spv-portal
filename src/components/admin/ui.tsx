import type { ReactNode } from 'react'

/**
 * Small presentational primitives for the admin side, in the FLIPIT palette
 * (BUILD_SPEC §13.2). Mobile-first: every one of these is designed at 375px
 * and only then widened.
 *
 * Server components — no state, no handlers.
 */

export function Card({
  title,
  description,
  children,
  tone = 'default',
}: {
  title?: string
  description?: ReactNode
  children: ReactNode
  tone?: 'default' | 'warn' | 'ok'
}) {
  const accent =
    tone === 'warn'
      ? 'border-l-2 border-l-warn'
      : tone === 'ok'
        ? 'border-l-2 border-l-ok'
        : ''

  return (
    <section
      className={`rounded-sm border hairline bg-paper p-4 sm:p-5 ${accent}`}
    >
      {title ? (
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      ) : null}
      {description ? (
        <div className="mt-2 text-sm leading-relaxed text-dim">{description}</div>
      ) : null}
      <div className={title || description ? 'mt-4' : ''}>{children}</div>
    </section>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string
  title: string
  children?: ReactNode
}) {
  return (
    <header className="mb-5">
      {eyebrow ? (
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        {title}
      </h1>
      {children ? (
        <div className="mt-3 max-w-2xl text-sm leading-relaxed text-dim">
          {children}
        </div>
      ) : null}
    </header>
  )
}

/**
 * A labelled control.
 *
 * The hint is joined to the control with `aria-describedby`, so a screen
 * reader reads it as part of the field rather than as a stray paragraph after
 * it. Several of these hints carry the reason a value is refused — "Only http
 * and https addresses are accepted here" — and a hint nobody hears is a hint
 * that is not doing its job.
 *
 * The id is derived from `name`, which is also what `TextInput` and its
 * siblings default their own id to, so the two agree without a caller having
 * to pass either.
 */
export function Field({
  label,
  name,
  hint,
  children,
}: {
  label: string
  name: string
  hint?: ReactNode
  children: ReactNode
}) {
  const hintId = `${name}-hint`

  return (
    <div className="mb-4">
      <label
        htmlFor={name}
        className="block text-xs font-semibold uppercase tracking-wider text-silver2"
      >
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? (
        <p id={hintId} className="mt-2 text-xs leading-relaxed text-dim">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * `focus:border-orange` alone would be a colour-only focus indicator, which
 * WCAG 1.4.1 does not accept. The visible ring comes from the global
 * `:focus-visible` rule in globals.css; this only changes the border so the
 * two read as one control rather than fighting each other.
 *
 * `min-h-11` is 44px — the target size WCAG 2.5.8 asks for, and the height a
 * thumb needs on the 375px screen §13.2 says these people will be using.
 */
const controlClass =
  'w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext ' +
  'placeholder:text-muted focus:border-orange'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} id={props.id ?? props.name} className={controlClass} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} id={props.id ?? props.name} className={`${controlClass} min-h-24`} />
  )
}

export function Select({
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select {...props} id={props.id ?? props.name} className={controlClass}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Checkbox({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-start gap-3 text-sm text-ftext">
      <input
        type="checkbox"
        {...props}
        id={props.id ?? props.name}
        className="mt-0.5 h-4 w-4 shrink-0 accent-orange"
      />
      <span>{label}</span>
    </label>
  )
}

export function Pill({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'neutral' | 'accent'
  children: ReactNode
}) {
  const styles: Record<typeof tone, string> = {
    ok: 'bg-ok/12 text-ok',
    warn: 'bg-warn/12 text-warn',
    accent: 'bg-orange/12 text-orange',
    neutral: 'bg-white/6 text-silver2',
  }
  return (
    <span
      className={`inline-block rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${styles[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * A configured secret, shown as the fact that it exists and nothing more.
 * `maskConfigured()` from lib/crypto produces the text; this is its frame.
 */
export function SecretState({ label, state }: { label: string; state: string }) {
  const configured = state === 'Configured'
  return (
    <p className="text-sm text-dim">
      {label}:{' '}
      <span className={configured ? 'text-ok' : 'text-warn'}>{state}</span>
    </p>
  )
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn'
  children: ReactNode
}) {
  const border = tone === 'warn' ? 'border-warn' : 'border-orange'
  return (
    <p className={`border-l-2 ${border} pl-3 text-xs leading-relaxed text-dim`}>
      {children}
    </p>
  )
}
