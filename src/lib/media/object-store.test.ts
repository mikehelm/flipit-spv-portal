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
