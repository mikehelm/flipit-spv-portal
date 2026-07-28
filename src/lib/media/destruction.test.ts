import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEnvCache } from '@/lib/env'
import { reconcile, type TrackedFile } from './reconcile'
import { mediaStore, resetMediaStoreCache, type MediaStore } from './store'

/**
 * Whether the filesystem store tells the truth about a delete that failed.
 *
 * `remove()` was one `rm` inside a `try` with an empty `catch`, commented
 * *"Removing something that is not there is the state we wanted"* — which is
 * the right thing to say about `ENOENT` and was being said about every other
 * failure as well. A read-only mount, a permission the process does not have, a
 * directory where a file should be: each one returned quietly, and the caller
 * counted the object as destroyed.
 *
 * The caller that matters is `eraseAccount`. It reports *"1 stored file was
 * destroyed and cannot be recovered"* on the strength of `remove()` returning,
 * about a person who has asked to be erased. The object store has always
 * distinguished absence from refusal — `deleteObject` checks that a 404 really
 * is an absence before it accepts one — so the two implementations of one
 * interface disagreed, and the one that failed towards reassurance was the
 * default.
 *
 * **Producing a real failure is the awkward part of testing this.** These run
 * as whatever user the suite runs as, and on a container that is often root, so
 * `chmod` proves nothing: root ignores it. What does fail for anybody is a
 * directory where `rm` expects a file, and a symlink loop where `stat` expects
 * a file. Neither is a likely production fault; both take exactly the branch a
 * production fault would, which is what is being tested.
 */

let root: string
let store: MediaStore
let previous: string | undefined

const KEY = 'img_DESTRUCTIONTESTKEYAAAA'
const OTHER = 'img_DESTRUCTIONTESTKEYBBBB'

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'spv-destruction-'))
  previous = process.env.MEDIA_STORE
  process.env.MEDIA_STORE = 'filesystem'
  process.env.MEDIA_DIR = root
  resetEnvCache()
  resetMediaStoreCache()
  store = mediaStore()!
})

afterEach(async () => {
  if (previous === undefined) delete process.env.MEDIA_STORE
  else process.env.MEDIA_STORE = previous
  delete process.env.MEDIA_DIR
  resetEnvCache()
  resetMediaStoreCache()
  await rm(root, { recursive: true, force: true })
})

describe('removing something that is not there', () => {
  it('is not an error, because it is the state that was wanted', async () => {
    // The whole reason the catch existed, and it still holds. It is also what
    // makes a half-finished erasure re-runnable: a second pass reaches keys the
    // first one already destroyed and must not stop on them.
    await expect(store.remove(KEY)).resolves.toBeUndefined()
  })

  it('and neither is removing it twice', async () => {
    await store.put(KEY, new TextEncoder().encode('x'), 'image/png')
    await store.remove(KEY)
    await expect(store.remove(KEY)).resolves.toBeUndefined()
  })
})

describe('removing something that will not go', () => {
  async function blockTheKey(): Promise<void> {
    // A directory where the object should be. `rm` without `recursive` refuses
    // it with ERR_FS_EISDIR, for root and for everybody else.
    await mkdir(path.join(root, KEY), { recursive: true })
    await writeFile(path.join(root, KEY, 'in-the-way'), 'x')
  }

  it('throws rather than returning as though it had gone', async () => {
    await blockTheKey()
    await expect(store.remove(KEY)).rejects.toThrow()
  })

  it('and says which errno, because that is the whole diagnosis', async () => {
    // EACCES, EROFS and ERR_FS_EISDIR are three different things to go and fix.
    await blockTheKey()
    await expect(store.remove(KEY)).rejects.toThrow(/ERR_FS_EISDIR/)
  })

  it('and never quotes the path, because the last segment of it is the key', async () => {
    /*
     * A storage key is a capability: the image route serves an object to
     * anybody holding one, with no session. `rm` puts the full path in its
     * message, this message reaches `pnpm media:check`'s output and the
     * `unreadable` list in its report, and from there a log file.
     */
    await blockTheKey()
    await expect(store.remove(KEY)).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(KEY) as unknown as string,
      }),
    )
  })

  it('and the root directory is not in the message either', async () => {
    await blockTheKey()
    const thrown = await store
      .remove(KEY)
      .then(() => null)
      .catch((error: unknown) => error as Error)
    expect(thrown).not.toBeNull()
    expect(thrown!.message).not.toContain(root)
  })
})

describe('asking about something that will not answer', () => {
  it('is null when it is simply not there', async () => {
    expect(await store.stat(KEY)).toBeNull()
  })

  it('but throws when the store refuses the question', async () => {
    /*
     * `reconcile` keeps `missing` and `unreadable` apart on purpose: one is
     * *the record survived and the object did not*, the other is *the store
     * would not say*. They have different remedies. A blanket swallow here
     * routed every refusal into `missing`, which reads as "the file is gone"
     * about a file that is present and unreadable.
     */
    await symlink(path.join(root, OTHER), path.join(root, KEY))
    await symlink(path.join(root, KEY), path.join(root, OTHER))
    await expect(store.stat(KEY)).rejects.toThrow(/ELOOP/)
  })

  it('and a refusal is counted as unreadable rather than as missing', async () => {
    await symlink(path.join(root, OTHER), path.join(root, KEY))
    await symlink(path.join(root, KEY), path.join(root, OTHER))

    const row: TrackedFile = {
      what: 'document',
      id: 'doc_row',
      label: 'Subscription agreement (issued)',
      storageKey: KEY,
      sizeBytes: 11,
    }

    const result = await reconcile(store, [row])
    expect(result.missing).toHaveLength(0)
    expect(result.unreadable).toHaveLength(1)
    expect(result.unreadable[0]?.reason).toMatch(/ELOOP/)
    expect(result.problems).toBeGreaterThan(0)
  })

  it('and the reason it records carries no path', async () => {
    await symlink(path.join(root, OTHER), path.join(root, KEY))
    await symlink(path.join(root, KEY), path.join(root, OTHER))

    const result = await reconcile(store, [
      { what: 'image', id: 'img_row', label: 'A picture', storageKey: KEY, sizeBytes: 1 },
    ])
    expect(result.unreadable[0]?.reason).not.toContain(KEY)
    expect(result.unreadable[0]?.reason).not.toContain(root)
  })
})

describe('the ordinary path is unchanged', () => {
  it('a file that is there is destroyed and then is not there', async () => {
    await store.put(KEY, new TextEncoder().encode('hello'), 'image/png')
    expect(await store.stat(KEY)).toEqual({ sizeBytes: 5 })
    await store.remove(KEY)
    expect(await store.stat(KEY)).toBeNull()
  })

  it('and removing one leaves its neighbour alone', async () => {
    await store.put(KEY, new TextEncoder().encode('one'), 'image/png')
    await store.put(OTHER, new TextEncoder().encode('two'), 'image/png')
    await store.remove(KEY)
    expect(await store.stat(OTHER)).toEqual({ sizeBytes: 3 })
  })
})
