import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { portalSignOutAction, recordResponseAction } from '@/actions/portal'
import { ActionForm } from '@/components/admin/action-form'
import { PageCurl } from '@/components/page-curl'
import { SiteFooter } from '@/components/site-footer'
import { canRespond, canView, type PortalNotice } from '@/lib/portal/access'
import { loadPortalView, type PortalOffer } from '@/lib/portal/data'
import { PAYMENT_SAFETY_NOTICE, type TimelineStep } from '@/lib/portal/timeline'
import { readInvestorAccount } from '@/lib/portal/session'
import { loadInvestorQa } from '@/lib/qa/data'
import { loadInvestorRegisterView } from '@/lib/register/data'
import { ROADMAP_DISCLAIMER } from '@/lib/portal/roadmap'
import { loadInvestorUpdates } from '@/lib/updates/data'
import { QaSection } from './qa-section'
import { RegisterSection } from './register-section'
import { UpdatesSection } from './updates-section'

export const metadata: Metadata = {
  title: 'Your private invitation — Flipit',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The investor's own record. BUILD_SPEC §4, §5, §13.
 *
 * Everything on this page is theirs. There is no count of other participants,
 * no total raised, no position in any queue, and no wording that implies any of
 * those exist — §15.
 */

const NOTICES: Record<PortalNotice, { title: string; body: string }> = {
  SUSPENDED: {
    title: 'Access temporarily unavailable',
    body: 'Access to this portal is temporarily unavailable. Please contact David if you have any questions.',
  },
  CLOSED: {
    title: 'This process has concluded',
    body: 'This process has concluded for your record. If you need a copy of your documents or correspondence, please contact David.',
  },
  READ_ONLY: {
    title: 'Read-only',
    body: 'This portal is currently read-only. You can view your record and download your documents, but responses and messages are not being accepted at this time.',
  },
  SUNSET: {
    title: 'This portal is closing',
    body: 'This portal will close soon. Please download any documents or correspondence you wish to keep before then.',
  },
  SERVICE_CLOSED: {
    title: 'The portal is no longer available',
    body: 'The Flipit investor portal is no longer available. For any questions about your record, please contact David.',
  },
  ARCHIVED: {
    title: 'This record is closed',
    body: 'This record is retained for our files and is no longer available here. Please contact David for anything you need.',
  },
}

function Step({ step }: { step: TimelineStep }) {
  const tone =
    step.state === 'DONE'
      ? 'text-ok border-ok'
      : step.state === 'CURRENT'
        ? 'text-orange border-orange'
        : 'text-muted border-edge'

  return (
    <li className="flex gap-4">
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${tone}`}
        aria-hidden="true"
      >
        {step.number}
      </div>
      <div className={`min-w-0 pb-6 ${step.state === 'AHEAD' ? 'opacity-60' : ''}`}>
        <p className="text-sm font-semibold text-ftext">
          {step.label}
          {step.state === 'CURRENT' ? (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-orange">
              Where things stand
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-dim">{step.explanation}</p>
      </div>
    </li>
  )
}

function OfferSection({ offer, allowResponse }: { offer: PortalOffer; allowResponse: boolean }) {
  return (
    <section className="mt-10">
      <div className="rounded-sm border hairline bg-paper p-5">
        <h2 className="text-sm font-semibold text-white">Your invitation</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <div>
            <dt className="text-xs text-muted">Investment amount</dt>
            <dd className="mt-1 font-semibold tabular-nums text-white">
              {offer.proposedAmount}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Your share of the SPV</dt>
            <dd className="mt-1 font-semibold tabular-nums text-white">
              {offer.spvPercentage}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Indirect Flipit interest</dt>
            <dd className="mt-1 font-semibold tabular-nums text-white">
              {offer.indirectPercentage}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Response deadline</dt>
            <dd className="mt-1 font-semibold tabular-nums text-white">
              {offer.responseDeadline}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-dim">
          Your response is not a binding subscription, and no payment is requested at this
          stage.
        </p>
      </div>

      {offer.showPaymentSafetyNotice ? (
        <p className="mt-4 border-l-2 border-warn bg-warn/6 p-4 text-sm leading-relaxed text-warn">
          {PAYMENT_SAFETY_NOTICE}
        </p>
      ) : null}

      {allowResponse ? (
        <div className="mt-6 rounded-sm border hairline bg-paper p-5">
          <h2 className="text-sm font-semibold text-white">Your response</h2>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            You can change this at any time until {offer.responseDeadline}.
          </p>

          <div className="mt-4">
            <ActionForm
              action={recordResponseAction}
              submitLabel="Record my response"
              hidden={{ offerId: offer.offerId }}
            >
              <fieldset className="mb-4">
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-silver2">
                  Choose one
                </legend>
                {(
                  [
                    ['INTERESTED', 'I am interested in receiving the formal investment documents.'],
                    ['NOT_INTERESTED', 'I am not interested at this time.'],
                    ['QUESTION', 'I have a question before deciding.'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="mb-3 flex items-start gap-3 text-sm text-ftext">
                    <input
                      type="radio"
                      name="choice"
                      value={value}
                      defaultChecked={offer.responseChoice === value}
                      required
                      className="mt-0.5 h-4 w-4 shrink-0 accent-orange"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>

              <label
                htmlFor={`note-${offer.offerId}`}
                className="block text-xs font-semibold uppercase tracking-wider text-silver2"
              >
                Questions or comments
              </label>
              <textarea
                id={`note-${offer.offerId}`}
                name="note"
                defaultValue={offer.responseNote ?? ''}
                rows={4}
                className="mt-2 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext placeholder:text-muted focus:border-orange"
              />
            </ActionForm>
          </div>
        </div>
      ) : null}

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-white">Where things stand</h2>
        <p className="mt-2 text-xs leading-relaxed text-dim">
          Each step below updates as the process moves forward. You will not need to do
          anything until a step asks you to.
        </p>
        <ol className="mt-5">
          {offer.timeline.map((step) => (
            <Step key={step.stage} step={step} />
          ))}
        </ol>
      </div>

      {offer.certificates.length > 0 ? (
        <section className="mt-8 rounded-sm border hairline bg-paper p-5">
          <h2 className="text-sm font-semibold text-white">Your participation certificate</h2>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            It confirms receipt of your funds and the position recorded for you. It is not a
            share certificate and not a title document — the subscription and SPV documents
            remain the governing instruments.
          </p>
          <ul className="mt-4 grid gap-2">
            {offer.certificates.map((certificate) => (
              <li
                key={certificate.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-sm border hairline bg-bg2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ftext">
                    {certificate.currency} {certificate.amountReceived} · value date{' '}
                    {certificate.valueDate}
                  </p>
                  <p className="text-xs text-muted">
                    Version {certificate.version} · issued {certificate.issuedOn}
                    {certificate.superseded ? ' · superseded by a later version' : ''}
                  </p>
                </div>
                <a
                  href={`/portal/certificate/${certificate.id}`}
                  className="inline-flex min-h-11 items-center rounded-sm bg-orange/12 px-3 text-xs font-semibold text-orange"
                >
                  Download PDF
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {offer.snapshot ? (
        <details className="mt-4 rounded-sm border hairline bg-paper p-5">
          <summary className="cursor-pointer text-sm font-semibold text-white">
            The invitation as it was sent to you
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            This is the exact message, kept unchanged as your record of it.
          </p>
          <p className="mt-3 text-xs text-muted">Subject: {offer.snapshot.subject}</p>
        </details>
      ) : null}
    </section>
  )
}

export default async function PortalPage() {
  const account = await readInvestorAccount()
  if (!account) redirect('/portal/signin')

  const view = await loadPortalView(account.id)
  if (!view) redirect('/portal/signin')

  const notice = view.access.notice ? NOTICES[view.access.notice] : null
  const qa = canView(view.access) ? await loadInvestorQa(account.id, view.access) : null
  const register = canView(view.access)
    ? await loadInvestorRegisterView(account.id, view.access)
    : null
  const updates = canView(view.access)
    ? await loadInvestorUpdates(account.id, view.access)
    : null

  return (
    <>
      <main id="main" className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-16">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          <PageCurl size={18} />
          Private Flipit Investment Invitation
        </p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight break-words text-white sm:text-3xl">
          {view.name}
        </h1>
        <div className="mt-5 h-[3px] w-12 bg-orange" />

        <p className="mt-6 text-sm leading-relaxed text-dim">
          This page displays the personalised invitation sent to you, and it will remain your
          private record of this process.
        </p>

        {notice ? (
          <div className="mt-6 rounded-sm border border-orange/40 bg-orange/6 p-4">
            <p className="text-sm font-semibold text-orange">{notice.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-silver2">{notice.body}</p>
          </div>
        ) : null}

        {canView(view.access) ? (
          view.offers.length === 0 ? (
            <p className="mt-10 text-sm leading-relaxed text-dim">
              There is nothing on your record yet.
            </p>
          ) : (
            view.offers.map((offer) => (
              <OfferSection
                key={offer.offerId}
                offer={offer}
                allowResponse={canRespond(view.access)}
              />
            ))
          )
        ) : null}

        {updates ? <UpdatesSection view={updates} /> : null}

        {qa ? <QaSection view={qa} /> : null}

        {register ? <RegisterSection view={register} /> : null}

        {canView(view.access) && view.tiles.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-sm font-semibold text-white">Coming to your portal</h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {view.tiles.map((tile) => (
                <li
                  key={tile.label}
                  className="rounded-sm border hairline bg-paper px-4 py-3 text-sm text-silver2"
                >
                  {tile.label}
                  {tile.isLive ? (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-ok">
                      Available
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {/*
              BUILD_SPEC §13.1, and it is not optional: *"A standing line beneath
              the tiles: Features shown are in development, are indicative only,
              and form no part of the investment being offered."*

              §13.1 also calls this section "the easiest place in the build to say
              something unintended", which is why the line comes from a constant
              beside the tiles rather than from tile copy — an owner renaming or
              hiding a tile cannot remove it, and there is no configuration that
              switches it off.
            */}
            <p className="mt-4 text-xs leading-relaxed text-muted">{ROADMAP_DISCLAIMER}</p>
          </section>
        ) : null}

        <div className="mt-12 border-t hairline pt-6">
          <form action={portalSignOutAction}>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-dim underline underline-offset-2"
            >
              Sign out
            </button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-muted">
            This portal displays your own record only. Nothing shown here is an offer to the
            public, investment advice, or a recommendation. The formal terms of any
            investment are set out solely in the subscription and SPV documents you receive.
            If anything here appears inconsistent with those documents, the documents govern.
          </p>
          <p className="mt-3 text-xs text-muted">
            <Link href="/verify" className="text-orange">
              How to check a message really came from us
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter surface="PORTAL" />
    </>
  )
}
