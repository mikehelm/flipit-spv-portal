import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetEnvCache } from '@/lib/env'
import {
  FakeS3,
  FAKE_S3_ACCESS_KEY_ID,
  FAKE_S3_BUCKET,
  FAKE_S3_REGION,
  FAKE_S3_SECRET,
} from '@/test/fake-s3'
import {
  EMPTY_PAYLOAD_SHA256,
  S3ObjectClient,
  buildCanonicalRequest,
  canonicalBucketUri,
  canonicalQueryString,
  parseListResult,
  signRequest,
  type S3Config,
} from './s3'
import { mediaStore, resetMediaStoreCache, type MediaStore } from './store'

/**
 * Listing: the question `pnpm media:check` could not ask.
 *
 * Every other read in this package starts from a key on a row — is the object
 * there, how big is it, give me its bytes. All of them are blind to the object
 * nobody has a row for, and that is the object worth finding: a document
 * package whose record was lost in a restore is an investor's subscription
 * agreement sitting in a bucket that nothing references, which is a retention
 * problem rather than an untidiness.
 *
 * Three things are worth testing carefully and are tested here.
 *
 * **Paging.** A client that ignores `NextContinuationToken` looks perfectly
 * correct against a store with three objects in it and silently reports a third
 * of a real bucket. So the fake pages properly and there is a test that walks
 * several pages.
 *
 * **The signature.** This is the first request in the client with a query
 * string in it, and a query string is part of what gets signed. The fake
 * re-derives the signature from the request as it arrived, so a client that
 * signed a different page than it asked for is refused over a real socket.
 *
 * **The parser.** Three regular expressions instead of an XML library, on the
 * same argument as the rest of the file — so the shapes it will not read need
 * to be written down.
 */

const ORIGINAL = { ...process.env }

const CONFIG: S3Config = {
  endpoint: 'https://s3.example.com',
  region: FAKE_S3_REGION,
  bucket: FAKE_S3_BUCKET,
  accessKeyId: FAKE_S3_ACCESS_KEY_ID,
  secretAccessKey: FAKE_S3_SECRET,
}

const FIXED = new Date('2026-07-25T23:00:00.000Z')

describe('signing a request about the bucket rather than an object in it', () => {
  it('the canonical query string is sorted and encoded', () => {
    expect(canonicalQueryString({ 'list-type': '2', 'max-keys': '10' })).toBe(
      'list-type=2&max-keys=10',
    )
    // Sorted by name, whatever order they were written in.
    expect(canonicalQueryString({ b: '1', a: '2' })).toBe('a=2&b=1')
    // Encoded the way a signature wants: a slash in a token is not a path.
    expect(canonicalQueryString({ 'continuation-token': 'a/b c+d' })).toBe(
      'continuation-token=a%2Fb%20c%2Bd',
    )
    expect(canonicalQueryString({})).toBe('')
  })

  it('the bucket URI has no trailing slash, because the request has none', () => {
    expect(canonicalBucketUri(FAKE_S3_BUCKET)).toBe(`/${FAKE_S3_BUCKET}`)
  })

  it('the canonical request for a listing is exactly this', () => {
    const { canonical } = buildCanonicalRequest({
      method: 'GET',
      uri: canonicalBucketUri(FAKE_S3_BUCKET),
      query: { 'list-type': '2', 'max-keys': '1000' },
      headers: {
        host: 's3.example.com',
        'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
        'x-amz-date': '20260725T230000Z',
      },
      payloadHash: EMPTY_PAYLOAD_SHA256,
    })

    expect(canonical).toBe(
      [
        'GET',
        `/${FAKE_S3_BUCKET}`,
        'list-type=2&max-keys=1000',
        'host:s3.example.com',
        `x-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}`,
        'x-amz-date:20260725T230000Z',
        '',
        'host;x-amz-content-sha256;x-amz-date',
        EMPTY_PAYLOAD_SHA256,
      ].join('\n'),
    )
  })

  /**
   * The one way this could go wrong quietly: a URL built from one rendering of
   * the query and a signature computed from another. It would work for
   * `list-type=2` and fail the first time a continuation token contained
   * something that encodes differently — which is to say, on the second page of
   * a large bucket and never in a test with three objects in it.
   */
  it('the URL carries exactly the query that was signed', () => {
    const signed = signRequest(CONFIG, {
      method: 'GET',
      query: { 'list-type': '2', 'continuation-token': 'a/b c' },
      now: FIXED,
    })

    expect(signed.url).toBe(
      `https://s3.example.com/${FAKE_S3_BUCKET}?continuation-token=a%2Fb%20c&list-type=2`,
    )
  })

  it('an object request is unchanged — no query, and a key in the path', () => {
    const signed = signRequest(CONFIG, {
      method: 'GET',
      key: 'img_AAAABBBBCCCCDDDDEEEEFFFF',
      now: FIXED,
    })

    expect(signed.url).toBe(
      `https://s3.example.com/${FAKE_S3_BUCKET}/img_AAAABBBBCCCCDDDDEEEEFFFF`,
    )
    expect(signed.url).not.toContain('?')
  })
})

describe('reading a ListBucketResult', () => {
  function result(inner: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${inner}</ListBucketResult>`
  }

  it('takes the key and the size out of each entry', () => {
    const parsed = parseListResult(
      result(
        '<Contents><Key>img_ONE</Key><Size>10</Size><ETag>"x"</ETag></Contents>' +
          '<Contents><Key>img_TWO</Key><Size>0</Size></Contents>' +
          '<IsTruncated>false</IsTruncated>',
      ),
    )

    expect(parsed.objects).toEqual([
      { key: 'img_ONE', sizeBytes: 10 },
      { key: 'img_TWO', sizeBytes: 0 },
    ])
    expect(parsed.nextToken).toBeNull()
  })

  it('unescapes a key, so a name with an ampersand is the name somebody sees', () => {
    const parsed = parseListResult(
      result('<Contents><Key>a&amp;b&lt;c&gt;d&quot;e&apos;f</Key><Size>1</Size></Contents>'),
    )

    expect(parsed.objects[0]!.key).toBe(`a&b<c>d"e'f`)
  })

  it('carries the continuation token only when there is more to come', () => {
    expect(
      parseListResult(
        result('<IsTruncated>true</IsTruncated><NextContinuationToken>tok</NextContinuationToken>'),
      ).nextToken,
    ).toBe('tok')

    // Truncated with no token would loop for ever: asking again without one
    // fetches the first page a second time. Treated as the end of the walk.
    expect(parseListResult(result('<IsTruncated>true</IsTruncated>')).nextToken).toBeNull()

    // A token with no truncation is not an invitation to ask again.
    expect(
      parseListResult(
        result(
          '<IsTruncated>false</IsTruncated><NextContinuationToken>tok</NextContinuationToken>',
        ),
      ).nextToken,
    ).toBeNull()
  })

  /**
   * Anything unreadable is dropped rather than guessed at, so a listing this
   * cannot parse produces fewer objects and never a wrong one. The totals are
   * then obviously short instead of subtly incorrect.
   */
  it('drops an entry it cannot read rather than inventing one', () => {
    const parsed = parseListResult(
      result(
        '<Contents><Key>ok</Key><Size>5</Size></Contents>' +
          '<Contents><Key></Key><Size>5</Size></Contents>' +
          '<Contents><Key>nosize</Key></Contents>' +
          '<Contents><Key>negative</Key><Size>-5</Size></Contents>' +
          '<Contents><Key>huge</Key><Size>99999999999999999999</Size></Contents>',
      ),
    )

    expect(parsed.objects).toEqual([{ key: 'ok', sizeBytes: 5 }])
  })

  it('an empty bucket is an empty list, not an error', () => {
    expect(parseListResult(result('<KeyCount>0</KeyCount>'))).toEqual({
      objects: [],
      nextToken: null,
    })
    expect(parseListResult('')).toEqual({ objects: [], nextToken: null })
  })
})

describe('listing a real bucket over a socket', () => {
  const fake = new FakeS3()
  let client: S3ObjectClient

  /**
   * The bucket these tests read, filled once.
   *
   * It used to be filled by the *first test in the file*, and every test below
   * it depended on that having run first. Nothing said so, and nothing enforced
   * the order — vitest runs the tests in a file in source order by default, so
   * it worked, invisibly, until the suite was run with `--sequence.shuffle` for
   * the first time and `stops at the caller's limit even mid-walk` read an
   * empty bucket and reported `[]`.
   *
   * A fixture built inside a test is a fixture the tests after it inherit. This
   * is the only place in this file where that mattered, and it is the reason
   * shuffling was worth doing at all.
   */
  beforeAll(async () => {
    await fake.start()
    client = new S3ObjectClient(fake.config())

    for (let n = 0; n < 25; n += 1) {
      const key = `img_PAGE${String(n).padStart(2, '0')}PAGEPAGEPAGEPA`
      await client.putObject(key, new Uint8Array(n + 1), 'image/png')
    }
  })

  afterAll(async () => {
    await fake.stop()
  })

  it('walks every page rather than reporting the first one', async () => {
    fake.requests = 0
    const listed = await client.listObjects(1000)

    expect(listed.objects).toHaveLength(25)
    expect(listed.truncated).toBe(false)
    expect(listed.objects[0]!.sizeBytes).toBe(1)
    expect(listed.objects[24]!.sizeBytes).toBe(25)

    // One request, because the page size is the protocol ceiling and 25 fits.
    expect(fake.requests).toBe(1)
  })

  /**
   * The assertion that matters most in this file. A client that ignores
   * `NextContinuationToken` passes every other test here — it returns the right
   * objects, in the right order, with the right sizes — and reports the first
   * thousand objects of a real bucket as though they were all of it. The fake
   * caps its page the way a real store does, so the walk is forced.
   */
  it('follows continuation tokens across several pages', async () => {
    fake.maxPageSize = 10
    try {
      fake.requests = 0
      const listed = await client.listObjects(1000)

      expect(listed.objects).toHaveLength(25)
      expect(listed.truncated).toBe(false)
      // Three pages of ten, ten and five, and no duplicates between them.
      expect(fake.requests).toBe(3)
      expect(new Set(listed.objects.map((object) => object.key)).size).toBe(25)
      expect(listed.objects[24]!.sizeBytes).toBe(25)
    } finally {
      fake.maxPageSize = 1000
    }
  })

  it('stops at the caller’s limit even mid-walk, and says it stopped', async () => {
    fake.maxPageSize = 10
    try {
      const listed = await client.listObjects(12)

      expect(listed.objects).toHaveLength(12)
      expect(listed.truncated).toBe(true)
    } finally {
      fake.maxPageSize = 1000
    }
  })

  it('a limit one short of the whole bucket still says there is more', async () => {
    const listed = await client.listObjects(24)

    expect(listed.objects).toHaveLength(24)
    expect(listed.truncated).toBe(true)
  })

  it('a key the application would never write is still reported', async () => {
    // Seeded straight into the store, because `put` refuses this shape — which
    // is exactly why a listing has to be willing to say it is there.
    fake.objects.set('somebody-elses-file.txt', { bytes: Buffer.alloc(7), contentType: 'text/plain' })

    const listed = await client.listObjects(1000)
    expect(listed.objects).toContainEqual({ key: 'somebody-elses-file.txt', sizeBytes: 7 })

    fake.objects.delete('somebody-elses-file.txt')
  })

  it('a limit of one is a limit of one, and says there is more', async () => {
    const listed = await client.listObjects(1)
    expect(listed.objects).toHaveLength(1)
    expect(listed.truncated).toBe(true)
  })
})

describe('listing a directory', () => {
  let directory = ''
  let store: MediaStore

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'spv-listing-'))
    process.env.MEDIA_STORE = 'filesystem'
    process.env.MEDIA_DIR = directory
    resetEnvCache()
    resetMediaStoreCache()
    store = mediaStore()!
  })

  afterAll(() => {
    for (const name of Object.keys(process.env)) {
      if (!(name in ORIGINAL)) delete process.env[name]
    }
    Object.assign(process.env, ORIGINAL)
    resetEnvCache()
    resetMediaStoreCache()
  })

  it('reports a file this application would never have written', async () => {
    await store.put('doc_REALREALREALREALREALR', new Uint8Array(5), 'application/pdf')
    await writeFile(path.join(directory, 'notes.txt'), 'left here by somebody')

    const listed = await store.list(1000)

    expect(listed.objects.map((object) => object.key)).toEqual([
      'doc_REALREALREALREALREALR',
      'notes.txt',
    ])
  })

  /**
   * A store pointed at a directory that does not exist yet is a fresh install,
   * not a fault. It has written nothing, which is a clean answer to "what is in
   * you" rather than an error about it.
   */
  it('a directory that does not exist yet is empty rather than an error', async () => {
    process.env.MEDIA_DIR = path.join(directory, 'not-created-yet')
    resetEnvCache()
    resetMediaStoreCache()

    expect(await mediaStore()!.list(10)).toEqual({ objects: [], truncated: false })

    process.env.MEDIA_DIR = directory
    resetEnvCache()
    resetMediaStoreCache()
  })
})
