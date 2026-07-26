import { createServer, type Server } from 'node:http'
import { readdirSync } from 'node:fs'
import { mkdtemp, stat, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetEnvCache } from '@/lib/env'
import { serveMedia } from './serve'
import { S3ObjectClient, responseLength } from './s3'
import { mediaStore, resetMediaStoreCache, type MediaStore, type StoredStream } from './store'

/**
 * *When* the bytes move, rather than which bytes arrive.
 *
 * The parity suite in `object-store.test.ts` proves both stores stream the
 * right bytes. That is necessary and it is not sufficient: a buffered
 * implementation returns exactly the same bytes, so every assertion about the
 * body would pass just as well against the thing this work removed. One
 * `arrayBuffer()` put back for convenience and the behaviour is identical until
 * the day the round is going well and four people open the video at once.
 *
 * So the assertions here are about laziness and about clean-up. A response that
 * has been built must not have pulled anything. A body arriving from a file
 * must arrive in pieces, which a single buffer cannot do. A stream a browser
 * abandoned mid-download must not leave a descriptor behind. And a store that
 * disagrees with the row naming it must not produce a response that promises
 * bytes which never come.
 */

const ORIGINAL = { ...process.env }

/** Bigger than the 64 KiB a filesystem read stream pulls at a time. */
const BIG = 200_000

function pattern(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let at = 0; at < size; at += 1) bytes[at] = at % 251
  return bytes
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function restoreEnv(): void {
  for (const name of Object.keys(process.env)) {
    if (!(name in ORIGINAL)) delete process.env[name]
  }
  Object.assign(process.env, ORIGINAL)
  resetEnvCache()
  resetMediaStoreCache()
}

function selectFilesystem(directory: string): MediaStore {
  process.env.MEDIA_STORE = 'filesystem'
  process.env.MEDIA_DIR = directory
  resetEnvCache()
  resetMediaStoreCache()
  return mediaStore()!
}

/** Open descriptors for this process. A leak shows up here and nowhere else. */
function openDescriptors(): number {
  return readdirSync('/proc/self/fd').length
}

describe('a file is read as it is sent, not read and then sent', () => {
  let store: MediaStore
  const KEY = 'vid_STREAMSTREAMSTREAMSTREAM'
  const bytes = pattern(BIG)

  beforeAll(async () => {
    store = selectFilesystem(await mkdtemp(path.join(tmpdir(), 'spv-streaming-')))
    await store.put(KEY, bytes, 'video/mp4')
  })

  afterAll(restoreEnv)

  /**
   * The one assertion that tells a stream from a buffer with extra steps. A
   * file read into memory and handed over arrives as one chunk; a file being
   * read as it is consumed arrives as several.
   */
  it('arrives in several chunks, which a buffered read could not do', async () => {
    const opened = (await store.openStream(KEY))!
    expect(opened.length).toBe(BIG)

    let chunks = 0
    let total = 0
    for await (const chunk of opened.stream as unknown as AsyncIterable<Uint8Array>) {
      chunks += 1
      total += chunk.length
    }

    expect(total).toBe(BIG)
    expect(chunks).toBeGreaterThan(1)
  })

  it('the length is the file’s own, and the bytes are all of them', async () => {
    const opened = (await store.openStream(KEY))!
    expect(await readAll(opened.stream)).toEqual(bytes)
  })

  it('an end past the last byte is clamped rather than refused', async () => {
    const opened = (await store.openStream(KEY, { start: BIG - 3, end: BIG + 10_000 }))!
    expect(opened.length).toBe(3)
    expect([...(await readAll(opened.stream))]).toEqual([...bytes.slice(BIG - 3)])
  })

  it('a start past the end of a real object is empty, not absent', async () => {
    // The distinction the route depends on: null means gone, and this means
    // there, and shorter than the row claims. They are answered differently.
    const opened = (await store.openStream(KEY, { start: BIG + 5, end: BIG + 10 }))!
    expect(opened).not.toBeNull()
    expect(opened.length).toBe(0)
    expect((await readAll(opened.stream)).length).toBe(0)
  })

  it('an empty object is a stream of nothing rather than an absence', async () => {
    const empty = 'vid_EMPTYEMPTYEMPTYEMPTYEM'
    await store.put(empty, new Uint8Array(0), 'video/mp4')

    const opened = (await store.openStream(empty))!
    expect(opened.length).toBe(0)
    expect((await readAll(opened.stream)).length).toBe(0)
  })

  /**
   * A descriptor per view, never given back, is the failure that replaces the
   * memory one if a handle is left open. Cancellation is the path that matters:
   * a browser seeking away mid-download abandons the body, which is the most
   * ordinary thing a video player does.
   */
  it('closes the descriptor when the stream is read to the end', async () => {
    const before = openDescriptors()
    for (let round = 0; round < 5; round += 1) {
      await readAll((await store.openStream(KEY))!.stream)
    }
    expect(openDescriptors()).toBeLessThanOrEqual(before)
  })

  it('closes the descriptor when the reader gives up half way', async () => {
    const before = openDescriptors()

    for (let round = 0; round < 5; round += 1) {
      const opened = (await store.openStream(KEY))!
      const reader = opened.stream.getReader()
      await reader.read()
      await reader.cancel()
    }

    // Node closes the handle on the stream's own tick, not the canceller's.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(openDescriptors()).toBeLessThanOrEqual(before)
  })
})

// ---------------------------------------------------------------------------

/**
 * A store that records when its bytes were pulled.
 *
 * `get` and `getRange` throw rather than merely going uncalled, so that an edit
 * reaching for the buffering read fails loudly here instead of quietly
 * reintroducing the thing this work removed.
 */
class SpyStore implements MediaStore {
  readonly kind = 'filesystem' as const
  pulls = 0
  opened: Array<{ start: number; end: number } | undefined> = []

  constructor(
    private readonly bytes: Uint8Array,
    private readonly options: { absent?: boolean } = {},
  ) {}

  describe(): string {
    return 'a spy'
  }

  async put(): Promise<void> {
    throw new Error('the spy does not write')
  }

  async get(): Promise<never> {
    throw new Error('serveMedia must not buffer a whole object')
  }

  async getRange(): Promise<never> {
    throw new Error('serveMedia must not buffer a range')
  }

  async stat(): Promise<{ sizeBytes: number } | null> {
    return { sizeBytes: this.bytes.length }
  }

  async list(): Promise<never> {
    throw new Error('serveMedia has no business listing a store')
  }

  async openStream(
    _key: string,
    range?: { start: number; end: number },
  ): Promise<StoredStream | null> {
    this.opened.push(range)
    if (this.options.absent) return null

    const start = range ? range.start : 0
    const end = Math.min(range ? range.end : this.bytes.length - 1, this.bytes.length - 1)
    const slice = this.bytes.slice(start, end + 1)

    return {
      length: slice.length,
      stream: new ReadableStream<Uint8Array>(
        {
          // An arrow, so the counter is this spy's rather than an alias of it.
          pull: (controller) => {
            // One byte at a time, so that "has anything been pulled" is a
            // question with an unambiguous answer.
            if (this.pulls >= slice.length) {
              controller.close()
              return
            }
            controller.enqueue(slice.slice(this.pulls, this.pulls + 1))
            this.pulls += 1
          },
        },
        // Zero, so nothing is pulled to fill a queue before a consumer asks.
        // The default of one would pre-fetch a chunk at construction and blur
        // the very distinction this spy exists to draw.
        new CountQueuingStrategy({ highWaterMark: 0 }),
      ),
    }
  }

  async remove(): Promise<void> {
    throw new Error('the spy does not delete')
  }
}

function request(range?: string): Request {
  return new Request('http://localhost/portal/video/v1', {
    headers: range ? { range } : undefined,
  })
}

const NOT_FOUND = () => new Response('Not found', { status: 404 })

describe('serveMedia sends a body it has not read', () => {
  const bytes = pattern(64)

  it('the whole-file response is built without pulling a byte', async () => {
    const store = new SpyStore(bytes)
    const response = await serveMedia({
      request: request(),
      store,
      storageKey: 'vid_SPYSPYSPYSPYSPYSPYSPYSP',
      contentType: 'video/mp4',
      sizeBytes: bytes.length,
      notFound: NOT_FOUND(),
    })

    // The response exists, the length is declared, and nothing has moved.
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('64')
    expect(store.pulls).toBe(0)

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(store.pulls).toBe(64)
  })

  it('a partial response is built without pulling a byte either', async () => {
    const store = new SpyStore(bytes)
    const response = await serveMedia({
      request: request('bytes=8-15'),
      store,
      storageKey: 'vid_SPYSPYSPYSPYSPYSPYSPYSP',
      contentType: 'video/mp4',
      sizeBytes: bytes.length,
      notFound: NOT_FOUND(),
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 8-15/64')
    expect(response.headers.get('Content-Length')).toBe('8')
    expect(store.pulls).toBe(0)
    expect(store.opened).toEqual([{ start: 8, end: 15, length: 8 }])

    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...bytes.slice(8, 16)])
  })

  it('an absent object is still the route’s own 404, on both branches', async () => {
    const absent = new SpyStore(bytes, { absent: true })

    for (const header of [undefined, 'bytes=0-1']) {
      const response = await serveMedia({
        request: request(header),
        store: absent,
        storageKey: 'vid_SPYSPYSPYSPYSPYSPYSPYSP',
        contentType: 'video/mp4',
        sizeBytes: bytes.length,
        notFound: NOT_FOUND(),
      })
      expect(response.status).toBe(404)
    }
  })
})

describe('a stored file that is shorter than its row', () => {
  let directory = ''
  let store: MediaStore
  const KEY = 'vid_TRUNCATEDTRUNCATEDTRUNC'

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'spv-truncated-'))
    store = selectFilesystem(directory)
    await store.put(KEY, pattern(100), 'video/mp4')
    await truncate(path.join(directory, KEY), 40)
  })

  afterAll(restoreEnv)

  it('the file really is shorter than the row says', async () => {
    expect((await stat(path.join(directory, KEY))).size).toBe(40)
    // And this is exactly the drift `pnpm media:check` reports on.
    expect(await store.stat(KEY)).toEqual({ sizeBytes: 40 })
  })

  /**
   * The row claims a hundred bytes and forty are on disk. What must not happen
   * is a `Content-Length` or a `Content-Range` promising bytes that will never
   * arrive: that is a player hanging on a download that never finishes, rather
   * than one that ends.
   */
  it('the whole-file response promises only what will actually arrive', async () => {
    const response = await serveMedia({
      request: request(),
      store,
      storageKey: KEY,
      contentType: 'video/mp4',
      sizeBytes: 100,
      notFound: NOT_FOUND(),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('40')
    expect((await response.arrayBuffer()).byteLength).toBe(40)
  })

  it('and a partial one names the span it is really sending', async () => {
    const response = await serveMedia({
      request: request('bytes=30-99'),
      store,
      storageKey: KEY,
      contentType: 'video/mp4',
      sizeBytes: 100,
      notFound: NOT_FOUND(),
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(response.headers.get('Content-Range')).toBe('bytes 30-39/100')
    expect((await response.arrayBuffer()).byteLength).toBe(10)
  })

  it('a range that begins past the real end is the ordinary 404', async () => {
    const response = await serveMedia({
      request: request('bytes=60-99'),
      store,
      storageKey: KEY,
      contentType: 'video/mp4',
      sizeBytes: 100,
      notFound: NOT_FOUND(),
    })

    // Not a 416 naming a size that is wrong, and not an empty 206. The same
    // answer as an id that does not exist, which tells an investor nothing
    // about the state of this deployment's storage.
    expect(response.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------

/**
 * A server that answers before it has finished, which is the whole point.
 *
 * If `openObjectStream` ended in `arrayBuffer()` it could not resolve until the
 * last byte had arrived. This one sends the headers and half the body, waits,
 * then sends the rest — and the assertion is that the call came back during the
 * wait.
 */
describe('an object-store body is handed over before it has all arrived', () => {
  let server: Server
  let endpoint = ''
  let finished = false

  beforeAll(async () => {
    server = createServer((_request, response) => {
      finished = false
      response.writeHead(200, { 'content-length': '20', 'content-type': 'video/mp4' })
      response.write(Buffer.alloc(10, 1))
      setTimeout(() => {
        finished = true
        response.end(Buffer.alloc(10, 2))
      }, 150)
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('resolves while the body is still arriving', async () => {
    const client = new S3ObjectClient({
      endpoint,
      region: 'auto',
      bucket: 'bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    })

    const opened = (await client.openObjectStream('vid_SLOWSLOWSLOWSLOWSLOWSLO'))!

    expect(finished).toBe(false)
    expect(opened.length).toBe(20)

    const all = await readAll(opened.stream)
    expect(finished).toBe(true)
    expect(all.length).toBe(20)
  })
})

describe('a response that does not say how long it is', () => {
  let server: Server
  let endpoint = ''

  beforeAll(async () => {
    server = createServer((_request, response) => {
      // Chunked, with no length and no content-range: a proxy having opinions.
      response.writeHead(200, { 'transfer-encoding': 'chunked' })
      response.end(Buffer.alloc(8, 3))
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  /**
   * Refused rather than guessed at. A length this code invented would go to a
   * browser as a promise about a body nobody has seen, and a browser holds the
   * connection open waiting for bytes that are not coming.
   */
  it('is refused, with a message that quotes nothing of it', async () => {
    const client = new S3ObjectClient({
      endpoint,
      region: 'auto',
      bucket: 'bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    })

    await expect(client.openObjectStream('vid_NOLENGTHNOLENGTHNOLENG')).rejects.toThrow(
      /without a length this build can trust/,
    )
  })
})

describe('reading a length off a response', () => {
  function headers(entries: Record<string, string>): {
    headers: { get(name: string): string | null }
  } {
    return { headers: { get: (name: string) => entries[name] ?? null } }
  }

  it('prefers what the store declared', () => {
    expect(responseLength(headers({ 'content-length': '1024' }))).toBe(1024)
    expect(responseLength(headers({ 'content-length': '0' }))).toBe(0)
  })

  it('falls back to the range a 206 names', () => {
    expect(responseLength(headers({ 'content-range': 'bytes 0-9/100' }))).toBe(10)
    expect(responseLength(headers({ 'content-range': 'bytes 90-99/100' }))).toBe(10)
    expect(responseLength(headers({ 'content-range': 'bytes 0-0/*' }))).toBe(1)
  })

  it('is null for anything it cannot read, rather than a guess', () => {
    expect(responseLength(headers({}))).toBeNull()
    expect(responseLength(headers({ 'content-length': 'lots' }))).toBeNull()
    expect(responseLength(headers({ 'content-length': '-4' }))).toBeNull()
    expect(responseLength(headers({ 'content-range': 'bytes */100' }))).toBeNull()
    expect(responseLength(headers({ 'content-range': 'bytes 9-0/100' }))).toBeNull()
    expect(responseLength(headers({ 'content-range': 'pages 0-9/100' }))).toBeNull()
  })

  it('a declared length wins over a range that disagrees', () => {
    // Not an average and not a maximum: the store's own assertion about the
    // body it is sending is the only one that describes the socket.
    expect(
      responseLength(headers({ 'content-length': '4', 'content-range': 'bytes 0-9/100' })),
    ).toBe(4)
  })
})
