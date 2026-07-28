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

/**
 * The path of a request about the bucket itself rather than an object in it.
 *
 * One caller: listing. `/bucket`, with no trailing slash, because that is the
 * path actually sent — and a signature is computed over the path that is sent,
 * not over a tidier one.
 */
export function canonicalBucketUri(bucket: string): string {
  return `/${encodeSegment(bucket)}`
}

/**
 * The query string, canonicalised: sorted by name, every part encoded.
 *
 * Empty when there is no query, which is what every request in this file was
 * until listing arrived — so the canonical request of a get, a put and a delete
 * is unchanged to the character, and the golden tests that pin them still pass.
 */
export function canonicalQueryString(query: Readonly<Record<string, string>>): string {
  return Object.keys(query)
    .sort()
    .map((name) => `${encodeSegment(name)}=${encodeSegment(query[name]!)}`)
    .join('&')
}

/** `20260725T230000Z` and `20260725`. */
export function amzTimestamps(now: Date): { amzDate: string; datestamp: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { amzDate, datestamp: amzDate.slice(0, 8) }
}

export type S3Method = 'PUT' | 'GET' | 'DELETE' | 'HEAD'

export interface CanonicalInput {
  method: S3Method
  uri: string
  /**
   * The query, unencoded. Absent on every request about a single object, which
   * is all of them except listing.
   */
  query?: Readonly<Record<string, string>>
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
    // Empty for everything but a listing — an empty line, not an omitted one.
    input.query ? canonicalQueryString(input.query) : '',
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
    method: S3Method
    /**
     * The object. Absent for a request about the bucket itself — which is
     * listing, and only listing.
     */
    key?: string
    /** Query parameters, unencoded. Listing again, and only listing. */
    query?: Readonly<Record<string, string>>
    body?: Uint8Array
    contentType?: string
    now: Date
  },
): SignedRequest {
  const { amzDate, datestamp } = amzTimestamps(request.now)
  const uri =
    request.key === undefined
      ? canonicalBucketUri(config.bucket)
      : canonicalUri(config.bucket, request.key)
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
    query: request.query,
    headers,
    payloadHash,
  })

  const scope = credentialScope(datestamp, config.region)
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, datestamp, config.region))
    .update(buildStringToSign(canonical, amzDate, scope), 'utf8')
    .digest('hex')

  // The query goes on the URL exactly as it went into the signature. Building
  // it twice, once for each, is how a signature comes to describe a request
  // that was not the one sent.
  const query = request.query ? canonicalQueryString(request.query) : ''

  return {
    url: `${config.endpoint.replace(/\/+$/, '')}${uri}${query ? `?${query}` : ''}`,
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
  received: {
    method: S3Method
    /** Absent for a bucket-level request, exactly as in `signRequest`. */
    key?: string
    query?: Readonly<Record<string, string>>
    body?: Uint8Array
    contentType?: string
    amzDate: string
  },
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

/** One object in a bucket, as a listing describes it. */
export interface ObjectSummary {
  key: string
  sizeBytes: number
}

/**
 * The five XML entities, and only those five.
 *
 * A key is base64url and never contains one. A key this application did not
 * write might contain anything, and reporting `a&amp;b` as a name nobody can
 * find in their console is a small lie that costs somebody an afternoon. There
 * is no numeric-entity handling and no external-entity handling of any kind:
 * this reads a listing, not a document.
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * A `ListBucketResult`, read with three patterns rather than an XML parser.
 *
 * The same argument as the rest of this file: a dependency that parses
 * arbitrary XML, on a path that handles an investor's documents, is a larger
 * surface than the thing it is being used for. What is needed is the contents
 * of `<Key>` and `<Size>` inside each `<Contents>`, plus whether there is more
 * to come — and anything that does not match those shapes is skipped rather
 * than guessed at.
 *
 * A `<Size>` that is not a plain integer, or a `<Key>` that is empty, drops the
 * entry. A listing this cannot read produces fewer objects, never a wrong one,
 * and the caller's totals are then obviously short rather than subtly wrong.
 */
export function parseListResult(xml: string): {
  objects: ObjectSummary[]
  nextToken: string | null
} {
  const objects: ObjectSummary[] = []

  for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1]
    const size = /<Size>(\d{1,19})<\/Size>/.exec(block)?.[1]
    if (key === undefined || key === '' || size === undefined) continue

    const sizeBytes = Number(size)
    if (!Number.isSafeInteger(sizeBytes)) continue

    objects.push({ key: unescapeXml(key), sizeBytes })
  }

  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]

  // A store that says "there is more" and does not say where to continue from
  // has ended the walk, because asking again without a token would fetch the
  // first page a second time and loop for ever.
  return {
    objects,
    nextToken: truncated && token ? unescapeXml(token) : null,
  }
}

/**
 * Whether a bucket keeps what it is told to delete.
 *
 * This exists because of the one failure an erasure cannot see from inside.
 * With versioning on, a `DELETE` writes a marker and keeps the object: the
 * store then answers every subsequent question the way an empty store answers,
 * `pnpm media:check` is clean and `pnpm verify:erasure` is green — because the
 * application asked for a delete and was told it happened. What has actually
 * happened is that an investor who asked to be erased still has a signed
 * subscription agreement in object storage, recoverable from a console.
 *
 * `SUSPENDED` is not safe and is deliberately not folded into `DISABLED`.
 * Suspending stops *new* versions being written; every non-current version
 * already there stays exactly where it is, and that is where the documents
 * deleted while it was enabled are.
 *
 * `UNKNOWN` is not safe either. It is the answer whenever the store will not
 * say — the call is refused, the provider does not implement it, or the body
 * does not parse — and it must be reported as "not known", never as "fine".
 */
export type BucketVersioning = 'ENABLED' | 'SUSPENDED' | 'DISABLED' | 'UNKNOWN'

/**
 * A `VersioningConfiguration`, read with a pattern rather than an XML parser —
 * the same argument as `parseListResult` above.
 *
 * An empty `<VersioningConfiguration/>` is what a bucket that has never had
 * versioning turned on answers, and it is the only shape that means `DISABLED`.
 * A `<Status>` this does not recognise is `UNKNOWN` rather than assumed
 * harmless: a status nobody here has heard of is not evidence of safety.
 */
export function parseVersioningStatus(xml: string): BucketVersioning {
  if (!/<VersioningConfiguration[\s>/]/.test(xml)) return 'UNKNOWN'

  const status = /<Status>\s*([A-Za-z]+)\s*<\/Status>/.exec(xml)?.[1]
  if (status === undefined) return 'DISABLED'
  if (status === 'Enabled') return 'ENABLED'
  if (status === 'Suspended') return 'SUSPENDED'
  return 'UNKNOWN'
}

/**
 * What a bucket is still holding that nothing points at any more.
 *
 * The other half of the versioning question, and the half that survives turning
 * versioning **off**. Switching it off stops new versions being written; it does
 * not remove one that already exists. A bucket that had versioning on for a
 * fortnight and has it off today still holds a copy of everything deleted during
 * that fortnight — including any document an investor erasure destroyed — and
 * reports itself as `DISABLED`, which is the answer somebody has just worked to
 * get.
 *
 * `atLeast` rather than a total: this reads one page. A number that is short is
 * still a number that is not zero, which is the whole question, and walking a
 * bucket full of dead versions to count them exactly is a lot of round trips to
 * reach the same conclusion.
 */
export interface HiddenVersions {
  /** Versions of an object that are not the current one. */
  nonCurrent: number
  /** Markers left where a delete hid an object rather than removing it. */
  deleteMarkers: number
  /** There were more than one page held; the counts above are a floor. */
  atLeast: boolean
}

/**
 * A `ListVersionsResult`, counted rather than collected.
 *
 * No key is read out of it and none is returned. A storage key is a capability
 * — the image route serves one without a session — and this answer is printed
 * in a report and written into an audit row. What is needed to raise the alarm
 * is *how many*, and the console the person then opens can name them.
 */
export function parseVersionListing(xml: string): HiddenVersions {
  let nonCurrent = 0
  for (const block of xml.match(/<Version>[\s\S]*?<\/Version>/g) ?? []) {
    // `IsLatest` false is a superseded version. The current one is an ordinary
    // object and is somebody's live file.
    if (/<IsLatest>\s*false\s*<\/IsLatest>/i.test(block)) nonCurrent += 1
  }

  const deleteMarkers = (xml.match(/<DeleteMarker>[\s\S]*?<\/DeleteMarker>/g) ?? []).length
  const atLeast = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)

  return { nonCurrent, deleteMarkers, atLeast }
}

const ATTEMPTS = 3
const BACKOFF_MS = [100, 400]
const TIMEOUT_MS = 30_000

/** A body that ends immediately, for a response that arrived with none. */
function emptyBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

/**
 * How many bytes a response body will produce, or null if it did not say.
 *
 * `Content-Length` first, because it is the store's own assertion about the
 * body it is sending. `Content-Range` second, because a 206 always carries one
 * and it names the same number a different way — a useful second answer when a
 * proxy has stripped the length. Null last, and the caller refuses on it: a
 * length nobody stated is a length this code would be inventing.
 */
export function responseLength(response: {
  headers: { get(name: string): string | null }
}): number | null {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number.isSafeInteger(Number(declared))) {
    return Number(declared)
  }

  const span = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/.exec(
    (response.headers.get('content-range') ?? '').trim(),
  )

  if (span) {
    const start = Number(span[1])
    const end = Number(span[2])
    if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start) {
      return end - start + 1
    }
  }

  return null
}

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

  /**
   * One request, retried the way an idempotent verb may be.
   *
   * `key` is absent for the one request that is about the bucket rather than an
   * object in it — listing — and `query` goes with it. Everything else about
   * the loop is the same for all five verbs, which is the reason this takes an
   * options bag rather than growing a second copy of the retry logic.
   */
  private async send(
    method: S3Method,
    options: {
      key?: string
      query?: Readonly<Record<string, string>>
      body?: Uint8Array
      contentType?: string
    } = {},
  ): Promise<Response> {
    const { key, query, body, contentType } = options
    let lastError: unknown = null

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const signed = signRequest(this.config, {
        method,
        key,
        query,
        body,
        contentType,
        now: new Date(),
      })

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
    const response = await this.send('PUT', { key, body: bytes, contentType })
    if (!response.ok) await this.refuse(response, 'PUT')
    // The body of a successful PUT is empty, and leaving it undrained keeps a
    // socket open until the agent collects it.
    await response.arrayBuffer().catch(() => undefined)
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const response = await this.send('GET', { key })

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
   *
   * **A response that does not say how long it is, is refused.** Every
   * S3-compatible store sends `Content-Length` on a GET and a `Content-Range`
   * on a 206; a response carrying neither is something between here and the
   * bucket doing the unexpected. The alternative to refusing is inventing a
   * length and promising it to a browser, which then holds the connection open
   * waiting for bytes that are not coming.
   */
  async openObjectStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<{ stream: ReadableStream<Uint8Array>; length: number } | null> {
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

    const length = responseLength(response)

    if (length === null) {
      await response.body?.cancel().catch(() => undefined)
      throw new S3RequestError(
        response.status,
        null,
        'The object store answered without a length this build can trust. ' +
          'Nothing has been served.',
      )
    }

    // A response with no body at all: the object is there, and there is
    // nothing to read from it.
    return { stream: (response.body as ReadableStream<Uint8Array> | null) ?? emptyBody(), length }
  }

  /**
   * How many bytes are actually there, without fetching any of them.
   *
   * A HEAD, so that checking a sixty-megabyte video costs a round trip rather
   * than a download. Null for an object that is not there — the same answer
   * `getObject` gives, for the same reason.
   */
  async headObject(key: string): Promise<{ sizeBytes: number } | null> {
    const response = await this.send('HEAD', { key })

    if (response.status === 404) {
      const verdict = await this.isAbsence(response)
      if (verdict.absent) return null
      await this.refuse(response, 'HEAD', verdict.code)
    }

    if (!response.ok) await this.refuse(response, 'HEAD')

    const declared = response.headers.get('content-length')
    // A store that answers a HEAD without a length is one this check cannot
    // use. Saying so beats reporting a size of zero and calling it a mismatch.
    if (declared === null || !/^\d+$/.test(declared)) {
      throw new S3RequestError(
        response.status,
        null,
        'The object store answered a HEAD without a usable Content-Length, so the size of ' +
          'the stored object cannot be checked.',
      )
    }

    return { sizeBytes: Number(declared) }
  }

  /**
   * Every object in the bucket, up to a limit the caller states.
   *
   * The only request in this file that is about the bucket rather than an
   * object in it, and the only one carrying a query string — which is why the
   * signer had to learn about both.
   *
   * **The limit is not a page size, and it is not optional.** A listing walks
   * continuation tokens until the store says there is no more, and a bucket
   * with a million objects in it would otherwise be a million objects in this
   * process's memory. The caller says how many it is prepared to hold, gets at
   * most that many, and is told whether there were more — so a report can say
   * "and there is more" rather than describing a fraction of a bucket as though
   * it were all of it.
   *
   * `truncated` covers both the caller's limit and the store's paging, and
   * either way it means one thing: this is not the whole bucket.
   */
  async listObjects(limit: number): Promise<{ objects: ObjectSummary[]; truncated: boolean }> {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new S3RequestError(0, null, 'A listing needs a positive limit of how many to hold.')
    }

    const objects: ObjectSummary[] = []
    let token: string | null = null

    for (;;) {
      const query: Record<string, string> = {
        'list-type': '2',
        // A thousand is the protocol's own ceiling. One more than the caller
        // has room for is asked for deliberately: it is how `truncated` gets
        // to be true without a second round trip to discover it.
        'max-keys': String(Math.min(1000, limit - objects.length + 1)),
      }
      if (token) query['continuation-token'] = token

      const response = await this.send('GET', { query })

      if (!response.ok) await this.refuse(response, 'GET')

      const page = parseListResult(await response.text())
      objects.push(...page.objects)

      if (objects.length > limit) return { objects: objects.slice(0, limit), truncated: true }
      if (!page.nextToken) return { objects, truncated: false }

      token = page.nextToken
    }
  }

  /**
   * Ask the bucket whether it keeps what it is told to delete.
   *
   * `GET /bucket?versioning` — the second request in this file about the bucket
   * rather than an object in it, and the second to carry a query.
   *
   * **It never throws, and that is the decision.** Every other call here
   * refuses loudly, because a caller that asked for bytes and did not get them
   * has to know. This one is a question asked by a reporting job on behalf of a
   * person, and a probe that turns a media report into a stack trace has made
   * the report worse. A provider that does not implement `GetBucketVersioning`,
   * or a key pair scoped to objects and not to bucket configuration, is an
   * ordinary state and the answer to it is `UNKNOWN` — which is reported as not
   * known, and is never reported as safe.
   */
  async bucketVersioning(): Promise<BucketVersioning> {
    try {
      const response = await this.send('GET', { query: { versioning: '' } })
      if (!response.ok) {
        await response.arrayBuffer().catch(() => undefined)
        return 'UNKNOWN'
      }
      return parseVersioningStatus(await response.text())
    } catch {
      // Deliberately no detail. The failure is reported as `UNKNOWN` where a
      // person will read it, and an error from a signed request can carry the
      // endpoint and the key id.
      return 'UNKNOWN'
    }
  }

  /**
   * How much the bucket is still holding behind delete markers.
   *
   * `GET /bucket?versions` — `ListObjectVersions`. Null means the bucket would
   * not say, for the same reasons and by the same two doors as
   * `bucketVersioning` above, and like it this never throws.
   *
   * **A bucket reporting `DISABLED` can still answer a positive number here**,
   * and that is the case this exists for: versioning turned off today does not
   * remove the copies made yesterday.
   */
  async hiddenVersions(limit: number): Promise<HiddenVersions | null> {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new S3RequestError(0, null, 'A version listing needs a positive limit.')
    }

    try {
      const response = await this.send('GET', {
        query: { versions: '', 'max-keys': String(Math.min(1000, limit)) },
      })
      if (!response.ok) {
        await response.arrayBuffer().catch(() => undefined)
        return null
      }
      const body = await response.text()
      // A body that is not a version listing at all is "would not say", not
      // "nothing there" — the same rule as the versioning parser.
      if (!/<ListVersionsResult[\s>/]/.test(body)) return null
      return parseVersionListing(body)
    } catch {
      return null
    }
  }

  async deleteObject(key: string): Promise<void> {
    const response = await this.send('DELETE', { key })

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
