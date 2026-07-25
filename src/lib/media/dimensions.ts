/**
 * Reading an image's pixel dimensions from its header.
 *
 * Not a validation gate — it is what lets the library screen say "1200 × 400"
 * beside a file, so somebody choosing an email header can tell it apart from a
 * favicon without opening it. Returns null whenever it is not certain, and no
 * caller treats null as a failure.
 *
 * Header bytes only. Nothing here decodes an image.
 */

import type { ImageFormat } from './formats'

export interface Dimensions {
  width: number
  height: number
}

export function readDimensions(format: ImageFormat, bytes: Uint8Array): Dimensions | null {
  switch (format) {
    case 'image/png':
      return readPng(bytes)
    case 'image/jpeg':
      return readJpeg(bytes)
    case 'image/webp':
      return readWebp(bytes)
  }
}

function readPng(bytes: Uint8Array): Dimensions | null {
  // IHDR is required to be the first chunk: 8 signature + 4 length + 4 type.
  if (bytes.length < 24) return null
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null
  return { width: be32(bytes, 16), height: be32(bytes, 20) }
}

function readJpeg(bytes: Uint8Array): Dimensions | null {
  let offset = 2

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null

    let markerAt = offset
    while (markerAt < bytes.length && bytes[markerAt] === 0xff) markerAt += 1
    if (markerAt >= bytes.length) return null

    const marker = bytes[markerAt]!
    if (marker === 0xd9 || marker === 0xda) return null
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset = markerAt + 1
      continue
    }

    if (markerAt + 2 >= bytes.length) return null
    const length = (bytes[markerAt + 1]! << 8) | bytes[markerAt + 2]!

    // Any SOFn except the four that are not frame headers.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

    if (isFrameHeader) {
      if (markerAt + 8 >= bytes.length) return null
      return {
        height: (bytes[markerAt + 4]! << 8) | bytes[markerAt + 5]!,
        width: (bytes[markerAt + 6]! << 8) | bytes[markerAt + 7]!,
      }
    }

    offset = markerAt + 1 + length
  }

  return null
}

function readWebp(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 30) return null
  const fourCc = String.fromCharCode(...bytes.subarray(12, 16))

  if (fourCc === 'VP8X') {
    // Three-byte little-endian, minus one.
    return {
      width: le24(bytes, 24) + 1,
      height: le24(bytes, 27) + 1,
    }
  }

  if (fourCc === 'VP8 ') {
    // Lossy: a start code then two 16-bit fields, 14 bits each.
    if (bytes.length < 30) return null
    return {
      width: ((bytes[27]! << 8) | bytes[26]!) & 0x3fff,
      height: ((bytes[29]! << 8) | bytes[28]!) & 0x3fff,
    }
  }

  if (fourCc === 'VP8L') {
    // Lossless: a signature byte then 14 bits of width and 14 of height.
    if (bytes.length < 25) return null
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }

  return null
}

function be32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>>
    0
  )
}

function le24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}
