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
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { env } from '@/lib/env'
import { S3ObjectClient } from './s3'

export interface StoredObject {
  bytes: Uint8Array
  contentType: string
}

/**
 * An object being read, rather than an object that has been read.
 *
 * `length` is how many bytes the stream will actually produce, taken from the
 * source itself — the `stat` the filesystem store already does to decide the
 * object exists, the `Content-Length` an object store sends anyway. Neither
 * costs an extra round trip.
 *
 * It is here because the alternative is a response whose `Content-Length` comes
 * from a database column. Those agree until the day they do not — a partial
 * write, a restored backup, an object replaced out of band — and on that day a
 * response promising more bytes than will arrive is a download that hangs
 * rather than one that ends. `pnpm media:check` exists precisely because that
 * state is considered reachable; this is the same fact applied to the response.
 * A range is still *resolved* against the recorded size. What is *promised* is
 * what the store has.
 */
export interface StoredStream {
  stream: ReadableStream<Uint8Array>
  length: number
}

/** One thing that is actually stored, as a listing describes it. */
export interface StoredObjectSummary {
  key: string
  sizeBytes: number
}

/** A stream that ends immediately. Not null: the object is there, and empty. */
function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
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
   * is not there — decided before a stream exists, because a stream that failed
   * part way through would already have sent a 200 and there is no way left to
   * say 404 after the status line has gone.
   *
   * A range that begins past the end of an object that *is* there is not null.
   * It is a stream of length zero, so that a caller can tell "gone" from
   * "shorter than the row claims" and answer each properly.
   */
  openStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<StoredStream | null>
  /**
   * How many bytes are actually stored under this key, without reading them.
   *
   * Null means the object is not there. This exists for one caller —
   * `pnpm media:check`, which compares what is in the store against the rows
   * that name it — and it is on the seam rather than in the script so that the
   * answer is the store's rather than the filesystem's.
   */
  stat(key: string): Promise<{ sizeBytes: number } | null>
  /**
   * Everything that is actually stored, up to a limit the caller states.
   *
   * The reverse of every other read here. `get`, `stat` and `openStream` all
   * start from a key on a row and ask whether the object is there; this starts
   * from the store and asks what is in it. It is the half of reconciliation
   * `pnpm media:check` could not do: an object no row points at is invisible to
   * a check that walks the rows, and an investor's subscription agreement
   * sitting in a bucket that nothing references is a retention problem rather
   * than a tidiness one.
   *
   * **The limit is required and the answer says whether it was reached.** A
   * bucket is not a directory somebody sized; holding all of one in memory
   * because a caller forgot a limit is how a report becomes an outage. A
   * `truncated` answer is a report that must say so.
   *
   * Keys are returned exactly as stored, including any that this application
   * would refuse to write. What to make of those is the caller's judgement, not
   * the store's — a stray file is a fact about the deployment.
   */
  list(limit: number): Promise<{ objects: StoredObjectSummary[]; truncated: boolean }>
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
  ): Promise<StoredStream | null> {
    const file = this.resolve(key)
    if (range && range.end < range.start) return null

    // Existence is checked before a stream is built, so a missing file is a
    // null here rather than an error event on a response that has already
    // begun — by which point the status line has gone and there is no way
    // left to say 404. The size comes back from the same call, so knowing how
    // long the answer will be costs nothing extra.
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      return null
    }

    const start = range ? range.start : 0
    // Clamped, never extended: a range whose end is past the last byte gets
    // what is there, which is what the specification says to do.
    const end = Math.min(range ? range.end : size - 1, size - 1)
    const length = Math.max(0, end - start + 1)

    if (length === 0) return { stream: emptyStream(), length: 0 }

    return {
      stream: Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>,
      length,
    }
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    const file = this.resolve(key)

    try {
      return { sizeBytes: (await stat(file)).size }
    } catch {
      return null
    }
  }

  /**
   * What is in the directory, with the sizes, sorted.
   *
   * Sorted because two runs of the same check on the same store should produce
   * the same report, and `readdir` does not promise an order. A subdirectory is
   * skipped: nothing here writes one, and recursing would be inventing a
   * meaning for a thing somebody else put there.
   *
   * A directory that does not exist yet lists as empty rather than failing. A
   * store configured on a fresh machine has written nothing, which is a clean
   * answer to the question, not an error about it.
   */
  async list(limit: number): Promise<{ objects: StoredObjectSummary[]; truncated: boolean }> {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('A listing needs a positive limit of how many to hold.')
    }

    let entries: string[]
    try {
      entries = await readdir(this.root)
    } catch {
      return { objects: [], truncated: false }
    }

    entries.sort()

    const objects: StoredObjectSummary[] = []

    for (const entry of entries) {
      let size: number
      try {
        const found = await stat(path.join(this.root, entry))
        if (!found.isFile()) continue
        size = found.size
      } catch {
        // Removed between the read of the directory and the read of the file.
        // It is not there now, which is the answer this is collecting.
        continue
      }

      if (objects.length === limit) return { objects, truncated: true }
      objects.push({ key: entry, sizeBytes: size })
    }

    return { objects, truncated: false }
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
  ): Promise<StoredStream | null> {
    if (range && range.end < range.start) return null

    return this.client.openObjectStream(this.checked(key), range)
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    return this.client.headObject(this.checked(key))
  }

  /**
   * The bucket's own account of what is in it.
   *
   * No key validation here, deliberately: this is the one read that is not
   * about a key this application chose, and refusing to report an object
   * because its name is one we would not have written is refusing to report
   * exactly the object worth reporting.
   */
  async list(limit: number): Promise<{ objects: StoredObjectSummary[]; truncated: boolean }> {
    return this.client.listObjects(limit)
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
