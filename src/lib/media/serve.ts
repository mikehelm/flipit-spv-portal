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
 * pull it down. `Content-Length` therefore comes from the recorded `size_bytes`
 * rather than from counting what was read — the row is written from the ingest
 * result and is the authority on how big the object is. A store whose file
 * disagreed with its row would now send a wrong length rather than a right one,
 * which is a trade recorded under Uncertain in PROGRESS.md rather than hidden.
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
    const stream = await input.store.openStream(input.storageKey, range)
    if (!stream) return input.notFound

    return new Response(stream, {
      status: 206,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': input.contentType,
        'Content-Length': String(range.length),
        'Content-Range': contentRangeHeader(range, input.sizeBytes),
        'Accept-Ranges': 'bytes',
      },
    })
  }

  const stream = await input.store.openStream(input.storageKey)
  if (!stream) return input.notFound

  return new Response(stream, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': input.contentType,
      'Content-Length': String(input.sizeBytes),
      'Accept-Ranges': 'bytes',
    },
  })
}
