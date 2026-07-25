/**
 * HTTP range requests, and why this stopped being optional. BUILD_SPEC §13.3.
 *
 * The video route used to answer every request with the whole file and say so
 * in a comment: a browser will download all of it and play it, which for a
 * short personal video is fine, and a hand-written range parser is a place to
 * get an off-by-one wrong. The first half of that is true. The second half was
 * the wrong conclusion, for a reason nobody had tested against:
 *
 * **Safari does not play a video served without range support.** It opens with
 * `Range: bytes=0-1`, and a server that answers 200 with the entire body
 * instead of 206 with two bytes is a server Safari gives up on. Not "plays
 * slowly" — does not play. That is every iPhone and every iPad, on a portal
 * whose §18 requirement is that it works on a phone first.
 *
 * So the parser is written, and it is written *here*, pure, with the tests
 * against it — rather than inline in three routes, which was the actual risk in
 * the original comment. An off-by-one in one place with forty tests on it is a
 * different proposition from the same arithmetic copied three times.
 *
 * Only a single range is honoured. Multi-range requests are answered with the
 * whole file, which RFC 9110 explicitly permits: a server may always ignore
 * `Range` and answer 200. Nothing here needs multipart/byteranges, and a
 * multipart body builder is the part of this that genuinely would be a place to
 * get something wrong.
 */

export interface ResolvedRange {
  /** First byte, inclusive. */
  start: number
  /** Last byte, inclusive — the HTTP convention, not a JavaScript end. */
  end: number
  /** `end - start + 1`. */
  length: number
}

export type RangeOutcome =
  /** No `Range` header, or one this build answers whole. Send 200. */
  | { kind: 'whole' }
  /** A satisfiable range. Send 206 with `Content-Range`. */
  | { kind: 'partial'; range: ResolvedRange }
  /** A syntactically valid range that falls outside the file. Send 416. */
  | { kind: 'unsatisfiable' }

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

/**
 * Work out what to answer, from the header and the size of the thing.
 *
 * `totalBytes` of zero is answered whole rather than as a range, because a
 * zero-length body has no satisfiable range and 416 on an empty file is a
 * worse answer than 200 with nothing in it.
 *
 * Three forms are recognised, and they are the three that exist:
 *
 *   - `bytes=0-1023`   — an explicit span. An end past the last byte is
 *                        clamped, which the specification requires rather than
 *                        merely allows.
 *   - `bytes=1024-`    — from here to the end.
 *   - `bytes=-1024`    — the *last* 1024 bytes. A suffix longer than the file
 *                        means the whole file, not an error.
 *
 * Anything else — a malformed header, several ranges, a unit that is not
 * `bytes` — returns `whole`. Ignoring a `Range` header is always a legal
 * response, and answering 200 to something unparsed is safer than guessing at
 * what it meant.
 */
export function resolveRange(header: string | null, totalBytes: number): RangeOutcome {
  if (!header || totalBytes <= 0) return { kind: 'whole' }

  const match = SINGLE_RANGE.exec(header.trim())
  if (!match) return { kind: 'whole' }

  const [, firstText, lastText] = match

  // `bytes=-` is neither a span nor a suffix. Not a range at all.
  if (firstText === '' && lastText === '') return { kind: 'whole' }

  let start: number
  let end: number

  if (firstText === '') {
    // A suffix: the last N bytes. N of zero is unsatisfiable by definition —
    // there is no such thing as the last nothing bytes.
    const suffix = Number(lastText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    start = Math.max(0, totalBytes - suffix)
    end = totalBytes - 1
  } else {
    start = Number(firstText)
    if (!Number.isSafeInteger(start)) return { kind: 'whole' }
    if (start >= totalBytes) return { kind: 'unsatisfiable' }

    if (lastText === '') {
      end = totalBytes - 1
    } else {
      const requestedEnd = Number(lastText)
      if (!Number.isSafeInteger(requestedEnd)) return { kind: 'whole' }
      if (requestedEnd < start) return { kind: 'unsatisfiable' }
      // Clamped, not refused. A client asking for more than there is gets what
      // there is, which is what the specification says to do.
      end = Math.min(requestedEnd, totalBytes - 1)
    }
  }

  return { kind: 'partial', range: { start, end, length: end - start + 1 } }
}

/** The `Content-Range` value for a 206. */
export function contentRangeHeader(range: ResolvedRange, totalBytes: number): string {
  return `bytes ${range.start}-${range.end}/${totalBytes}`
}

/** The `Content-Range` value for a 416, which names the size and nothing else. */
export function unsatisfiableRangeHeader(totalBytes: number): string {
  return `bytes */${totalBytes}`
}
