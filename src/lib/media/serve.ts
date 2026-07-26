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
 * **Nothing here holds a file.** Every response body is the store's stream,
 * handed to `Response` and pulled from at the speed the client's socket
 * drains. The 200 was the case that mattered: a `<video>` element that is
 * downloading rather than seeking sends no `Range` at all, so the whole-file
 * branch was sixty megabytes of process memory per viewer, on the one route
 * several people plausibly open in the same minute.
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
    const part = await input.store.openStream(input.storageKey, range)
    if (!part) return input.notFound

    // The object is there, and has nothing at that offset: the stored file is
    // shorter than the row claims. That is the same 404 as an id that does not
    // exist — the only answer that tells an investor nothing about the state of
    // this deployment's storage.
    if (part.length === 0) return input.notFound

    // Built from what the store is about to send, not from what was asked for.
    // Where the two differ the row has drifted from storage, and a
    // `Content-Range` promising bytes that will not arrive hangs a player
    // rather than ending it.
    const sending = {
      start: range.start,
      end: range.start + part.length - 1,
      length: part.length,
    }

    return new Response(part.stream, {
      status: 206,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': input.contentType,
        'Content-Length': String(part.length),
        'Content-Range': contentRangeHeader(sending, input.sizeBytes),
        'Accept-Ranges': 'bytes',
      },
    })
  }

  const object = await input.store.openStream(input.storageKey)
  if (!object) return input.notFound

  return new Response(object.stream, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': input.contentType,
      'Content-Length': String(object.length),
      'Accept-Ranges': 'bytes',
    },
  })
}
