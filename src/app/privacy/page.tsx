import type { Metadata } from 'next'
import Link from 'next/link'
import { PageCurl } from '@/components/page-curl'
import { loadVerificationConfig } from '@/lib/verify/config'

/**
 * The privacy policy. BUILD_SPEC §18, §9.2.
 *
 * §18: *"A real domain is needed **before** Gmail verification can start,
 * because the privacy policy has to be hosted on it, so stand the domain and a
 * placeholder privacy policy up early even if the app is not ready."*
 *
 * Two things follow from that sentence, and they pull in opposite directions.
 *
 * **It has to be publicly reachable and indexable**, because a Google reviewer
 * has to be able to open it from a consent screen without a sign-in, and
 * because §18's whole point is that it exists before the application does. So
 * it is the second route in the build with `index: true`.
 *
 * **And it must not become a second anti-phishing page.** §15.1 makes `/verify`
 * the one address an investor is told to type, and a second public page
 * describing the process would dilute that. So this describes data handling and
 * nothing else, and where somebody might be checking whether a message is
 * genuine it sends them to `/verify` rather than answering.
 *
 * It carries no investor-specific content, reads no database, and names no
 * individual beyond the two administrators the verification page already names
 * publicly. It is a server component only so it can read the configured sending
 * address rather than hard-coding one that will drift.
 */

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return {
    title: 'Privacy — Flipit Global SPV investor portal',
    description:
      'How the Flipit Global SPV investor portal handles personal information.',
    robots: {
      index: true,
      follow: true,
      nocache: false,
      googleBot: { index: true, follow: true },
    },
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-sm border hairline bg-paper p-5 sm:p-7">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-6 text-silver2">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  const config = loadVerificationConfig()

  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-16">
      <header>
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          <PageCurl size={18} />
          Flipit Global SPV
        </p>
        <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
          Privacy
        </h1>
        <div className="mt-5 h-[3px] w-12 bg-orange" />
        <p className="mt-5 text-base leading-7 text-silver2">
          This is a private investor portal for a single, invitation-only
          investment process. It is not a public service, it has no sign-up, and
          it holds records only for people who were personally invited.
        </p>
      </header>

      <Section title="What is held, and why">
        <p>
          For each invited person: their name, their email address, the country
          used to determine whether an invitation may lawfully be sent to them,
          the figures of the participation proposed to them, their response, any
          correspondence they send through the portal, and the dates on which
          their participation moved from one recorded stage to the next.
        </p>
        <p>
          Where funds are received, the amount, the value date and the payment
          reference recorded by the operator are held so that a participation
          certificate can be issued.
        </p>
        <p>
          All of it exists for one purpose: administering this investment
          process and keeping an accurate record of it. None of it is used for
          marketing, none of it is sold, and none of it is shared with an
          advertising or analytics service.
        </p>
      </Section>

      <Section title="What is not held">
        <p>
          <strong className="text-white">No tracking.</strong> There is no
          analytics service, no advertising pixel, and no third-party script on
          any page. Emails sent by this portal contain no tracking pixel and no
          click-through redirect; a link in an email goes where it says it goes.
        </p>
        <p>
          <strong className="text-white">No payment details.</strong> No bank
          account number, card number or other payment credential is collected
          or stored here. Payment happens outside this portal, and the portal
          records only that it happened and the reference given to it.
        </p>
        <p>
          <strong className="text-white">No passwords in readable form.</strong>{' '}
          Administrator passwords are stored only as a one-way hash. Investors
          have no password at all — access is by a single-use link sent to the
          address the invitation was sent to, and only a hash of that link is
          stored.
        </p>
      </Section>

      <Section title="Who can see it">
        <p>
          Two named administrators: the owner and the operator of the SPV. No
          one else has an account, and there is no way to create one.
        </p>
        <p>
          <strong className="text-white">
            An investor signing in sees their own record and nothing else.
          </strong>{' '}
          No page, message or error in this portal reveals that another investor
          exists, how many there are, or what anyone else has contributed. Where
          a question and its answer are published for everyone, the person who
          asked is removed — no name, no initials, no address, and the date is
          coarsened so that it cannot identify them.
        </p>
      </Section>

      <Section title="Email">
        <p>
          Messages from this process are sent from{' '}
          <strong className="text-white">{config.invitationSenderEmail}</strong>{' '}
          using Google&rsquo;s mail service, one message at a time, to one named
          recipient. There is no mailing list and no bulk send.
        </p>
        <p>
          Google&rsquo;s handling of a message in transit is governed by their
          own terms. A copy of exactly what was sent is kept here, unchanged, as
          the record of what a recipient was told.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          Indefinitely, by default. The portal is intended to remain the
          investor&rsquo;s own record of this process after the round closes,
          and a record of a securities transaction is not something to discard
          on a schedule.
        </p>
        <p>
          Anyone who would rather their record were removed can say so, and it
          will be — subject only to anything that has to be retained to meet a
          legal or regulatory obligation. Ask through the portal, or reply to
          the invitation.
        </p>
      </Section>

      <Section title="Where it is held, and how">
        <p>
          In a single hosted PostgreSQL database. Credentials and API keys are
          encrypted before they are written, and are never displayed again after
          being saved, never written to a log, and never included in an export.
        </p>
        <p>
          Every consequential action is recorded in an append-only audit log
          &mdash; who did it, when, and why. That log deliberately contains no
          message bodies, no tokens and no credentials.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask what is held about you, ask for it to be corrected, ask
          for a copy, or ask for it to be deleted. Ask through the portal or by
          replying to the invitation, and it will be dealt with by a person
          rather than a form.
        </p>
      </Section>

      <Section title="If you are not sure a message is genuine">
        <p>
          Do not use this page to decide that. There is a page for it, it is
          reachable without signing in, and it names the exact sending address
          and the exact link domain this process uses:
        </p>
        <p>
          <Link href="/verify" className="font-semibold text-orange underline underline-offset-2">
            How to check a message really came from us
          </Link>
        </p>
        <p>
          <strong className="text-white">
            You will never be emailed a change of bank details.
          </strong>{' '}
          If you receive a message that appears to do so, it did not come from
          this process.
        </p>
      </Section>

      <p className="mt-8 text-xs leading-relaxed text-muted">
        This page describes how this portal handles information. It is not the
        offer, and it forms no part of the terms of any investment &mdash; those
        are set out solely in the subscription and SPV documents an investor
        receives.
      </p>
    </main>
  )
}
