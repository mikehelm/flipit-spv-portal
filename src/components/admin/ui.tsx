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
      ? 'border-l-2 border-l-[#ff5b52]'
      : tone === 'ok'
        ? 'border-l-2 border-l-[#35d07f]'
        : ''

  return (
    <section
      className={`rounded-sm border hairline bg-[#14162f] p-4 sm:p-5 ${accent}`}
    >
      {title ? (
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      ) : null}
      {description ? (
        <div className="mt-2 text-sm leading-relaxed text-[#9498b5]">{description}</div>
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
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#F59A23]">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        {title}
      </h1>
      {children ? (
        <div className="mt-3 max-w-2xl text-sm leading-relaxed text-[#9498b5]">
          {children}
        </div>
      ) : null}
    </header>
  )
}

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
  return (
    <div className="mb-4">
      <label
        htmlFor={name}
        className="block text-xs font-semibold uppercase tracking-wider text-[#cbd1de]"
      >
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? (
        <p className="mt-2 text-xs leading-relaxed text-[#9498b5]">{hint}</p>
      ) : null}
    </div>
  )
}

const controlClass =
  'w-full rounded-sm border hairline bg-[#0d0f2e] px-3 py-2.5 text-sm text-[#e7e9f5] ' +
  'placeholder:text-[#6c7290] focus:border-[#F59A23] focus:outline-none'

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
    <label className="flex items-start gap-3 text-sm text-[#e7e9f5]">
      <input
        type="checkbox"
        {...props}
        id={props.id ?? props.name}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#F59A23]"
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
    ok: 'bg-[#35d07f]/12 text-[#35d07f]',
    warn: 'bg-[#ff5b52]/12 text-[#ff5b52]',
    accent: 'bg-[#F59A23]/12 text-[#F59A23]',
    neutral: 'bg-white/6 text-[#cbd1de]',
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
    <p className="text-sm text-[#9498b5]">
      {label}:{' '}
      <span className={configured ? 'text-[#35d07f]' : 'text-[#ff5b52]'}>{state}</span>
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
  const border = tone === 'warn' ? 'border-[#ff5b52]' : 'border-[#F59A23]'
  return (
    <p className={`border-l-2 ${border} pl-3 text-xs leading-relaxed text-[#9498b5]`}>
      {children}
    </p>
  )
}
