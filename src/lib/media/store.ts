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

import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { env } from '@/lib/env'
import { S3ObjectClient } from './s3'

export interface StoredObject {
  bytes: Uint8Array
  contentType: string
}

export interface MediaStore {
  /** Which implementation this is, for the settings screen to display. */
  readonly kind: 'filesystem' | 'object-store'
  /** One line describing where things are being written. Never a credential. */
  describe(): string
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  /**
   * Bytes `start` to `end`, both inclusive — the HTTP convention, because the
   * only caller is a route answering a `Range` header and translating twice is
   * how an off-by-one gets in.
   *
   * Null means the object is not there, exactly as `get` does. The caller has
   * already resolved the range against the recorded size, so a range outside
   * the object is a caller error rather than a case to answer.
   */
  getRange(key: string, start: number, end: number): Promise<StoredObject | null>
  /**
   * The same bytes as `get`/`getRange`, as a stream that is never all in
   * memory at once.
   *
   * This is what the routes use. `get` stays because several callers genuinely
   * want the bytes — the ingest verification reads a stored file to compare it,
   * and a caller that wants a `Uint8Array` should not have to drain a stream to
   * get one. `openStream` is for the one case where holding sixty megabytes to
   * hand them straight to a socket is the wrong shape.
   *
   * `range` is inclusive on both ends, as `getRange` is. Null means the object
   * is not there.
   */
  openStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null>
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
      return { bytes: new Uint8Array(bytes), contentType: 'application/octet-stream' }
    } catch {
      return null
    }
  }

  /**
   * Read only the bytes asked for, with a file handle and a position.
   *
   * Not `readFile` then `slice`. The point of a range request is that a
   * sixty-megabyte video does not have to be in memory for a browser to play
   * two seconds of it, and reading the whole file first would keep the correct
   * HTTP behaviour while throwing away the reason for it.
   */
  async getRange(key: string, start: number, end: number): Promise<StoredObject | null> {
    const file = this.resolve(key)
    const length = end - start + 1
    if (length <= 0) return null

    let handle
    try {
      handle = await open(file, 'r')
    } catch {
      return null
    }

    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      return {
        bytes: new Uint8Array(buffer.subarray(0, bytesRead)),
        contentType: 'application/octet-stream',
      }
    } finally {
      await handle.close()
    }
  }

  async openStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null> {
    const file = this.resolve(key)

    // Existence is checked before a stream is built, so a missing file is a
    // null here rather than an error event on a response that has already
    // begun — by which point the status line has gone and there is no way
    // left to say 404.
    try {
      await stat(file)
    } catch {
      return null
    }

    const stream = createReadStream(
      file,
      range ? { start: range.start, end: range.end } : undefined,
    )

    return Readable.toWeb(stream) as ReadableStream<Uint8Array>
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
    return { bytes, contentType: 'application/octet-stream' }
  }

  /**
   * A `Range` header on the GET, and a 206 back.
   *
   * The client refuses anything that is not a 206, rather than accepting a 200
   * and slicing it here. A store that ignores `Range` and sends the whole
   * object would otherwise look identical to one that honoured it, right up
   * until a sixty-megabyte video was being held in memory to serve two
   * seconds of it.
   */
  async getRange(key: string, start: number, end: number): Promise<StoredObject | null> {
    if (end < start) return null

    const bytes = await this.client.getObjectRange(this.checked(key), start, end)
    if (bytes === null) return null

    return { bytes, contentType: 'application/octet-stream' }
  }

  async openStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null> {
    return this.client.openObjectStream(this.checked(key), range)
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
