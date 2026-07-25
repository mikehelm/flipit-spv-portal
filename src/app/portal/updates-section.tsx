import type { InvestorUpdatesView } from '@/lib/updates/data'

/**
 * The updates feed, on the investor's side. BUILD_SPEC §6, copy from
 * PORTAL_COPY.
 *
 * Newest first, with a published date. Everything here came out of the
 * investor's own delivery rows, so a targeted update simply is not in the list
 * for anybody it was not addressed to — there is no filtering happening at this
 * layer that could be got wrong.
 */
export function UpdatesSection({ view }: { view: InvestorUpdatesView }) {
  if (!view.canView) return null

  return (
    <section className="mt-12">
      <h2 className="text-sm font-semibold text-white">Updates</h2>
      <p className="mt-2 text-xs leading-relaxed text-dim">
        Notices and progress reports from David appear here, newest first. This is the
        authoritative place for updates on the SPV and on Flipit.
      </p>

      {view.updates.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-dim">
          There are no updates yet. You will be notified by email when one is published.
        </p>
      ) : (
        <ol className="mt-4 grid grid-cols-1 gap-3">
          {view.updates.map((update) => (
            <li key={update.id} className="rounded-sm border hairline bg-paper p-4 sm:p-5">
              <p className="text-sm font-semibold text-white">{update.title}</p>
              <p className="mt-1 text-xs text-muted">
                {update.publishedAt.toISOString().slice(0, 10)}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-silver2">
                {update.body}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
