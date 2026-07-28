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
 * **It changes nothing.** It reports, exits non-zero if anything is wrong, and
 * writes one line to the audit log saying that it ran and what it found — which
 * is how `pnpm check:health` can say whether this is being run at all. Deleting
 * or re-uploading is a decision for a person holding the backup.
 *
 * The comparing lives in `src/lib/media/reconcile.ts` and is unit-tested there.
 * This file is the printing and the exit code.
 *
 *   pnpm media:check
 */

import 'dotenv/config'
import { audit, systemActor } from '@/lib/audit'
import {
  collectTrackedFiles,
  LIST_LIMIT,
  MEDIA_CHECK_COMPLETED_ACTION,
  reconcile,
  recordOf,
  recordOfUnconfigured,
  type MediaCheckRecord,
  type Reconciliation,
} from '@/lib/media/reconcile'
import { isValidStorageKey, mediaStore, MEDIA_STORE_UNCONFIGURED } from '@/lib/media/store'

async function main(): Promise<void> {
  const store = mediaStore()

  if (!store) {
    console.log(`\nThere is no media store configured.\n\n  ${MEDIA_STORE_UNCONFIGURED}\n`)
    const rows = await collectTrackedFiles()

    if (rows.length > 0) {
      console.log(
        `But ${rows.length} row${rows.length === 1 ? '' : 's'} in the database name a stored ` +
          'file. Those files are unreachable until a store is configured — and if this ' +
          'deployment previously had one, it is the same store that needs configuring back.\n',
      )
      process.exitCode = 1
    }

    await record(recordOfUnconfigured(rows.length))
    return
  }

  console.log(`\nChecking stored files against their records\n  store: ${store.describe()}\n`)

  const rows = await collectTrackedFiles()
  const result = await reconcile(store, rows)

  if (rows.length === 0) {
    // No rows is not the end of the check — it is the case where *everything*
    // in the store is an orphan, which is what a database restored from before
    // its uploads looks like. Stopping here would have called that clean.
    console.log('  No record names a stored file.')

    printOrphans(result)
    printRetention(result)

    if (result.problems === 0) {
      console.log('\n  And nothing is stored. That is a clean answer.\n')
    } else {
      console.log(
        `\n  ${result.problems} problem${result.problems === 1 ? '' : 's'}. Nothing was changed.\n`,
      )
      process.exitCode = 1
    }

    await record(recordOf(result))
    return
  }

  console.log(`  ${result.checked} record${result.checked === 1 ? '' : 's'} checked`)

  if (result.missing.length > 0) {
    console.log(
      `\n  ${result.missing.length} file${result.missing.length === 1 ? ' is' : 's are'} MISSING:`,
    )
    for (const row of result.missing) {
      console.log(`    ${row.what.padEnd(9)} ${row.label} — record ${row.id}`)
    }
    console.log(
      '\n  A missing file means the record survived and the object did not. The usual cause ' +
        '\n  is a database restored without the bucket it was taken alongside — see ' +
        '\n  DEPLOYMENT.md §1.1. Nothing here has been changed.',
    )
  }

  if (result.wrongSize.length > 0) {
    console.log(
      `\n  ${result.wrongSize.length} file${result.wrongSize.length === 1 ? '' : 's'} the WRONG SIZE:`,
    )
    for (const row of result.wrongSize) {
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

  if (result.unreadable.length > 0) {
    console.log(`\n  ${result.unreadable.length} could not be checked at all:`)
    for (const row of result.unreadable) {
      console.log(`    ${row.what.padEnd(9)} ${row.label} — ${row.reason}`)
    }
  }

  if (result.missing.length + result.wrongSize.length + result.unreadable.length === 0) {
    console.log('\n  Every stored file is present and is the size its record says.')
  }

  printOrphans(result)
  printRetention(result)

  if (result.problems === 0) {
    console.log('\n  Nothing is stored that nothing points at, either.\n')
  } else {
    console.log(
      `\n  ${result.problems} problem${result.problems === 1 ? '' : 's'}. Nothing was changed.\n`,
    )
    process.exitCode = 1
  }

  await record(recordOf(result))
}

/**
 * The reverse pass, printed.
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
function printOrphans(result: Reconciliation): void {
  if (result.listingError !== null) {
    console.log(
      `\n  The store could not be listed: ${result.listingError}` +
        '\n  Objects that no record points at cannot be checked for. Everything above still ' +
        '\n  holds — this half of the check did not run.',
    )
    return
  }

  const listed = result.listed ?? 0

  console.log(
    `\n  ${listed} object${listed === 1 ? '' : 's'} in the store` +
      `${result.truncated ? `, and there are more than ${LIST_LIMIT} — this is not all of them` : ''}`,
  )

  if (result.orphans.length > 0) {
    const bytes = result.orphans.reduce((total, object) => total + object.sizeBytes, 0)
    console.log(
      `\n  ${result.orphans.length} object${result.orphans.length === 1 ? ' is' : 's are'} ` +
        `stored that no record points at (${bytes} bytes):`,
    )

    for (const object of result.orphans) {
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

  if (result.truncated) {
    console.log(
      `\n  The listing stopped at ${LIST_LIMIT} objects, so there may be orphans this did ` +
        '\n  not see. Raise LIST_LIMIT, or find out what is putting that much in the store.',
    )
  }
}

/**
 * The one line in this report that is not a comparison.
 *
 * Everything else here asks whether the rows and the store agree. This asks the
 * store one question about itself, because it is the only way to find out: a
 * versioned bucket answers every other question exactly as an unversioned one
 * does, a delete against it succeeds, and an investor erasure then reports
 * destroying a document that is still there.
 *
 * Printed on every run, including the clean one — a silence that only breaks
 * when something is wrong cannot be distinguished from a silence because
 * nobody asked.
 */
function printRetention(result: Reconciliation): void {
  if (result.versioning === 'DISABLED') {
    console.log('\n  Deletes are permanent on this store — versioning is off.')
    printHidden(result)
    return
  }

  if (result.versioning === 'UNKNOWN') {
    console.log(
      '\n  Whether deletes are permanent on this store is NOT KNOWN. It would not say — the' +
        '\n  provider may not implement the question, or the key pair may be scoped to objects' +
        '\n  and not to the bucket. Check in the provider’s console that versioning is off,' +
        '\n  along with any object lock or retention rule. See DEPLOYMENT.md §1.',
    )
    printHidden(result)
    return
  }

  console.log(
    `\n  DELETES ARE NOT PERMANENT ON THIS STORE. Versioning is ${result.versioning.toLowerCase()}.` +
      '\n  A delete writes a marker and keeps the object, so everything else in this report' +
      '\n  can be clean while every deleted file remains recoverable from the console. An' +
      '\n  investor erasure destroys stored documents and says so on the screen; on this' +
      '\n  bucket that sentence is not true. Turn versioning off and expire the non-current' +
      '\n  versions, then run this again. See DEPLOYMENT.md §1 and §12.',
  )
  printHidden(result)
}

/**
 * What the store is still holding that nothing points at any more.
 *
 * Separate from the lines above, because it is the half of the question that
 * survives the fix. Turning versioning off is what the warning asks for, and it
 * removes nothing already written: a bucket corrected this morning reports
 * permanent deletes and can still hold a copy of every document deleted while
 * it was on. That is the state somebody reaches by ticking the box and stopping
 * there, and it reads as clean everywhere else in this application.
 *
 * Null is the filesystem store, which has no such thing to count. Nothing is
 * printed then — a line saying "and it holds nothing behind a delete marker"
 * about a directory would be answering a question that was never asked of it.
 */
function printHidden(result: Reconciliation): void {
  if (result.hidden === null) return

  const { nonCurrent, deleteMarkers, atLeast } = result.hidden
  if (nonCurrent + deleteMarkers === 0) {
    console.log('  And it holds nothing behind a delete marker.')
    return
  }

  console.log(
    `\n  It is STILL HOLDING ${atLeast ? 'at least ' : ''}${nonCurrent} superseded ` +
      `version${nonCurrent === 1 ? '' : 's'} and ${deleteMarkers} delete ` +
      `marker${deleteMarkers === 1 ? '' : 's'}.` +
      '\n  Those are copies of objects this application asked the store to destroy. Turning' +
      '\n  versioning off does not remove them: expire the non-current versions with a' +
      '\n  lifecycle rule, or delete them in the console, and run this again. Until then any' +
      '\n  erasure carried out against this store is incomplete. See DEPLOYMENT.md §1.',
  )
}

/**
 * Write down that this ran, and what it found.
 *
 * Counts only — no storage key, no label, no record id. The report above is
 * where the detail belongs, because a person is reading it and can act on it.
 * This line exists for one question: has anybody run this lately, and did it
 * come back clean. `pnpm check:health` asks it, so an operator watching one
 * thing is watching this too.
 */
async function record(metadata: MediaCheckRecord): Promise<void> {
  await audit({
    actor: systemActor,
    entityType: 'media',
    entityId: null,
    action: MEDIA_CHECK_COMPLETED_ACTION,
    metadata,
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
