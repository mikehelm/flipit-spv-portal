import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { referencedVariables } from '@/lib/email/render'
import {
  EMAIL_TEMPLATE_KINDS,
  TEMPLATE_DESCRIPTION,
  TEMPLATE_LABEL,
  type EmailTemplateKind,
} from '@/lib/email/templates'
import { EMAIL_VARIABLES, EMAIL_VARIABLE_NAMES } from '@/lib/email/variables'
import { loadPreflight, loadTemplateOverview } from './data'

export const metadata: Metadata = {
  title: 'Email templates — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The template screen. BUILD_SPEC §11.
 *
 * Three things, in the order they matter:
 *
 *   1. What will be sent, and what its hash is — the hash is what a compliance
 *      approval is recorded against (§8.2), so it belongs on the screen rather
 *      than buried.
 *   2. Whether the templates render for **every** recipient. §11.4 requires
 *      this at pre-flight, not at send time, and this is where the operator
 *      sees the whole list at once instead of one failed send at a time.
 *   3. A preview of the real email for a real recipient.
 *
 * `requireOnboardedAdmin()` runs here even though the layout already guards
 * the group. A layout guard is a convenience; this is the authorization.
 */
export default async function TemplatesPage() {
  await requireOnboardedAdmin()

  const overviews = await Promise.all(
    EMAIL_TEMPLATE_KINDS.map(async (kind) => loadTemplateOverview(kind)),
  )
  const preflight = await loadPreflight()

  const { result, recipients } = preflight
  const problemsByOffer = new Map<string, typeof result.problems>()
  for (const problem of result.problems) {
    const list = problemsByOffer.get(problem.offerId) ?? []
    list.push(problem)
    problemsByOffer.set(problem.offerId, list)
  }

  return (
    <div className="space-y-8">
      <SectionHeading eyebrow="Email" title="Templates and preview">
        <p>
          Two templates, hashed separately and approved separately. The invitation
          carries the offer figures; the reminder carries the deadline and the portal
          link and nothing else.
        </p>
      </SectionHeading>

      <div className="space-y-4">
        {overviews.map(({ template }) => {
          const referenced = [
            ...new Set([
              ...referencedVariables(template.subject),
              ...referencedVariables(template.htmlSource),
              ...referencedVariables(template.textSource),
            ]),
          ].sort()

          return (
            <Card
              key={template.kind}
              title={TEMPLATE_LABEL[template.kind]}
              description={TEMPLATE_DESCRIPTION[template.kind]}
            >
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#9498b5]">
                    Subject
                  </dt>
                  <dd className="mt-1 text-[#e7e9f5]">{template.subject}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#9498b5]">
                    Template hash
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs text-[#e7e9f5]">
                    {template.hash}
                  </dd>
                  <dd className="mt-1 text-xs text-[#9498b5]">
                    Computed over the subject and both parts, including the conditional
                    blocks. Changing the operator&rsquo;s contact method does not change
                    it; changing a word does.
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#9498b5]">
                    Source
                  </dt>
                  <dd className="mt-1 text-[#9498b5]">
                    {template.origin === 'STORED'
                      ? `Stored template, version ${template.version ?? 1}.`
                      : 'The shipped default. No edited version has been stored yet.'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#9498b5]">
                    Variables used
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {referenced.map((name) => (
                      <span
                        key={name}
                        className="rounded-sm border hairline px-1.5 py-0.5 font-mono text-[11px] text-[#9498b5]"
                      >
                        {name}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </Card>
          )
        })}
      </div>

      <Card
        title="Pre-flight rendering check"
        tone={result.ok ? 'ok' : 'warn'}
        description={
          <>
            Every recipient is rendered against both templates here, before anything is
            sent. An unresolved variable has to be caught now, not halfway through the
            batch.
          </>
        }
      >
        {recipients.length === 0 ? (
          <p className="text-sm text-[#9498b5]">
            No recipients have been imported into the open round yet, so there is nothing
            to render. Import a list first.
          </p>
        ) : result.ok ? (
          <p className="text-sm text-[#35d07f]">
            Both templates render cleanly for all {result.checked}{' '}
            {result.checked === 1 ? 'recipient' : 'recipients'}. No unresolved variables.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[#ff5b52]">
              {result.problems.length}{' '}
              {result.problems.length === 1 ? 'problem' : 'problems'} across{' '}
              {result.affectedOfferIds.length} of {result.checked}{' '}
              {result.checked === 1 ? 'recipient' : 'recipients'}. Sending is not safe
              until each is resolved.
            </p>

            <ul className="space-y-3">
              {[...problemsByOffer.entries()].map(([offerId, problems]) => (
                <li key={offerId} className="border-l-2 border-[#ff5b52] pl-3">
                  <p className="text-sm text-[#e7e9f5]">
                    {problems[0].recipientName}{' '}
                    <span className="text-[#9498b5]">
                      &lt;{problems[0].recipientEmail}&gt;
                    </span>
                  </p>
                  <ul className="mt-1 space-y-1">
                    {[
                      ...new Map(
                        problems.map((problem) => [
                          `${problem.variable}:${problem.kind}`,
                          problem,
                        ]),
                      ).values(),
                    ].map((problem) => (
                      <li
                        key={`${problem.variable}-${problem.kind}-${problem.part}`}
                        className="text-xs leading-relaxed text-[#9498b5]"
                      >
                        <span className="font-mono text-[#e7e9f5]">
                          {'{{'}
                          {problem.variable}
                          {'}}'}
                        </span>{' '}
                        unresolved in the {TEMPLATE_LABEL[problem.kind].toLowerCase()}.
                        {problem.note ? ` ${problem.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>

            {result.templateErrors.length > 0 ? (
              <div className="border-l-2 border-[#ff5b52] pl-3">
                <p className="text-sm text-[#e7e9f5]">Template or record errors</p>
                <ul className="mt-1 space-y-1">
                  {result.templateErrors.map((error, index) => (
                    <li
                      key={`${error.kind}-${index}`}
                      className="text-xs leading-relaxed text-[#9498b5]"
                    >
                      {TEMPLATE_LABEL[error.kind]}: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card
        title="Preview a real recipient"
        description="The exact email, with their real figures and their real deadline. The portal link is deliberately not a working token — a preview issues nothing."
      >
        {recipients.length === 0 ? (
          <p className="text-sm text-[#9498b5]">Nothing to preview yet.</p>
        ) : (
          <ul className="divide-y divide-white/8">
            {recipients.map((recipient) => (
              <li
                key={recipient.offerId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-[#e7e9f5]">{recipient.name}</p>
                  <p className="truncate text-xs text-[#9498b5]">{recipient.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  {problemsByOffer.has(recipient.offerId) ? (
                    <span className="text-[#ff5b52]">Unresolved variables</span>
                  ) : null}
                  {recipient.blocked ? (
                    <span className="text-[#ff5b52]">Blocked</span>
                  ) : null}
                  {(['INVITATION', 'REMINDER'] as EmailTemplateKind[]).map((kind) => (
                    <Link
                      key={kind}
                      href={`/templates/preview/${recipient.offerId}?kind=${kind}`}
                      className="inline-flex min-h-9 items-center rounded-sm border hairline px-2.5 font-semibold text-[#9498b5] transition-colors hover:border-[#F59A23] hover:text-[#e7e9f5]"
                    >
                      {TEMPLATE_LABEL[kind]}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Variables"
        description="Where each value comes from. Nothing falls back to anything not listed here, and nothing is ever left blank — an unresolved variable stops the send."
      >
        <dl className="space-y-4">
          {EMAIL_VARIABLE_NAMES.map((name) => {
            const declaration = EMAIL_VARIABLES[name]
            return (
              <div key={name}>
                <dt className="font-mono text-xs text-[#e7e9f5]">
                  {'{{'}
                  {name}
                  {'}}'}
                  {declaration.optional ? (
                    <span className="ml-2 font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-[#9498b5]">
                      optional
                    </span>
                  ) : null}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-[#9498b5]">
                  {declaration.description}
                </dd>
                <dd className="mt-0.5 text-xs leading-relaxed text-[#9498b5]">
                  {declaration.chain}
                </dd>
              </div>
            )
          })}
        </dl>
      </Card>
    </div>
  )
}
