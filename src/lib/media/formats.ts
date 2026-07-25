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

export type ImageFormat = (typeof IMAGE_FORMATS)[number]
export type VideoFormat = (typeof VIDEO_FORMATS)[number]
export type AcceptedFormat = ImageFormat | VideoFormat

/** Formats we can name in a refusal because we recognise them and say no. */
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
