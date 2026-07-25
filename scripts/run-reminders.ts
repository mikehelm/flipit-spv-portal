/**
 * The scheduled job. BUILD_SPEC §6.5.
 *
 * Run this on a schedule — hourly is plenty, since reminders are planned to a
 * specific hour and a run that misses one by a few hours still catches it
 * before it goes stale:
 *
 *   pnpm reminders:run
 *
 * It is deliberately a script rather than an HTTP route. A route is a URL, and
 * a URL that sends email to investors is one misconfigured proxy away from
 * being reachable by somebody who should not reach it. This has no listener and
 * no authentication surface: whoever can run it can already run anything.
 *
 * Everything it prints is a count or a reason. No address, no subject, no body.
 */

import 'dotenv/config'
import { runDueReminders } from '@/lib/reminders/run'

async function main(): Promise<void> {
  const started = new Date()
  const summary = await runDueReminders({ now: started })

  console.log(`Reminder run at ${started.toISOString()}`)
  console.log(`  considered: ${summary.considered}`)
  console.log(`  sent:       ${summary.sent}`)
  console.log(`  skipped:    ${summary.skipped}`)
  console.log(`  blocked:    ${summary.blocked}`)
  console.log(`  failed:     ${summary.failed}`)

  for (const outcome of summary.outcomes) {
    if (outcome.kind === 'SENT') continue
    // The reason, never the recipient.
    console.log(`  ${outcome.kind}: ${outcome.reason.slice(0, 160)}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
