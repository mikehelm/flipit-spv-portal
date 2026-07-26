/**
 * Every stored file, against the row that names it. BUILD_SPEC §5, §13.2, §13.3.
 *
 * Three tables hold a `storage_key` and a `size_bytes`: the media library, the
 * personal video, and document packages. Nothing in normal operation can make
 * those disagree with what is actually stored — the size is written from the
 * ingest result in the same call that writes the bytes — but two things
 * outside normal operation can:
 *
 *   - **A restore that brought the database back without its bucket.** The
 *     backup covers Postgres; the objects are somebody else's copy. A database
 *     restored against an empty or different bucket has rows pointing at
 *     nothing, and the symptom is broken images and a document that will not
 *     download, one at a time, as somebody happens to click.
 *   - **A truncated write.** A `put` that failed part way leaves a shorter
 *     object under a key whose row records the full length. Since the media
 *     responses now stream, `Content-Length` comes from the row — so a short
 *     file makes a browser wait for bytes that are never coming, rather than
 *     failing cleanly.
 *
 * Both are quiet, and both are found in one pass here. This reads sizes with a
 * `stat` on the seam — a `HEAD` against an object store — so checking a
 * sixty-megabyte video costs a round trip rather than a download.
 *
 * **It changes nothing.** It reports, and exits non-zero if anything is wrong,
 * so it can go in a deployment script. Deleting or re-uploading is a decision
 * for a person holding the backup.
 *
 *   pnpm media:check
 */

import 'dotenv/config'
import { db } from '@/db'
import { documentPackages, mediaAssets, operatorVideos } from '@/db/schema'
import { mediaStore, MEDIA_STORE_UNCONFIGURED } from '@/lib/media/store'

interface Tracked {
  what: string
  id: string
  label: string
  storageKey: string
  sizeBytes: number
}

let checked = 0
const missing: Tracked[] = []
const wrongSize: Array<Tracked & { actual: number }> = []
const unreadable: Array<Tracked & { reason: string }> = []

async function collect(): Promise<Tracked[]> {
  const out: Tracked[] = []

  for (const row of await db.select().from(mediaAssets)) {
    out.push({
      what: 'image',
      id: row.id,
      label: row.name,
      storageKey: row.storageKey,
      sizeBytes: row.sizeBytes,
    })
  }

  for (const row of await db.select().from(operatorVideos)) {
    out.push({
      what: 'video',
      id: row.id,
      // Never the caption or the transcript. §16, checklist 8 — a report is a
      // log, and neither of those belongs in one.
      label: row.publishedAt ? 'published' : 'not published',
      storageKey: row.storageKey,
      sizeBytes: row.sizeBytes,
    })
  }

  for (const row of await db.select().from(documentPackages)) {
    out.push({
      what: 'document',
      id: row.id,
      label: `${row.title}${row.issuedAt ? ' (issued)' : ' (not issued)'}`,
      storageKey: row.storageKey,
      sizeBytes: row.sizeBytes,
    })
  }

  return out
}

async function main(): Promise<void> {
  const store = mediaStore()

  if (!store) {
    console.log(`\nThere is no media store configured.\n\n  ${MEDIA_STORE_UNCONFIGURED}\n`)
    const rows = await collect()
    if (rows.length > 0) {
      console.log(
        `But ${rows.length} row${rows.length === 1 ? '' : 's'} in the database name a stored ` +
          'file. Those files are unreachable until a store is configured — and if this ' +
          'deployment previously had one, it is the same store that needs configuring back.\n',
      )
      process.exitCode = 1
    }
    return
  }

  console.log(`\nChecking stored files against their records\n  store: ${store.describe()}\n`)

  const rows = await collect()

  if (rows.length === 0) {
    console.log('  Nothing is stored, and nothing claims to be. That is a clean answer.\n')
    return
  }

  for (const row of rows) {
    checked += 1

    let stat: { sizeBytes: number } | null
    try {
      stat = await store.stat(row.storageKey)
    } catch (error) {
      // The message, never the key and never the endpoint — the client already
      // refuses to put either in an error, and this does not undo that.
      unreadable.push({ ...row, reason: error instanceof Error ? error.message : 'unknown' })
      continue
    }

    if (stat === null) {
      missing.push(row)
      continue
    }

    if (stat.sizeBytes !== row.sizeBytes) {
      wrongSize.push({ ...row, actual: stat.sizeBytes })
    }
  }

  console.log(`  ${checked} record${checked === 1 ? '' : 's'} checked`)

  if (missing.length > 0) {
    console.log(`\n  ${missing.length} file${missing.length === 1 ? ' is' : 's are'} MISSING:`)
    for (const row of missing) {
      console.log(`    ${row.what.padEnd(9)} ${row.label} — record ${row.id}`)
    }
    console.log(
      '\n  A missing file means the record survived and the object did not. The usual cause ' +
        '\n  is a database restored without the bucket it was taken alongside — see ' +
        '\n  DEPLOYMENT.md §1.1. Nothing here has been changed.',
    )
  }

  if (wrongSize.length > 0) {
    console.log(`\n  ${wrongSize.length} file${wrongSize.length === 1 ? '' : 's'} the WRONG SIZE:`)
    for (const row of wrongSize) {
      console.log(
        `    ${row.what.padEnd(9)} ${row.label} — record says ${row.sizeBytes}, store has ` +
          `${row.actual} (record ${row.id})`,
      )
    }
    console.log(
      '\n  Since media responses stream, Content-Length comes from the record. A file ' +
        '\n  shorter than its record makes a browser wait for bytes that are not coming.',
    )
  }

  if (unreadable.length > 0) {
    console.log(`\n  ${unreadable.length} could not be checked at all:`)
    for (const row of unreadable) {
      console.log(`    ${row.what.padEnd(9)} ${row.label} — ${row.reason}`)
    }
  }

  const wrong = missing.length + wrongSize.length + unreadable.length

  if (wrong === 0) {
    console.log('\n  Every stored file is present and is the size its record says.\n')
  } else {
    console.log(`\n  ${wrong} problem${wrong === 1 ? '' : 's'}. Nothing was changed.\n`)
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
