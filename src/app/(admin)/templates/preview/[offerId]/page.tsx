import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Card, SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { TEMPLATE_LABEL } from '@/lib/email/templates'
import { EMAIL_VARIABLE_NAMES } from '@/lib/email/variables'
import { loadPreviewRecipient, previewFor } from '../../data'

export const metadata: Metadata = {
  title: 'Email preview — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/** Parsed, not cast. An unknown kind falls back to the invitation. */
const kindSchema = z.enum(['INVITATION', 'REMINDER']).catch('INVITATION')

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  ROW: 'From the imported row',
  SERVICE_CONFIG: 'From settings',
  AUTHENTICATED_ADDRESS: 'From the authenticated sending account',
  RECORD: 'From this record',
  DEPLOYMENT: 'From this deployment',
  ABSENT: 'Not resolved',
}

/**
 * The real email for one real recipient. BUILD_SPEC §11.4, WP4.
 *
 * The HTML part is rendered in a sandboxed iframe rather than injected into
 * this page: an email body is untrusted markup by construction, and it must
 * not be able to reach the admin document. `sandbox=""` grants nothing —
 * no scripts, no forms, no same-origin.
 *
 * The portal link shown is deliberately not a working token. Previewing is a
 * read; a read does not issue credentials.
 */
export default async function EmailPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const admin = await requireOnboardedAdmin()

  const { offerId } = await params
  const query = await searchParams
  const kind = kindSchema.parse(Array.isArray(query.kind) ? query.kind[0] : query.kind)

  const recipient = await loadPreviewRecipient(offerId)
  if (!recipient) notFound()

  const outcome = await previewFor(admin, recipient, kind)
  const otherKind = kind === 'INVITATION' ? 'REMINDER' : 'INVITATION'

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow={TEMPLATE_LABEL[kind]} title={recipient.name}>
        <p>
          {recipient.email}
          {recipient.jurisdiction ? ` · ${recipient.jurisdiction}` : ''}
          {recipient.blocked ? ' · Blocked' : ''}
        </p>
      </SectionHeading>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/templates"
          className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
        >
          All templates
        </Link>
        <Link
          href={`/templates/preview/${recipient.offerId}?kind=${otherKind}`}
          className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 font-semibold text-dim transition-colors hover:border-orange hover:text-ftext"
        >
          Preview the {TEMPLATE_LABEL[otherKind].toLowerCase()} instead
        </Link>
      </div>

      {outcome.status === 'ERROR' ? (
        <Card title="This email cannot be rendered" tone="warn">
          <p className="text-sm leading-relaxed text-ftext">{outcome.message}</p>
        </Card>
      ) : null}

      {outcome.status === 'UNRESOLVED' ? (
        <Card title="This email cannot be sent yet" tone="warn">
          <p className="text-sm leading-relaxed text-ftext">
            {outcome.unresolved.length}{' '}
            {outcome.unresolved.length === 1 ? 'variable' : 'variables'} could not be
            resolved for this recipient. Nothing is rendered with a gap in it, so there
            is no preview to show until this is fixed.
          </p>
          <ul className="mt-3 space-y-2">
            {[
              ...new Map(
                outcome.unresolved.map((item) => [item.variable, item]),
              ).values(),
            ].map((item) => (
              <li key={item.variable} className="border-l-2 border-warn pl-3">
                <p className="font-mono text-xs text-ftext">
                  {'{{'}
                  {item.variable}
                  {'}}'}
                </p>
                {item.note ? (
                  <p className="mt-1 text-xs leading-relaxed text-dim">
                    {item.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {outcome.status === 'RENDERED' ? (
        <>
          <Card title="Headers">
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-3">
                <dt className="w-20 shrink-0 text-dim">Subject</dt>
                <dd className="min-w-0 flex-1 text-ftext">{outcome.email.subject}</dd>
              </div>
              <div className="flex flex-wrap gap-x-3">
                <dt className="w-20 shrink-0 text-dim">From</dt>
                <dd className="min-w-0 flex-1 break-all text-ftext">
                  {outcome.context.variables.sender_name} &lt;
                  {outcome.context.variables.sender_email}&gt;
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-3">
                <dt className="w-20 shrink-0 text-dim">To</dt>
                <dd className="min-w-0 flex-1 break-all text-ftext">
                  {recipient.email}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-3">
                <dt className="w-20 shrink-0 text-dim">Hash</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-xs text-dim">
                  {outcome.email.templateHash}
                </dd>
              </div>
            </dl>
          </Card>

          <Card
            title="HTML part"
            description="Rendered in a sandboxed frame at 600px. This is the markup that will be sent, byte for byte."
          >
            <div className="overflow-hidden rounded-sm border hairline bg-white">
              <iframe
                title={`${TEMPLATE_LABEL[kind]} preview for ${recipient.name}`}
                srcDoc={outcome.email.html}
                sandbox=""
                referrerPolicy="no-referrer"
                className="h-[70vh] w-full border-0"
              />
            </div>
          </Card>

          <Card
            title="Plain-text part"
            description="Mandatory, and it carries the same information. Some recipients block HTML, and a text part materially helps deliverability."
          >
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-sm border hairline bg-bg2 p-3 font-mono text-xs leading-relaxed text-ftext">
              {outcome.email.text}
            </pre>
          </Card>
        </>
      ) : null}

      <Card
        title="How each value was resolved"
        description="The fallback chain, applied to this recipient. Nothing here guesses."
      >
        <ul className="divide-y divide-white/8">
          {EMAIL_VARIABLE_NAMES.map((name) => {
            const value = outcome.status === 'ERROR' ? null : outcome.context.variables[name]
            const source =
              outcome.status === 'ERROR' ? 'ABSENT' : outcome.context.sources[name]
            return (
              <li
                key={name}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <span className="font-mono text-xs text-dim">{name}</span>
                <span className="min-w-0 flex-1 break-all text-right text-xs text-ftext">
                  {value ?? <span className="text-dim">not set</span>}
                </span>
                <span className="w-full text-right text-[11px] text-dim">
                  {SOURCE_LABEL[source] ?? source}
                </span>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
