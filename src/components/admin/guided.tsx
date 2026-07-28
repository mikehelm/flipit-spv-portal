import Link from 'next/link'
import { Pill } from '@/components/admin/ui'

export const HUMAN_STATUSES = [
  'Needs you',
  'Waiting',
  'Ready',
  'Complete',
] as const

export type HumanStatus = (typeof HUMAN_STATUSES)[number]

export const STATUS_TONE: Record<
  HumanStatus,
  'ok' | 'warn' | 'neutral' | 'accent'
> = {
  'Needs you': 'accent',
  Waiting: 'warn',
  Ready: 'neutral',
  Complete: 'ok',
}

export const STATUS_ICON: Record<HumanStatus, string> = {
  'Needs you': '→',
  Waiting: '◷',
  Ready: '◇',
  Complete: '✓',
}

export function Status({ status }: { status: HumanStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span> {status}
    </Pill>
  )
}

export function PathItem({
  number,
  title,
  description,
  status,
  href,
}: {
  number: string
  title: string
  description: string
  status: HumanStatus
  href: string
}) {
  return (
    <li className="rounded-sm border hairline bg-bg2/55 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border hairline text-xs font-bold text-silver2"
          >
            {number}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ftext">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-dim">{description}</p>
          </div>
        </div>
        <Status status={status} />
      </div>
      <Link
        href={href}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-orange"
      >
        Open {title.toLowerCase()}
      </Link>
    </li>
  )
}
