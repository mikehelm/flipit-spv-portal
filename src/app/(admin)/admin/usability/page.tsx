import type { Metadata } from 'next'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireOwner } from '@/lib/auth/guards'
import {
  loadDavidUsabilitySignals,
  USABILITY_RETENTION_DAYS,
} from '@/lib/usability'

export const metadata: Metadata = {
  title: 'David’s test activity — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

function pageLabel(path: string): string {
  const names: Record<string, string> = {
    '/admin': 'Start',
    '/admin/email-review': 'Email review',
    '/recipients': 'Review and send',
    '/investors': 'Investors',
    '/templates': 'Email templates',
    '/round': 'The round',
    '/updates': 'Updates',
    '/questions': 'Questions',
    '/reminders': 'Reminders',
    '/admin/onboarding': 'David’s setup',
  }
  return names[path] ?? path.replace(/:item/g, 'detail')
}

function duration(value: number): string {
  if (value < 60_000) return `${Math.max(1, Math.round(value / 1000))} sec`
  return `${Math.round(value / 60_000)} min`
}

export default async function UsabilityPage() {
  await requireOwner()
  const rows = await loadDavidUsabilitySignals()
  const totals = rows.reduce(
    (result, row) => ({
      durationMs: result.durationMs + row.durationMs,
      clicks: result.clicks + row.clickCount,
      rapidClicks: result.rapidClicks + row.rapidClickCount,
      errors: result.errors + row.browserErrorCount,
    }),
    { durationMs: 0, clicks: 0, rapidClicks: 0, errors: 0 },
  )
  const hasTrouble = totals.rapidClicks > 0 || totals.errors > 0

  return (
    <>
      <SectionHeading
        eyebrow="Just for Mike"
        title="David’s test activity"
      >
        A small troubleshooting view for the review period. It records only page
        names, time and counts. Everything deletes automatically after{' '}
        {USABILITY_RETENTION_DAYS} days.
      </SectionHeading>

      <div className="mb-6">
        <Notice>
          This cannot record typed text, document content, AI questions, click
          targets, coordinates, screenshots or screen replay. David sees the
          same notice while it is active.
        </Notice>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card title="Time">
          <p className="text-2xl font-bold text-white">
            {duration(totals.durationMs)}
          </p>
        </Card>
        <Card title="Clicks">
          <p className="text-2xl font-bold text-white">{totals.clicks}</p>
        </Card>
        <Card title="Rapid-click signals">
          <p className="text-2xl font-bold text-white">{totals.rapidClicks}</p>
        </Card>
        <Card title="Browser errors">
          <p className="text-2xl font-bold text-white">{totals.errors}</p>
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Trouble check"
          tone={hasTrouble ? 'warn' : 'ok'}
          description={
            hasTrouble
              ? 'There is a signal worth checking with David. A signal is not proof that something is broken.'
              : rows.length === 0
                ? 'No activity has arrived yet.'
                : 'No rapid-click frustration or browser errors have been recorded.'
          }
        >
          <Pill tone={hasTrouble ? 'warn' : 'ok'}>
            {hasTrouble ? 'Check in' : 'Looks normal'}
          </Pill>
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title={`Recent activity — last ${USABILITY_RETENTION_DAYS} days`}
          description="Newest first. Long visits are split into short entries so a closed tab cannot lose an entire visit."
        >
          {rows.length === 0 ? (
            <p className="text-sm text-dim">Nothing recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b hairline text-xs uppercase tracking-wider text-silver2">
                    <th className="px-2 py-3">When</th>
                    <th className="px-2 py-3">Page</th>
                    <th className="px-2 py-3">Time</th>
                    <th className="px-2 py-3">Clicks</th>
                    <th className="px-2 py-3">Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const signalCount =
                      row.rapidClickCount + row.browserErrorCount
                    return (
                      <tr key={row.id} className="border-b hairline text-ftext">
                        <td className="px-2 py-3 text-dim">
                          {row.createdAt.toLocaleString('en-GB', {
                            timeZone: 'Asia/Bangkok',
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-2 py-3 font-semibold">
                          {pageLabel(row.pagePath)}
                        </td>
                        <td className="px-2 py-3">{duration(row.durationMs)}</td>
                        <td className="px-2 py-3">{row.clickCount}</td>
                        <td className="px-2 py-3">
                          {signalCount === 0 ? (
                            <span className="text-dim">None</span>
                          ) : (
                            <Pill tone="warn">{signalCount}</Pill>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
