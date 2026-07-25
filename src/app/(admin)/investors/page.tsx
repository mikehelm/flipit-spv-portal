import type { Metadata } from 'next'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { readServiceConfig } from '@/lib/auth/service-config'
import { loadAdminAccounts, type AdminAccountRow } from '@/lib/portal/accounts-data'
import { portalAccess } from '@/lib/portal/access'
import { ChangeStatusForm } from './parts'

export const metadata: Metadata = {
  title: 'Investors — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * Investor accounts and their state. BUILD_SPEC §4.2.
 *
 * This screen exists because `changeAccountStatus` did not have a caller.
 * The function was written in WP8 and is correct — it revokes every session and
 * every unspent link in the same breath as the status write — but with nothing
 * calling it, §4.2's "suspension takes effect immediately" was unreachable, and
 * an investor whose mailbox was compromised could not be cut off at all.
 *
 * Every row shows what a change would actually end: how many sessions the
 * person currently holds and how many of their links are still redeemable.
 * That is the sentence in §4.2 made visible before the decision rather than
 * after it.
 */

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '—'
}

function StatusPill({ status }: { status: string }) {
  if (status === 'ACTIVE') return <Pill tone="ok">Active</Pill>
  if (status === 'INVITED') return <Pill tone="accent">Invited</Pill>
  if (status === 'SUSPENDED') return <Pill tone="warn">Suspended</Pill>
  if (status === 'CLOSED') return <Pill tone="neutral">Closed</Pill>
  return <Pill tone="neutral">Archived</Pill>
}

function AccountCard({
  account,
  closedAccountAccess,
  serviceMode,
}: {
  account: AdminAccountRow
  closedAccountAccess: 'READ_ONLY' | 'NONE'
  serviceMode: 'ACTIVE' | 'READ_ONLY' | 'SUNSET' | 'DISABLED'
}) {
  const access = portalAccess({
    accountStatus: account.status,
    closedAccountAccess,
    serviceMode,
  })

  return (
    <article className="rounded-sm border hairline bg-[#14162f] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{account.name}</p>
          <p className="truncate text-xs text-[#6c7290]">{account.email}</p>
          <p className="mt-1 text-xs text-[#9498b5]">
            {account.offerCount} offer{account.offerCount === 1 ? '' : 's'} · mailbox{' '}
            {account.emailVerifiedAt ? 'verified' : 'not verified'} · last signed in{' '}
            {formatDate(account.lastSignInAt)}
          </p>
        </div>
        <StatusPill status={account.status} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#9498b5]">
        Right now they hold{' '}
        <span className="text-[#e7e9f5]">
          {account.liveSessions} live session{account.liveSessions === 1 ? '' : 's'}
        </span>{' '}
        and{' '}
        <span className="text-[#e7e9f5]">
          {account.liveLinks} unspent link{account.liveLinks === 1 ? '' : 's'}
        </span>
        . Their portal is currently{' '}
        <span className="text-[#e7e9f5]">
          {access.capability === 'FULL'
            ? 'fully open to them'
            : access.capability === 'READ_ONLY'
              ? 'read-only'
              : 'closed to them'}
        </span>
        .
      </p>

      {account.history.length > 0 ? (
        <details className="mt-4 rounded-sm border hairline bg-[#0d0f2e] p-3">
          <summary className="cursor-pointer text-xs font-semibold text-[#cbd1de]">
            History ({account.history.length})
          </summary>
          <ul className="mt-3 grid gap-3">
            {account.history.map((entry, index) => (
              <li key={`${entry.at.toISOString()}-${index}`} className="text-xs text-[#9498b5]">
                <span className="text-[#e7e9f5]">
                  {(entry.from ?? 'new').toLowerCase()} → {entry.to.toLowerCase()}
                </span>{' '}
                on {formatDate(entry.at)}
                {entry.by ? ` by ${entry.by}` : ''} ·{' '}
                {entry.investorNotified ? 'investor was told' : 'investor was not told'}
                <span className="mt-1 block text-[#cbd1de]">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="mt-3 rounded-sm border hairline bg-[#0d0f2e] p-3">
        <summary className="cursor-pointer text-xs font-semibold text-[#cbd1de]">
          Change their status
        </summary>
        <div className="mt-3">
          <ChangeStatusForm
            accountId={account.id}
            currentStatus={account.status}
            liveSessions={account.liveSessions}
            liveLinks={account.liveLinks}
          />
        </div>
      </details>
    </article>
  )
}

export default async function InvestorsPage() {
  await requireOnboardedAdmin()

  const [accounts, config] = await Promise.all([loadAdminAccounts(), readServiceConfig()])

  const suspended = accounts.filter((row) => row.status === 'SUSPENDED').length

  return (
    <div className="grid gap-6">
      <SectionHeading eyebrow="Investors" title="Accounts and access">
        <p className="text-sm leading-relaxed text-[#9498b5]">
          An investor account is durable — it survives the round and holds every offer ever made
          to that person. This is where its state is changed, and the change takes effect at
          once: suspending somebody ends every session they hold and revokes every link they
          have not spent, in the same instant the status is written.
        </p>
      </SectionHeading>

      {accounts.length === 0 ? (
        <Card title="No accounts yet">
          <p className="text-sm leading-relaxed text-[#9498b5]">
            An account is created when a recipient file is imported, or when somebody is added to
            the register by hand. Nothing here until then.
          </p>
        </Card>
      ) : (
        <>
          <Notice>
            {accounts.length} account{accounts.length === 1 ? '' : 's'}
            {suspended > 0 ? `, of which ${suspended} suspended` : ''}. Every change asks for a
            reason and records it against the investor&rsquo;s own record, with your name and the
            time. Nothing on this screen emails anybody.
          </Notice>

          <div className="grid gap-3">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                closedAccountAccess={config.closedAccountAccess}
                serviceMode={config.serviceMode}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
