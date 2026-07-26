/**
 * The things nobody is watching, in one report. BUILD_SPEC §6.5, §7, §8.1, §18.1.
 *
 *   pnpm check:health
 *
 * Every quiet failure in this application already has a surface that shows it,
 * and every one of those surfaces needs somebody to open it. The failure this
 * exists for is the one where nobody does — a scheduler that was never installed
 * or stopped in March, a mail credential that expired, a run killed between
 * taking a reminder and sending it. From inside the application all three look
 * like a quiet week.
 *
 * So this is written to be run by a machine on the same schedule as the job it
 * watches, and read by a person afterwards:
 *
 *   - exit 0 when everything is as it should be, or when the only findings are
 *     decisions somebody made — a non-active service mode, a testing deployment
 *     that correctly refuses to send;
 *   - exit 1 when something needs a person.
 *
 * **It changes nothing.** Releasing a stuck reminder or replacing a credential
 * needs somebody who knows what has been happening. This tells them and stops.
 *
 * It prints reminder ids and counts, and no email address, subject or body — the
 * same rule the reminder job follows, for the same reason: this ends up in a log
 * file on a server.
 */

import 'dotenv/config'
import { buildHealthReport } from '@/lib/health/report'
import type { Finding, Severity } from '@/lib/health/rules'

const MARK: Record<Severity, string> = {
  OK: 'ok   ',
  ATTENTION: 'note ',
  WRONG: 'WRONG',
}

function print(finding: Finding): void {
  console.log(`  ${MARK[finding.severity]} ${finding.area}: ${finding.headline}`)
  console.log(`        ${finding.detail}`)
  if (finding.severity !== 'OK') console.log(`        → ${finding.remedy}`)
  console.log('')
}

async function main(): Promise<void> {
  const report = await buildHealthReport()

  console.log(`Health report at ${report.at.toISOString()}\n`)

  // Worst first. A log line that scrolls is read from the top.
  const order: Severity[] = ['WRONG', 'ATTENTION', 'OK']
  for (const severity of order) {
    for (const finding of report.findings.filter((row) => row.severity === severity)) {
      print(finding)
    }
  }

  const wrong = report.findings.filter((row) => row.severity === 'WRONG').length
  const attention = report.findings.filter((row) => row.severity === 'ATTENTION').length

  if (wrong > 0) {
    console.log(`${wrong} thing${wrong === 1 ? '' : 's'} need${wrong === 1 ? 's' : ''} a person.`)
    process.exitCode = 1
    return
  }

  if (attention > 0) {
    console.log(
      `Nothing is broken. ${attention} thing${attention === 1 ? ' is' : 's are'} worth knowing ` +
        'about, and each of them is somebody’s decision rather than a fault.',
    )
    return
  }

  console.log('Everything this knows how to check is as it should be.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
