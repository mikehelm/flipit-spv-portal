import Link from 'next/link'
import { Card, SectionHeading } from '@/components/admin/ui'
import { requireOwnAccount } from '@/lib/auth/guards'
import { ROLE_LABELS } from '@/lib/roles'

/**
 * Where a role check sends someone who is signed in but not entitled.
 *
 * It says plainly what happened, because a blocked action that reads as a
 * generic failure is a bug. The attempt itself is already on the audit log —
 * written by the guard that refused it, not by this page.
 *
 * **`requireOwnAccount()`, and that is the entire point of the page.** It used
 * to call `requireAdmin()`, which refuses a viewer by redirecting to
 * `NO_ACCESS_PATH` — this path. A read-only administrator who touched any
 * owner-only link therefore bounced here for ever, and `requireAdmin()` wrote
 * an `access.refused` audit row on every single hop: an unbounded write to the
 * one table that is supposed to be the trustworthy account of what happened.
 * Fifteen rows came out of six requests while this was being measured.
 *
 * The role that could not read this page was the only role that would ever be
 * sent to it. That is the shape of the bug worth remembering: a refusal page
 * guarded by the check that refuses.
 */
export default async function NoAccessPage() {
  const identity = await requireOwnAccount()

  return (
    <>
      <SectionHeading eyebrow="Access" title="That area is not yours">
        You are signed in as {identity.email}, which holds the{' '}
        {ROLE_LABELS[identity.role].toLowerCase()} role. The page you asked for is
        restricted to a different role, and the attempt has been recorded.
      </SectionHeading>

      <Card title="What this covers">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-dim">
          <li>
            Compliance approval, service configuration, the AI key and operator access
            are owner-only.
          </li>
          <li>
            Operator setup — display name, contact method, sending account — belongs to
            the operator&rsquo;s own account and cannot be completed on their behalf.
          </li>
          {identity.role === 'VIEWER' ? (
            <li>
              Read-only access covers the investor records, the amounts, the documents
              and the conversation. Anything that writes, sends or approves is refused,
              including the import, the export, the register&rsquo;s order and the audit
              log. Your own password and two-factor are yours and are not restricted.
            </li>
          ) : null}
        </ul>
        {/*
          Tap targets, not prose links. WCAG 2.5.5 exempts a link sitting in a
          sentence, because padding a word until it is 44px tall breaks the line
          it sits in — but these two are not in a sentence, they are the way off
          this page, and at 20px they were the smallest thing to hit anywhere in
          the application. `verify:viewport` found them the first time this page
          was measured at 375px, which was after it stopped being a page nobody
          could open.
        */}
        <p className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-sm font-semibold text-orange transition-colors hover:border-orange"
          >
            Back to the overview
          </Link>
          <Link
            href="/admin/security"
            className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-sm font-semibold text-orange transition-colors hover:border-orange"
          >
            Your two-factor
          </Link>
        </p>
      </Card>
    </>
  )
}
