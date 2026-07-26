import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resetEnvCache } from '@/lib/env'
import { FakeS3, FAKE_S3_ACCESS_KEY_ID, FAKE_S3_BUCKET, FAKE_S3_REGION, FAKE_S3_SECRET } from '@/test/fake-s3'
import { ingest } from './ingest'
import { jpegWithMetadata } from './fixtures'
import { mediaStore, resetMediaStoreCache, type MediaStore } from './store'

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

        const stream = await store.openStream('img_STREAMSTREAMSTREAMSTR')
        expect(stream).not.toBeNull()
        expect([...(await drain(stream!))]).toEqual([...bytes])
      })

      it('streams a range, inclusive on both ends', async () => {
        const store = build()
        const bytes = new Uint8Array(300)
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256

        await store.put('img_STREAMRANGESTREAMRAN', bytes, 'image/png')

        const two = await store.openStream('img_STREAMRANGESTREAMRAN', { start: 0, end: 1 })
        expect([...(await drain(two!))]).toEqual([0, 1])

        const tail = await store.openStream('img_STREAMRANGESTREAMRAN', { start: 297, end: 299 })
        expect([...(await drain(tail!))]).toEqual([297 % 256, 298 % 256, 299 % 256])

        // Byte for byte the same answer as the buffered read, on both stores.
        const buffered = await store.getRange('img_STREAMRANGESTREAMRAN', 10, 19)
        const streamed = await store.openStream('img_STREAMRANGESTREAMRAN', { start: 10, end: 19 })
        expect([...(await drain(streamed!))]).toEqual([...buffered!.bytes])
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
