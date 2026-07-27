import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { drawablePngWithMetadata, FIXTURE_SECRET_MARKER, pngWithMetadata } from './fixtures'
import { stripPng } from './strip'

/**
 * The one fixture in this repository that has to be a real file.
 *
 * Everything else in `fixtures.ts` is real in *shape* and deliberately fake in
 * its checksums, and that is the right trade for what reads them: `ingest` reads
 * a signature and an `IHDR`, and the stripper works on chunk boundaries and
 * never looks inside one. Neither has any use for a CRC, and a fixture anybody
 * can read beats a fixture anybody can decode.
 *
 * A browser has a use for a CRC. `verify:viewport` uploads an image through the
 * real form and asks whether the thumbnail appears — and a broken image renders
 * as alt text, which has a size, a contrast ratio and a tap target, and passes
 * every other check on that screen while showing an operator nothing. So one
 * fixture is real, and this is what keeps it real: a `zlib` import belongs in a
 * test rather than in a module the verify scripts load, and rebuilding the
 * stream by hand in the fixture is only trustworthy if something independent
 * inflates it.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface Chunk {
  type: string
  payload: Buffer
  crcMatches: boolean
}

/** CRC-32, computed here independently of the implementation under test. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunks(png: Buffer): Chunk[] {
  const found: Chunk[] = []
  let at = 8
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const type = png.subarray(at + 4, at + 8).toString('ascii')
    const payload = png.subarray(at + 8, at + 8 + length)
    const declared = png.readUInt32BE(at + 8 + length)
    found.push({
      type,
      payload: Buffer.from(payload),
      crcMatches: crc32(png.subarray(at + 4, at + 8 + length)) === declared,
    })
    at += 12 + length
  }
  return found
}

describe('drawablePngWithMetadata', () => {
  const png = Buffer.from(drawablePngWithMetadata())
  const parsed = chunks(png)

  it('is a PNG', () => {
    expect(png.subarray(0, 8)).toEqual(SIGNATURE)
    expect(parsed.at(0)?.type).toBe('IHDR')
    expect(parsed.at(-1)?.type).toBe('IEND')
  })

  it('every checksum is real, which is the whole difference', () => {
    // The fixture beside it writes a zero here on purpose. This one cannot.
    for (const chunk of parsed) {
      expect(chunk.crcMatches, `${chunk.type} carries a bad CRC`).toBe(true)
    }
  })

  it('and the fixture beside it still does not, on purpose', () => {
    // If somebody ever "fixes" `pngWithMetadata`, the eleven tests that read it
    // gain nothing and this file loses the contrast that explains why two exist.
    expect(chunks(Buffer.from(pngWithMetadata())).every((chunk) => chunk.crcMatches)).toBe(false)
  })

  it('declares 128 × 64, eight-bit greyscale', () => {
    const ihdr = parsed.find((chunk) => chunk.type === 'IHDR')!
    expect(ihdr.payload.readUInt32BE(0)).toBe(128)
    expect(ihdr.payload.readUInt32BE(4)).toBe(64)
    expect(ihdr.payload[8]).toBe(8) // bit depth
    expect(ihdr.payload[9]).toBe(0) // colour type: greyscale
    expect(ihdr.payload[12]).toBe(0) // not interlaced
  })

  it('and carries exactly that many pixels, inflated by something else', () => {
    // The stream is written by hand as a stored deflate block. `inflateSync` is
    // the independent reader that says whether it was written correctly — a
    // length, its complement and the bytes, with an adler-32 that has to agree.
    const idat = parsed.filter((chunk) => chunk.type === 'IDAT')
    const raw = inflateSync(Buffer.concat(idat.map((chunk) => chunk.payload)))
    expect(raw).toHaveLength(64 * (128 + 1))
    // One filter byte per row, filter 0. A row that started with anything else
    // would decode to noise rather than to a gradient.
    for (let y = 0; y < 64; y += 1) expect(raw[y * 129]).toBe(0)
  })

  it('hides the same thing the other fixtures hide, in blocks that are valid', () => {
    // The point of a real CRC on the metadata blocks too: a browser would draw
    // the *unstripped* file. So "the served copy has none of these" is a
    // statement about this application, not about a malformed input it happened
    // to reject.
    expect(png.includes(FIXTURE_SECRET_MARKER)).toBe(true)
    for (const type of ['tEXt', 'iTXt', 'eXIf']) {
      expect(parsed.some((chunk) => chunk.type === type), type).toBe(true)
    }
  })

  it('survives the stripper as something a browser can still draw', () => {
    // The stripper copies chunks verbatim, so what it leaves keeps the CRCs it
    // was given. If it ever rewrote a chunk without recomputing one, the library
    // would store images no browser would display and only this would say so.
    const stripped = Buffer.from(stripPng(drawablePngWithMetadata()))
    const after = chunks(stripped)

    for (const chunk of after) {
      expect(chunk.crcMatches, `${chunk.type} carries a bad CRC after stripping`).toBe(true)
    }
    for (const type of ['tEXt', 'iTXt', 'eXIf']) {
      expect(after.some((chunk) => chunk.type === type), type).toBe(false)
    }
    expect(stripped.includes(FIXTURE_SECRET_MARKER)).toBe(false)

    // Still an image: the header, the pixels and the terminator all survive.
    expect(after.at(0)?.type).toBe('IHDR')
    expect(after.at(-1)?.type).toBe('IEND')
    const raw = inflateSync(
      Buffer.concat(after.filter((c) => c.type === 'IDAT').map((c) => c.payload)),
    )
    expect(raw).toHaveLength(64 * (128 + 1))
  })
})
