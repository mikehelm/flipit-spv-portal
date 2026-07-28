/**
 * Stored files against the rows that name them, as a value rather than a print.
 * BUILD_SPEC §5, §13.2, §13.3.
 *
 * `scripts/check-media.ts` was the whole of this: it collected the rows, asked
 * the store about each one, listed the store, and printed the differences. That
 * is a fine shape for a command and a useless one for anything else, because a
 * `main()` that writes to standard output cannot be asked what it found.
 *
 * Two things wanted to ask. The health report wanted to say whether the check is
 * being run at all and what it last found, so that an operator watches one thing
 * rather than three. And the check itself had no unit tests — every assertion
 * about it went through `pnpm verify:media`, spawning the real command and
 * matching its output with regular expressions, which proves the command works
 * and says nothing about the rules inside it.
 *
 * So the judgement moved here and the printing stayed there. This file reads and
 * compares; it changes nothing, in the store or in the database. Deleting an
 * orphan or re-uploading a missing file is a decision for a person holding the
 * backup, and it was never this code's to make.
 */

import { count } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { documentPackages, mediaAssets, operatorVideos } from '@/db/schema'
import type { MediaStore, StoredObjectSummary } from './store'
import type { BucketVersioning } from './s3'

/** One record that names a stored file. */
export interface TrackedFile {
  what: 'image' | 'video' | 'document'
  id: string
  /**
   * Enough to find the record by, and never more.
   *
   * A video's is its published state rather than its caption or transcript, and
   * a document's is its title. §16 and checklist 8 — this ends up in a log.
   */
  label: string
  storageKey: string
  sizeBytes: number
}

/**
 * How many objects a listing is prepared to hold in memory.
 *
 * A real deployment has tens; five thousand is a ceiling on a mistake, not an
 * expectation. Reaching it is reported rather than silently obeyed — a check
 * that describes a fraction of a bucket as though it were all of it is worse
 * than one that refuses to guess.
 */
export const LIST_LIMIT = 5000

export interface Reconciliation {
  /** How many records were asked about. */
  checked: number
  /** The record survived; the object did not. */
  missing: TrackedFile[]
  /** The object is there and is not the length the record claims. */
  wrongSize: Array<TrackedFile & { actual: number }>
  /** The store refused the question. Never the key, never the endpoint. */
  unreadable: Array<TrackedFile & { reason: string }>
  /** Stored, and no record points at it. */
  orphans: StoredObjectSummary[]
  /** How many objects the listing returned, or null when it could not run. */
  listed: number | null
  /** Why the listing could not run. Null when it did. */
  listingError: string | null
  /** The listing stopped at the limit, so there may be orphans it did not see. */
  truncated: boolean
  /**
   * Whether the store keeps what it is told to delete.
   *
   * The one thing in this report that is not a comparison between the rows and
   * the store. It is here because this is the job that already asks the store
   * questions on a schedule, and because a versioned bucket is invisible to
   * every other question: it answers `stat`, `list` and `get` exactly as an
   * unversioned one does. `ENABLED` and `SUSPENDED` count as problems;
   * `UNKNOWN` does not, because a provider that does not implement the call
   * would otherwise fail this command for ever with nothing anybody could do.
   */
  versioning: BucketVersioning
  /** Everything wrong, counted once. Non-zero is what makes the command exit 1. */
  problems: number
}

/** Every record in the three tables that hold a `storage_key`. */
export async function collectTrackedFiles(): Promise<TrackedFile[]> {
  const out: TrackedFile[] = []

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
      // Never the caption or the transcript.
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

/**
 * How many records name a stored file, without loading any of them.
 *
 * Three counts. It exists because the health report needs to know whether there
 * is anything to check and must not pay for the check to find out — the whole
 * reason the report reads a recorded result rather than reconciling on a page
 * load is that reconciling costs a round trip per object.
 */
export async function countTrackedFiles(): Promise<number> {
  const [images, videos, documents] = await Promise.all([
    db.select({ value: count() }).from(mediaAssets),
    db.select({ value: count() }).from(operatorVideos),
    db.select({ value: count() }).from(documentPackages),
  ])

  return (images[0]?.value ?? 0) + (videos[0]?.value ?? 0) + (documents[0]?.value ?? 0)
}

/**
 * Both directions in one pass.
 *
 * Forwards: every record, asked of the store with a `stat` — a `HEAD` against an
 * object store — so checking a sixty-megabyte video costs a round trip rather
 * than a download.
 *
 * Backwards: everything the store holds, checked against the keys the records
 * named. Walking the rows can only ever find rows, and an investor's
 * subscription agreement sitting in a bucket that nothing references is a
 * retention problem rather than an untidiness.
 *
 * A listing that fails counts as one problem and does not invalidate the
 * forward pass: what was checked was still checked, and saying so is more useful
 * than throwing the lot away.
 */
export async function reconcile(
  store: MediaStore,
  rows: readonly TrackedFile[],
  limit: number = LIST_LIMIT,
): Promise<Reconciliation> {
  const missing: TrackedFile[] = []
  const wrongSize: Array<TrackedFile & { actual: number }> = []
  const unreadable: Array<TrackedFile & { reason: string }> = []

  for (const row of rows) {
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

  const known = new Set(rows.map((row) => row.storageKey))

  let listed: Awaited<ReturnType<MediaStore['list']>> | null = null
  let listingError: string | null = null

  try {
    listed = await store.list(limit)
  } catch (error) {
    listingError = error instanceof Error ? error.message : 'unknown'
  }

  const orphans = listed ? listed.objects.filter((object) => !known.has(object.key)) : []
  const truncated = listed?.truncated ?? false

  const versioning = await store.versioning()

  const problems =
    missing.length +
    wrongSize.length +
    unreadable.length +
    orphans.length +
    (truncated ? 1 : 0) +
    (listingError === null ? 0 : 1) +
    (versioning === 'ENABLED' || versioning === 'SUSPENDED' ? 1 : 0)

  return {
    checked: rows.length,
    missing,
    wrongSize,
    unreadable,
    orphans,
    listed: listed ? listed.objects.length : null,
    listingError,
    truncated,
    versioning,
    problems,
  }
}

// ---------------------------------------------------------------------------
// What gets written down, so the health report can read it later
// ---------------------------------------------------------------------------

/**
 * The audit action `pnpm media:check` writes. The only record that one happened.
 *
 * Counts, and nothing else. Not a storage key — the command prints orphan keys
 * to its own output deliberately, because the only way to act on an object is to
 * name it to somebody holding the credentials, but the audit log is exported and
 * read on a screen and a key there would outlive the reason for it. Not a label
 * either: a document's title is the investor's document's title.
 */
export const MEDIA_CHECK_COMPLETED_ACTION = 'media.checked'

export const mediaCheckRecordSchema = z.object({
  /** False when the run found no store configured, and so checked nothing. */
  storeConfigured: z.boolean(),
  checked: z.number().int().min(0),
  missing: z.number().int().min(0),
  wrongSize: z.number().int().min(0),
  unreadable: z.number().int().min(0),
  orphans: z.number().int().min(0),
  /** Whether the store could be listed at all. */
  listed: z.boolean(),
  truncated: z.boolean(),
  /**
   * What the store says about keeping what it is told to delete.
   *
   * **Optional, and that is not laziness.** This schema parses rows written by
   * every earlier version of the command, and a required field would make every
   * one of them fail to parse — which this module's own reader treats as *no
   * row at all*, silently losing the media finding from the health report over
   * a field that was added afterwards. Absent means "a run from before anybody
   * asked", and it is reported as exactly that rather than as `DISABLED`.
   */
  versioning: z.enum(['ENABLED', 'SUSPENDED', 'DISABLED', 'UNKNOWN']).optional(),
  problems: z.number().int().min(0),
})

export type MediaCheckRecord = z.infer<typeof mediaCheckRecordSchema>

/** The audit metadata for a run that had a store to check. */
export function recordOf(result: Reconciliation): MediaCheckRecord {
  return {
    storeConfigured: true,
    checked: result.checked,
    missing: result.missing.length,
    wrongSize: result.wrongSize.length,
    unreadable: result.unreadable.length,
    orphans: result.orphans.length,
    listed: result.listingError === null,
    truncated: result.truncated,
    versioning: result.versioning,
    problems: result.problems,
  }
}

/**
 * The audit metadata for a run that found no store configured.
 *
 * Not a silent no-op. No store and no records is a supported state — the portal,
 * the invitation and the certificate are all complete with an empty media
 * library — but no store and records that name files means those files are
 * unreachable, and each one is a problem whether or not anything could be
 * checked.
 */
export function recordOfUnconfigured(recordsNamingAFile: number): MediaCheckRecord {
  return {
    storeConfigured: false,
    checked: 0,
    missing: 0,
    wrongSize: 0,
    unreadable: 0,
    orphans: 0,
    listed: false,
    truncated: false,
    // No store to ask. Not `DISABLED`, which would be a claim about a store
    // that is not there.
    versioning: 'UNKNOWN',
    problems: recordsNamingAFile,
  }
}
