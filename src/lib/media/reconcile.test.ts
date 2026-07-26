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
