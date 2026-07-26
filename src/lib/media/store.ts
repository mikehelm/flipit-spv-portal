/**
 * Where uploaded bytes actually go. BUILD_SPEC §13.2, §13.3.
 *
 * **This is the seam WP15 was waiting for, and it is the same shape as WP5's
 * `EmailTransport`.** WP16 deferred this package with a specific reason: the
 * deployment had nowhere to put a file, and the two ways to fake one were both
 * worse than waiting. Base64 in Postgres puts a multi-megabyte video in a row
 * that ordinary reads touch; a writable disk does not survive a serverless
 * invocation. Neither of those is fixed by an interface — but *choosing* is,
 * and an interface is what makes the choice a line of configuration rather
 * than a rewrite.
 *
 * So: one interface, one working implementation on a real filesystem, and a
 * declared object-store implementation that refuses with a message naming
 * exactly what is missing. Selecting the object store on a deployment that has
 * not finished wiring it produces a refusal that says so, at the moment
 * somebody tries to upload, rather than a file that appears to save and is
 * gone on the next request.
 *
 * **Nothing else in the application depends on this being configured.** §13.2
 * asks the portal to "look finished before anything is uploaded", and it does:
 * every screen, every email and the certificate all work with an empty media
 * library, which is exactly the state a fresh install is in.
 */

import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { env } from '@/lib/env'
import { S3ObjectClient } from './s3'

export interface StoredObject {
  bytes: Uint8Array
  contentType: string
}

/**
 * A byte span, inclusive at both ends — the HTTP convention, because the only
 * caller is a route answering a `Range` header, and translating twice is how an
 * off-by-one gets in.
 */
export interface ByteRange {
  start: number
  end: number
}

/**
 * An object being read, rather than an object that has been read.
 *
 * The difference is the whole point. `StoredObject` holds every byte in one
 * buffer: for a sixty-megabyte video that is sixty megabytes of process memory
 * per concurrent viewer, and the video is the one thing here that several
 * people plausibly open at the same minute. A `ReadableStream` is handed
 * straight to `Response`, which pulls from it at the speed the socket drains,
 * so what is in memory is a chunk rather than a file.
 *
 * `length` is how many bytes the stream will produce, read from the source
 * itself — `stat` on a filesystem, `Content-Length` on an object store — and
 * never from a database column. The column is what a range is *resolved*
 * against; what gets sent is what the store actually has.
 */
export interface StoredStream {
  stream: ReadableStream<Uint8Array>
  contentType: string
  length: number
}

/**
 * The content type every store reports, and why it is a constant.
 *
 * Never the type the storage layer echoes back: on a filesystem there is none,
 * and on an object store it is whatever was declared at upload — which is
 * exactly the value ingest refuses to trust. The real type is a column on the
 * row that names the key, sniffed from the bytes, and the caller has it.
 */
const OPAQUE_TYPE = 'application/octet-stream'

/** A stream that ends immediately. Not null: the object is there, and empty. */
function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

/**
 * Every byte of a stream, in one buffer.
 *
 * This exists so that `getRange` — whose callers want bytes — is the streaming
 * read with a collector on the end, rather than a second implementation of the
 * same arithmetic. Two copies of "which bytes did they ask for" inside one
 * class is the duplication the range work went out of its way to avoid.
 *
 * It is also the honest name for what buffering is: a deliberate choice made
 * by a caller who knows the thing is small, not the default the whole system
 * falls into.
 */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0

  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }

  return bytes
}

export interface MediaStore {
  /** Which implementation this is, for the settings screen to display. */
  readonly kind: 'filesystem' | 'object-store'
  /** One line describing where things are being written. Never a credential. */
  describe(): string
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  /**
   * Bytes `start` to `end`, both inclusive, in one buffer.
   *
   * Null means the object is not there, exactly as `get` does. The caller has
   * already resolved the range against the recorded size, so a range outside
   * the object is a caller error rather than a case to answer.
   *
   * This is `openStream` with a collector on the end. Prefer `openStream`
   * unless the bytes are actually needed in hand — a range can be most of a
   * file, so "it is only a range" is not a size argument.
   */
  getRange(key: string, start: number, end: number): Promise<StoredObject | null>
  /**
   * The object, or part of it, as a stream that has not been read yet.
   *
   * This is the read an HTTP response should use. Nothing is buffered: the
   * bytes move when the consumer pulls them, which for a `Response` means when
   * the client's socket has room.
   *
   * Null means the object is not there. A range that starts past the end of a
   * real object is *not* null — the object exists — and comes back as a stream
   * of length zero, so a caller can tell "gone" from "shorter than the row
   * claims" and answer each properly.
   */
  openStream(key: string, range?: ByteRange): Promise<StoredStream | null>
  remove(key: string): Promise<void>
}

/**
 * A storage key, and the reason it is what it is.
 *
 * Twenty-four random bytes, base64url. Two properties are load-bearing:
 *
 *   - **Unguessable.** An image is served without a session (see the route),
 *     so the key *is* the capability. Sequential ids would make the whole
 *     library enumerable by anyone who found one URL.
 *   - **No dot, no slash, no space.** The filesystem store turns a key into a
 *     path, and a key that cannot express a path separator or a parent
 *     directory cannot escape its root. The validator below is belt to that
 *     braces; both are here because one of them will be the one that holds.
 */
export function newStorageKey(prefix: 'img' | 'vid' | 'doc'): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`
}

const VALID_KEY = /^(img|vid|doc)_[A-Za-z0-9_-]{16,128}$/

export function isValidStorageKey(key: string): boolean {
  return VALID_KEY.test(key)
}

// ---------------------------------------------------------------------------

class FilesystemMediaStore implements MediaStore {
  readonly kind = 'filesystem' as const

  constructor(private readonly root: string) {}

  describe(): string {
    return `Local filesystem at ${this.root}`
  }

  private resolve(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new Error('Refusing to touch a storage key that is not a storage key.')
    }
    return path.join(this.root, key)
  }

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    const file = this.resolve(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }

  async get(key: string): Promise<StoredObject | null> {
    // Resolved OUTSIDE the try, deliberately. A malformed key used to be
    // swallowed by the same catch that turns a missing file into null, so a
    // caller asking about a key that could not exist was told "not there"
    // rather than "that is not a key" — and the object store, which refuses,
    // then behaved differently from this one for the same input. A seam whose
    // two implementations disagree is not a seam.
    const file = this.resolve(key)

    try {
      const bytes = await readFile(file)
      // The content type is not read back from disk. It is a column on the
      // row that names this key, sniffed at ingest, and the caller has it.
      return { bytes: new Uint8Array(bytes), contentType: OPAQUE_TYPE }
    } catch {
      return null
    }
  }

  /**
   * Read only the bytes asked for — and only when they are wanted in hand.
   *
   * One implementation of the arithmetic, in `openStream`, with a collector on
   * the end. `readFile` then `slice` would be the third thing this method has
   * been and the worst: the point of a range request is that a sixty-megabyte
   * video is not in memory to serve two seconds of it.
   */
  async getRange(key: string, start: number, end: number): Promise<StoredObject | null> {
    if (end < start) return null

    const opened = await this.openStream(key, { start, end })
    if (!opened) return null

    return { bytes: await collect(opened.stream), contentType: opened.contentType }
  }

  /**
   * A file handle, a position, and a stream off it.
   *
   * `handle.createReadStream` closes the handle when the stream ends, errors
   * *or is cancelled* — the third one being why this is not a hand-rolled pull
   * loop. A browser that seeks away mid-download cancels the response body, and
   * a descriptor leaked on that path is a leak on the most ordinary thing a
   * video player does.
   *
   * The size comes from `stat` on the open handle rather than from the caller's
   * recorded size, so what `length` promises is what the file will actually
   * produce even if the row has drifted from the disk.
   */
  async openStream(key: string, range?: ByteRange): Promise<StoredStream | null> {
    const file = this.resolve(key)
    if (range && range.end < range.start) return null

    let handle
    try {
      handle = await open(file, 'r')
    } catch {
      return null
    }

    try {
      const { size } = await handle.stat()

      const start = range ? range.start : 0
      // Clamped, never extended: asking past the end of a file yields what is
      // there, which is the same thing the specification says about a range
      // whose end is past the last byte.
      const end = Math.min(range ? range.end : size - 1, size - 1)
      const length = Math.max(0, end - start + 1)

      if (length === 0) {
        await handle.close()
        return { stream: emptyStream(), contentType: OPAQUE_TYPE, length: 0 }
      }

      return {
        stream: Readable.toWeb(
          handle.createReadStream({ start, end }),
        ) as unknown as ReadableStream<Uint8Array>,
        contentType: OPAQUE_TYPE,
        length,
      }
    } catch (error) {
      // Only reachable before the stream exists — after it, the stream owns the
      // handle and closes it. Closing twice would be harmless; not closing here
      // would leak a descriptor on a failed `stat`.
      await handle.close().catch(() => undefined)
      throw error
    }
  }

  async remove(key: string): Promise<void> {
    const file = this.resolve(key)

    try {
      await rm(file)
    } catch {
      // Removing something that is not there is the state we wanted.
    }
  }
}

/**
 * The object store. Selected by configuration, and now actually one.
 *
 * This used to be a class that refused with a message naming what was missing,
 * which was the right thing to ship and the wrong thing to leave. It is the
 * implementation a deployment without a persistent disk needs, and every
 * deployment this application is likely to get is one of those.
 *
 * It is deliberately a thin wrapper. The key validation is the same call the
 * filesystem store makes, and for the same reason: a key that cannot express a
 * slash cannot address a bucket it was not given, and cannot leave the prefix
 * that names it. `get` returns null for an absent object rather than throwing,
 * so the two stores are indistinguishable to a caller who is asking whether
 * something is there.
 */
class ObjectMediaStore implements MediaStore {
  readonly kind = 'object-store' as const

  constructor(private readonly client: S3ObjectClient) {}

  describe(): string {
    return `Object store at ${this.client.describe()}`
  }

  private checked(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new Error('Refusing to touch a storage key that is not a storage key.')
    }
    return key
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.putObject(this.checked(key), bytes, contentType)
  }

  async get(key: string): Promise<StoredObject | null> {
    const bytes = await this.client.getObject(this.checked(key))
    if (bytes === null) return null

    // Deliberately not the response's own content type, so that both stores
    // answer identically. The type is a column on the row that names this key,
    // sniffed from the bytes at ingest; what an object store echoes back is
    // whatever was declared to it, which is the thing ingest refuses to trust.
    return { bytes, contentType: OPAQUE_TYPE }
  }

  /** The streaming read, collected. One range implementation, as above. */
  async getRange(key: string, start: number, end: number): Promise<StoredObject | null> {
    if (end < start) return null

    const opened = await this.openStream(key, { start, end })
    if (!opened) return null

    return { bytes: await collect(opened.stream), contentType: opened.contentType }
  }

  /**
   * The response body, handed on rather than drained.
   *
   * `fetch` already gives a stream; the buffering was this class calling
   * `arrayBuffer()` on it. Passing it through means a video read out of an S3
   * bucket crosses this process a chunk at a time in both directions.
   *
   * A ranged read still refuses anything that is not a 206 — a store that
   * ignores `Range` and sends the whole object would otherwise be
   * indistinguishable from one honouring it, which is the failure this exists
   * to make loud.
   */
  async openStream(key: string, range?: ByteRange): Promise<StoredStream | null> {
    if (range && range.end < range.start) return null

    const opened = await this.client.openObject(this.checked(key), range)
    if (opened === null) return null

    return { stream: opened.body, contentType: OPAQUE_TYPE, length: opened.length }
  }

  async remove(key: string): Promise<void> {
    await this.client.deleteObject(this.checked(key))
  }
}

// ---------------------------------------------------------------------------

let cached: MediaStore | null | undefined

/**
 * The configured store, or null when there is none.
 *
 * Null is a first-class answer, not an error. A deployment with no media
 * storage is a supported state — the portal is complete without it — so the
 * callers ask, and the upload screens say what to set.
 */
export function mediaStore(): MediaStore | null {
  if (cached !== undefined) return cached

  const configured = env().MEDIA_STORE

  if (configured === 'object-store') {
    // Every one of these is guaranteed non-empty by the environment schema:
    // selecting the object store without them is a refusal to start, not a
    // client that gets built and fails on first use.
    cached = new ObjectMediaStore(
      new S3ObjectClient({
        endpoint: env().MEDIA_S3_ENDPOINT,
        region: env().MEDIA_S3_REGION,
        bucket: env().MEDIA_S3_BUCKET,
        accessKeyId: env().MEDIA_S3_ACCESS_KEY_ID,
        secretAccessKey: env().MEDIA_S3_SECRET_ACCESS_KEY,
      }),
    )
  } else if (configured === 'filesystem') {
    cached = new FilesystemMediaStore(env().MEDIA_DIR)
  } else {
    cached = null
  }

  return cached
}

/** Test-only. */
export function resetMediaStoreCache(): void {
  cached = undefined
}

export const MEDIA_STORE_UNCONFIGURED =
  'There is nowhere to put an uploaded file on this deployment. Set MEDIA_STORE to ' +
  '"filesystem" and MEDIA_DIR to a writable directory that survives a restart, then ' +
  'try again. Everything else in the portal works without it.'
