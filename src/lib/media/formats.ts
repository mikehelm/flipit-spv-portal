/**
 * What the media library accepts, and how it decides. BUILD_SPEC §13.2, §13.3.
 *
 * **The declared content type is never believed.** A browser sends whatever
 * the operating system guessed from the file extension, and an attacker sends
 * whatever they like. Every byte that enters this application is identified
 * from its own leading bytes, and the stored `content_type` is the sniffed
 * one — so the type the app later serves is the type the file actually is,
 * not the type somebody said it was.
 *
 * The accepted list is short on purpose. §13.2 asks for "size and type limits"
 * and lists what the library is for: "logo variants, favicon, an email header
 * image, portal hero imagery, David's headshot, product screenshots." Three
 * still-image formats cover all six.
 *
 * Two formats are named and refused rather than falling through to a generic
 * "unrecognised", because they are the two somebody will actually try:
 *
 *   - **SVG is never accepted.** An SVG is a document that can contain script
 *     and remote references. Serving one from this application's own domain —
 *     which §13.2 requires — would place attacker-controlled script on the
 *     origin that holds the investor session cookie. There is no size limit or
 *     sanitiser that makes this a good trade for a logo.
 *   - **GIF is never accepted**, for the quieter reason that this build cannot
 *     confidently strip its comment and application extension blocks, and a
 *     format whose metadata we cannot remove is a format that fails §13.2's
 *     "stripped of EXIF" requirement. Refusing is the conservative option.
 */

export const IMAGE_FORMATS = ['image/jpeg', 'image/png', 'image/webp'] as const
export const VIDEO_FORMATS = ['video/mp4', 'video/webm', 'video/quicktime'] as const

/**
 * **PDF, and nothing else.** BUILD_SPEC §5 status 3.
 *
 * A document package is a subscription agreement or an SPV instrument — the
 * governing documents §5.1 says the participation certificate is *not*. Two
 * reasons for the single format:
 *
 *   - A `.docx` is a zip archive that can carry macros and remote references,
 *     and it renders differently on every machine that opens it. An investor
 *     reading terms should see the same page the operator sent.
 *   - A PDF is the only one of the plausible formats this application can
 *     serve inline without handing the browser something it will run.
 */
export const DOCUMENT_FORMATS = ['application/pdf'] as const

export type ImageFormat = (typeof IMAGE_FORMATS)[number]
export type VideoFormat = (typeof VIDEO_FORMATS)[number]
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number]
export type AcceptedFormat = ImageFormat | VideoFormat | DocumentFormat

/**
 * Formats we can name in a refusal because we recognise them and say no.
 *
 * PDF is on this list *and* on `DOCUMENT_FORMATS`, and that is not a
 * contradiction: it is accepted where a document belongs and named in a
 * refusal where an image does. `inspect` asks "is this accepted for this
 * kind" before it asks "is this one we refuse by name", so the answer depends
 * on where the file was being put.
 */
export const REFUSED_FORMATS = {
  'image/svg+xml': 'SVG',
  'image/gif': 'GIF',
  'application/pdf': 'PDF',
  'text/html': 'HTML',
} as const

export type RefusedFormat = keyof typeof REFUSED_FORMATS

export type SniffedFormat = AcceptedFormat | RefusedFormat | null

export function isImageFormat(value: string): value is ImageFormat {
  return (IMAGE_FORMATS as readonly string[]).includes(value)
}

export function isVideoFormat(value: string): value is VideoFormat {
  return (VIDEO_FORMATS as readonly string[]).includes(value)
}

export function isDocumentFormat(value: string): value is DocumentFormat {
  return (DOCUMENT_FORMATS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Size limits
// ---------------------------------------------------------------------------

/**
 * Five megabytes for an image.
 *
 * A logo, a favicon, an email header and a headshot are all well under one.
 * Five leaves room for a full-width portal hero at 2× without leaving room for
 * somebody to fill the disk. §13.2 asks for a limit; this is the limit.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Sixty-four megabytes for a video.
 *
 * §13.3 describes "a short personal video" recorded on a phone or in the
 * browser. At the bitrates both produce, sixty-four megabytes is comfortably
 * more than three minutes, and three minutes is already longer than anyone
 * will watch. The number is a ceiling on what one request has to hold in
 * memory as much as it is a policy — see `ingest.ts`.
 */
export const MAX_VIDEO_BYTES = 64 * 1024 * 1024

/**
 * Twenty megabytes for a document.
 *
 * A subscription agreement is text and runs to tens of kilobytes. Twenty
 * megabytes is room for a scanned execution copy of something long, and is
 * still small enough that serving one does not need a range request.
 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/**
 * What kind of thing is being uploaded. Declared here rather than in
 * `ingest.ts` because a browser needs it too.
 *
 * `ingest.ts` re-exports it, so nothing that imported it from there had to
 * change. The reason it moved is the reason `tooLargeMessage` exists below: a
 * client component cannot import `ingest.ts` — that module reaches the
 * filesystem and the database — and a limit only the server knows about is a
 * limit the browser silently exceeds.
 */
export type UploadKind = 'image' | 'video' | 'document'

const LIMIT_BY_KIND: Readonly<Record<UploadKind, number>> = {
  image: MAX_IMAGE_BYTES,
  video: MAX_VIDEO_BYTES,
  document: MAX_DOCUMENT_BYTES,
}

/** "an image", "a video", "a document" — for a refusal written as a sentence. */
export const KIND_ARTICLE: Readonly<Record<UploadKind, string>> = {
  image: 'an image',
  video: 'a video',
  document: 'a document',
}

export function maxBytesFor(kind: UploadKind): number {
  return LIMIT_BY_KIND[kind]
}

/** One decimal place, so a 1.5 MB file is not reported as 2 MB. */
export function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/**
 * The sentence a person reads when their file is too big — **one sentence, used
 * on both sides of the wire.**
 *
 * `inspect` refuses an oversized file on the server and returns this. A file
 * input refuses one in the browser and shows this. They are the same function
 * because they have to be the same words: a browser-side guard that phrases the
 * refusal differently teaches the operator there are two different problems,
 * when there is one file and one limit.
 *
 * It names both numbers — the file's size and the limit — because a message
 * naming only the limit leaves somebody guessing whether the file they chose is
 * the one that was too big.
 */
export function tooLargeMessage(kind: UploadKind, bytes: number): string {
  return (
    `That file is ${megabytes(bytes)} and the limit for ${KIND_ARTICLE[kind]} is ` +
    `${megabytes(maxBytesFor(kind))}. Nothing was stored.`
  )
}

// ---------------------------------------------------------------------------
// Sniffing
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  let out = ''
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]!)
  return out
}

const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const EBML = [0x1a, 0x45, 0xdf, 0xa3]

/**
 * Identify a file from its own bytes. Returns null when nothing matches.
 *
 * Order matters only in that the container formats are checked by their box or
 * chunk headers rather than by a prefix, so a file cannot be both.
 */
export function sniffFormat(bytes: Uint8Array): SniffedFormat {
  if (bytes.length < 12) return null

  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  if (startsWith(bytes, PNG)) return 'image/png'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (startsWith(bytes, EBML)) return 'video/webm'

  // ISO base media file format: a `ftyp` box at the very start. The major
  // brand distinguishes QuickTime from MP4; both are served as themselves so
  // a browser is told the truth about what it is being handed.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }

  if (ascii(bytes, 0, 4) === '%PDF') return 'application/pdf'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif'

  // SVG and HTML are text, and both may open with a byte-order mark, an XML
  // declaration, a doctype or whitespace. Look at a bounded prefix rather than
  // requiring a fixed offset.
  const head = ascii(bytes, 0, Math.min(bytes.length, 512)).toLowerCase()
  if (head.includes('<svg')) return 'image/svg+xml'
  if (head.includes('<!doctype html') || head.includes('<html')) return 'text/html'

  return null
}
