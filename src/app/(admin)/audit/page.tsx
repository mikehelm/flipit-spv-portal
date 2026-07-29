import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireOwner } from '@/lib/auth/guards'
import { auditFilterOptions, exportableRounds, loadAuditRows } from '@/lib/export/data'

export const metadata: Metadata = {
  title: 'Audit log — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The audit log viewer. BUILD_SPEC §16, §20.
 *
 * *"The log is append-only and visible to the owner."* `requireOwner()` is the
 * access control and it audits an operator's attempt before turning them away.
 *
 * There is no control on this page that edits or deletes an entry, and there is
 * no function anywhere that could — `lib/audit.ts` provides `audit()` and
 * nothing else, deliberately.
 */

const PAGE_SIZE = 200

function describe(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return ''
  if (typeof metadata !== 'object') return String(metadata)

  return Object.entries(metadata as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ')
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireOwner()

  const params = await searchParams
  const one = (key: string): string =>
    typeof params[key] === 'string' ? (params[key] as string) : ''

  const filter = {
    actor: one('actor') || null,
    entityType: one('entity') || null,
    action: one('action') || null,
    from: one('from') || null,
    to: one('to') || null,
    limit: PAGE_SIZE,
  }

  const rows = await loadAuditRows(filter)
  const options = await auditFilterOptions()
  const rounds = await exportableRounds()

  const query = new URLSearchParams(
    Object.entries({
      actor: filter.actor ?? '',
      entity: filter.entityType ?? '',
      action: filter.action ?? '',
      from: filter.from ?? '',
      to: filter.to ?? '',
    }).filter(([, value]) => value !== ''),
  ).toString()

  return (
    <>
      <SectionHeading eyebrow="Audit log" title="Audit log">
        Append-only, and the owner&rsquo;s. Every refused action is in here as well as every
        successful one — a blocked send with its reason is more use after the fact than a
        successful one.
      </SectionHeading>

      <div className="mb-6">
        <Notice>
          Nothing on this page edits or deletes an entry, and there is no function in the
          application that could. Entries carry identifiers, outcomes and reasons — never a
          token, an email body, or a key.
        </Notice>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card title="Filter" description="Find an entry by person, record type, action or date.">
          <form method="get" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-silver2">
                Actor
              </span>
              <select
                name="actor"
                defaultValue={filter.actor ?? ''}
                className="mt-2 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext"
              >
                <option value="">Anyone</option>
                {options.actors.map((actor) => (
                  <option key={actor} value={actor}>
                    {actor}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-silver2">
                Entity
              </span>
              <select
                name="entity"
                defaultValue={filter.entityType ?? ''}
                className="mt-2 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext"
              >
                <option value="">Anything</option>
                {options.entityTypes.map((entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-silver2">
                Action
              </span>
              <select
                name="action"
                defaultValue={filter.action ?? ''}
                className="mt-2 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext"
              >
                <option value="">Any action</option>
                {options.actions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wider text-silver2">
                  From
                </span>
                <input
                  type="date"
                  name="from"
                  defaultValue={filter.from ?? ''}
                  className="mt-2 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext"
                />
              </label>
              <label className="block min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wider text-silver2">
                  To
                </span>
                <input
                  type="date"
                  name="to"
                  defaultValue={filter.to ?? ''}
                  className="mt-2 w-full min-h-11 rounded-sm border hairline bg-bg2 px-3 py-2.5 text-sm text-ftext"
                />
              </label>
            </div>

            <div className="sm:col-span-2 flex flex-wrap gap-3">
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-sm bg-orange px-4 text-sm font-semibold text-ink"
              >
                Apply
              </button>
              <Link
                href="/audit"
                className="inline-flex min-h-11 items-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext"
              >
                Clear
              </Link>
            </div>
          </form>
        </Card>

        <Card
          title="Export"
          description="Only Mike can export the full audit history. Mike and David can export the investor records for a round."
        >
          <div className="flex flex-wrap gap-3">
            <a
              href={`/export/audit?${query}${query ? '&' : ''}format=csv`}
              className="inline-flex min-h-11 items-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext"
            >
              Audit log, CSV
            </a>
            <a
              href={`/export/audit?${query}${query ? '&' : ''}format=xlsx`}
              className="inline-flex min-h-11 items-center rounded-sm border hairline px-4 text-sm font-semibold text-ftext"
            >
              Audit log, Excel
            </a>
          </div>

          <div className="mt-5 border-t hairline pt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-silver2">
              Recipients
            </p>
            <div className="grid grid-cols-1 gap-3">
              {rounds.map((round) => (
                <div key={round.id} className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-ftext">{round.name}</span>
                  <a
                    href={`/export/recipients?round=${round.id}&format=csv`}
                    className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-ftext"
                  >
                    CSV
                  </a>
                  <a
                    href={`/export/recipients?round=${round.id}&format=xlsx`}
                    className="inline-flex min-h-11 items-center rounded-sm border hairline px-3 text-xs font-semibold text-ftext"
                  >
                    Excel
                  </a>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">
            {rows.length === PAGE_SIZE
              ? `Most recent ${PAGE_SIZE} entries`
              : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
          </h2>

          {rows.length === 0 ? (
            <Card>
              <p className="text-sm text-dim">Nothing matches that filter.</p>
            </Card>
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {rows.map((row) => (
                <li key={row.id} className="rounded-sm border hairline bg-paper p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="min-w-0 break-all font-mono text-xs text-ftext">
                      {row.action}
                    </p>
                    <p className="text-xs tabular-nums text-muted">
                      {row.createdAt.toISOString().slice(0, 19).replace('T', ' ')} UTC
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-dim">
                    <Pill tone="neutral">{row.entityType}</Pill>{' '}
                    <span className="ml-2">{row.actorLabel}</span>
                    {row.entityId ? (
                      <span className="ml-2 break-all font-mono text-muted">
                        {row.entityId}
                      </span>
                    ) : null}
                  </p>
                  {describe(row.metadata) ? (
                    <p className="mt-1 break-words text-xs leading-relaxed text-muted">
                      {describe(row.metadata)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
