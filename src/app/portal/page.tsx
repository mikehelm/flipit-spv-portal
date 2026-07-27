import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { portalSignOutAction, recordResponseAction } from '@/actions/portal'
import { AccountCurlMenu } from '@/components/account-curl-menu'
import { ActionForm } from '@/components/admin/action-form'
import { PageCurl } from '@/components/page-curl'
import { PortalPreviewSwitch } from '@/components/portal-preview-switch'
import { SiteFooter } from '@/components/site-footer'
import { requireReader } from '@/lib/auth/guards'
import { canRespond, canView } from '@/lib/portal/access'
import { flagEnabled, PORTAL_FLAGS, readFeatureFlags } from '@/lib/flags'
import { CONTACT_COPY, type PortalContact } from '@/lib/portal/contact'
import {
  OPERATOR_CONTACT_COPY,
  OPERATOR_CONTACT_SAFETY,
} from '@/lib/portal/operator-contact'
import { noticeCopy } from '@/lib/portal/notices'
import { loadPortalView, type PortalOffer, type PortalView } from '@/lib/portal/data'
import { johnDoeDemoPortalView } from '@/lib/portal/demo'
import { PAYMENT_SAFETY_NOTICE, type TimelineStep } from '@/lib/portal/timeline'
import { readInvestorAccount } from '@/lib/portal/session'
import { loadInvestorQa } from '@/lib/qa/data'
import { loadInvestorRegisterView } from '@/lib/register/data'
import { ROADMAP_DISCLAIMER } from '@/lib/portal/roadmap'
import { investorDocuments } from '@/lib/documents/data'
import { shouldShowVideoSection, videoTextAlternative } from '@/lib/media/video'
import { currentVideo } from '@/lib/media/video-store'
import type { AdminRole } from '@/lib/roles'
import { loadInvestorUpdates } from '@/lib/updates/data'
import { pendingEmailChange } from '@/lib/portal/email-change'
import {
  ACKNOWLEDGEMENT_HEADING,
  ACKNOWLEDGEMENT_STANDING_LINE,
} from '@/lib/portal/acknowledgements'
import {
  activeAcknowledgementItems,
  currentAcknowledgements,
  type AcknowledgementItem,
} from '@/lib/portal/acknowledgements-data'
import { EmailSection } from './email-section'
import { QaSection } from './qa-section'
import { RegisterSection } from './register-section'
import { DocumentsSection } from './documents-section'
import { UpdatesSection } from './updates-section'
import { VideoSection } from './video-section'
import styles from './premium-effects.module.css'

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

/**
 * The contact route, rendered. §4.2 asks for one on a suspended account and §7
 * asks for one on a closed portal; which address leads is `portalContacts`.
 *
 * A `mailto:` rather than a form. A form would be a message channel that only
 * works while the application is up, on notices whose whole subject is this
 * application being unavailable to the person reading them.
 */
function ContactRoute({ contacts }: { contacts: PortalContact[] }) {
  if (contacts.length === 0) return null

  return (
    <div className="mt-3 border-t border-orange/25 pt-3">
      {contacts.map((contact) => (
        <p key={contact.address} className="text-sm leading-relaxed text-silver2">
          {CONTACT_COPY[contact.use].before}
          <a href={`mailto:${contact.address}`} className="break-words text-orange underline">
            {contact.address}
          </a>
          {CONTACT_COPY[contact.use].after}
        </p>
      ))}
    </div>
  )
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

/**
 * The acknowledgement checkboxes. BUILD_SPEC §13, §8.2.
 *
 * The wording comes from the table an owner edits; the standing line beneath
 * does not, and there is no prop here that could replace it. §13 makes "not to
 * be treated as a binding subscription" a constraint on the application rather
 * than a default, so the sentence is rendered from a constant and appears
 * whenever the boxes do.
 *
 * With nothing configured the section does not appear at all — an empty set of
 * approved wording is a supported state, not a gap to be filled with something
 * invented here.
 */
function Acknowledgements({
  items,
  ticked,
}: {
  items: AcknowledgementItem[]
  ticked: Set<string>
}) {
  if (items.length === 0) return null

  return (
    <fieldset className="mb-5 border-t hairline pt-5">
      <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-silver2">
        {ACKNOWLEDGEMENT_HEADING}
      </legend>

      {items.map((item) => (
        <label key={item.id} className="mb-3 flex items-start gap-3 text-sm text-ftext">
          <input
            type="checkbox"
            name="acknowledgement"
            value={item.id}
            defaultChecked={ticked.has(item.id)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-orange"
          />
          <span className="leading-relaxed">
            {item.label}
            {!item.required ? <span className="ml-2 text-xs text-muted">(optional)</span> : null}
          </span>
        </label>
      ))}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        {ACKNOWLEDGEMENT_STANDING_LINE}
      </p>
    </fieldset>
  )
}

function OfferSection({
  offer,
  allowResponse,
  acknowledgements,
  ticked,
}: {
  offer: PortalOffer
  allowResponse: boolean
  acknowledgements: AcknowledgementItem[]
  ticked: Set<string>
}) {
  return (
    <section className="mt-10">
      <div className={`${styles.surface} rounded-sm border hairline bg-paper p-5`}>
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
                className="mt-2 mb-5 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext placeholder:text-muted focus:border-orange"
              />

              <Acknowledgements items={acknowledgements} ticked={ticked} />
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
        <ol className={`${styles.timeline} mt-5`}>
          {offer.timeline.map((step) => (
            <Step key={step.stage} step={step} />
          ))}
        </ol>
      </div>

      {offer.certificates.length > 0 ? (
        <section
          className={`${styles.surface} ${styles.certificateSurface} mt-8 rounded-sm border hairline p-5`}
        >
          <h2 className="text-sm font-semibold text-white">Your participation certificate</h2>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            It confirms receipt of your funds and the position recorded for you. It is not a
            share certificate and not a title document — the subscription and SPV documents
            remain the governing instruments.
          </p>
          <ul className="mt-4 grid grid-cols-1 gap-2">
            {offer.certificates.map((certificate) => (
              <li
                key={certificate.id}
                className={`${styles.certificateRow} flex flex-wrap items-center justify-between gap-3 rounded-sm border hairline bg-bg2 px-3 py-2.5`}
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

export async function renderPortalPage(isDemoPreview = false) {
  let accountId: string
  let view: PortalView
  let previewRole: AdminRole = 'OPERATOR'

  if (isDemoPreview) {
    // This is the real access boundary. Owners, operators and explicitly
    // allowlisted read-only testers may enter; a guessed or shared URL still
    // reaches this signed-in reader guard before any synthetic data is chosen.
    const admin = await requireReader()
    previewRole = admin.role
    view = johnDoeDemoPortalView()
    accountId = view.accountId
  } else {
    const account = await readInvestorAccount()
    if (!account) redirect('/portal/signin')

    const loaded = await loadPortalView(account.id)
    if (!loaded) redirect('/portal/signin')
    view = loaded
    accountId = account.id
  }

  const notice = view.access.notice
    ? noticeCopy(view.access.notice, { closingDate: view.closingDate })
    : null
  const qa =
    !isDemoPreview && canView(view.access)
      ? await loadInvestorQa(accountId, view.access)
      : null
  const register = !isDemoPreview && canView(view.access)
    ? await loadInvestorRegisterView(accountId, view.access)
    : null
  const updates = !isDemoPreview && canView(view.access)
    ? await loadInvestorUpdates(accountId, view.access)
    : null

  // §13.3. The section exists only when there is a published video: no
  // placeholder, no empty player, no gap where one would have been. The video
  // is global rather than per-investor — there is one, David's, and it is the
  // same one for everybody — so nothing here reads or reveals another account.
  // §7, §13.3. Off: the section is absent. The video is global — one video,
  // David's, the same for everybody — so nothing of this investor's goes with
  // it.
  const video =
    canView(view.access) && flagEnabled(await readFeatureFlags(), PORTAL_FLAGS.operatorVideo)
      ? await currentVideo()
      : null
  const videoText = video ? videoTextAlternative(video) : null

  // §5 status 3 and §13. Issued documents only — `investorDocuments` joins
  // through this account's own offers, so another investor's document is never
  // selected rather than being fetched and filtered out. §7 keeps these
  // readable in `read_only` and `sunset`, which `canView` already allows.
  const documents =
    !isDemoPreview && canView(view.access) ? await investorDocuments(accountId) : []

  // §13. Keyed on this account, so there is no pending request here but their
  // own — and nothing is loaded at all for a reader who cannot see their record.
  const pending =
    !isDemoPreview && canView(view.access) ? await pendingEmailChange(accountId) : null

  // §13, §8.2. The configured wording, and what this investor has already
  // ticked so the form comes back as they left it. Both are keyed on their own
  // offers; the wording is global and belongs to nobody.
  const acknowledgements =
    !isDemoPreview && canRespond(view.access) ? await activeAcknowledgementItems() : []
  const tickedByOffer = new Map<string, Set<string>>()
  if (acknowledgements.length > 0) {
    for (const offer of view.offers) {
      tickedByOffer.set(offer.offerId, await currentAcknowledgements(offer.offerId))
    }
  }

  return (
    <>
      <AccountCurlMenu
        name={view.name}
        email={view.email}
        roleLabel={isDemoPreview ? 'Demo investor' : 'Investor'}
      >
        {isDemoPreview ? (
          <Link
            href="/admin"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-sm border border-orange/35 bg-orange/10 px-3 text-xs font-semibold text-orange"
          >
            Exit preview
          </Link>
        ) : (
          <form action={portalSignOutAction}>
            <button
              type="submit"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-sm border hairline px-3 text-xs font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
            >
              Sign out
            </button>
          </form>
        )}
      </AccountCurlMenu>

      {isDemoPreview ? (
        <PortalPreviewSwitch mode="INVESTOR" role={previewRole} />
      ) : null}

      <main id="main" className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-16">
        {isDemoPreview ? (
          <p className="mb-6 rounded-sm border border-orange/25 bg-orange/6 p-3 text-xs leading-relaxed text-silver2">
            Private investor rehearsal for Mike, David and authorized testers. John Doe
            is synthetic, nothing is saved, and no email can be sent.
          </p>
        ) : null}

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
            <ContactRoute contacts={view.contacts} />
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
                allowResponse={!isDemoPreview && canRespond(view.access)}
                acknowledgements={acknowledgements}
                ticked={tickedByOffer.get(offer.offerId) ?? new Set()}
              />
            ))
          )
        ) : null}

        {shouldShowVideoSection(video) && video ? (
          <VideoSection
            videoId={video.id}
            contentType={video.contentType}
            caption={videoText?.caption ?? null}
            transcript={videoText?.transcript ?? null}
          />
        ) : null}

        <DocumentsSection documents={documents} />

        {updates ? <UpdatesSection view={updates} /> : null}

        {qa ? <QaSection view={qa} /> : null}

        {register ? <RegisterSection view={register} /> : null}

        {canView(view.access) ? (
          <EmailSection
            currentEmail={view.email}
            pending={pending}
            canChange={!isDemoPreview && view.access.capability === 'FULL'}
          />
        ) : null}

        {canView(view.access) && view.tiles.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-sm font-semibold text-white">Coming to your portal</h2>
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
          {isDemoPreview ? (
            <p className="text-sm font-semibold text-orange">
              Demo preview — no investor session has been created.
            </p>
          ) : null}

          <p className="mt-6 text-xs leading-relaxed text-muted">
            This portal displays your own record only. Nothing shown here is an offer to the
            public, investment advice, or a recommendation. The formal terms of any
            investment are set out solely in the subscription and SPV documents you receive.
            If anything here appears inconsistent with those documents, the documents govern.
          </p>
          {/*
            §13's "route to contact the operator", and §2.1's `wa.me` link.
            Directly beneath the statement of what the portal is and is not,
            because §13 lists the two together and because somebody who has just
            read "this is not advice" is exactly who wants somewhere to ask.

            Absent when nothing is configured. A contact section naming no route
            is worse than no section.
          */}
          {view.operatorContact ? (
            <div className="mt-6 border-t hairline pt-6">
              <h2 className="text-sm font-semibold text-white">If you have a question</h2>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                The questions section above reaches us and keeps your question on your
                record, which is usually the best place for it.{' '}
                {OPERATOR_CONTACT_COPY[view.operatorContact.kind]}
                <a
                  href={view.operatorContact.href}
                  className="break-words text-orange underline"
                  {...(view.operatorContact.kind === 'WHATSAPP'
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                >
                  {view.operatorContact.display}
                </a>
                .
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                {OPERATOR_CONTACT_SAFETY}
              </p>
            </div>
          ) : null}

          <p className="mt-6 text-xs text-muted">
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

export default async function PortalPage() {
  return renderPortalPage()
}
