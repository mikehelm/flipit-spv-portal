import 'dotenv/config'
import { pruneUsabilityEvents, USABILITY_RETENTION_DAYS } from '@/lib/usability'

async function main(): Promise<void> {
  const removed = await pruneUsabilityEvents()
  console.log(
    `Usability retention: removed ${removed} row(s) older than ${USABILITY_RETENTION_DAYS} days.`,
  )
}

main()
  .catch(() => {
    console.error('Usability retention failed.')
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
