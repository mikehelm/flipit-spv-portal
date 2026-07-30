import Link from 'next/link'
import type { AdminRole } from '@/lib/roles'
import type { ReviewRow } from '@/lib/sending/review'

type IssueKind = 'country' | 'deadline' | 'email' | 'approval'

interface InvestorIssue {
  kind: IssueKind
  label: string
  action: string
  why: string
  basis: string
}

const ISSUE: Record<IssueKind, Omit<InvestorIssue, 'kind'>> = {
  country: {
    label: 'Country needed',
    action: 'Add the investor’s country.',
    why:
      'The approved-jurisdiction gate needs a country before it can decide whether this individual may be invited. A qualified person—not the app—decides which jurisdictions are approved.',
    basis: 'Compliance workflow · BUILD_SPEC §8.2 · not legal advice',
  },
  deadline: {
    label: 'Deadline needed',
    action: 'Set this person’s response deadline before sending.',
    why:
      'The invitation and reminder workflow use an individual response deadline. The date does not automatically close the round; David still decides when to close it.',
    basis: 'Round workflow · BUILD_SPEC §6.6',
  },
  email: {
    label: 'Shared email',
    action: 'Confirm a separate address, or confirm that these rows should stay paired.',
    why:
      'The import gate treats duplicate addresses as unresolved so each offer reaches the intended person and account. Sending stays locked until the address decision is clear.',
    basis: 'Identity and delivery check · BUILD_SPEC §10',
  },
  approval: {
    label: 'Approval needed',
    action: 'Ask Mike to review the recorded compliance approval.',
    why:
      'Sending is disabled until a qualified person’s approval covers the current invitation and this person’s jurisdiction. The application does not provide or replace legal advice.',
    basis: 'Compliance workflow · BUILD_SPEC §8.2 · not legal advice',
  },
}

function issuesFor(row: ReviewRow, repeatedEmails: ReadonlySet<string>): InvestorIssue[] {
  const issues: InvestorIssue[] = []
  if (!row.jurisdiction) issues.push({ kind: 'country', ...ISSUE.country })
  if (!row.responseDeadline) issues.push({ kind: 'deadline', ...ISSUE.deadline })
  if (repeatedEmails.has(row.email.toLowerCase())) {
    issues.push({ kind: 'email', ...ISSUE.email })
  }
  if (row.blocked && issues.length === 0) {
    issues.push({ kind: 'approval', ...ISSUE.approval })
  }
  return issues
}

function InformationTip({
  label,
  children,
  align = 'left',
}: {
  label: string
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        className="cursor-help border-b border-dotted border-[#8e8e93] outline-none"
      >
        {label}
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-[calc(100%+10px)] z-30 w-72 rounded-xl border border-black/10 bg-[#1d1d1f] px-4 py-3 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-[0_18px_48px_rgba(0,0,0,0.24)] transition duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        {children}
      </span>
    </span>
  )
}

function IssueCell({
  issue,
  href,
  align = 'left',
}: {
  issue: InvestorIssue
  href: string
  align?: 'left' | 'right'
}) {
  return (
    <span className="group relative inline-flex">
      <Link
        href={href}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 font-semibold text-[#d70015] outline-none hover:bg-[#fff0f1] focus-visible:ring-2 focus-visible:ring-[#d70015]/30"
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#d70015]" />
        {issue.label}
      </Link>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-[calc(100%+8px)] z-40 w-80 rounded-2xl border border-black/10 bg-white p-4 text-left text-xs font-normal leading-relaxed text-[#1d1d1f] opacity-0 shadow-[0_20px_60px_rgba(0,0,0,0.2)] transition duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        <strong className="block text-sm text-[#d70015]">{issue.action}</strong>
        <span className="mt-2 block text-[#515154]">{issue.why}</span>
        <span className="mt-3 block border-t border-black/10 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#86868b]">
          {issue.basis}
        </span>
      </span>
    </span>
  )
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
  const prepared = rows.map((row) => ({
    row,
    issues: issuesFor(row, repeatedEmails),
  }))
  const withIssues = prepared.filter((item) => item.issues.length > 0)
  const visible = (withIssues.length > 0 ? withIssues : prepared).slice(0, 6)

  return (
    <section aria-labelledby="investor-list-heading" className="mb-8">
      <div className="overflow-visible rounded-[22px] bg-white text-[#1d1d1f] shadow-[0_18px_55px_rgba(0,0,0,0.22)] ring-1 ring-black/5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-black/10 px-5 py-5 sm:px-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#86868b]">
              Investor spreadsheet
            </p>
            <h2
              id="investor-list-heading"
              className="mt-1.5 text-xl font-semibold tracking-[-0.02em] text-[#1d1d1f]"
            >
              Check the investor details
            </h2>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[#6e6e73]">
              Black means the information is present. Red means a decision or correction
              is still needed. Hover or focus on red text to see what to do and why.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[#6e6e73]">{rows.length} people</span>
            <span
              className={
                withIssues.length > 0
                  ? 'font-semibold text-[#d70015]'
                  : 'font-semibold text-[#1d1d1f]'
              }
            >
              {withIssues.length > 0 ? `${withIssues.length} need attention` : 'All checked'}
            </span>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-8">
            <p className="text-sm text-[#6e6e73]">No spreadsheet has been added yet.</p>
            <Link
              href="/import"
              className="mt-4 inline-flex min-h-11 items-center rounded-full bg-[#1d1d1f] px-5 text-sm font-semibold text-white"
            >
              Upload the spreadsheet
            </Link>
          </div>
        ) : (
          <>
            <div className="px-3 py-2 sm:px-4">
              <ul className="divide-y divide-black/10 md:hidden">
                {visible.map(({ row, issues }) => {
                  const href = `/recipients/${row.offerId}#draft-invitation-details`
                  return (
                    <li key={row.offerId} className="px-2 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[#1d1d1f]">{row.name}</p>
                          <p className="truncate text-xs text-[#6e6e73]">{row.email}</p>
                        </div>
                        <Link
                          href={href}
                          className="inline-flex min-h-9 shrink-0 items-center rounded-full bg-[#1d1d1f] px-4 text-xs font-semibold text-white"
                        >
                          Edit
                        </Link>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {issues.length > 0 ? (
                          issues.map((issue) => (
                            <IssueCell key={issue.kind} issue={issue} href={href} />
                          ))
                        ) : (
                          <span className="text-sm font-medium text-[#1d1d1f]">Ready</span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              <table className="hidden w-full table-fixed border-separate border-spacing-0 text-left text-sm md:table">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#86868b]">
                    <th className="w-[19%] px-3 py-3">Investor</th>
                    <th className="w-[25%] px-3 py-3">
                      <InformationTip label="Email">
                        Used for the person’s account and invitation delivery. A shared address
                        must be intentionally resolved before sending.
                      </InformationTip>
                    </th>
                    <th className="w-[15%] px-3 py-3">
                      <InformationTip label="Country">
                        Required by the approved-jurisdiction gate. The application flags the
                        record; a qualified person makes the approval decision.
                      </InformationTip>
                    </th>
                    <th className="w-[16%] px-3 py-3">
                      <InformationTip label="Deadline">
                        Used for the invitation and reminder schedule. It does not
                        automatically close the round.
                      </InformationTip>
                    </th>
                    <th className="w-[15%] px-3 py-3">Status</th>
                    <th className="w-[10%] px-3 py-3 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ row, issues }) => {
                    const href = `/recipients/${row.offerId}#draft-invitation-details`
                    const countryIssue = issues.find((issue) => issue.kind === 'country')
                    const deadlineIssue = issues.find((issue) => issue.kind === 'deadline')
                    const emailIssue = issues.find((issue) => issue.kind === 'email')
                    const statusIssue = issues.find((issue) => issue.kind === 'approval')
                      ?? issues[0]

                    return (
                      <tr
                        key={row.offerId}
                        className="group/row border-t border-black/10 [&>td]:border-t [&>td]:border-black/10"
                      >
                        <td className="truncate px-3 py-4 font-semibold text-[#1d1d1f]">
                          {row.name}
                        </td>
                        <td className="truncate px-3 py-4 text-[#1d1d1f]">
                          {emailIssue ? (
                            <IssueCell issue={emailIssue} href={href} />
                          ) : (
                            row.email
                          )}
                        </td>
                        <td className="px-3 py-4 text-[#1d1d1f]">
                          {countryIssue ? (
                            <IssueCell issue={countryIssue} href={href} />
                          ) : (
                            row.jurisdiction
                          )}
                        </td>
                        <td className="px-3 py-4 text-[#1d1d1f]">
                          {deadlineIssue ? (
                            <IssueCell issue={deadlineIssue} href={href} />
                          ) : (
                            row.responseDeadline
                          )}
                        </td>
                        <td className="px-3 py-4">
                          {statusIssue ? (
                            <IssueCell issue={statusIssue} href={href} align="right" />
                          ) : (
                            <span className="font-medium text-[#1d1d1f]">Ready</span>
                          )}
                        </td>
                        <td className="px-3 py-4 text-right">
                          <Link
                            href={href}
                            aria-label={`Review and edit ${row.name}`}
                            className="inline-flex min-h-9 items-center rounded-full px-3 font-semibold text-[#1d1d1f] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 px-5 py-4 sm:px-6">
              <p className="text-xs text-[#86868b]">
                Showing {visible.length}{' '}
                {withIssues.length > 0 ? 'people who need attention first' : 'people'}.
              </p>
              <Link
                href="/recipients"
                className="inline-flex min-h-10 items-center rounded-full bg-[#1d1d1f] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-80"
              >
                Open all investors
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
