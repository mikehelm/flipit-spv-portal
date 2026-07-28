import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resetEnvCache } from '@/lib/env'
import { FakeS3, FAKE_S3_ACCESS_KEY_ID, FAKE_S3_BUCKET, FAKE_S3_REGION, FAKE_S3_SECRET } from '@/test/fake-s3'
import { ingest } from './ingest'
import { jpegWithMetadata } from './fixtures'
import { mediaStore, resetMediaStoreCache, type MediaStore } from './store'
import { S3ObjectClient, parseVersioningStatus, parseVersionListing } from './s3'

/**
 * The object store as the application sees it, rather than as a signer.
 *
 * The point of a seam is that the thing behind it does not matter, and the only
 * way to know that is true is to run the same expectations against both
 * implementations and require the same answers. That is what most of this file
 * is: a table of behaviours, and a loop.
 *
 * The rest is the boot-time gate. Selecting the object store with three of the
 * five variables set used to be a deployment that started, looked configured,
 * and refused the first upload; it is now a deployment that does not start.
 */

const KEY = 'img_STOREKEYSTOREKEYSTOREKEY'

/** Read a whole stream into one array, for a test that wants to compare bytes. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

const ORIGINAL = { ...process.env }

function restoreEnv(): void {
  for (const name of Object.keys(process.env)) {
    if (!(name in ORIGINAL)) delete process.env[name]
  }
  Object.assign(process.env, ORIGINAL)
  resetEnvCache()
  resetMediaStoreCache()
}

describe('both stores answer the same questions the same way', () => {
  const fake = new FakeS3()
  let directory = ''

  beforeAll(async () => {
    await fake.start()
    directory = await mkdtemp(path.join(tmpdir(), 'spv-store-parity-'))
  })

  afterAll(async () => {
    await fake.stop()
    restoreEnv()
  })

  function selectFilesystem(): MediaStore {
    process.env.MEDIA_STORE = 'filesystem'
    process.env.MEDIA_DIR = directory
    resetEnvCache()
    resetMediaStoreCache()
    return mediaStore()!
  }

  function selectObjectStore(): MediaStore {
    process.env.MEDIA_STORE = 'object-store'
    process.env.MEDIA_S3_ENDPOINT = fake.endpoint
    process.env.MEDIA_S3_REGION = FAKE_S3_REGION
    process.env.MEDIA_S3_BUCKET = FAKE_S3_BUCKET
    process.env.MEDIA_S3_ACCESS_KEY_ID = FAKE_S3_ACCESS_KEY_ID
    process.env.MEDIA_S3_SECRET_ACCESS_KEY = FAKE_S3_SECRET
    resetEnvCache()
    resetMediaStoreCache()
    return mediaStore()!
  }

  const implementations: ReadonlyArray<[string, () => MediaStore]> = [
    ['filesystem', () => selectFilesystem()],
    ['object-store', () => selectObjectStore()],
  ]

  for (const [name, build] of implementations) {
    describe(name, () => {
      it('stores bytes and gives back exactly those bytes', async () => {
        const store = build()
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250, 0, 255])

        await store.put(KEY, bytes, 'image/png')

        const read = await store.get(KEY)
        expect(read).not.toBeNull()
        expect(read!.bytes).toEqual(bytes)
      })

      it('a key that was never stored is null rather than a throw', async () => {
        const store = build()
        expect(await store.get('img_NOTHINGHEREATALLNOTHING')).toBeNull()
      })

      it('remove makes it absent, and removing it twice is not an error', async () => {
        const store = build()
        await store.put('img_TWICETWICETWICETWICETW', new Uint8Array([1]), 'image/png')

        await store.remove('img_TWICETWICETWICETWICETW')
        expect(await store.get('img_TWICETWICETWICETWICETW')).toBeNull()
        await expect(store.remove('img_TWICETWICETWICETWICETW')).resolves.toBeUndefined()
      })

      it('the content type comes from the caller’s own column, never from the store', async () => {
        const store = build()
        await store.put('img_TYPETYPETYPETYPETYPETY', new Uint8Array([1, 2]), 'image/webp')

        // Both answer the same placeholder. What the bytes actually are was
        // decided by the sniffer at ingest and lives on the row; a store that
        // echoed a declared type back would be a second, weaker opinion.
        expect((await store.get('img_TYPETYPETYPETYPETYPETY'))!.contentType).toBe(
          'application/octet-stream',
        )
      })

      it('refuses a key that is not a storage key, on every verb', async () => {
        const store = build()

        for (const bad of ['../../etc/passwd', 'img_../escape', '', 'nope', 'img_short']) {
          await expect(store.put(bad, new Uint8Array([1]), 'image/png')).rejects.toThrow(
            /not a storage key/,
          )
          await expect(store.get(bad)).rejects.toThrow(/not a storage key/)
          await expect(store.remove(bad)).rejects.toThrow(/not a storage key/)
        }
      })

      it('reads a range, and reads exactly the bytes asked for', async () => {
        const store = build()
        const bytes = new Uint8Array(256)
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i

        await store.put('img_RANGERANGERANGERANGERA', bytes, 'image/png')

        // Inclusive on both ends — the HTTP convention, and the off-by-one.
        const first = await store.getRange('img_RANGERANGERANGERANGERA', 0, 0)
        expect([...first!.bytes]).toEqual([0])

        const two = await store.getRange('img_RANGERANGERANGERANGERA', 0, 1)
        expect([...two!.bytes]).toEqual([0, 1])

        const middle = await store.getRange('img_RANGERANGERANGERANGERA', 100, 109)
        expect([...middle!.bytes]).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])

        const last = await store.getRange('img_RANGERANGERANGERANGERA', 255, 255)
        expect([...last!.bytes]).toEqual([255])

        const all = await store.getRange('img_RANGERANGERANGERANGERA', 0, 255)
        expect([...all!.bytes]).toEqual([...bytes])
      })

      it('a range of an object that is not there is null, not a throw', async () => {
        const store = build()
        expect(await store.getRange('img_NOTHINGHEREATALLNOTHING', 0, 9)).toBeNull()
      })

      it('a backwards range is null rather than a negative-length read', async () => {
        const store = build()
        await store.put('img_BACKWARDSBACKWARDSBAC', new Uint8Array([1, 2, 3]), 'image/png')
        expect(await store.getRange('img_BACKWARDSBACKWARDSBAC', 2, 1)).toBeNull()
      })

      it('a range refuses a key that is not a storage key too', async () => {
        const store = build()
        await expect(store.getRange('../../etc/passwd', 0, 9)).rejects.toThrow(
          /not a storage key/,
        )
      })

      it('streams the whole object, and the stream is the bytes', async () => {
        const store = build()
        const bytes = new Uint8Array(300)
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256

        await store.put('img_STREAMSTREAMSTREAMSTR', bytes, 'image/png')

        const opened = await store.openStream('img_STREAMSTREAMSTREAMSTR')
        expect(opened).not.toBeNull()
        // The length is known before a byte is read, and it is the store's own
        // answer rather than anything a caller told it.
        expect(opened!.length).toBe(300)
        expect([...(await drain(opened!.stream))]).toEqual([...bytes])
      })

      it('streams a range, inclusive on both ends', async () => {
        const store = build()
        const bytes = new Uint8Array(300)
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256

        await store.put('img_STREAMRANGESTREAMRAN', bytes, 'image/png')

        const two = await store.openStream('img_STREAMRANGESTREAMRAN', { start: 0, end: 1 })
        expect(two!.length).toBe(2)
        expect([...(await drain(two!.stream))]).toEqual([0, 1])

        const tail = await store.openStream('img_STREAMRANGESTREAMRAN', { start: 297, end: 299 })
        expect(tail!.length).toBe(3)
        expect([...(await drain(tail!.stream))]).toEqual([297 % 256, 298 % 256, 299 % 256])

        // Byte for byte the same answer as the buffered read, on both stores.
        const buffered = await store.getRange('img_STREAMRANGESTREAMRAN', 10, 19)
        const streamed = await store.openStream('img_STREAMRANGESTREAMRAN', { start: 10, end: 19 })
        expect([...(await drain(streamed!.stream))]).toEqual([...buffered!.bytes])
      })

      /**
       * The awkward answers, which both stores have to give identically or the
       * choice of backend becomes visible in an HTTP status code.
       */
      it('a range past the end is empty rather than absent, and a backwards one is null', async () => {
        const store = build()
        await store.put('img_SHORTSHORTSHORTSHORTS', new Uint8Array([1, 2, 3]), 'image/png')

        // There, and shorter than asked for. Not the same as gone.
        const clamped = await store.openStream('img_SHORTSHORTSHORTSHORTS', { start: 1, end: 99 })
        expect(clamped).not.toBeNull()
        expect(clamped!.length).toBe(2)
        expect([...(await drain(clamped!.stream))]).toEqual([2, 3])

        expect(await store.openStream('img_SHORTSHORTSHORTSHORTS', { start: 2, end: 1 })).toBeNull()
      })

      /**
       * Absence has to be decided BEFORE a response begins. A stream that
       * failed part way through would already have sent a 200, and there is no
       * way left to say 404 after the status line has gone.
       */
      it('an absent object is null before a stream exists, not an error during one', async () => {
        const store = build()
        expect(await store.openStream('img_NOSTREAMNOSTREAMNOSTR')).toBeNull()
        expect(
          await store.openStream('img_NOSTREAMNOSTREAMNOSTR', { start: 0, end: 1 }),
        ).toBeNull()
      })

      it('a stream refuses a key that is not a storage key too', async () => {
        const store = build()
        await expect(store.openStream('../../etc/passwd')).rejects.toThrow(/not a storage key/)
      })

      it('stat reports the size that is actually stored, without reading it', async () => {
        const store = build()
        const bytes = new Uint8Array(4321)

        await store.put('img_STATSTATSTATSTATSTATS', bytes, 'image/png')

        expect(await store.stat('img_STATSTATSTATSTATSTATS')).toEqual({ sizeBytes: 4321 })
      })

      it('stat of something absent is null, not an error', async () => {
        const store = build()
        expect(await store.stat('img_NOSTATNOSTATNOSTATNO')).toBeNull()
      })

      it('stat refuses a key that is not a storage key too', async () => {
        const store = build()
        await expect(store.stat('../../etc/passwd')).rejects.toThrow(/not a storage key/)
      })

      /**
       * The reverse read: from the store to the keys, rather than from a key to
       * the object. Both stores have to answer it the same way, because the
       * report built on it is the same report either way.
       */
      it('lists what is stored, with sizes, in a stable order', async () => {
        const store = build()

        await store.put('img_LISTONELISTONELISTONE1', new Uint8Array(11), 'image/png')
        await store.put('img_LISTTWOLISTTWOLISTTWO2', new Uint8Array(22), 'image/png')

        const listed = await store.list(1000)
        const found = listed.objects.filter((object) => object.key.startsWith('img_LIST'))

        expect(found).toEqual([
          { key: 'img_LISTONELISTONELISTONE1', sizeBytes: 11 },
          { key: 'img_LISTTWOLISTTWOLISTTWO2', sizeBytes: 22 },
        ])
        expect(listed.truncated).toBe(false)

        // Sorted, so two runs of the same check produce the same report.
        expect([...listed.objects].sort((a, b) => (a.key < b.key ? -1 : 1))).toEqual(listed.objects)
      })

      it('a removed object stops being listed', async () => {
        const store = build()
        await store.put('img_LISTGONELISTGONELISTG', new Uint8Array(3), 'image/png')

        const before = await store.list(1000)
        expect(before.objects.some((o) => o.key === 'img_LISTGONELISTGONELISTG')).toBe(true)

        await store.remove('img_LISTGONELISTGONELISTG')

        const after = await store.list(1000)
        expect(after.objects.some((o) => o.key === 'img_LISTGONELISTGONELISTG')).toBe(false)
      })

      /**
       * A limit that is silently obeyed is a report that describes part of a
       * bucket as though it were all of it. Both stores say when they stopped.
       */
      it('says when it stopped rather than quietly returning part of the store', async () => {
        const store = build()
        await store.put('img_LIMITONELIMITONELIMIT', new Uint8Array(1), 'image/png')
        await store.put('img_LIMITTWOLIMITTWOLIMIT', new Uint8Array(1), 'image/png')

        const capped = await store.list(1)
        expect(capped.objects).toHaveLength(1)
        expect(capped.truncated).toBe(true)
      })

      it('a limit that is not a limit is refused', async () => {
        const store = build()
        for (const bad of [0, -1, 1.5, Number.NaN]) {
          await expect(store.list(bad)).rejects.toThrow(/positive limit/)
        }
      })

      it('stat and a real read agree about the size', async () => {
        const store = build()
        const bytes = new Uint8Array(777)

        await store.put('img_AGREEAGREEAGREEAGREEA', bytes, 'image/png')

        const stat = await store.stat('img_AGREEAGREEAGREEAGREEA')
        const read = await store.get('img_AGREEAGREEAGREEAGREEA')
        expect(stat!.sizeBytes).toBe(read!.bytes.length)
      })

      it('says where it is writing, and never says it with a credential', () => {
        const store = build()
        const described = store.describe()

        expect(described.length).toBeGreaterThan(0)
        expect(described).not.toContain(FAKE_S3_SECRET)
        expect(described).not.toContain(FAKE_S3_ACCESS_KEY_ID)
      })
    })
  }

  it('a traversal key never reached the object store as a request', async () => {
    selectObjectStore()
    fake.requests = 0

    await expect(mediaStore()!.get('img_../../../../etc/passwd')).rejects.toThrow()

    // Refused before the socket, not by the far end being well behaved.
    expect(fake.requests).toBe(0)
  })

  it('a traversal key never reached the filesystem either', async () => {
    selectFilesystem()
    const before = await readdir(directory)

    await expect(mediaStore()!.put('../escaped', new Uint8Array([1]), 'image/png')).rejects.toThrow()

    expect(await readdir(directory)).toEqual(before)
  })

  it('the one ingest path stores through whichever store is configured', async () => {
    selectObjectStore()

    const result = await ingest('image', jpegWithMetadata())
    expect(result.ok).toBe(true)

    if (result.ok) {
      // The bytes in the object store are the stripped ones, not the uploaded
      // ones — the strip happens before the put, on both stores alike.
      const stored = fake.objects.get(result.storageKey)
      expect(stored).toBeDefined()
      expect(stored!.bytes.length).toBe(result.sizeBytes)
      expect(result.strippedBytes).toBeGreaterThan(0)
      expect(stored!.contentType).toBe('image/jpeg')
      expect(result.storageKey.startsWith('img_')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------

describe('the object store is all-or-nothing, and it is checked at boot', () => {
  afterEach(restoreEnv)

  function select(overrides: Record<string, string>): void {
    process.env.MEDIA_STORE = 'object-store'
    process.env.MEDIA_S3_ENDPOINT = 'https://s3.example.com'
    process.env.MEDIA_S3_BUCKET = 'a-bucket'
    process.env.MEDIA_S3_ACCESS_KEY_ID = 'AKIA0000000000000000'
    process.env.MEDIA_S3_SECRET_ACCESS_KEY = 'a-secret'
    Object.assign(process.env, overrides)
    resetEnvCache()
    resetMediaStoreCache()
  }

  it('a complete configuration builds an object store', () => {
    select({})
    const store = mediaStore()
    expect(store?.kind).toBe('object-store')
    expect(store?.describe()).toContain('a-bucket')
  })

  for (const missing of [
    'MEDIA_S3_ENDPOINT',
    'MEDIA_S3_BUCKET',
    'MEDIA_S3_ACCESS_KEY_ID',
    'MEDIA_S3_SECRET_ACCESS_KEY',
  ]) {
    it(`refuses to start without ${missing}`, () => {
      select({ [missing]: '' })
      expect(() => mediaStore()).toThrow(new RegExp(missing))
    })
  }

  it('refuses an endpoint that is not an absolute URL', () => {
    select({ MEDIA_S3_ENDPOINT: 's3.example.com' })
    expect(() => mediaStore()).toThrow(/absolute http or https URL/)
  })

  it('refuses an endpoint carrying a path, which would silently shift the prefix', () => {
    select({ MEDIA_S3_ENDPOINT: 'https://s3.example.com/some-prefix' })
    expect(() => mediaStore()).toThrow(/scheme and host only/)
  })

  it('the refusal names the variable and never prints its value', () => {
    select({ MEDIA_S3_BUCKET: '' })

    const error = (() => {
      try {
        mediaStore()
        return null
      } catch (caught) {
        return caught
      }
    })()

    expect(String(error)).toContain('MEDIA_S3_BUCKET')
    expect(String(error)).not.toContain('a-secret')
  })

  it('none of it is required when the object store is not selected', () => {
    process.env.MEDIA_STORE = 'filesystem'
    for (const name of [
      'MEDIA_S3_ENDPOINT',
      'MEDIA_S3_BUCKET',
      'MEDIA_S3_ACCESS_KEY_ID',
      'MEDIA_S3_SECRET_ACCESS_KEY',
    ]) {
      delete process.env[name]
    }
    resetEnvCache()
    resetMediaStoreCache()

    expect(mediaStore()?.kind).toBe('filesystem')
  })

  it('no store at all is still a supported state', () => {
    process.env.MEDIA_STORE = ''
    resetEnvCache()
    resetMediaStoreCache()

    expect(mediaStore()).toBeNull()
  })
})

/**
 * Asking a bucket whether it keeps what it is told to delete.
 *
 * The one property of a store that cannot be discovered by using it. Put, get,
 * stat, list and delete all behave identically on a versioned bucket and an
 * unversioned one — the difference is that on the first, the object is still
 * there after the delete, behind a marker, recoverable from a console. An
 * investor erasure that reports destroying a signed subscription agreement is
 * then not true, and nothing else in this repository can see it.
 */
describe('whether the bucket keeps what it is told to delete', () => {
  it('reads an empty configuration as permanent deletes', async () => {
    const bucket = new FakeS3()
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config())
      expect(await client.bucketVersioning()).toBe('DISABLED')
    } finally {
      await bucket.stop()
    }
  })

  it('reads Enabled', async () => {
    const bucket = new FakeS3()
    bucket.versioning = 'Enabled'
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config())
      expect(await client.bucketVersioning()).toBe('ENABLED')
    } finally {
      await bucket.stop()
    }
  })

  it('reads Suspended, and does not fold it into permanent', async () => {
    // Suspending stops new versions. Every non-current version already written
    // stays exactly where it is, which is where the documents deleted while it
    // was on are.
    const bucket = new FakeS3()
    bucket.versioning = 'Suspended'
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config())
      expect(await client.bucketVersioning()).toBe('SUSPENDED')
    } finally {
      await bucket.stop()
    }
  })

  it('answers UNKNOWN when the provider does not implement the question', async () => {
    const bucket = new FakeS3()
    bucket.versioningApi = 'ABSENT'
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config())
      // Not a throw. This is a question a reporting job asks on behalf of a
      // person, and a probe that turns a media report into a stack trace has
      // made the report worse.
      expect(await client.bucketVersioning()).toBe('UNKNOWN')
    } finally {
      await bucket.stop()
    }
  })

  it('answers UNKNOWN rather than throwing when the endpoint is not there', async () => {
    const bucket = new FakeS3()
    await bucket.start()
    const config = bucket.config()
    await bucket.stop()
    const client = new S3ObjectClient(config)
    expect(await client.bucketVersioning()).toBe('UNKNOWN')
  }, 20_000)

  it('signs the request, so a wrong secret is refused and reads as UNKNOWN', async () => {
    const bucket = new FakeS3()
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config('the wrong secret entirely'))
      expect(await client.bucketVersioning()).toBe('UNKNOWN')
      // And the fake really did refuse it, rather than never being asked.
      expect(bucket.requests).toBeGreaterThan(0)
    } finally {
      await bucket.stop()
    }
  })

  it('the store seam reports it, and a filesystem store is permanent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'versioning-'))
    const before = { store: process.env.MEDIA_STORE, dir: process.env.MEDIA_DIR }
    process.env.MEDIA_STORE = 'filesystem'
    process.env.MEDIA_DIR = directory
    resetEnvCache()
    resetMediaStoreCache()
    try {
      expect(await mediaStore()!.versioning()).toBe('DISABLED')
    } finally {
      if (before.store === undefined) delete process.env.MEDIA_STORE
      else process.env.MEDIA_STORE = before.store
      if (before.dir === undefined) delete process.env.MEDIA_DIR
      else process.env.MEDIA_DIR = before.dir
      resetEnvCache()
      resetMediaStoreCache()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('parsing a VersioningConfiguration', () => {
  it('an empty one means versioning was never turned on', () => {
    expect(parseVersioningStatus('<VersioningConfiguration/>')).toBe('DISABLED')
    expect(parseVersioningStatus('<VersioningConfiguration></VersioningConfiguration>')).toBe(
      'DISABLED',
    )
  })

  it('reads the two statuses that exist', () => {
    expect(
      parseVersioningStatus('<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'),
    ).toBe('ENABLED')
    expect(
      parseVersioningStatus(
        '<VersioningConfiguration><Status> Suspended </Status></VersioningConfiguration>',
      ),
    ).toBe('SUSPENDED')
  })

  it('a status it has never heard of is UNKNOWN, not assumed harmless', () => {
    expect(
      parseVersioningStatus('<VersioningConfiguration><Status>Whatever</Status></VersioningConfiguration>'),
    ).toBe('UNKNOWN')
  })

  it('and something that is not a VersioningConfiguration at all is UNKNOWN', () => {
    // An error document, an HTML page from a proxy, an empty body. None of them
    // is evidence that deletes are permanent.
    expect(parseVersioningStatus('<Error><Code>AccessDenied</Code></Error>')).toBe('UNKNOWN')
    expect(parseVersioningStatus('')).toBe('UNKNOWN')
    expect(parseVersioningStatus('<html><body>404</body></html>')).toBe('UNKNOWN')
  })
})

/**
 * What the bucket is still holding that nothing points at any more.
 *
 * The half of the retention question that survives the remedy: switching
 * versioning off stops new versions being written and removes not one already
 * there. A bucket somebody corrected this morning reports permanent deletes and
 * can still hold a copy of every document an erasure destroyed while it was on.
 */
describe('copies the bucket kept behind delete markers', () => {
  it('is nothing on a bucket that never kept any', async () => {
    const bucket = new FakeS3()
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config())
      expect(await client.hiddenVersions(1000)).toEqual({
        nonCurrent: 0,
        deleteMarkers: 0,
        atLeast: false,
      })
    } finally {
      await bucket.stop()
    }
  })

  it('counts what a delete kept, and keeps counting after versioning is switched off', async () => {
    const bucket = new FakeS3()
    bucket.versioning = 'Enabled'
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config())
      await client.putObject(KEY, new TextEncoder().encode('an agreement'), 'application/pdf')
      await client.deleteObject(KEY)

      expect(await client.hiddenVersions(1000)).toEqual({
        nonCurrent: 1,
        deleteMarkers: 1,
        atLeast: false,
      })

      // Somebody reads the warning and does what it says. The status goes
      // quiet; the copy does not go anywhere.
      bucket.versioning = 'DISABLED'
      expect(await client.bucketVersioning()).toBe('DISABLED')
      expect((await client.hiddenVersions(1000))!.nonCurrent).toBe(1)
    } finally {
      await bucket.stop()
    }
  })

  it('does not count a live object as a copy of anything', async () => {
    const bucket = new FakeS3()
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config())
      await client.putObject(KEY, new TextEncoder().encode('a live file'), 'application/pdf')
      expect((await client.hiddenVersions(1000))!.nonCurrent).toBe(0)
    } finally {
      await bucket.stop()
    }
  })

  it('reports a truncated listing as a floor rather than a total', async () => {
    const bucket = new FakeS3()
    bucket.versionsTruncated = true
    await bucket.start()
    try {
      const client = new S3ObjectClient(bucket.config())
      expect((await client.hiddenVersions(1000))!.atLeast).toBe(true)
    } finally {
      await bucket.stop()
    }
  })

  it('is null, not zero, when the bucket will not say', async () => {
    for (const mode of ['REFUSED', 'ABSENT'] as const) {
      const bucket = new FakeS3()
      bucket.versioningApi = mode
      await bucket.start()
      try {
        const client = new S3ObjectClient(bucket.config())
        // Zero would be an all-clear invented out of a refusal.
        expect(await client.hiddenVersions(1000)).toBeNull()
      } finally {
        await bucket.stop()
      }
    }
  }, 20_000)

  it('and null on a filesystem store, which has no such thing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hidden-'))
    const before = { store: process.env.MEDIA_STORE, dir: process.env.MEDIA_DIR }
    process.env.MEDIA_STORE = 'filesystem'
    process.env.MEDIA_DIR = directory
    resetEnvCache()
    resetMediaStoreCache()
    try {
      expect(await mediaStore()!.hiddenVersions(1000)).toBeNull()
    } finally {
      if (before.store === undefined) delete process.env.MEDIA_STORE
      else process.env.MEDIA_STORE = before.store
      if (before.dir === undefined) delete process.env.MEDIA_DIR
      else process.env.MEDIA_DIR = before.dir
      resetEnvCache()
      resetMediaStoreCache()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('parsing a ListVersionsResult', () => {
  it('counts superseded versions and delete markers, and not current ones', () => {
    const xml =
      '<ListVersionsResult>' +
      '<IsTruncated>false</IsTruncated>' +
      '<Version><Key>a</Key><IsLatest>true</IsLatest></Version>' +
      '<Version><Key>b</Key><IsLatest>false</IsLatest></Version>' +
      '<Version><Key>b</Key><IsLatest>false</IsLatest></Version>' +
      '<DeleteMarker><Key>b</Key><IsLatest>true</IsLatest></DeleteMarker>' +
      '</ListVersionsResult>'
    expect(parseVersionListing(xml)).toEqual({
      nonCurrent: 2,
      deleteMarkers: 1,
      atLeast: false,
    })
  })

  it('reads truncation as a floor', () => {
    const xml = '<ListVersionsResult><IsTruncated>true</IsTruncated></ListVersionsResult>'
    expect(parseVersionListing(xml).atLeast).toBe(true)
  })
})
