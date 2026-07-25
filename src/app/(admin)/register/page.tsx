import type { Metadata } from 'next'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { loadOperatorRegister, openRound, type RegisterMember } from '@/lib/register/data'
import { ORDER_IS_NOT_A_QUEUE_NOTICE, REGISTER_TITLE } from '@/lib/register/copy'
import { BAND_EXPLANATION } from '@/lib/register/order'
import { AddToRegisterForm, IssueOfferForm, OverrideForm } from './parts'

export const metadata: Metadata = {
  title: 'Register of interest — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The register in computed order, with each person's history. BUILD_SPEC §5.2.2,
 * §5.2.3.
 *
 * This is the only screen in the application that shows an order, and it is the
 * operator's. §5.2.2: "The computed order is never shown to investors. No one
 * sees their own position or anyone else's."
 */

function formatDate(value: Date | string | null): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value
  return value.toISOString().slice(0, 10)
}

function MemberCard({ member }: { member: RegisterMember }) {
  return (
    <article className="rounded-sm border hairline bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-4">
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-orange text-xs font-bold tabular-nums text-orange"
            aria-hidden="true"
          >
            {member.position}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{member.name}</p>
            <p className="text-xs text-muted">
              {member.email} · account {member.status.toLowerCase()}
              {member.jurisdiction ? ` · ${member.jurisdiction}` : ' · no jurisdiction on record'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Pill tone={member.band === 'FUNDS_RECEIVED' ? 'ok' : 'neutral'}>
            {member.bandLabel}
          </Pill>
          {member.overridden ? <Pill tone="accent">Position overridden</Pill> : null}
          {member.addedByOperator ? <Pill tone="neutral">Added by you</Pill> : null}
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-dim">
        {BAND_EXPLANATION[member.band]}
      </p>

      {member.overridden ? (
        <div className="mt-3 border-l-2 border-orange pl-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
            Why this position was overridden
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ftext">{member.overrideReason}</p>
          <p className="mt-1 text-xs text-muted">
            The computation alone put them at {member.computedPosition}.
          </p>
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted">Joined the register</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
            {formatDate(member.joinedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Funds value date</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
            {member.history.fundsValueDate ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Commitment agreed</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
            {formatDate(member.history.commitmentAgreedAt) ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Indicative interest</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
            {member.indicativeAmount ?? '—'}
          </dd>
        </div>
      </dl>

      {member.history.roundName ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted">Their current offer</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
              {member.history.proposedAmount ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">SPV share</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
              {member.history.spvPercentage ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Received</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ftext">
              {member.history.receivedAmount ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Stage</dt>
            <dd className="mt-0.5 font-semibold text-ftext">
              {member.history.stage?.toLowerCase().replace(/_/g, ' ') ?? '—'}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-xs text-muted">
          No offer on record. They have never been sent an invitation in any round.
        </p>
      )}

      <div className="mt-5 grid gap-3">
        <OverrideForm
          accountId={member.accountId}
          currentPosition={member.position}
          overridden={member.overridden}
        />
        <IssueOfferForm
          accountId={member.accountId}
          name={member.name}
          jurisdiction={member.jurisdiction}
          suggestedAmount={null}
          suggestedPercentage={null}
        />
      </div>
    </article>
  )
}

export default async function RegisterPage() {
  await requireOnboardedAdmin()

  const members = await loadOperatorRegister()
  const round = await openRound()

  return (
    <>
      <SectionHeading eyebrow="Register of interest" title={REGISTER_TITLE}>
        A standing register of people who would take more if more became available. It is not a
        waitlist, and nothing about it reserves an allocation or creates an entitlement to one.
      </SectionHeading>

      <div className="mb-6">
        <Notice>{ORDER_IS_NOT_A_QUEUE_NOTICE}</Notice>
      </div>

      {!round ? (
        <div className="mb-6">
          <Card tone="warn" title="No open round">
            <p className="text-sm leading-relaxed text-dim">
              There is no open round, so no offer can be issued from the register. Joining,
              leaving and ordering all carry on as normal.
            </p>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">
            In computed order{members.length > 0 ? ` (${members.length})` : ''}
          </h2>

          {members.length === 0 ? (
            <Card>
              <p className="text-sm leading-relaxed text-dim">
                Nobody is on the register. Investors add themselves from their own portal, and
                you can add somebody below — including a person who was never on the original
                recipient list.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4">
              {members.map((member) => (
                <MemberCard key={member.accountId} member={member} />
              ))}
            </div>
          )}
        </section>

        <section>
          <Card
            title="Add somebody yourself"
            description="Including a person who was never on the original recipient list. This is how the register becomes the starting list for a later round."
          >
            <AddToRegisterForm />
          </Card>
        </section>
      </div>
    </>
  )
}
