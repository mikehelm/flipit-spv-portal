import Link from 'next/link'
import { Card, Pill } from '@/components/admin/ui'
import type { OnboardingProgress } from '@/lib/auth/onboarding'
import type { AdminRole } from '@/lib/roles'

type HumanStatus = 'Needs you' | 'Waiting' | 'Ready' | 'Complete'

const STATUS_TONE: Record<
  HumanStatus,
  'ok' | 'warn' | 'neutral' | 'accent'
> = {
  'Needs you': 'accent',
  Waiting: 'warn',
  Ready: 'neutral',
  Complete: 'ok',
}

const STATUS_ICON: Record<HumanStatus, string> = {
  'Needs you': '→',
  Waiting: '◷',
  Ready: '◇',
  Complete: '✓',
}

function Status({ status }: { status: HumanStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span> {status}
    </Pill>
  )
}

function PathItem({
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

function OperatorStart({
  firstName,
  onboarding,
}: {
  firstName: string
  onboarding: OnboardingProgress
}) {
  const currentStep = onboarding.steps.find((step) => step.current)
  const waitingOnMike = onboarding.nextStep === 'SENDING_ACCOUNT'
  const personalStepsRemaining = onboarding.steps.filter(
    (step) => !step.complete && step.id !== 'SENDING_ACCOUNT',
  )

  const next =
    onboarding.complete
      ? {
          status: 'Ready' as const,
          title: 'Review the investor invitation',
          description:
            'Your setup is complete. Compare David’s original email with the current invitation, ask questions and propose any wording changes.',
          href: '/admin/email-review',
          action: 'Review the invitation',
        }
      : waitingOnMike
        ? {
            status: 'Waiting' as const,
            title: 'Mike needs to connect the sending account',
            description:
              'That credential belongs to Mike. You can keep moving by reviewing the invitation while he connects it.',
            href: '/admin/email-review',
            action: 'Continue with the email review',
          }
        : onboarding.canComplete
          ? {
              status: 'Needs you' as const,
              title: 'One click left — confirm your setup is finished',
              description:
                'Every setup answer is saved. Open setup once more to record that it is complete.',
              href: '/admin/onboarding',
              action: 'Finish setup',
            }
        : {
            status: 'Needs you' as const,
            title: currentStep?.title ?? 'Finish your setup',
            description:
              'Continue your saved setup. The portal will return you to the first unfinished step.',
            href: '/admin/onboarding',
            action: 'Continue setup',
          }

  const setupStatus: HumanStatus = onboarding.complete
    ? 'Complete'
    : waitingOnMike
      ? 'Waiting'
      : 'Needs you'

  return (
    <section aria-labelledby="guided-start-heading" className="mb-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
            David’s next step
          </p>
          <h1
            id="guided-start-heading"
            className="mt-2 text-xl font-bold tracking-tight text-white sm:text-2xl"
          >
            Keep the round moving, {firstName}
          </h1>
        </div>
        <p className="text-xs text-dim">
          {onboarding.completedCount} of {onboarding.totalCount} setup steps complete
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Status status={next.status} />
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-silver2">
            Recommended now
          </p>
        </div>
        <h2 className="mt-4 text-xl font-bold text-white">{next.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dim">
          {next.description}
        </p>
        <Link
          href={next.href}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-sm bg-orange px-5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
        >
          {next.action}
        </Link>
        {waitingOnMike && personalStepsRemaining.length > 0 ? (
          <p className="mt-3 text-xs leading-relaxed text-dim">
            You also have {personalStepsRemaining.length}{' '}
            {personalStepsRemaining.length === 1 ? 'setup step' : 'setup steps'} of your
            own still available.{' '}
            <Link href="/admin/onboarding" className="font-semibold text-orange">
              Review your remaining setup
            </Link>
            .
          </p>
        ) : null}
      </Card>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-ftext">Preparation path</h2>
        <p className="mt-1 text-xs leading-relaxed text-dim">
          This shows what is available now. Ready does not mean reviewed or approved.
        </p>
        <ol className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <PathItem
            number="1"
            title="Your setup"
            description="Your identity, contact choice and rehearsal steps."
            status={setupStatus}
            href="/admin/onboarding"
          />
          <PathItem
            number="2"
            title="Invitation review"
            description="Compare the two emails and explain or propose wording changes."
            status="Ready"
            href="/admin/email-review"
          />
          <PathItem
            number="3"
            title="Investor list"
            description={
              onboarding.complete
                ? 'Review the investor records and offers; no completion is assumed here.'
                : 'This is available now. No investor-data completion is assumed here.'
            }
            status="Ready"
            href="/investors"
          />
          <PathItem
            number="4"
            title="Investor rehearsal"
            description="Walk through the safe John Doe preview before anything is sent."
            status="Ready"
            href="/portal/demo"
          />
        </ol>
      </div>
    </section>
  )
}

function OwnerStart({
  firstName,
  pendingAccessRequests,
  submittedProposals,
}: {
  firstName: string
  pendingAccessRequests: number
  submittedProposals: number
}) {
  const accessStatus: HumanStatus =
    pendingAccessRequests > 0 ? 'Needs you' : 'Ready'
  const proposalStatus: HumanStatus =
    submittedProposals > 0 ? 'Needs you' : 'Ready'
  const totalDecisions = pendingAccessRequests + submittedProposals
  const next =
    pendingAccessRequests > 0
      ? {
          title: 'Review access requests',
          description:
            pendingAccessRequests === 1
              ? 'One person is waiting for a verification decision.'
              : `${pendingAccessRequests} people are waiting for verification decisions.`,
          href: '/access-requests',
          action: 'Review access requests',
        }
      : submittedProposals > 0
        ? {
            title: 'Review David’s proposed wording',
            description:
              submittedProposals === 1
                ? 'One invitation change is waiting for your decision.'
                : `${submittedProposals} invitation changes are waiting for your decisions.`,
            href: '/admin/email-review',
            action: 'Review proposed changes',
          }
        : {
            title: 'Review invitation readiness',
            description:
              'Access requests and submitted wording changes are clear. Check the investor list and pre-flight readiness next.',
            href: '/recipients',
            action: 'Review invitation readiness',
          }

  return (
    <section aria-labelledby="guided-start-heading" className="mb-8">
      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          Mike’s decisions
        </p>
        <h1
          id="guided-start-heading"
          className="mt-2 text-xl font-bold tracking-tight text-white sm:text-2xl"
        >
          What needs your decision, {firstName}
        </h1>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Status status={totalDecisions > 0 ? 'Needs you' : 'Ready'} />
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-silver2">
            Recommended now
          </p>
        </div>
        <h2 className="mt-4 text-xl font-bold text-white">{next.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dim">
          {next.description}
        </p>
        <Link
          href={next.href}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-sm bg-orange px-5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
        >
          {next.action}
        </Link>
      </Card>

      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PathItem
          number="1"
          title="Access decisions"
          description={
            pendingAccessRequests === 0
              ? 'No verification decisions are waiting.'
              : `${pendingAccessRequests} verification ${pendingAccessRequests === 1 ? 'decision is' : 'decisions are'} waiting.`
          }
          status={accessStatus}
          href="/access-requests"
        />
        <PathItem
          number="2"
          title="Invitation decisions"
          description={
            submittedProposals === 0
              ? 'No submitted wording changes are waiting.'
              : `${submittedProposals} submitted wording ${submittedProposals === 1 ? 'change is' : 'changes are'} waiting.`
          }
          status={proposalStatus}
          href="/admin/email-review"
        />
      </ol>
    </section>
  )
}

function ViewerStart({ firstName }: { firstName: string }) {
  return (
    <section aria-labelledby="guided-start-heading" className="mb-8">
      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          Safe test guide
        </p>
        <h1
          id="guided-start-heading"
          className="mt-2 text-xl font-bold tracking-tight text-white sm:text-2xl"
        >
          Three things to try, {firstName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
          These are read-only paths. You can inspect the experience without saving,
          sending or approving anything.
        </p>
      </div>

      <ol className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <PathItem
          number="1"
          title="Compare the emails"
          description="Open David’s original and the current invitation side by side."
          status="Ready"
          href="/admin/email-review"
        />
        <PathItem
          number="2"
          title="Rehearse a proposal"
          description="Use Graham test mode to try David’s proposal flow. Nothing you type is saved."
          status="Ready"
          href="/admin/email-review"
        />
        <PathItem
          number="3"
          title="View as John Doe"
          description="Walk through the synthetic investor experience without changing data."
          status="Ready"
          href="/portal/demo"
        />
      </ol>
    </section>
  )
}

export function GuidedStart({
  role,
  firstName,
  onboarding,
  pendingAccessRequests,
  submittedProposals,
}: {
  role: AdminRole
  firstName: string
  onboarding: OnboardingProgress | null
  pendingAccessRequests: number | null
  submittedProposals: number | null
}) {
  if (role === 'OPERATOR' && onboarding) {
    return <OperatorStart firstName={firstName} onboarding={onboarding} />
  }

  if (role === 'OWNER') {
    return (
      <OwnerStart
        firstName={firstName}
        pendingAccessRequests={pendingAccessRequests ?? 0}
        submittedProposals={submittedProposals ?? 0}
      />
    )
  }

  return <ViewerStart firstName={firstName} />
}
