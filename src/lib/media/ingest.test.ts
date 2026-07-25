import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEnvCache } from '@/lib/env'
import {
  gifBytes,
  jpegWithMetadata,
  mp4WithLocation,
  pdfBytes,
  pngWithMetadata,
  svgBytes,
  webmBytes,
  webpWithMetadata,
} from './fixtures'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, sniffFormat } from './formats'
import { ingest, inspect } from './ingest'
import { isValidStorageKey, mediaStore, newStorageKey, resetMediaStoreCache } from './store'

/**
 * BUILD_SPEC §13.2 — "size and type limits", "stripped of EXIF", "served from
 * the app's own domain".
 */

describe('inspect — what may be stored', () => {
  it('accepts the three image formats and reports the sniffed type, not the declared one', () => {
    // Every one of these is uploaded declaring itself a GIF. The declared type
    // is a claim by whoever named the file and is never the answer.
    expect(inspect('image', jpegWithMetadata(), 'image/gif')).toMatchObject({
      ok: true,
      format: 'image/jpeg',
    })
    expect(inspect('image', pngWithMetadata(), 'image/gif')).toMatchObject({
      ok: true,
      format: 'image/png',
    })
    expect(inspect('image', webpWithMetadata(), 'image/gif')).toMatchObject({
      ok: true,
      format: 'image/webp',
    })
  })

  it('accepts the three video formats', () => {
    expect(inspect('video', mp4WithLocation())).toMatchObject({ ok: true, format: 'video/mp4' })
    expect(inspect('video', webmBytes())).toMatchObject({ ok: true, format: 'video/webm' })
  })

  it('refuses an SVG by name, and says why', () => {
    const result = inspect('image', svgBytes(), 'image/png')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('FORMAT_NOT_ACCEPTED')
    expect(result.message).toContain('SVG')
    expect(result.message).toContain('script')
    expect(result.message).toContain('PNG')
  })

  it('refuses a GIF, because its metadata cannot be stripped here', () => {
    const result = inspect('image', gifBytes())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('FORMAT_NOT_ACCEPTED')
    expect(result.message).toContain('GIF')
  })

  it('refuses a PDF renamed to .png', () => {
    expect(inspect('image', pdfBytes(), 'image/png')).toMatchObject({
      ok: false,
      reason: 'FORMAT_NOT_ACCEPTED',
    })
  })

  it('refuses a video in the image library and an image on the video screen, separately', () => {
    const videoAsImage = inspect('image', mp4WithLocation())
    const imageAsVideo = inspect('video', pngWithMetadata())

    expect(videoAsImage).toMatchObject({ ok: false, reason: 'WRONG_KIND' })
    expect(imageAsVideo).toMatchObject({ ok: false, reason: 'WRONG_KIND' })
  })

  it('refuses an empty file', () => {
    expect(inspect('image', new Uint8Array(0))).toMatchObject({ ok: false, reason: 'EMPTY_FILE' })
  })

  it('refuses something it does not recognise at all', () => {
    expect(inspect('image', new Uint8Array(64))).toMatchObject({
      ok: false,
      reason: 'UNRECOGNISED_FORMAT',
    })
  })

  it('enforces a size limit, and the two limits are different', () => {
    const oversizeImage = new Uint8Array(MAX_IMAGE_BYTES + 1)
    oversizeImage.set(jpegWithMetadata(), 0)

    const result = inspect('image', oversizeImage)
    expect(result).toMatchObject({ ok: false, reason: 'TOO_LARGE' })
    if (result.ok) return
    expect(result.message).toContain('MB')

    expect(MAX_VIDEO_BYTES).toBeGreaterThan(MAX_IMAGE_BYTES)
  })

  it('checks the size before it parses anything', () => {
    // An oversized SVG is refused for its size, not its format: a parser must
    // never see a file that is already over the limit.
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1)
    huge.set(svgBytes(), 0)
    expect(inspect('image', huge)).toMatchObject({ ok: false, reason: 'TOO_LARGE' })
  })
})

describe('ingest — inspect, strip, store', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'spv-media-'))
    process.env.MEDIA_STORE = 'filesystem'
    process.env.MEDIA_DIR = directory
    resetEnvCache()
    resetMediaStoreCache()
  })

  afterEach(() => {
    delete process.env.MEDIA_STORE
    delete process.env.MEDIA_DIR
    resetEnvCache()
    resetMediaStoreCache()
  })

  it('writes the STRIPPED bytes, so the original is never on disk at all', async () => {
    const result = await ingest('image', jpegWithMetadata())

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const onDisk = await readFile(path.join(directory, result.storageKey))
    expect(onDisk.toString('latin1')).not.toContain('Privet Drive')
    expect(onDisk.length).toBe(result.sizeBytes)
    expect(result.strippedBytes).toBeGreaterThan(0)
    expect(sniffFormat(new Uint8Array(onDisk))).toBe('image/jpeg')
  })

  it('records the size of what was stored, not the size of what was uploaded', async () => {
    const original = jpegWithMetadata()
    const result = await ingest('image', original)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sizeBytes).toBeLessThan(original.length)
  })

  it('gives each upload a distinct, unguessable key', async () => {
    const first = await ingest('image', pngWithMetadata())
    const second = await ingest('image', pngWithMetadata())

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.storageKey).not.toBe(second.storageKey)
    expect(first.storageKey.startsWith('img_')).toBe(true)
    expect(first.storageKey.length).toBeGreaterThan(30)
  })

  it('refuses, and stores nothing, when there is nowhere configured to put it', async () => {
    process.env.MEDIA_STORE = ''
    resetEnvCache()
    resetMediaStoreCache()

    const result = await ingest('image', pngWithMetadata())

    expect(result).toMatchObject({ ok: false, reason: 'STORE_NOT_CONFIGURED' })
    if (result.ok) return
    expect(result.message).toContain('MEDIA_STORE')
    expect(mediaStore()).toBeNull()
  })

  it('refuses before it writes: a rejected upload leaves no file behind', async () => {
    const before = await ingest('image', svgBytes())
    expect(before.ok).toBe(false)

    const { readdir } = await import('node:fs/promises')
    expect(await readdir(directory)).toEqual([])
  })

  it('strips a video the same way, and the file length is unchanged', async () => {
    const original = mp4WithLocation()
    const result = await ingest('video', original)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const onDisk = await readFile(path.join(directory, result.storageKey))
    expect(onDisk.toString('latin1')).not.toContain('+51.5074')
    expect(onDisk.length).toBe(original.length)
    expect(result.storageKey.startsWith('vid_')).toBe(true)
  })
})

describe('storage keys', () => {
  it('cannot express a path, which is what stops one escaping its directory', () => {
    for (let i = 0; i < 200; i += 1) {
      const key = newStorageKey('img')
      expect(key).not.toContain('/')
      expect(key).not.toContain('\\')
      expect(key).not.toContain('.')
      expect(isValidStorageKey(key)).toBe(true)
    }
  })

  it('refuses a key that is trying to be a path', () => {
    for (const attempt of [
      '../../../etc/passwd',
      'img_../secret',
      'img_a/b',
      '/etc/passwd',
      'img_',
      '',
      'other_aaaaaaaaaaaaaaaaaaaa',
    ]) {
      expect(isValidStorageKey(attempt)).toBe(false)
    }
  })

  it('refuses to read or write through a key that is not a storage key', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'spv-media-'))
    process.env.MEDIA_STORE = 'filesystem'
    process.env.MEDIA_DIR = directory
    resetEnvCache()
    resetMediaStoreCache()

    const store = mediaStore()
    expect(store).not.toBeNull()
    await expect(store!.put('../escape', new Uint8Array([1]), 'image/png')).rejects.toThrow(
      /storage key/i,
    )

    delete process.env.MEDIA_STORE
    delete process.env.MEDIA_DIR
    resetEnvCache()
    resetMediaStoreCache()
  })
})
