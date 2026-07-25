import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EMPTY_PAYLOAD_SHA256,
  S3ObjectClient,
  S3RequestError,
  amzTimestamps,
  buildCanonicalRequest,
  buildStringToSign,
  canonicalUri,
  credentialScope,
  deriveSigningKey,
  encodeSegment,
  signRequest,
  signingKey,
  verifySignature,
  type S3Config,
} from './s3'
import { FAKE_S3_ACCESS_KEY_ID, FAKE_S3_BUCKET, FAKE_S3_REGION, FAKE_S3_SECRET, FakeS3 } from '@/test/fake-s3'

/**
 * The object store, in three layers.
 *
 * 1. **The signature, pinned.** A canonical request and a string-to-sign
 *    written out character for character, and a signature that is a fixed hex
 *    string for a fixed clock. These are golden tests in the strict sense: they
 *    do not prove the algorithm is AWS's, they prove that what this file
 *    computes today is what it computed when somebody read it. Changing one is
 *    a deliberate act with a diff attached.
 * 2. **A real HTTP round-trip**, against a server stood up in this process that
 *    re-derives the signature from the secret and rejects anything it cannot
 *    reproduce. Put, get, delete and absence, over a socket.
 * 3. **What must never come out** — a credential in a description, in an error,
 *    or in a URL that gets thrown.
 */

const CONFIG: S3Config = {
  endpoint: 'https://s3.example.com',
  region: FAKE_S3_REGION,
  bucket: FAKE_S3_BUCKET,
  accessKeyId: FAKE_S3_ACCESS_KEY_ID,
  secretAccessKey: FAKE_S3_SECRET,
}

const FIXED = new Date('2026-07-25T23:00:00.000Z')
const KEY = 'img_AAAABBBBCCCCDDDDEEEEFFFF'

describe('the signature, written down', () => {
  it('the empty payload hash is SHA-256 of nothing', () => {
    expect(EMPTY_PAYLOAD_SHA256).toBe(createHash('sha256').update('').digest('hex'))
  })

  it('a timestamp is the two forms AWS asks for', () => {
    expect(amzTimestamps(FIXED)).toEqual({ amzDate: '20260725T230000Z', datestamp: '20260725' })
  })

  it('a segment encoder that finishes what encodeURIComponent leaves', () => {
    expect(encodeSegment("a!b'c(d)e*f")).toBe('a%21b%27c%28d%29e%2Af')
    // Every key this application mints passes through unchanged.
    expect(encodeSegment(KEY)).toBe(KEY)
    // And a slash cannot survive into the path.
    expect(encodeSegment('a/b')).toBe('a%2Fb')
  })

  it('the canonical URI is /bucket/key', () => {
    expect(canonicalUri(CONFIG.bucket, KEY)).toBe(`/${CONFIG.bucket}/${KEY}`)
  })

  it('the canonical request is exactly this', () => {
    const { canonical, signedHeaders } = buildCanonicalRequest({
      method: 'GET',
      uri: canonicalUri(CONFIG.bucket, KEY),
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
        `/${CONFIG.bucket}/${KEY}`,
        '',
        'host:s3.example.com',
        `x-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}`,
        'x-amz-date:20260725T230000Z',
        '',
        'host;x-amz-content-sha256;x-amz-date',
        EMPTY_PAYLOAD_SHA256,
      ].join('\n'),
    )

    expect(signedHeaders).toBe('host;x-amz-content-sha256;x-amz-date')
  })

  it('headers are sorted and folded regardless of the order they arrive in', () => {
    const { canonical, signedHeaders } = buildCanonicalRequest({
      method: 'PUT',
      uri: '/b/k',
      headers: {
        'x-amz-date': '20260725T230000Z',
        'Content-Type': '  image/png   ',
        host: 's3.example.com',
        'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
      },
      payloadHash: EMPTY_PAYLOAD_SHA256,
    })

    expect(signedHeaders).toBe('content-type;host;x-amz-content-sha256;x-amz-date')
    expect(canonical).toContain('content-type:image/png\n')
  })

  it('the string to sign is exactly this', () => {
    const scope = credentialScope('20260725', CONFIG.region)
    expect(scope).toBe('20260725/eu-west-2/s3/aws4_request')

    expect(buildStringToSign('CANONICAL', '20260725T230000Z', scope)).toBe(
      [
        'AWS4-HMAC-SHA256',
        '20260725T230000Z',
        '20260725/eu-west-2/s3/aws4_request',
        createHash('sha256').update('CANONICAL').digest('hex'),
      ].join('\n'),
    )
  })

  /**
   * **The one test here that is not self-referential.**
   *
   * Everything else in this block pins what this file computes against what it
   * computed yesterday, which catches a regression and proves nothing about
   * whether the algorithm is AWS's. This vector is AWS's own — the worked
   * example from their "deriving the signing key" documentation, with their
   * example secret, their date, their region and their service — and the
   * expected value is published rather than observed. If the four-step HMAC
   * chain here were subtly wrong, this is the assertion that would say so.
   */
  it('the derivation reproduces AWS’s own published signing-key vector', () => {
    // AWS's worked example uses the `iam` service; `signingKey` is this same
    // function closed over `s3`, so the chain under test is the one in use.
    expect(
      deriveSigningKey(
        'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        '20110909',
        'us-east-1',
        'iam',
      ).toString('hex'),
    ).toBe('98f1d889fec4f4421adc522bab0ce1f82e6929c262ed15e5a94c90efd1e3b0e7')

    expect(signingKey('secret', '20260725', 'eu-west-2')).toEqual(
      deriveSigningKey('secret', '20260725', 'eu-west-2', 's3'),
    )
  })

  it('the signing key is the four-step derivation, and it is stable', () => {
    expect(signingKey(CONFIG.secretAccessKey, '20260725', CONFIG.region).toString('hex')).toBe(
      'b40a086b24815cab4245e01fa306a8c500e9feea3b019f1abfbcf826cef2c894',
    )
  })

  it('a signed GET is byte-for-byte this, for this clock', () => {
    const signed = signRequest(CONFIG, { method: 'GET', key: KEY, now: FIXED })

    expect(signed.url).toBe(`https://s3.example.com/${CONFIG.bucket}/${KEY}`)
    expect(signed.headers['x-amz-date']).toBe('20260725T230000Z')
    expect(signed.headers['x-amz-content-sha256']).toBe(EMPTY_PAYLOAD_SHA256)
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 ' +
        `Credential=${CONFIG.accessKeyId}/20260725/eu-west-2/s3/aws4_request, ` +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=4e86e5265ec27abb9b02e617c0ac9ff0cd0929589f0be7c1da74efd03a29a5d2',
    )
  })

  it('a PUT hashes the body rather than the empty string, and carries the type', () => {
    const body = new Uint8Array([1, 2, 3, 4])
    const signed = signRequest(CONFIG, {
      method: 'PUT',
      key: KEY,
      body,
      contentType: 'image/png',
      now: FIXED,
    })

    expect(signed.headers['x-amz-content-sha256']).toBe(
      createHash('sha256').update(body).digest('hex'),
    )
    expect(signed.headers['x-amz-content-sha256']).not.toBe(EMPTY_PAYLOAD_SHA256)
    expect(signed.headers['content-type']).toBe('image/png')
    expect(signed.headers.authorization).toContain('SignedHeaders=content-type;host;')
  })

  it('one different byte of body is a different signature', () => {
    const one = signRequest(CONFIG, {
      method: 'PUT',
      key: KEY,
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: 'image/png',
      now: FIXED,
    })
    const other = signRequest(CONFIG, {
      method: 'PUT',
      key: KEY,
      body: new Uint8Array([1, 2, 3, 5]),
      contentType: 'image/png',
      now: FIXED,
    })

    expect(one.headers.authorization).not.toBe(other.headers.authorization)
  })

  it('a different secret is a different signature, and the secret never appears in one', () => {
    const other = signRequest(
      { ...CONFIG, secretAccessKey: 'a-different-secret' },
      { method: 'GET', key: KEY, now: FIXED },
    )

    expect(other.headers.authorization).not.toContain(CONFIG.secretAccessKey)
    expect(
      signRequest(CONFIG, { method: 'GET', key: KEY, now: FIXED }).headers.authorization,
    ).not.toBe(other.headers.authorization)
  })

  it('the verifier accepts what the signer produced and refuses a tampered one', () => {
    const signed = signRequest(CONFIG, { method: 'GET', key: KEY, now: FIXED })

    expect(
      verifySignature(CONFIG, { method: 'GET', key: KEY, amzDate: '20260725T230000Z' }, signed.headers.authorization!),
    ).toBe(true)

    // A different key, the same signature.
    expect(
      verifySignature(
        CONFIG,
        { method: 'GET', key: 'img_ZZZZBBBBCCCCDDDDEEEEFFFF', amzDate: '20260725T230000Z' },
        signed.headers.authorization!,
      ),
    ).toBe(false)

    expect(verifySignature(CONFIG, { method: 'GET', key: KEY, amzDate: '20260725T230000Z' }, 'nonsense')).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('a round trip over a real socket', () => {
  const fake = new FakeS3()

  beforeAll(async () => {
    await fake.start()
  })

  afterAll(async () => {
    await fake.stop()
  })

  it('puts bytes the server can verify, and gets exactly them back', async () => {
    const client = new S3ObjectClient(fake.config())
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

    await client.putObject(KEY, bytes, 'image/png')

    expect(fake.objects.get(KEY)?.contentType).toBe('image/png')
    expect(await client.getObject(KEY)).toEqual(bytes)
  })

  it('a key that was never put is null, not an error', async () => {
    const client = new S3ObjectClient(fake.config())
    expect(await client.getObject('img_NEVERSTOREDNEVERSTORED')).toBeNull()
  })

  it('delete removes it, and deleting it again is still fine', async () => {
    const client = new S3ObjectClient(fake.config())
    await client.putObject('img_TODELETETODELETETODELETE', new Uint8Array([9]), 'image/png')

    await client.deleteObject('img_TODELETETODELETETODELETE')
    expect(await client.getObject('img_TODELETETODELETETODELETE')).toBeNull()

    await expect(client.deleteObject('img_TODELETETODELETETODELETE')).resolves.toBeUndefined()
  })

  it('a ranged get asks for and receives exactly those bytes', async () => {
    const client = new S3ObjectClient(fake.config())
    const bytes = new Uint8Array(64)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i

    await client.putObject('img_RANGEDGETRANGEDGETRANG', bytes, 'application/octet-stream')

    expect([...(await client.getObjectRange('img_RANGEDGETRANGEDGETRANG', 0, 1))!]).toEqual([0, 1])
    expect([...(await client.getObjectRange('img_RANGEDGETRANGEDGETRANG', 63, 63))!]).toEqual([63])
    expect((await client.getObjectRange('img_RANGEDGETRANGEDGETRANG', 0, 63))!.length).toBe(64)
  })

  it('a ranged get of something absent is null', async () => {
    const client = new S3ObjectClient(fake.config())
    expect(await client.getObjectRange('img_ABSENTABSENTABSENTABSE', 0, 9)).toBeNull()
  })

  /**
   * The failure mode this strictness exists for: a store that ignores `Range`
   * answers 200 with the whole object, and a client that quietly sliced that
   * would be indistinguishable from one honouring the range — until a
   * sixty-megabyte video was in memory to serve two seconds of it.
   */
  it('a store that ignores the range is an error, not a silent whole-file read', async () => {
    const client = new S3ObjectClient(fake.config())
    await client.putObject('img_IGNOREDIGNOREDIGNORED', new Uint8Array(32), 'application/octet-stream')

    fake.ignoreRanges = true
    try {
      await expect(client.getObjectRange('img_IGNOREDIGNOREDIGNORED', 0, 1)).rejects.toThrow(
        /ignored a range request/,
      )
    } finally {
      fake.ignoreRanges = false
    }
  })

  it('a wrong secret is refused by the server, and the refusal names the code and not the body', async () => {
    const client = new S3ObjectClient(fake.config('the-wrong-secret'))

    await expect(client.putObject(KEY, new Uint8Array([1]), 'image/png')).rejects.toThrow(
      /SignatureDoesNotMatch/,
    )
  })

  it('a 500 is retried and the retry is allowed to succeed', async () => {
    const client = new S3ObjectClient(fake.config())
    fake.requests = 0
    fake.failures.push(503, 500)

    await client.putObject('img_RETRIEDRETRIEDRETRIEDXX', new Uint8Array([7, 7]), 'image/png')

    expect(fake.requests).toBe(3)
    expect(fake.objects.get('img_RETRIEDRETRIEDRETRIEDXX')?.bytes).toEqual(Buffer.from([7, 7]))
  })

  /**
   * The failure this test exists for is a quiet one: a deployment pointed at a
   * bucket that does not exist answers 404 to every request, and a client that
   * reads 404 as "not there" would show an empty media library and a missing
   * document on every investor's record — a portal that looks like it has lost
   * the files rather than one that is misconfigured.
   */
  it('a 404 that means the wrong bucket is an error, not an absence', async () => {
    const client = new S3ObjectClient({ ...fake.config(), bucket: 'a-bucket-that-is-not-ours' })
    fake.requests = 0

    await expect(client.getObject(KEY)).rejects.toThrow(/NoSuchBucket/)
    // Not retried. A 4xx is an answer, and asking again gets the same one.
    expect(fake.requests).toBe(1)

    await expect(client.deleteObject(KEY)).rejects.toThrow(/NoSuchBucket/)
  })

  it('a 404 that means the key is absent is still null, and a delete of it still fine', async () => {
    const client = new S3ObjectClient(fake.config())

    expect(await client.getObject('img_ABSENTABSENTABSENTABSENT')).toBeNull()
    await expect(client.deleteObject('img_ABSENTABSENTABSENTABSENT')).resolves.toBeUndefined()
  })

  it('a store that never answers gives up and says nothing was stored', async () => {
    const client = new S3ObjectClient({ ...CONFIG, endpoint: 'http://127.0.0.1:1' })

    await expect(client.putObject(KEY, new Uint8Array([1]), 'image/png')).rejects.toThrow(
      /Nothing has been stored/,
    )
  })

  it('an exhausted retry of 5xx surfaces the status', async () => {
    const client = new S3ObjectClient(fake.config())
    fake.failures.push(500, 502, 503)

    await expect(client.getObject(KEY)).rejects.toBeInstanceOf(S3RequestError)
  })
})

// ---------------------------------------------------------------------------

describe('what must never come out of this file — checklist 8', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/lib/media/s3.ts'), 'utf8')

  it('nothing in it logs', () => {
    expect(source).not.toMatch(/console\.(log|info|warn|error|debug)/)
  })

  it('the description carries the endpoint and the bucket, and neither key', () => {
    const described = new S3ObjectClient(CONFIG).describe()

    expect(described).toContain(CONFIG.bucket)
    expect(described).not.toContain(CONFIG.secretAccessKey)
    expect(described).not.toContain(CONFIG.accessKeyId)
  })

  it('a thrown error carries neither key, nor a signature, nor a URL', async () => {
    const fake = new FakeS3()
    await fake.start()

    try {
      const client = new S3ObjectClient(fake.config('the-wrong-secret'))
      const error = await client.getObject(KEY).catch((caught: unknown) => caught)
      const rendered = `${String(error)} ${JSON.stringify(error)}`

      expect(rendered).not.toContain('the-wrong-secret')
      expect(rendered).not.toContain(CONFIG.accessKeyId)
      expect(rendered).not.toMatch(/Signature=/)
      expect(rendered).not.toMatch(/AWS4-HMAC/)
      expect(rendered).not.toMatch(/127\.0\.0\.1/)
    } finally {
      await fake.stop()
    }
  })

  it('an error body reaches the message only as a code, and only letters of one', async () => {
    const server = createServer((_request, response) => {
      response
        .writeHead(400)
        .end(
          '<Error><Code>Malformed</Code><StringToSign>AWS4-HMAC-SHA256\n' +
            'secret-looking-nonsense</StringToSign></Error>',
        )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const client = new S3ObjectClient({ ...CONFIG, endpoint: `http://127.0.0.1:${port}` })
      const error = await client.getObject(KEY).catch((caught: unknown) => caught)

      expect(String(error)).toContain('Malformed')
      expect(String(error)).not.toContain('StringToSign')
      expect(String(error)).not.toContain('secret-looking-nonsense')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('the signature is compared in constant time', () => {
    expect(source).toContain('timingSafeEqual')
  })

  it('a signed request never follows a redirect somewhere it was not signed for', () => {
    expect(source).toContain("redirect: 'error'")
  })
})
