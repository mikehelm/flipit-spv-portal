/**
 * Turning a stored object into an HTTP response. BUILD_SPEC §13.3, §18.
 *
 * Both video routes — the investor's and the operator's preview — served an
 * identical response built twice, and both are now doing something with more
 * arithmetic in it than they were. Two copies of a range calculation is exactly
 * the risk the original "no ranges here" comment was worried about, so there is
 * one copy, here, and the routes decide *who may see the video* and nothing
 * else.
 *
 * The headers are the ones that were already going out. Nothing about caching,
 * indexing or content-type sniffing changes: `private, no-store` and a
 * `noindex` still apply to a partial response, and the content type is still
 * the one sniffed from the file's own bytes at upload rather than anything a
 * browser said.
 *
 * **The body is a stream, not a buffer.** A sixty-megabyte video was previously
 * read into one `Uint8Array` and handed to a `Response`, which meant the whole
 * file was in memory for as long as it took a phone on a slow connection to
 * pull it down.
 *
 * **The range is resolved against the recorded size; the length promised is the
 * store's.** Those two are the same number until the day they are not — a
 * partial write, a restored backup, an object replaced out of band — and
 * `pnpm media:check` exists because that day is considered reachable. On it, a
 * `Content-Length` taken from the row would promise bytes that never arrive,
 * which is a download that hangs rather than one that ends. So the header is
 * built from what the store is about to send, which costs nothing: the
 * filesystem `stat`s the file to decide it exists at all, and an object store
 * sends a `Content-Length` whether it is read or not.
 */

import {
  contentRangeHeader,
  resolveRange,
  unsatisfiableRangeHeader,
} from './ranges'
import type { MediaStore } from './store'

export interface ServeMediaInput {
  request: Request
  store: MediaStore
  storageKey: string
  /** The sniffed type on the row. Never a value that came from a browser. */
  contentType: string
  /** The recorded size. Ranges are resolved against this, not against a read. */
  sizeBytes: number
  /** The one refusal the route constructed. Reused rather than rebuilt. */
  notFound: Response
}

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Disposition': 'inline',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
}

/**
 * Serve the whole object, or the part of it that was asked for.
 *
 * `Accept-Ranges: bytes` goes on every response including the whole-file one,
 * because that header is how a player finds out it may seek at all. A file
 * served without it is a file Safari will not scrub through even when every
 * range request would have worked.
 */
export async function serveMedia(input: ServeMediaInput): Promise<Response> {
  const outcome = resolveRange(input.request.headers.get('range'), input.sizeBytes)

  if (outcome.kind === 'unsatisfiable') {
    // 416 is reached only after every access check has passed, so it tells
    // somebody who is already entitled to the whole file how big it is.
    return new Response(null, {
      status: 416,
      headers: {
        ...BASE_HEADERS,
        'Accept-Ranges': 'bytes',
        'Content-Range': unsatisfiableRangeHeader(input.sizeBytes),
      },
    })
  }

  if (outcome.kind === 'partial') {
    const { range } = outcome
    const opened = await input.store.openStream(input.storageKey, range)
    if (!opened) return input.notFound

    // The object is there and has nothing at that offset: the stored file is
    // shorter than the row claims. That is the route's own 404 — the same
    // answer as an id that does not exist, and the only one that tells an
    // investor nothing about the state of this deployment's storage.
    if (opened.length === 0) return input.notFound

    // Named for the bytes that will actually arrive rather than the ones that
    // were asked for. The two differ only when the row has drifted from the
    // store, and on that path a promise of more is worse than a smaller truth.
    const sending = {
      start: range.start,
      end: range.start + opened.length - 1,
      length: opened.length,
    }

    return new Response(opened.stream, {
      status: 206,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': input.contentType,
        'Content-Length': String(opened.length),
        'Content-Range': contentRangeHeader(sending, input.sizeBytes),
        'Accept-Ranges': 'bytes',
      },
    })
  }

  const opened = await input.store.openStream(input.storageKey)
  if (!opened) return input.notFound

  return new Response(opened.stream, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': input.contentType,
      'Content-Length': String(opened.length),
      'Accept-Ranges': 'bytes',
    },
  })
}
