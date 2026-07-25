import type { Metadata } from 'next'
import {
  loadVerificationConfig,
  type VerificationConfig,
} from '@/lib/verify/config'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return {
    title: 'Verify a Flipit SPV invitation',
    description:
      'Independent checks for an invitation to the Flipit Global SPV investor portal.',
    robots: {
      index: true,
      follow: true,
      nocache: false,
      googleBot: { index: true, follow: true },
    },
  }
}

export function VerificationPageContent({
  config,
}: {
  config: VerificationConfig
}) {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-16">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange">
          FLIPIT · Invitation verification
        </p>
        <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
          Checking whether the invitation is genuine
        </h1>
        <div className="mt-5 h-[3px] w-12 bg-orange" />
        <p className="mt-5 text-base leading-7 text-silver2">
          You may have received an unexpected private invitation concerning an
          investment through the Flipit Global SPV. Being cautious is the right
          response. Use the checks below before opening a link or transferring
          funds.
        </p>
      </header>

      <section className="mt-8 rounded-sm border hairline bg-paper p-5 sm:p-7">
        <h2 className="text-xl font-semibold text-white">Who is involved</h2>
        <div className="mt-4 space-y-4 text-sm leading-6 text-silver2">
          <p>
            <strong className="text-white">Michael Helm</strong> is the owner
            administrator for this private investor portal, with oversight of
            its records, access, and exports.
          </p>
          <p>
            <strong className="text-white">David Serene</strong> is the SPV
            operator. He manages the invitations, investor questions, recorded
            participation stages, and confirmation of received funds.
          </p>
        </div>
      </section>

      <section className="mt-5 rounded-sm border hairline bg-paper p-5 sm:p-7">
        <h2 className="text-xl font-semibold text-white">Two exact checks</h2>
        <dl className="mt-5 grid grid-cols-1 gap-5">
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.14em] text-dim">
              Invitation sender
            </dt>
            <dd className="mt-1 break-all font-mono text-base text-white">
              {config.invitationSenderEmail}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-[0.14em] text-dim">
              Domain used by every legitimate link
            </dt>
            <dd className="mt-1 break-all font-mono text-base text-white">
              {config.legitimateLinkDomain}
            </dd>
          </div>
        </dl>
        <p className="mt-5 border-l-2 border-orange pl-4 text-sm leading-6 text-silver2">
          Look at the real sender address and link destination, not only the
          display name or visible link text. A lookalike spelling is not valid.
        </p>
      </section>

      <section className="mt-5 rounded-sm border hairline bg-paper p-5 sm:p-7">
        <h2 className="text-xl font-semibold text-white">
          What the email will and will not ask
        </h2>
        <ul className="mt-4 space-y-3 text-sm leading-6 text-silver2">
          <li>
            It may ask you to open your private portal, review an offer made to
            you, record a response, or ask David a question.
          </li>
          <li>
            It will not ask for your portal password. Investors do not have
            portal passwords.
          </li>
          <li>
            It will not ask you to send a password, one-time code, API key, or
            other credential by reply.
          </li>
          <li>
            It will not disclose or discuss any other investor or their
            participation.
          </li>
        </ul>
      </section>

      <aside className="mt-5 border-2 border-warn bg-warn-surface p-5 sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-warn-soft">
          Standing payment warning
        </p>
        <h2 className="mt-2 text-xl font-bold leading-snug text-white">
          Payment details will NEVER be changed by email.
        </h2>
        <p className="mt-3 text-sm leading-6 text-ftext">
          Before any transfer, verify the instructions by voice with David
          using a phone number you already know. Do not use a number supplied
          in the email, a reply, or an unexpected message.
        </p>
      </aside>

      <section className="mt-5 rounded-sm border hairline bg-paper p-5 sm:p-7">
        <h2 className="text-xl font-semibold text-white">
          Verify by another route
        </h2>
        <p className="mt-3 text-sm leading-6 text-silver2">
          Stop and contact David or Michael through details already in your
          address book or through a person who introduced you. Read the sender
          address and destination domain above aloud. If you cannot verify them
          independently, do not open the link and do not transfer funds.
        </p>
      </section>
    </main>
  )
}

export default function VerifyPage() {
  return <VerificationPageContent config={loadVerificationConfig()} />
}
