/**
 * The one path a byte takes to get into this application. BUILD_SPEC §13.2, §13.3.
 *
 * Five steps, in this order, and the order is the point:
 *
 *   1. **Size**, before anything else. Checking the length of a buffer is free
 *      and refusing early means an oversized file never reaches a parser.
 *   2. **Identify from the bytes**, never from what the browser declared.
 *   3. **Is that format accepted for this kind of upload** — an image where an
 *      image belongs, a video where a video belongs, and a refusal that names
 *      the format when we recognise it and say no.
 *   4. **Strip metadata**, which happens before the bytes are stored, so there
 *      is no window in which the original is on disk.
 *   5. **Store under an unguessable key.**
 *
 * `inspect` is steps 1 to 3 and is pure — no filesystem, no database, no
 * environment. It is where the tests live. `ingest` adds 4 and 5.
 */

import {
  DOCUMENT_FORMATS,
  IMAGE_FORMATS,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  REFUSED_FORMATS,
  VIDEO_FORMATS,
  sniffFormat,
  type AcceptedFormat,
  type RefusedFormat,
} from './formats'
import { stripMetadata } from './strip'
import { mediaStore, newStorageKey, MEDIA_STORE_UNCONFIGURED } from './store'

export type UploadKind = 'image' | 'video' | 'document'

export type IngestRefusalReason =
  | 'EMPTY_FILE'
  | 'TOO_LARGE'
  | 'UNRECOGNISED_FORMAT'
  | 'FORMAT_NOT_ACCEPTED'
  | 'WRONG_KIND'
  | 'STORE_NOT_CONFIGURED'

export interface IngestRefusal {
  ok: false
  reason: IngestRefusalReason
  /** Specific. Names the problem and what to do about it. Never generic. */
  message: string
}

export interface InspectAccepted {
  ok: true
  format: AcceptedFormat
  sizeBytes: number
}

export type InspectResult = InspectAccepted | IngestRefusal

const ACCEPTED_BY_KIND: Readonly<Record<UploadKind, readonly string[]>> = {
  image: IMAGE_FORMATS,
  video: VIDEO_FORMATS,
  document: DOCUMENT_FORMATS,
}

const LIMIT_BY_KIND: Readonly<Record<UploadKind, number>> = {
  image: MAX_IMAGE_BYTES,
  video: MAX_VIDEO_BYTES,
  document: MAX_DOCUMENT_BYTES,
}

const KIND_ARTICLE: Readonly<Record<UploadKind, string>> = {
  image: 'an image',
  video: 'a video',
  document: 'a document',
}

/**
 * The prefix on a storage key, so that a key says what kind of thing it names
 * without anybody having to look the row up. A document is `doc_`.
 */
const KEY_PREFIX: Readonly<Record<UploadKind, 'img' | 'vid' | 'doc'>> = {
  image: 'img',
  video: 'vid',
  document: 'doc',
}

export function maxBytesFor(kind: UploadKind): number {
  return LIMIT_BY_KIND[kind]
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

function refuse(reason: IngestRefusalReason, message: string): IngestRefusal {
  return { ok: false, reason, message }
}

function isRefusedFormat(format: string): format is RefusedFormat {
  return format in REFUSED_FORMATS
}

/**
 * Decide whether these bytes may be stored. Pure.
 *
 * `declaredContentType` is accepted and deliberately unused for the decision.
 * It is in the signature so that a future caller cannot pass it in the belief
 * that it is being checked — and so that this comment sits at the place
 * somebody would look. What a browser declares is derived from a file
 * extension, which is a claim by whoever named the file.
 */
export function inspect(
  kind: UploadKind,
  bytes: Uint8Array,
  _declaredContentType?: string | null,
): InspectResult {
  if (bytes.length === 0) {
    return refuse('EMPTY_FILE', 'That file is empty. Nothing was stored.')
  }

  const limit = maxBytesFor(kind)
  if (bytes.length > limit) {
    return refuse(
      'TOO_LARGE',
      `That file is ${megabytes(bytes.length)} and the limit for ${KIND_ARTICLE[kind]} is ` +
        `${megabytes(limit)}. Nothing was stored.`,
    )
  }

  const sniffed = sniffFormat(bytes)

  if (sniffed === null) {
    return refuse(
      'UNRECOGNISED_FORMAT',
      'That file is not in a format this application recognises. ' +
        `Images: ${IMAGE_FORMATS.join(', ')}. Videos: ${VIDEO_FORMATS.join(', ')}. ` +
        `Documents: ${DOCUMENT_FORMATS.join(', ')}.`,
    )
  }

  // "Accepted here" is asked before "refused by name", because the answer
  // depends on where the file was being put: a PDF is a document package and
  // is not an image, and both of those need to be sayable.
  if (ACCEPTED_BY_KIND[kind].includes(sniffed)) {
    return { ok: true, format: sniffed as AcceptedFormat, sizeBytes: bytes.length }
  }

  if (isRefusedFormat(sniffed)) {
    const name = REFUSED_FORMATS[sniffed]
    const because =
      sniffed === 'image/svg+xml'
        ? 'An SVG is a document that can carry script, and this application serves media from ' +
          'its own domain — the same origin that holds the investor session. Export it as a PNG.'
        : sniffed === 'image/gif'
          ? 'This build cannot reliably remove the comment blocks a GIF can carry, and an ' +
            'image whose metadata cannot be stripped does not go on the portal. Export it as ' +
            'a PNG or a WebP.'
          : sniffed === 'application/pdf'
            ? 'A PDF is a document package, not an image — it goes on the investor’s record ' +
              'from their row on the Investors screen.'
            : `It is not ${KIND_ARTICLE[kind]}.`
    return refuse('FORMAT_NOT_ACCEPTED', `That file is ${name} and is not accepted. ${because}`)
  }

  // Recognised, accepted somewhere, and not here.
  const belongsTo = (Object.keys(ACCEPTED_BY_KIND) as UploadKind[]).find((other) =>
    ACCEPTED_BY_KIND[other].includes(sniffed),
  )

  return refuse(
    'WRONG_KIND',
    belongsTo
      ? `That is ${KIND_ARTICLE[belongsTo]} (${sniffed}), and this screen takes ` +
        `${KIND_ARTICLE[kind]}. Nothing was stored.`
      : `That is not ${KIND_ARTICLE[kind]}. Nothing was stored.`,
  )
}

// ---------------------------------------------------------------------------

export interface IngestStored {
  ok: true
  format: AcceptedFormat
  /** Length AFTER stripping — what is actually on disk. */
  sizeBytes: number
  storageKey: string
  /** How many bytes the metadata strip removed. Zero is a normal answer. */
  strippedBytes: number
  stored: Uint8Array
}

export type IngestResult = IngestStored | IngestRefusal

/**
 * Inspect, strip, and store. The only function that writes media bytes.
 *
 * The stored size is measured after stripping, so the row records what is on
 * disk rather than what was uploaded, and `strippedBytes` gives the screen
 * something honest to say about what was removed.
 */
export async function ingest(
  kind: UploadKind,
  bytes: Uint8Array,
  declaredContentType?: string | null,
): Promise<IngestResult> {
  const inspected = inspect(kind, bytes, declaredContentType)
  if (!inspected.ok) return inspected

  const store = mediaStore()
  if (!store) return refuse('STORE_NOT_CONFIGURED', MEDIA_STORE_UNCONFIGURED)

  const stripped = stripMetadata(inspected.format, bytes)
  const storageKey = newStorageKey(KEY_PREFIX[kind])

  await store.put(storageKey, stripped, inspected.format)

  return {
    ok: true,
    format: inspected.format,
    sizeBytes: stripped.length,
    strippedBytes: bytes.length - stripped.length,
    storageKey,
    stored: stripped,
  }
}
