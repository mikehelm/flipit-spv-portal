import Link from 'next/link'
import { Pill } from '@/components/admin/ui'
import type { AdminRole } from '@/lib/roles'
import type { ReviewRow } from '@/lib/sending/review'

function issuesFor(row: ReviewRow, repeatedEmails: ReadonlySet<string>): string[] {
  const issues: string[] = []
  if (!row.jurisdiction) issues.push('Country missing')
  if (!row.responseDeadline) issues.push('Deadline missing')
  if (repeatedEmails.has(row.email.toLowerCase())) issues.push('Shared email')
  if (row.blocked && issues.length === 0) issues.push('Approval needed')
  return issues
}

export function InvestorListOverview({
  role,
  rows,
}: {
  role: AdminRole
  rows: ReviewRow[]
}) {
  if (role === 'VIEWER') return null

  const emailCounts = new Map<string, number>()
  for (const row of rows) {
    const email = row.email.toLowerCase()
    emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1)
  }
  const repeatedEmails = new Set(
    [...emailCounts].filter(([, count]) => count > 1).map(([email]) => email),
  )
  const withIssues = rows
    .map((row) => ({ row, issues: issuesFor(row, repeatedEmails) }))
    .filter((item) => item.issues.length > 0)
  const visible = (withIssues.length > 0 ? withIssues : rows.map((row) => ({ row, issues: [] })))
    .slice(0, 5)

  return (
    <section aria-labelledby="investor-list-heading" className="mb-8">
      <div className="rounded-sm border hairline bg-paper">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b hairline p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange">
              Investor list
            </p>
            <h2 id="investor-list-heading" className="mt-2 text-xl font-bold text-white">
              Check the spreadsheet data
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dim">
              Click a person to fix their details. Every confirmed change is recorded, and
              uploading or editing never sends an invitation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill tone={rows.length > 0 ? 'ok' : 'neutral'}>{rows.length} people</Pill>
            <Pill tone={withIssues.length > 0 ? 'warn' : 'ok'}>
              {withIssues.length > 0 ? `${withIssues.length} need review` : 'Data checked'}
            </Pill>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-5">
            <p className="text-sm text-dim">No spreadsheet has been added yet.</p>
            <Link
              href="/import"
              className="mt-4 inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-bold text-bg"
            >
              Upload the spreadsheet
            </Link>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-edge">
              {visible.map(({ row, issues }) => (
                <li
                  key={row.offerId}
                  className="grid gap-3 p-4 transition-colors hover:bg-bg2/45 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{row.name}</p>
                    <p className="truncate text-xs text-dim">{row.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {issues.length > 0 ? (
                      issues.map((issue) => (
                        <span
                          key={issue}
                          className="rounded-sm bg-warn/10 px-2 py-1 text-[11px] font-semibold text-warn"
                        >
                          {issue}
                        </span>
                      ))
                    ) : (
                      <Pill tone="ok">Ready</Pill>
                    )}
                  </div>
                  <Link
                    href={`/recipients/${row.offerId}#draft-invitation-details`}
                    className="inline-flex min-h-11 items-center justify-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext transition-colors hover:border-orange hover:text-orange"
                  >
                    Review &amp; edit
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t hairline p-4">
              <p className="text-xs text-dim">
                Showing {visible.length} {withIssues.length > 0 ? 'people who need attention' : 'people'}.
              </p>
              <Link href="/recipients" className="text-sm font-semibold text-orange">
                Open the full investor list →
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
