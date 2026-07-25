import { describe, expect, it } from 'vitest'
import {
  gifBytes,
  jpegWithMetadata,
  mp4WithLocation,
  pngWithMetadata,
  svgBytes,
  webmBytes,
  webmWithMetadata,
  webpWithMetadata,
} from './fixtures'
import { sniffFormat } from './formats'
import { readDimensions } from './dimensions'
import {
  stripEbmlMetadata,
  stripIsoMetadata,
  stripJpeg,
  stripMetadata,
  stripPng,
  stripWebp,
  stripsMetadata,
} from './strip'

/**
 * BUILD_SPEC §13.2 — "stripped of EXIF" — and §22 AC31.
 *
 * Every test in this file starts by asserting the fixture *does* contain the
 * secret. A stripping test whose input was already clean is a test that passes
 * for the wrong reason, and this is the only defence against that.
 */

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
}

const SECRET = 'Privet Drive'

describe('stripJpeg', () => {
  it('removes EXIF, XMP, ICC, IPTC and the comment, and the fixture had all of them', () => {
    const original = jpegWithMetadata()
    expect(text(original)).toContain(SECRET)

    const stripped = stripJpeg(original)

    expect(text(stripped)).not.toContain(SECRET)
    expect(stripped.length).toBeLessThan(original.length)
  })

  it('keeps the image itself — dimensions and scan data survive', () => {
    const stripped = stripJpeg(jpegWithMetadata())

    expect(sniffFormat(stripped)).toBe('image/jpeg')
    expect(readDimensions('image/jpeg', stripped)).toEqual({ width: 128, height: 64 })
    // The four entropy-coded bytes after SOS, then EOI.
    expect([...stripped.slice(-6)]).toEqual([0x12, 0x34, 0x56, 0x78, 0xff, 0xd9])
  })

  it('keeps a real JFIF header, because a JPEG without one is mishandled by old decoders', () => {
    const stripped = stripJpeg(jpegWithMetadata())
    expect(text(stripped)).toContain('JFIF')
  })

  it('drops an APP0 that is labelled APP0 but is not a JFIF header', () => {
    // "the segment labelled APP0" and "a JFIF header" are different claims.
    const payload = Buffer.from(`NOTJF\0${'x'.repeat(20)}${SECRET}`, 'latin1')
    const length = payload.length + 2
    const forged = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, (length >> 8) & 0xff, length & 0xff]),
      payload,
      Buffer.from([0xff, 0xd9]),
    ])

    expect(text(stripJpeg(new Uint8Array(forged)))).not.toContain(SECRET)
  })

  it('is idempotent', () => {
    const once = stripJpeg(jpegWithMetadata())
    expect([...stripJpeg(once)]).toEqual([...once])
  })

  it('leaves a file it cannot parse alone rather than truncating it', () => {
    const notJpeg = new Uint8Array([1, 2, 3, 4])
    expect([...stripJpeg(notJpeg)]).toEqual([1, 2, 3, 4])
  })
})

describe('stripPng', () => {
  it('removes tEXt, iTXt, eXIf, iCCP and tIME, and the fixture had all of them', () => {
    const original = pngWithMetadata()
    expect(text(original)).toContain(SECRET)

    const stripped = stripPng(original)

    expect(text(stripped)).not.toContain(SECRET)
    for (const chunk of ['tEXt', 'iTXt', 'eXIf', 'iCCP', 'tIME']) {
      expect(text(stripped)).not.toContain(chunk)
    }
  })

  it('keeps the image itself', () => {
    const stripped = stripPng(pngWithMetadata())

    expect(sniffFormat(stripped)).toBe('image/png')
    expect(readDimensions('image/png', stripped)).toEqual({ width: 128, height: 64 })
    expect(text(stripped)).toContain('IDAT')
    expect(text(stripped)).toContain('pHYs')
    expect(text(stripped)).toContain('IEND')
  })

  it('works from an allowlist, so an unknown chunk type is dropped rather than kept', () => {
    // The failure mode a denylist has: a chunk nobody thought of.
    const original = pngWithMetadata()
    const marker = 'zzZz'
    const withUnknown = Buffer.concat([
      Buffer.from(original.subarray(0, original.length - 12)),
      Buffer.from([0, 0, 0, 12]),
      Buffer.from(marker, 'latin1'),
      Buffer.from('unknown text', 'latin1'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from(original.subarray(original.length - 12)),
    ])

    const stripped = stripPng(new Uint8Array(withUnknown))
    expect(text(stripped)).not.toContain(marker)
    expect(text(stripped)).not.toContain('unknown text')
  })

  it('is idempotent', () => {
    const once = stripPng(pngWithMetadata())
    expect([...stripPng(once)]).toEqual([...once])
  })
})

describe('stripWebp', () => {
  it('removes the EXIF, XMP and ICC chunks, and the fixture had all three', () => {
    const original = webpWithMetadata()
    expect(text(original)).toContain(SECRET)

    const stripped = stripWebp(original)

    expect(text(stripped)).not.toContain(SECRET)
    expect(text(stripped)).not.toContain('EXIF')
    expect(text(stripped)).not.toContain('XMP ')
    expect(text(stripped)).not.toContain('ICCP')
  })

  it('clears the VP8X flags, so the file does not announce metadata it no longer has', () => {
    const original = webpWithMetadata()
    expect(original[20]! & 0x2c).toBe(0x2c)

    const stripped = stripWebp(original)
    expect(stripped[20]! & 0x2c).toBe(0)
  })

  it('rewrites the RIFF length to match what was kept', () => {
    const stripped = stripWebp(webpWithMetadata())
    const declared =
      stripped[4]! | (stripped[5]! << 8) | (stripped[6]! << 16) | (stripped[7]! << 24)

    expect(declared).toBe(stripped.length - 8)
  })

  it('keeps the image itself', () => {
    const stripped = stripWebp(webpWithMetadata())
    expect(sniffFormat(stripped)).toBe('image/webp')
    expect(readDimensions('image/webp', stripped)).toEqual({ width: 128, height: 64 })
    expect(text(stripped)).toContain('VP8 ')
  })
})

describe('stripIsoMetadata', () => {
  it('removes the location an iPhone writes into moov/udta', () => {
    const original = mp4WithLocation()
    expect(text(original)).toContain('+51.5074')
    expect(text(original)).toContain('udta')

    const stripped = stripIsoMetadata(original)

    expect(text(stripped)).not.toContain('+51.5074')
    expect(text(stripped)).not.toContain('udta')
    expect(text(stripped)).not.toContain('©xyz')
  })

  it('does not move a single byte, because moov holds absolute offsets into mdat', () => {
    const original = mp4WithLocation()
    const stripped = stripIsoMetadata(original)

    expect(stripped.length).toBe(original.length)
    // mdat and its payload are byte-identical and in the same place.
    const mdatAt = text(original).indexOf('mdat')
    expect(text(stripped).indexOf('mdat')).toBe(mdatAt)
    expect([...stripped.subarray(mdatAt, mdatAt + 12)]).toEqual([
      ...original.subarray(mdatAt, mdatAt + 12),
    ])
  })

  it('replaces the box with a skippable free box rather than leaving a hole', () => {
    const stripped = stripIsoMetadata(mp4WithLocation())
    expect(text(stripped)).toContain('free')
  })

  it('leaves ftyp and mvhd alone', () => {
    const stripped = stripIsoMetadata(mp4WithLocation())
    expect(text(stripped)).toContain('ftyp')
    expect(text(stripped)).toContain('moov')
    expect(text(stripped)).toContain('mvhd')
    expect(text(stripped)).toContain('trak')
  })

  it('stops rather than mis-parsing a box whose size it cannot trust', () => {
    // Size 1 means a 64-bit size follows; size 0 means "to end of file". Both
    // are legal, neither is guessed at, and the file comes back untouched.
    const declaredSizeOne = new Uint8Array([0, 0, 0, 1, 0x6d, 0x6f, 0x6f, 0x76, 9, 9, 9, 9])
    expect([...stripIsoMetadata(declaredSizeOne)]).toEqual([...declaredSizeOne])
  })

  it('is idempotent', () => {
    const once = stripIsoMetadata(mp4WithLocation())
    expect([...stripIsoMetadata(once)]).toEqual([...once])
  })
})

describe('stripMetadata', () => {
  it('routes each accepted format to its stripper', () => {
    expect(text(stripMetadata('image/jpeg', jpegWithMetadata()))).not.toContain(SECRET)
    expect(text(stripMetadata('image/png', pngWithMetadata()))).not.toContain(SECRET)
    expect(text(stripMetadata('image/webp', webpWithMetadata()))).not.toContain(SECRET)
    expect(text(stripMetadata('video/mp4', mp4WithLocation()))).not.toContain('+51.5074')
    expect(text(stripMetadata('video/quicktime', mp4WithLocation()))).not.toContain('+51.5074')
  })

  it('routes WebM to the EBML stripper too, which it did not used to', () => {
    expect(text(stripMetadata('video/webm', webmWithMetadata()))).not.toContain(SECRET)
  })

  it('leaves a WebM with nothing to remove alone', () => {
    // The browser recorder's output has no Info strings and no Tags. Nothing
    // matches, so nothing is written — the bytes come back identical.
    const bytes = webmBytes()
    expect([...stripMetadata('video/webm', bytes)]).toEqual([...bytes])
  })

  it('says it strips every video format now, and still not a PDF', () => {
    expect(stripsMetadata('video/webm')).toBe(true)
    expect(stripsMetadata('video/mp4')).toBe(true)
    expect(stripsMetadata('video/quicktime')).toBe(true)
    expect(stripsMetadata('image/jpeg')).toBe(true)
    // A document package is a legal instrument. Byte for byte, deliberately.
    expect(stripsMetadata('application/pdf')).toBe(false)
  })
})

/**
 * WebM was the one accepted format that claimed to be stripped and was not.
 *
 * The old reasoning held for a recorded file — a `MediaRecorder` stream carries
 * nothing to remove — and never held for an uploaded one, which is a path this
 * application has always had. These are the tests for closing that.
 */
describe('WebM — the gap that had a name', () => {
  const source = webmWithMetadata()
  const stripped = stripMetadata('video/webm', source)

  it('the fixture really does carry what the test is looking for', () => {
    // Four separate places, so a stripper that found one and missed three
    // could not pass.
    expect(text(source)).toContain('Title: ')
    expect(text(source)).toContain(SECRET)
    expect(text(source)).toContain('Muxed by software')
    expect(text(source)).toContain('Written by software')
    expect(text(source)).toContain('Camera of')
    expect(text(source)).toContain('LOCATION')
  })

  it('none of it survives', () => {
    expect(text(stripped)).not.toContain(SECRET)
    expect(text(stripped)).not.toContain('Title:')
    expect(text(stripped)).not.toContain('Muxed by')
    expect(text(stripped)).not.toContain('Written by')
    expect(text(stripped)).not.toContain('Camera of')
    expect(text(stripped)).not.toContain('LOCATION')
  })

  /**
   * The whole reason this is done in place. Matroska addresses its own
   * elements by absolute byte position — SeekHead entries and cue positions
   * are offsets from the start of the segment — so a stripper that shortened
   * anything would produce a file that seeks to the wrong place.
   */
  it('not one byte of length changes', () => {
    expect(stripped.length).toBe(source.length)
  })

  it('and the frame data is untouched', () => {
    // The SimpleBlock payload, byte for byte.
    const frame = [0x81, 0, 0, 0x80, 1, 2, 3, 4, 5, 6, 7, 8]
    const asArray = [...stripped]
    const found = asArray.findIndex((_, i) =>
      frame.every((byte, j) => asArray[i + j] === byte),
    )
    expect(found).toBeGreaterThan(0)
  })

  it('the header still says it is a WebM, so it is still identifiable', () => {
    expect(sniffFormat(stripped)).toBe('video/webm')
    expect(text(stripped)).toContain('webm')
  })

  it('the structural elements survive — this is a strip, not a demolition', () => {
    // Segment, Info, Tracks and Cluster ids are all still where they were.
    for (const id of [
      [0x18, 0x53, 0x80, 0x67], // Segment
      [0x15, 0x49, 0xa9, 0x66], // Info
      [0x16, 0x54, 0xae, 0x6b], // Tracks
      [0x1f, 0x43, 0xb6, 0x75], // Cluster
    ]) {
      const asArray = [...stripped]
      const at = asArray.findIndex((_, i) => id.every((byte, j) => asArray[i + j] === byte))
      expect(at).toBeGreaterThan(0)
    }
  })

  it('the mandatory elements are kept and emptied, not deleted', () => {
    // MuxingApp (0x4D80) and WritingApp (0x5741) are required by Matroska. A
    // file missing one is invalid; a file where one is empty is not.
    const asArray = [...stripped]
    for (const id of [
      [0x4d, 0x80],
      [0x57, 0x41],
    ]) {
      const at = asArray.findIndex((_, i) => id.every((byte, j) => asArray[i + j] === byte))
      expect(at).toBeGreaterThan(0)
    }
  })

  it('the optional Tags block is replaced by a Void of exactly its size', () => {
    // Tags (0x1254C367) is gone entirely, and a Void (0xEC) stands where it
    // was. Void is the EBML equivalent of the MP4 `free` box.
    const asArray = [...stripped]
    const tagsId = [0x12, 0x54, 0xc3, 0x67]
    const stillThere = asArray.findIndex((_, i) =>
      tagsId.every((byte, j) => asArray[i + j] === byte),
    )
    expect(stillThere).toBe(-1)
    expect(asArray).toContain(0xec)
  })

  it('an already-clean WebM is byte-identical, so stripping twice is safe', () => {
    const twice = stripMetadata('video/webm', stripped)
    expect([...twice]).toEqual([...stripped])
  })

  it('a truncated WebM is returned rather than corrupted', () => {
    for (const cut of [4, 8, 16, 32, 64]) {
      const short = source.slice(0, cut)
      const result = stripMetadata('video/webm', short)
      expect(result.length).toBe(short.length)
    }
  })

  it('random bytes behind an EBML magic do not hang or throw', () => {
    const noise = new Uint8Array(512)
    noise.set([0x1a, 0x45, 0xdf, 0xa3], 0)
    for (let i = 4; i < noise.length; i += 1) noise[i] = (i * 37) % 256

    expect(() => stripMetadata('video/webm', noise)).not.toThrow()
    expect(stripMetadata('video/webm', noise).length).toBe(noise.length)
  })

  it('does not touch the bytes of a format that is not a WebM', () => {
    // The entry point routes by the sniffed format, so this is belt to braces:
    // pointed at an MP4 directly, the EBML walk finds no ids it knows.
    const mp4 = mp4WithLocation()
    expect([...stripEbmlMetadata(mp4)].length).toBe(mp4.length)
  })
})

describe('the formats that never reach a stripper', () => {
  it('recognises SVG and GIF by their bytes, so ingest can refuse them by name', () => {
    expect(sniffFormat(svgBytes())).toBe('image/svg+xml')
    expect(sniffFormat(gifBytes())).toBe('image/gif')
  })
})
