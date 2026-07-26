import type { Metadata } from 'next'
import { Card, Notice, Pill, SectionHeading } from '@/components/admin/ui'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { buildHealthReport } from '@/lib/health/report'
import type { Finding, Severity } from '@/lib/health/rules'

export const metadata: Metadata = {
  title: 'System health — Flipit SPV',
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = 'force-dynamic'

/**
 * The health report, on the screen of the person who would have to act on it.
 *
 * `pnpm check:health` was built first and is the version a scheduler runs: it
 * writes to a log and exits non-zero when something needs a person. That shape
 * is right for a machine and wrong for the operator, who does not have a
 * terminal and would not be reading a log file if he did. This is the same
 * report, from the same rules, rendered where he already is.
 *
 * Both exist on purpose. The command is what notices at three in the morning;
 * this is what he sees when he opens the application, which is the only moment
 * at which anybody is going to do anything about it.
 *
 * Read-only, like the command. There is no button on this page — every remedy
 * below names the page that does the thing, and putting a shortcut here would
 * be a second path to an action with a different set of checks in front of it.
 */

const TONE: Record<Severity, 'ok' | 'warn' | 'neutral'> = {
  OK: 'ok',
  ATTENTION: 'warn',
  WRONG: 'warn',
}

const LABEL: Record<Severity, string> = {
  OK: 'Fine',
  ATTENTION: 'Worth knowing',
  WRONG: 'Needs you',
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="rounded-sm border hairline bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted">{finding.area}</p>
          <p className="mt-1 text-sm font-semibold text-white">{finding.headline}</p>
        </div>
        <Pill tone={TONE[finding.severity]}>{LABEL[finding.severity]}</Pill>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-dim">{finding.detail}</p>

      {finding.severity === 'OK' ? null : (
        <p className="mt-3 border-l-2 border-orange pl-3 text-xs leading-relaxed text-dim">
          {finding.remedy}
        </p>
      )}
    </li>
  )
}

export default async function HealthPage() {
  await requireOnboardedAdmin()

  const report = await buildHealthReport()

  const wrong = report.findings.filter((row) => row.severity === 'WRONG')
  const attention = report.findings.filter((row) => row.severity === 'ATTENTION')
  const fine = report.findings.filter((row) => row.severity === 'OK')

  return (
    <>
      <SectionHeading eyebrow="System health" title="Is anything actually running?">
        Every other page here shows you what is wrong when you open it. This one is for the
        thing none of them can tell you: whether the parts that run on their own — the reminder
        job above all — are running at all. A scheduler that stopped looks, from inside this
        application, exactly like a quiet week.
      </SectionHeading>

      <div className="mb-6 grid grid-cols-1 gap-3">
        {wrong.length === 0 ? (
          <Notice>
            Nothing here needs you right now. This page changes nothing and never acts on what
            it finds — every line below tells you where to go and leaves the decision with you.
          </Notice>
        ) : (
          <Notice tone="warn">
            {wrong.length === 1
              ? 'One thing needs you.'
              : `${wrong.length} things need you.`}{' '}
            They are at the top. Each says what is the case and where to go about it.
          </Notice>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6">
        {wrong.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">Needs you</h2>
            <ul className="grid grid-cols-1 gap-3">
              {wrong.map((finding) => (
                <FindingRow key={`${finding.area}-${finding.headline}`} finding={finding} />
              ))}
            </ul>
          </section>
        ) : null}

        {attention.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">Worth knowing</h2>
            <p className="mb-3 text-xs leading-relaxed text-dim">
              None of these is a fault. Each is either a decision somebody made or a refusal
              working as designed — but they are the settings that quietly explain why nothing
              is sending, so they are on this page rather than buried.
            </p>
            <ul className="grid grid-cols-1 gap-3">
              {attention.map((finding) => (
                <FindingRow key={`${finding.area}-${finding.headline}`} finding={finding} />
              ))}
            </ul>
          </section>
        ) : null}

        {fine.length > 0 ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">Checked, and fine</h2>
            <p className="mb-3 text-xs leading-relaxed text-dim">
              Listed rather than left out. A page that shows nothing when all is well is
              indistinguishable from a page that failed to look.
            </p>
            <ul className="grid grid-cols-1 gap-3">
              {fine.map((finding) => (
                <FindingRow key={`${finding.area}-${finding.headline}`} finding={finding} />
              ))}
            </ul>
          </section>
        ) : null}

        <Card title="The same report, where nobody has to be looking">
          <p className="text-sm leading-relaxed text-dim">
            <code className="text-silver2">pnpm check:health</code> prints exactly what is on
            this page and exits non-zero when something needs a person, so a scheduler can
            notice at three in the morning rather than waiting for somebody to open this. The
            cron line is in the deployment runbook.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-dim">
            That command runs on this machine, though, so it falls silent in two situations
            that look identical from here: a quiet night, and a machine that stopped. So the
            same findings are also answered over the web, at{' '}
            <code className="text-silver2">/api/health</code>, to a request carrying a secret
            set in the deployment. An outside monitoring service polls that and raises somebody
            when the answer stops being a 200. It carries counts and area names only — never a
            name, an address or a figure — and it sends nothing itself. The runbook has the
            setup.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-dim">
            Read at {report.at.toISOString().slice(0, 16).replace('T', ' ')} UTC. This page is
            worked out fresh every time it loads; there is nothing cached to be out of date.
          </p>
        </Card>
      </div>
    </>
  )
}
