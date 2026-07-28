import { describe, expect, it } from 'vitest'
import {
  LIST_LIMIT,
  mediaCheckRecordSchema,
  reconcile,
  recordOf,
  recordOfUnconfigured,
  type TrackedFile,
} from './reconcile'
import type { MediaStore, StoredObjectSummary, StoredStream } from './store'
import type { BucketVersioning, HiddenVersions } from './s3'

/**
 * The comparing that `pnpm media:check` does, without a database and without a
 * store on a disk.
 *
 * Until this file the only assertions about that logic went through
 * `pnpm verify:media`, which spawns the real command and matches its printed
 * output with regular expressions. That proves the command works, once, against
 * one arrangement of one filesystem store — and it says nothing about the cases
 * that are awkward to arrange for real: a store that throws on one key and
 * answers on the next, a listing that fails outright, a listing that hits its
 * limit. Those are the cases where a miscount matters, because the count is now
 * what the health report reads.
 */

/**
 * A store whose answers are declared per key.
 *
 * Everything a reconciliation must not do throws. `get`, `getRange` and
 * `openStream` are all reads of the bytes, and a check that reads the bytes to
 * find out how many there are costs a download per file — which is precisely
 * what `stat` exists to avoid.
 */
class FakeStore implements MediaStore {
  readonly kind = 'object-store' as const

  constructor(
    private readonly sizes: Record<string, number>,
    private readonly options: {
      throwsOn?: Record<string, string>
      objects?: StoredObjectSummary[]
      listThrows?: string
      truncated?: boolean
      /** What this store says about keeping what it is told to delete. */
      versioningStatus?: BucketVersioning
      /** What it is still holding behind delete markers. Null = it cannot say. */
      hidden?: HiddenVersions | null
    } = {},
  ) {}

  describe(): string {
    return 'a fake store'
  }

  async put(): Promise<void> {
    throw new Error('a reconciliation writes nothing')
  }

  async get(): Promise<never> {
    throw new Error('a reconciliation must not read the bytes')
  }

  async getRange(): Promise<never> {
    throw new Error('a reconciliation must not read the bytes')
  }

  async openStream(): Promise<StoredStream | null> {
    throw new Error('a reconciliation must not read the bytes')
  }

  async remove(): Promise<void> {
    throw new Error('a reconciliation deletes nothing')
  }

  async versioning(): Promise<BucketVersioning> {
    return this.options.versioningStatus ?? 'DISABLED'
  }

  async hiddenVersions(): Promise<HiddenVersions | null> {
    return this.options.hidden ?? null
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    const message = this.options.throwsOn?.[key]
    if (message !== undefined) throw new Error(message)
    const size = this.sizes[key]
    return size === undefined ? null : { sizeBytes: size }
  }

  async list(limit: number): Promise<{ objects: StoredObjectSummary[]; truncated: boolean }> {
    if (this.options.listThrows !== undefined) throw new Error(this.options.listThrows)
    const objects = this.options.objects ?? []
    return { objects: objects.slice(0, limit), truncated: this.options.truncated ?? false }
  }
}

function file(overrides: Partial<TrackedFile> = {}): TrackedFile {
  return {
    what: 'image',
    id: 'med_1',
    label: 'a picture',
    storageKey: 'img_AAAAAAAAAAAAAAAAAAAAAAAA',
    sizeBytes: 100,
    ...overrides,
  }
}

const NOTHING_STORED: StoredObjectSummary[] = []

describe('a record against the object it names', () => {
  it('is silent when every file is present and the size its record says', async () => {
    const rows = [file(), file({ id: 'med_2', storageKey: 'doc_BBBBBBBBBBBBBBBBBBBBBBBB', sizeBytes: 7 })]
    const store = new FakeStore(
      { img_AAAAAAAAAAAAAAAAAAAAAAAA: 100, doc_BBBBBBBBBBBBBBBBBBBBBBBB: 7 },
      {
        objects: [
          { key: 'img_AAAAAAAAAAAAAAAAAAAAAAAA', sizeBytes: 100 },
          { key: 'doc_BBBBBBBBBBBBBBBBBBBBBBBB', sizeBytes: 7 },
        ],
      },
    )

    const result = await reconcile(store, rows)

    expect(result.checked).toBe(2)
    expect(result.problems).toBe(0)
    expect(result.missing).toHaveLength(0)
    expect(result.orphans).toHaveLength(0)
  })

  it('reports a record whose object is gone', async () => {
    // A database restored without the bucket it was taken alongside.
    const store = new FakeStore({}, { objects: NOTHING_STORED })
    const result = await reconcile(store, [file()])

    expect(result.missing.map((row) => row.id)).toEqual(['med_1'])
    expect(result.problems).toBe(1)
  })

  it('reports an object shorter than the record claims', async () => {
    const store = new FakeStore(
      { img_AAAAAAAAAAAAAAAAAAAAAAAA: 61 },
      { objects: [{ key: 'img_AAAAAAAAAAAAAAAAAAAAAAAA', sizeBytes: 61 }] },
    )
    const result = await reconcile(store, [file()])

    expect(result.wrongSize).toHaveLength(1)
    expect(result.wrongSize[0]?.actual).toBe(61)
    expect(result.wrongSize[0]?.sizeBytes).toBe(100)
    expect(result.missing).toHaveLength(0)
  })

  it('carries on past a key the store refuses, rather than losing the rest', async () => {
    // One unreachable object must not turn the other forty into an unknown.
    const rows = [
      file({ id: 'med_1', storageKey: 'img_AAAAAAAAAAAAAAAAAAAAAAAA' }),
      file({ id: 'med_2', storageKey: 'img_CCCCCCCCCCCCCCCCCCCCCCCC' }),
    ]
    const store = new FakeStore(
      { img_CCCCCCCCCCCCCCCCCCCCCCCC: 100 },
      {
        throwsOn: { img_AAAAAAAAAAAAAAAAAAAAAAAA: 'connection reset' },
        objects: [{ key: 'img_CCCCCCCCCCCCCCCCCCCCCCCC', sizeBytes: 100 }],
      },
    )

    const result = await reconcile(store, rows)

    expect(result.checked).toBe(2)
    expect(result.unreadable.map((row) => row.id)).toEqual(['med_1'])
    expect(result.missing).toHaveLength(0)
    expect(result.wrongSize).toHaveLength(0)
    expect(result.problems).toBe(1)
  })

  it('never carries a storage key or an endpoint in the reason it could not read one', async () => {
    // The reason is the error's message and nothing else. A key is a capability
    // and this ends up in a log file.
    const store = new FakeStore({}, { throwsOn: { img_AAAAAAAAAAAAAAAAAAAAAAAA: 'timed out' } })
    const result = await reconcile(store, [file()])

    expect(result.unreadable[0]?.reason).toBe('timed out')
  })
})

describe('the same question backwards', () => {
  it('reports an object that no record points at', async () => {
    const store = new FakeStore(
      { img_AAAAAAAAAAAAAAAAAAAAAAAA: 100 },
      {
        objects: [
          { key: 'img_AAAAAAAAAAAAAAAAAAAAAAAA', sizeBytes: 100 },
          { key: 'doc_ORPHANORPHANORPHANORPH', sizeBytes: 11 },
        ],
      },
    )

    const result = await reconcile(store, [file()])

    expect(result.orphans.map((object) => object.key)).toEqual(['doc_ORPHANORPHANORPHANORPH'])
    expect(result.problems).toBe(1)
  })

  it('treats everything in the store as an orphan when no record names a file', async () => {
    // A database restored from before its uploads. The forward pass finds
    // nothing to complain about precisely because there is nothing to walk.
    const store = new FakeStore(
      {},
      { objects: [{ key: 'doc_ORPHANORPHANORPHANORPH', sizeBytes: 11 }] },
    )

    const result = await reconcile(store, [])

    expect(result.checked).toBe(0)
    expect(result.orphans).toHaveLength(1)
    expect(result.problems).toBe(1)
  })

  it('counts a listing that could not run as one problem, and keeps the forward pass', async () => {
    const store = new FakeStore({ img_AAAAAAAAAAAAAAAAAAAAAAAA: 100 }, { listThrows: 'no such bucket' })

    const result = await reconcile(store, [file()])

    expect(result.listed).toBeNull()
    expect(result.listingError).toBe('no such bucket')
    expect(result.missing).toHaveLength(0)
    expect(result.problems).toBe(1)
  })

  it('counts a truncated listing as a problem, because the answer is incomplete', async () => {
    // The alternative is a report that describes a fraction of a bucket as
    // though it were the whole of it.
    const store = new FakeStore(
      {},
      { objects: [{ key: 'doc_ORPHANORPHANORPHANORPH', sizeBytes: 11 }], truncated: true },
    )

    const result = await reconcile(store, [])

    expect(result.truncated).toBe(true)
    expect(result.problems).toBe(2)
  })

  it('asks for no more than the declared limit', async () => {
    // A bucket is not a directory somebody sized. An unbounded listing is how a
    // report becomes an outage.
    const asked: number[] = []
    const spy = new (class extends FakeStore {
      override async list(limit: number) {
        asked.push(limit)
        return { objects: [], truncated: false }
      }
    })({})

    await reconcile(spy, [])
    await reconcile(spy, [], 12)

    expect(asked).toEqual([LIST_LIMIT, 12])
  })
})

describe('what gets written down for the health report to read', () => {
  it('is counts, and never a key, a label or a record id', async () => {
    const store = new FakeStore(
      {},
      {
        objects: [{ key: 'doc_ORPHANORPHANORPHANORPH', sizeBytes: 11 }],
      },
    )
    const result = await reconcile(store, [file({ label: 'David — subscription agreement' })])
    const record = recordOf(result)

    const serialised = JSON.stringify(record)
    expect(serialised).not.toContain('doc_ORPHANORPHANORPHANORPH')
    expect(serialised).not.toContain('img_AAAAAAAAAAAAAAAAAAAAAAAA')
    expect(serialised).not.toContain('subscription')
    expect(serialised).not.toContain('med_1')

    expect(record).toEqual({
      storeConfigured: true,
      checked: 1,
      missing: 1,
      wrongSize: 0,
      unreadable: 0,
      orphans: 1,
      listed: true,
      truncated: false,
      versioning: 'DISABLED',
      hiddenVersions: null,
      problems: 2,
    })
  })

  it('round-trips through the schema the report parses it with', async () => {
    const store = new FakeStore({ img_AAAAAAAAAAAAAAAAAAAAAAAA: 100 }, {})
    const record = recordOf(await reconcile(store, [file()]))

    // The script writes it and the report reads it weeks later. If the shape
    // drifts, this is the test that says so rather than a health page quietly
    // reporting that nothing has ever been checked.
    expect(mediaCheckRecordSchema.safeParse(JSON.parse(JSON.stringify(record))).success).toBe(true)
  })

  it('records a run with no store as having found every record unreachable', async () => {
    // Not a clean answer. Nothing could be checked, and the rows still point at
    // files this deployment cannot read.
    expect(recordOfUnconfigured(3)).toMatchObject({ storeConfigured: false, problems: 3 })
    expect(recordOfUnconfigured(0)).toMatchObject({ storeConfigured: false, problems: 0 })
  })
})

/**
 * A bucket that keeps what it is told to delete.
 *
 * This is the only fact in a reconciliation that is not a comparison between
 * the rows and the store, and it is here because it is the only way to learn
 * it. A versioned bucket answers `stat`, `list` and `get` exactly as an
 * unversioned one does and accepts every `DELETE`; the difference is that the
 * object is still there afterwards. So every other check in this repository
 * passes over a store where an investor erasure destroys nothing at all.
 */
describe('whether the store keeps what it is told to delete', () => {
  it('is asked, and reported, on a clean run', async () => {
    const result = await reconcile(new FakeStore({}, {}), [])
    expect(result.versioning).toBe('DISABLED')
    expect(result.problems).toBe(0)
  })

  it('counts as a problem when versioning is on', async () => {
    const result = await reconcile(new FakeStore({}, { versioningStatus: 'ENABLED' }), [])
    expect(result.versioning).toBe('ENABLED')
    // Nothing else is wrong: no rows, no objects, nothing missing. The bucket
    // alone is the problem, which is the case that would otherwise read clean.
    expect(result.problems).toBe(1)
  })

  it('and when it is suspended, because the old versions are still there', async () => {
    const result = await reconcile(new FakeStore({}, { versioningStatus: 'SUSPENDED' }), [])
    expect(result.problems).toBe(1)
  })

  it('but not when the store will not say', async () => {
    // A provider that does not implement the question would otherwise fail this
    // command for ever with nothing anybody could do about it. It is reported
    // loudly and it is not counted.
    const result = await reconcile(new FakeStore({}, { versioningStatus: 'UNKNOWN' }), [])
    expect(result.versioning).toBe('UNKNOWN')
    expect(result.problems).toBe(0)
  })

  it('survives the schema the health report parses the record with', async () => {
    const result = await reconcile(new FakeStore({}, { versioningStatus: 'ENABLED' }), [])
    const parsed = mediaCheckRecordSchema.safeParse(recordOf(result))
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.versioning).toBe('ENABLED')
  })

  it('and a record from before the question existed still parses', () => {
    /*
     * The reason the field is optional. `report.ts` treats a row that fails
     * this schema as no row at all, so a required field would silently drop the
     * media finding from the health report for every run written before this
     * was added — a new check making an existing one disappear.
     */
    const old = {
      storeConfigured: true,
      checked: 3,
      missing: 0,
      wrongSize: 0,
      unreadable: 0,
      orphans: 0,
      listed: true,
      truncated: false,
      problems: 0,
    }
    const parsed = mediaCheckRecordSchema.safeParse(old)
    expect(parsed.success).toBe(true)
    // Absent, not `DISABLED`. There is no evidence either way and the report
    // must not manufacture some.
    expect(parsed.success && parsed.data.versioning).toBeUndefined()
  })

  it('reports no store as not known, rather than as permanent', () => {
    expect(recordOfUnconfigured(2).versioning).toBe('UNKNOWN')
  })
})

/**
 * What the store is still holding that nothing points at any more.
 *
 * The half of the retention question that survives the remedy. Switching
 * versioning off is what the previous check asks for and it removes nothing
 * already written — so a deployment that did exactly as it was told reports
 * `DISABLED` and can still hold a copy of every document an erasure destroyed.
 */
describe('copies the store kept behind delete markers', () => {
  it('is not a problem when there are none', async () => {
    const store = new FakeStore({}, { hidden: { nonCurrent: 0, deleteMarkers: 0, atLeast: false } })
    const result = await reconcile(store, [])
    expect(result.problems).toBe(0)
  })

  it('is a problem even when versioning now reports permanent deletes', async () => {
    // The state somebody reaches by ticking the box and stopping there. Every
    // other check in this repository reads it as clean.
    const store = new FakeStore(
      {},
      {
        versioningStatus: 'DISABLED',
        hidden: { nonCurrent: 4, deleteMarkers: 4, atLeast: false },
      },
    )
    const result = await reconcile(store, [])
    expect(result.versioning).toBe('DISABLED')
    expect(result.problems).toBe(1)
  })

  it('counts once, not once per copy', async () => {
    const store = new FakeStore(
      {},
      { hidden: { nonCurrent: 900, deleteMarkers: 900, atLeast: true } },
    )
    expect((await reconcile(store, [])).problems).toBe(1)
  })

  it('adds to the versioning problem rather than replacing it', async () => {
    const store = new FakeStore(
      {},
      {
        versioningStatus: 'ENABLED',
        hidden: { nonCurrent: 1, deleteMarkers: 1, atLeast: false },
      },
    )
    expect((await reconcile(store, [])).problems).toBe(2)
  })

  it('a store that cannot say is not a problem, and is not zero either', async () => {
    // Null is the filesystem's permanent answer. Reporting it as zero would be
    // a claim about a machine this store cannot see.
    const store = new FakeStore({}, { hidden: null })
    const result = await reconcile(store, [])
    expect(result.hidden).toBeNull()
    expect(result.problems).toBe(0)
  })

  it('is written down as counts, and never as a key', async () => {
    const store = new FakeStore(
      { img_AAAAAAAAAAAAAAAAAAAAAAAA: 100 },
      { hidden: { nonCurrent: 2, deleteMarkers: 2, atLeast: false } },
    )
    const record = recordOf(await reconcile(store, []))
    expect(record.hiddenVersions).toEqual({ nonCurrent: 2, deleteMarkers: 2, atLeast: false })
    expect(mediaCheckRecordSchema.safeParse(record).success).toBe(true)
  })

  it('and a record from before the question existed still parses', () => {
    const old = {
      storeConfigured: true,
      checked: 1,
      missing: 0,
      wrongSize: 0,
      unreadable: 0,
      orphans: 0,
      listed: true,
      truncated: false,
      versioning: 'DISABLED' as const,
      problems: 0,
    }
    const parsed = mediaCheckRecordSchema.safeParse(old)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.hiddenVersions).toBeUndefined()
  })
})
