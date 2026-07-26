/**
 * Is a reminder run in progress? BUILD_SPEC §6.5.
 *
 *   pnpm reminders:lock
 *
 * Prints BUSY when something holds the run lock and FREE when nothing does, and
 * exits zero either way — this is a question, not a check.
 *
 * It exists for two reasons. The first is operational: when a reminder sits on
 * the queue marked as being sent, this says whether a run is actually behind it
 * or whether the run died and the row wants rescheduling. The second is that it
 * is a real second process taking a real second database session, which is the
 * only honest way to prove that the lock excludes anybody. `pnpm
 * verify:reminders` spawns it from inside a held lock and expects BUSY.
 *
 * Holding the lock for a moment and letting go is the whole of it. Nothing here
 * sends, and nothing here writes.
 */

import 'dotenv/config'
import { withRunLock } from '@/lib/reminders/lock'

async function main(): Promise<void> {
  const attempt = await withRunLock(async () => 'taken')
  console.log(attempt.acquired ? 'FREE' : 'BUSY')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
