/**
 * A small S3-compatible client, and why it is written out by hand.
 *
 * `store.ts` has always declared an object store and always refused to be one.
 * The refusal was honest — a stub that returned success would have lost files —
 * but it is also the last thing standing between this application and a
 * deployment that has no persistent disk, which is every serverless one. This
 * is the class the refusal was a placeholder for.
 *
 * **Written rather than installed.** The AWS SDK is tens of megabytes and
 * pulls a credential-resolution chain that reads instance metadata, shared
 * config files and environment variables this application deliberately does not
 * use. What is actually needed here is three verbs — put, get, delete — and one
 * signature algorithm, and the signature algorithm is forty lines. A dependency
 * that large, for that little, on a path that handles an investor's documents,
 * is a worse trade than writing it down where it can be read.
 *
 * **Path style, not virtual host.** The address is `endpoint/bucket/key`.
 * Virtual-host addressing (`bucket.endpoint/key`) needs a DNS entry and a
 * wildcard certificate per bucket, and is the one of the two that S3, R2, MinIO
 * and Backblaze do *not* all support identically. Path style is understood by
 * all of them.
 *
 * **Nothing here logs.** Not a URL, not a header, not a response body. An S3
 * error body for a bad signature quotes the string that was signed back at you,
 * and while that is not the secret it is derived from a request that carried
 * one. Failures surface as a status and, when the body offers one, an error
 * code matched out of it by a strict pattern — never the body itself.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export interface S3Config {
  /** Scheme and host, no trailing slash. e.g. https://s3.eu-west-2.amazonaws.com */
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

const ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'

/** SHA-256 of the empty string. The payload hash of every GET and DELETE here. */
export const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function sha256Hex(input: Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex')
}

function hmac(key: Uint8Array | string, message: string): Buffer {
  return createHmac('sha256', key).update(message, 'utf8').digest()
}

/**
 * Percent-encode one path segment the way S3 canonicalisation wants it.
 *
 * `encodeURIComponent` leaves `!'()*` alone and S3 does not, so those four are
 * finished by hand. Every storage key this application mints is base64url and
 * every character of one is already unreserved, so in practice this is the
 * identity function — it is here because "in practice" is not a guarantee, and
 * a bucket name typed into an environment variable is not something this file
 * gets to choose.
 */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function canonicalUri(bucket: string, key: string): string {
  return `/${encodeSegment(bucket)}/${encodeSegment(key)}`
}

/** `20260725T230000Z` and `20260725`. */
export function amzTimestamps(now: Date): { amzDate: string; datestamp: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { amzDate, datestamp: amzDate.slice(0, 8) }
}

export interface CanonicalInput {
  method: 'PUT' | 'GET' | 'DELETE'
  uri: string
  /** Lowercase header names to values. Must include `host` and `x-amz-*`. */
  headers: Readonly<Record<string, string>>
  payloadHash: string
}

export function buildCanonicalRequest(input: CanonicalInput): {
  canonical: string
  signedHeaders: string
} {
  // Lowercased first, then sorted, then read from the lowercased map. Sorting
  // the lowercased names but reading the original map is a bug that only shows
  // up when a caller passes `Content-Type` rather than `content-type`, which is
  // exactly the sort of thing a caller does.
  const lowered: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.headers)) {
    lowered[name.toLowerCase()] = value
  }

  const names = Object.keys(lowered).sort()

  const canonicalHeaders = names
    .map((name) => `${name}:${lowered[name]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('')

  const signedHeaders = names.join(';')

  const canonical = [
    input.method,
    input.uri,
    // No query string is ever sent. An empty line, not an omitted one.
    '',
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n')

  return { canonical, signedHeaders }
}

export function buildStringToSign(
  canonical: string,
  amzDate: string,
  scope: string,
): string {
  return [ALGORITHM, amzDate, scope, sha256Hex(canonical)].join('\n')
}

export function credentialScope(datestamp: string, region: string): string {
  return `${datestamp}/${region}/${SERVICE}/aws4_request`
}

/**
 * The four-step HMAC chain, with the service left open.
 *
 * Nothing here signs for anything but S3 — `signingKey` below closes it over
 * the one service this file uses. The parameter exists so that the chain can be
 * checked against AWS's own published worked example, which is for `iam`. A
 * derivation that can only be tested against itself is a derivation nobody has
 * actually checked.
 */
export function deriveSigningKey(
  secretAccessKey: string,
  datestamp: string,
  region: string,
  service: string,
): Buffer {
  const date = hmac(`AWS4${secretAccessKey}`, datestamp)
  const regional = hmac(date, region)
  const scoped = hmac(regional, service)
  return hmac(scoped, 'aws4_request')
}

export function signingKey(
  secretAccessKey: string,
  datestamp: string,
  region: string,
): Buffer {
  return deriveSigningKey(secretAccessKey, datestamp, region, SERVICE)
}

export interface SignedRequest {
  url: string
  headers: Record<string, string>
}

/**
 * Sign one request. Pure — no clock, no network, no environment.
 *
 * `now` is a parameter rather than read from the clock so the golden tests can
 * pin an exact canonical request and an exact signature. A signing routine
 * whose output cannot be written down is a signing routine nobody reviews.
 */
export function signRequest(
  config: S3Config,
  request: {
    method: 'PUT' | 'GET' | 'DELETE'
    key: string
    body?: Uint8Array
    contentType?: string
    now: Date
  },
): SignedRequest {
  const { amzDate, datestamp } = amzTimestamps(request.now)
  const uri = canonicalUri(config.bucket, request.key)
  const host = new URL(config.endpoint).host
  const payloadHash = request.body ? sha256Hex(request.body) : EMPTY_PAYLOAD_SHA256

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }

  if (request.contentType) headers['content-type'] = request.contentType

  const { canonical, signedHeaders } = buildCanonicalRequest({
    method: request.method,
    uri,
    headers,
    payloadHash,
  })

  const scope = credentialScope(datestamp, config.region)
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, datestamp, config.region))
    .update(buildStringToSign(canonical, amzDate, scope), 'utf8')
    .digest('hex')

  return {
    url: `${config.endpoint.replace(/\/+$/, '')}${uri}`,
    headers: {
      ...headers,
      authorization:
        `${ALGORITHM} Credential=${config.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }
}

/**
 * Recompute a signature and compare it in constant time.
 *
 * This is the verifier's half, and it exists for the tests: the round-trip
 * suite stands a real HTTP server up and has it reject anything it cannot
 * re-sign, so "the client sent a well-formed signed request" is checked by
 * something other than the client's own assertion about itself. It is exported
 * because a test importing it is better than a test copying it.
 */
export function verifySignature(
  config: S3Config,
  received: { method: 'PUT' | 'GET' | 'DELETE'; key: string; body?: Uint8Array; contentType?: string; amzDate: string },
  authorization: string,
): boolean {
  const offered = /Signature=([0-9a-f]{64})$/.exec(authorization)?.[1]
  if (!offered) return false

  const now = new Date(
    `${received.amzDate.slice(0, 4)}-${received.amzDate.slice(4, 6)}-${received.amzDate.slice(6, 8)}` +
      `T${received.amzDate.slice(9, 11)}:${received.amzDate.slice(11, 13)}:${received.amzDate.slice(13, 15)}Z`,
  )

  const expected = /Signature=([0-9a-f]{64})$/.exec(
    signRequest(config, { ...received, now }).headers.authorization!,
  )?.[1]

  if (!expected) return false

  return timingSafeEqual(Buffer.from(offered, 'hex'), Buffer.from(expected, 'hex'))
}

// ---------------------------------------------------------------------------

export class S3RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'S3RequestError'
  }
}

/**
 * The error code out of an S3 error body, and nothing else out of it.
 *
 * A `SignatureDoesNotMatch` body quotes the canonical request and the string
 * that was signed. That is not the secret, but it is a rendering of a request
 * that carried one, and it has no business in an exception somebody will print.
 * The pattern admits letters only and at most sixty-four of them, so the worst
 * a hostile endpoint can put in a message is a made-up error code.
 */
function errorCodeFrom(body: string): string | null {
  return /<Code>([A-Za-z]{1,64})<\/Code>/.exec(body)?.[1] ?? null
}

const ATTEMPTS = 3
const BACKOFF_MS = [100, 400]
const TIMEOUT_MS = 30_000

/**
 * Put, get and delete against an S3-compatible endpoint.
 *
 * Every verb is idempotent — a PUT writes the same bytes to the same key, a
 * DELETE of something absent is the state that was wanted — so a retry after a
 * transient failure cannot do half of something twice. Retries are for 5xx and
 * for a connection that never answered. A 4xx is not retried: it is an answer,
 * and asking again will get the same one.
 */
export class S3ObjectClient {
  constructor(private readonly config: S3Config) {}

  /** Never a credential. The settings screen shows this. */
  describe(): string {
    return `${this.config.endpoint}/${this.config.bucket}`
  }

  private async send(
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    let lastError: unknown = null

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const signed = signRequest(this.config, { method, key, body, contentType, now: new Date() })

      try {
        const response = await fetch(signed.url, {
          method,
          headers: signed.headers,
          body: body ? (body.slice() as Uint8Array<ArrayBuffer>) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // No redirect is ever followed. A redirect off a signed request goes
          // somewhere the signature was not computed for, and if the endpoint
          // is misconfigured that somewhere is a stranger holding the bytes.
          redirect: 'error',
        })

        if (response.status < 500) return response

        lastError = new S3RequestError(response.status, null, `S3 ${method} failed: ${response.status}.`)
      } catch (error) {
        lastError = error
      }

      const wait = BACKOFF_MS[attempt]
      if (wait !== undefined) await new Promise((resolve) => setTimeout(resolve, wait))
    }

    if (lastError instanceof S3RequestError) throw lastError

    throw new S3RequestError(
      0,
      null,
      `The object store did not answer after ${ATTEMPTS} attempts. Nothing has been stored.`,
    )
  }

  private async refuse(response: Response, method: string, code?: string | null): Promise<never> {
    const resolved = code !== undefined ? code : errorCodeFrom(await response.text().catch(() => ''))
    throw new S3RequestError(
      response.status,
      resolved,
      `The object store refused a ${method}: HTTP ${response.status}` +
        `${resolved ? ` (${resolved})` : ''}. Check MEDIA_S3_BUCKET, the endpoint and the key pair.`,
    )
  }

  /**
   * Is this 404 "that object is not there", or "you asked the wrong bucket"?
   *
   * The distinction matters more than it looks. A misconfigured bucket answers
   * 404 to everything, and a client that reads every 404 as absence would
   * report every investor's document as missing and every image as gone — a
   * deployment that looks like it has lost its files rather than one that is
   * pointed at the wrong place. S3 and every compatible store say `NoSuchKey`
   * for the first and `NoSuchBucket` for the second, so the body is worth the
   * one read it costs.
   *
   * An empty or unparseable body is treated as absence, because some stores
   * answer a HEAD-shaped 404 with nothing in it, and refusing on silence would
   * turn a normal "not there" into an error on those.
   */
  private async isAbsence(response: Response): Promise<{ absent: true } | { absent: false; code: string }> {
    const code = errorCodeFrom(await response.text().catch(() => ''))

    if (code === null || code === 'NoSuchKey' || code === 'NoSuchVersion') {
      return { absent: true }
    }

    return { absent: false, code }
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const response = await this.send('PUT', key, bytes, contentType)
    if (!response.ok) await this.refuse(response, 'PUT')
    // The body of a successful PUT is empty, and leaving it undrained keeps a
    // socket open until the agent collects it.
    await response.arrayBuffer().catch(() => undefined)
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const response = await this.send('GET', key)

    // Absent is an answer, not a failure — the filesystem store says the same
    // thing by returning null, and the two must be indistinguishable to a
    // caller or the choice of store becomes a behavioural difference.
    if (response.status === 404) {
      const verdict = await this.isAbsence(response)
      if (verdict.absent) return null
      await this.refuse(response, 'GET', verdict.code)
    }

    if (!response.ok) await this.refuse(response, 'GET')

    return new Uint8Array(await response.arrayBuffer())
  }

  /**
   * Bytes `start` to `end` inclusive, and **only** a 206 is accepted.
   *
   * A store that ignores `Range` answers 200 with the whole object, and a
   * client that quietly sliced that would look identical to one honouring the
   * range — right up until a sixty-megabyte video was being held in memory to
   * serve two seconds of it. So a 200 here is an error with a message naming
   * the problem, not a silent fallback.
   *
   * `Range` is deliberately not part of the signature. S3 signs the headers it
   * is told to sign, and adding an unsigned header is permitted; keeping the
   * signed set identical to the plain GET's means one canonical request shape
   * to reason about rather than two.
   */
  async getObjectRange(key: string, start: number, end: number): Promise<Uint8Array | null> {
    const signed = signRequest(this.config, { method: 'GET', key, now: new Date() })

    const response = await fetch(signed.url, {
      method: 'GET',
      headers: { ...signed.headers, range: `bytes=${start}-${end}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })

    if (response.status === 404) {
      const verdict = await this.isAbsence(response)
      if (verdict.absent) return null
      await this.refuse(response, 'GET', verdict.code)
    }

    if (response.status === 200) {
      await response.arrayBuffer().catch(() => undefined)
      throw new S3RequestError(
        200,
        null,
        'The object store ignored a range request and offered the whole object. ' +
          'This build will not serve a partial response it did not receive.',
      )
    }

    if (response.status !== 206) await this.refuse(response, 'GET')

    return new Uint8Array(await response.arrayBuffer())
  }

  /**
   * The object's bytes as a stream, never all in memory at once.
   *
   * Two things are deliberately different from the buffered reads above.
   *
   * **No retry.** A retry means sending the request again, and the caller of a
   * stream has already been handed one — a second attempt would have to be
   * spliced into a response that is partly written. A failure to *start* is
   * still an error before anything is sent; a failure part way through ends
   * the stream, which is what a truncated download looks like at every layer.
   *
   * **No timeout on the body.** The buffered reads abort after thirty seconds
   * because a request that has not finished by then has failed. A stream is
   * different: a sixty-megabyte video on a slow phone connection is *supposed*
   * to take minutes, and a timeout that fires mid-download would cut it off.
   * A stalled connection is the socket's problem to notice, not this timer's.
   */
  async openObjectStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null> {
    const signed = signRequest(this.config, { method: 'GET', key, now: new Date() })

    const headers: Record<string, string> = { ...signed.headers }
    if (range) headers.range = `bytes=${range.start}-${range.end}`

    const response = await fetch(signed.url, {
      method: 'GET',
      headers,
      redirect: 'error',
    })

    if (response.status === 404) {
      const verdict = await this.isAbsence(response)
      if (verdict.absent) return null
      await this.refuse(response, 'GET', verdict.code)
    }

    if (range && response.status === 200) {
      await response.body?.cancel().catch(() => undefined)
      throw new S3RequestError(
        200,
        null,
        'The object store ignored a range request and offered the whole object. ' +
          'This build will not serve a partial response it did not receive.',
      )
    }

    const expected = range ? 206 : 200
    if (response.status !== expected) await this.refuse(response, 'GET')

    return response.body as ReadableStream<Uint8Array> | null
  }

  async deleteObject(key: string): Promise<void> {
    const response = await this.send('DELETE', key)

    if (response.status === 404) {
      const verdict = await this.isAbsence(response)
      // Removing something that is not there is the state we wanted. Being
      // told the bucket does not exist is not.
      if (verdict.absent) return
      await this.refuse(response, 'DELETE', verdict.code)
    }

    if (!response.ok) await this.refuse(response, 'DELETE')

    await response.arrayBuffer().catch(() => undefined)
  }
}
