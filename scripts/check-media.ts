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
 *     object under a key whose row records the full length. The response now
 *     takes its `Content-Length` from the store rather than the row, so this
 *     no longer hangs a browser — but a video that is half there is still a
 *     video that is half there, and nothing else would say so.
 *
 * Both are quiet, and both are found in one pass here. This reads sizes with a
 * `stat` on the seam — a `HEAD` against an object store — so checking a
 * sixty-megabyte video costs a round trip rather than a download.
 *
 * **And then the same question backwards.** Walking the rows can only ever find
 * rows; an object that no row points at is invisible to it. Those exist for the
 * mirror-image reasons — a database restored from *before* an upload, a delete
 * that removed the row and failed on the object, a bucket shared with something
 * else — and an investor's subscription agreement sitting in a bucket that
 * nothing references is a retention problem rather than an untidiness. So the
 * store is listed and every key it holds is checked back against the rows.
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
import { isValidStorageKey, mediaStore, MEDIA_STORE_UNCONFIGURED } from '@/lib/media/store'

interface Tracked {
  what: string
  id: string
  label: string
  storageKey: string
  sizeBytes: number
}

/**
 * How many objects this is prepared to hold in memory while it reports.
 *
 * A real deployment has tens; five thousand is a ceiling on a mistake, not an
 * expectation. Reaching it is reported rather than silently obeyed — a check
 * that describes a fraction of a bucket as though it were all of it is worse
 * than one that refuses to guess.
 */
const LIST_LIMIT = 5000

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
    // No rows is not the end of the check — it is the case where *everything*
    // in the store is an orphan, which is what a database restored from before
    // its uploads looks like. Returning here would have called that clean.
    console.log('  No record names a stored file.')

    const strays = await reportOrphans(store, new Set())

    if (strays === 0) {
      console.log('\n  And nothing is stored. That is a clean answer.\n')
    } else {
      console.log(`\n  ${strays} problem${strays === 1 ? '' : 's'}. Nothing was changed.\n`)
      process.exitCode = 1
    }
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
      '\n  The response sends what the store has rather than what the record claims, so ' +
        '\n  this does not hang a download. It does mean part of a file is gone.',
    )
  }

  if (unreadable.length > 0) {
    console.log(`\n  ${unreadable.length} could not be checked at all:`)
    for (const row of unreadable) {
      console.log(`    ${row.what.padEnd(9)} ${row.label} — ${row.reason}`)
    }
  }

  if (missing.length + wrongSize.length + unreadable.length === 0) {
    console.log('\n  Every stored file is present and is the size its record says.')
  }

  const orphans = await reportOrphans(store, new Set(rows.map((row) => row.storageKey)))

  const wrong = missing.length + wrongSize.length + unreadable.length + orphans

  if (wrong === 0) {
    console.log('\n  Nothing is stored that nothing points at, either.\n')
  } else {
    console.log(`\n  ${wrong} problem${wrong === 1 ? '' : 's'}. Nothing was changed.\n`)
    process.exitCode = 1
  }
}

/**
 * The reverse pass: everything in the store, checked back against the rows.
 *
 * **Orphan keys are printed in full, and that is deliberate.** The rest of this
 * script prints record ids and labels but never a storage key, because a key is
 * how an image is addressed and printing one into a CI log would be handing out
 * a capability. An orphan is the exception that proves the rule: the routes look
 * the row up *first* and serve nothing without one, so a key with no row behind
 * it addresses nothing this application will hand over. What it does address is
 * an object in a bucket — and the only way to act on that is to name it to
 * somebody who already holds the credentials.
 */
async function reportOrphans(
  store: NonNullable<ReturnType<typeof mediaStore>>,
  known: ReadonlySet<string>,
): Promise<number> {
  let listed: Awaited<ReturnType<typeof store.list>>

  try {
    listed = await store.list(LIST_LIMIT)
  } catch (error) {
    console.log(
      `\n  The store could not be listed: ${error instanceof Error ? error.message : 'unknown'}` +
        '\n  Objects that no record points at cannot be checked for. Everything above still ' +
        '\n  holds — this half of the check did not run.',
    )
    return 1
  }

  console.log(
    `\n  ${listed.objects.length} object${listed.objects.length === 1 ? '' : 's'} in the store` +
      `${listed.truncated ? `, and there are more than ${LIST_LIMIT} — this is not all of them` : ''}`,
  )

  const orphans = listed.objects.filter((object) => !known.has(object.key))

  if (orphans.length > 0) {
    const bytes = orphans.reduce((total, object) => total + object.sizeBytes, 0)
    console.log(
      `\n  ${orphans.length} object${orphans.length === 1 ? ' is' : 's are'} stored that no ` +
        `record points at (${bytes} bytes):`,
    )

    for (const object of orphans) {
      const shape = isValidStorageKey(object.key)
        ? object.key.slice(0, 4).replace('_', '')
        : 'not a storage key this application would write'
      console.log(`    ${object.key} — ${object.sizeBytes} bytes, ${shape}`)
    }

    console.log(
      '\n  Each is either an upload whose record was lost, a delete that removed the record ' +
        '\n  and not the object, or something else sharing this store. Deleting one is a ' +
        '\n  decision for a person holding the backup — nothing here has been changed.',
    )
  }

  if (listed.truncated) {
    console.log(
      `\n  The listing stopped at ${LIST_LIMIT} objects, so there may be orphans this did ` +
        '\n  not see. Raise LIST_LIMIT, or find out what is putting that much in the store.',
    )
    return orphans.length + 1
  }

  return orphans.length
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
