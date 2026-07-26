/**
 * An S3-shaped server, in this process, that checks the signature itself.
 *
 * It is not a simulator of S3 and does not try to be. What it is, is a second
 * opinion: a request is only accepted if this server can rebuild the signature
 * from the secret and the request it actually received off the wire. A client
 * that signed the wrong path, the wrong method, the wrong body or the wrong
 * headers fails here, over a real socket, rather than against a mock the client
 * itself supplied.
 *
 * It lives here rather than in one test file because two suites need it — the
 * signing tests and the store tests — and a copied fake is two fakes that drift.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { verifySignature, type S3Config } from '@/lib/media/s3'

export const FAKE_S3_BUCKET = 'flipit-spv-media'
export const FAKE_S3_SECRET = 'not-a-real-secret-key-for-tests-only'
export const FAKE_S3_ACCESS_KEY_ID = 'AKIAEXAMPLEKEYID0000'
export const FAKE_S3_REGION = 'eu-west-2'

export class FakeS3 {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>()
  /** Statuses to serve, once each, before behaving normally. */
  readonly failures: number[] = []
  /**
   * Answer a `Range` request with the whole object and a 200, the way a store
   * that does not implement ranges does. Off by default; the client is
   * supposed to refuse this, and there is a test that it does.
   */
  ignoreRanges = false
  requests = 0
  private server: Server | null = null
  port = 0

  async start(): Promise<void> {
    this.server = createServer((request, response) => void this.handle(request, response))
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    const address = this.server!.address()
    this.port = typeof address === 'object' && address ? address.port : 0
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = null
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`
  }

  config(secret: string = FAKE_S3_SECRET): S3Config {
    return {
      endpoint: this.endpoint,
      region: FAKE_S3_REGION,
      bucket: FAKE_S3_BUCKET,
      accessKeyId: FAKE_S3_ACCESS_KEY_ID,
      secretAccessKey: secret,
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.requests += 1

    const failure = this.failures.shift()
    if (failure !== undefined) {
      response.writeHead(failure).end('<Error><Code>InternalError</Code></Error>')
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)

    const method = request.method as 'PUT' | 'GET' | 'DELETE' | 'HEAD'
    const [, bucket, key] = (request.url ?? '').split('/')

    if (bucket !== FAKE_S3_BUCKET) {
      response.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>')
      return
    }

    const authorization = request.headers.authorization ?? ''
    const amzDate = String(request.headers['x-amz-date'] ?? '')
    const contentType = request.headers['content-type']

    const ok = verifySignature(
      { ...this.config(), endpoint: `http://${request.headers.host}` },
      {
        method,
        key: decodeURIComponent(key ?? ''),
        body: method === 'PUT' ? new Uint8Array(body) : undefined,
        contentType: typeof contentType === 'string' ? contentType : undefined,
        amzDate,
      },
      authorization,
    )

    if (!ok) {
      // The real thing quotes the string it signed back at you. This one does
      // not, so that a test cannot accidentally start depending on that.
      response.writeHead(403).end('<Error><Code>SignatureDoesNotMatch</Code></Error>')
      return
    }

    const stored = this.objects.get(key!)

    if (method === 'PUT') {
      this.objects.set(key!, {
        bytes: body,
        contentType: typeof contentType === 'string' ? contentType : '',
      })
      response.writeHead(200).end()
    } else if (method === 'GET') {
      if (!stored) {
        response.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>')
        return
      }

      const range = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range ?? ''))

      if (range && !this.ignoreRanges) {
        const start = Number(range[1])
        const end = Math.min(Number(range[2]), stored.bytes.length - 1)

        if (start >= stored.bytes.length || end < start) {
          response
            .writeHead(416, { 'content-range': `bytes */${stored.bytes.length}` })
            .end()
          return
        }

        const slice = stored.bytes.subarray(start, end + 1)
        response
          .writeHead(206, {
            'content-type': stored.contentType,
            'content-length': String(slice.length),
            'content-range': `bytes ${start}-${end}/${stored.bytes.length}`,
            'accept-ranges': 'bytes',
          })
          .end(slice)
        return
      }

      // `content-length` by hand, because Node answers chunked otherwise, and
      // every real S3-compatible store states the length of the body it is
      // sending. A fake that omits a header the real thing always sends is a
      // fake that lets a client come to depend on not having one — and this
      // client refuses a body whose length nobody stated. The genuinely
      // length-less case has its own bare server, in `streaming.test.ts`.
      response
        .writeHead(200, {
          'content-type': stored.contentType,
          'content-length': String(stored.bytes.length),
        })
        .end(stored.bytes)
    } else if (method === 'HEAD') {
      if (!stored) {
        response.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>')
        return
      }
      response
        .writeHead(200, {
          'content-type': stored.contentType,
          'content-length': String(stored.bytes.length),
        })
        .end()
    } else if (method === 'DELETE') {
      this.objects.delete(key!)
      response.writeHead(204).end()
    } else {
      response.writeHead(405).end()
    }
  }
}
