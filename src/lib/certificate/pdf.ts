/**
 * A PDF writer, in about three hundred lines and with no dependencies at all.
 *
 * BUILD_SPEC §5.1 wants a branded PDF. The obvious way to get one is to render
 * HTML in a headless browser, and this application deliberately does not do
 * that. The reasoning is the same one that replaced argon2 with scrypt: the
 * deployment target runs this app as bundled serverless functions, and a
 * headless Chromium is a 300 MB native binary that has to survive both the
 * dependency install and the bundler's tracing to reach the runtime. The
 * failure mode is the worst available — everything works locally, the deploy
 * goes green, and then the first investor to have their funds recorded gets an
 * error instead of their certificate.
 *
 * So the certificate is written directly. A PDF is a small text format: a
 * handful of objects, a content stream of drawing operators, and a table of
 * byte offsets. The fourteen standard fonts, Helvetica among them, need no
 * embedding — every reader has them. That is the whole trick, and it means
 * this file has no native module, no download, and nothing to go wrong at
 * bundle time.
 *
 * What it deliberately does NOT do: images, embedded fonts, transparency,
 * multiple pages, or anything else the certificate does not need. This is not a
 * PDF library and should never grow into one.
 */

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** A4 in PostScript points. */
export const PAGE_WIDTH = 595.28
export const PAGE_HEIGHT = 841.89

export type FontName = 'Helvetica' | 'Helvetica-Bold'

/**
 * Advance widths for printable ASCII, in 1/1000 em, from the standard Adobe
 * font metrics. Only 32–126 — every character outside that range is
 * transliterated before it reaches here (see `toWinAnsi`), so an unmeasurable
 * character cannot exist by the time a width is needed.
 */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722,
  722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
]

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722,
  722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
]

function widthsFor(font: FontName): number[] {
  return font === 'Helvetica-Bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
}

/**
 * Anything outside printable ASCII is transliterated rather than dropped.
 *
 * A certificate carries a person's name, and a name is the last thing that
 * should silently lose a character. The common typographic characters this
 * application produces — curly quotes, en and em dashes, the ellipsis — have
 * exact ASCII equivalents; accented Latin letters are folded to their base
 * letter, which is wrong but legible, and far better than a blank box.
 */
export function toWinAnsi(value: string): string {
  const map: Record<string, string> = {
    '‘': "'",
    '’': "'",
    '‚': ',',
    '“': '"',
    '”': '"',
    '–': '-',
    '—': '-',
    '…': '...',
    ' ': ' ',
    '•': '-',
    '·': '-',
    '°': ' deg',
    '×': 'x',
    '£': 'GBP ',
    '€': 'EUR ',
  }

  return value
    .normalize('NFKD')
    // Strip combining marks left by the decomposition: "é" → "e".
    .replace(/[̀-ͯ]/g, '')
    .split('')
    .map((character) => {
      if (map[character]) return map[character]
      const code = character.codePointAt(0) ?? 63
      return code >= 32 && code <= 126 ? character : '?'
    })
    .join('')
}

/** Width of a string at a given size, in points. */
export function measure(text: string, font: FontName, size: number): number {
  const widths = widthsFor(font)
  let total = 0
  for (const character of toWinAnsi(text)) {
    const index = character.charCodeAt(0) - 32
    total += widths[index] ?? 556
  }
  return (total * size) / 1000
}

/** Greedy word wrap to a maximum width. Never splits a word. */
export function wrap(text: string, font: FontName, size: number, maxWidth: number): string[] {
  const words = toWinAnsi(text).split(/\s+/).filter((word) => word !== '')
  if (words.length === 0) return []

  const lines: string[] = []
  let line = words[0]!

  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`
    if (measure(candidate, font, size) <= maxWidth) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }

  lines.push(line)
  return lines
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number
  g: number
  b: number
}

/** `#RRGGBB` to the 0–1 components a PDF operator wants. */
export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '')
  return {
    r: Number.parseInt(value.slice(0, 2), 16) / 255,
    g: Number.parseInt(value.slice(2, 4), 16) / 255,
    b: Number.parseInt(value.slice(4, 6), 16) / 255,
  }
}

function pdfString(value: string): string {
  return toWinAnsi(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function fixed(value: number): string {
  return value.toFixed(2)
}

/**
 * A page being drawn.
 *
 * The coordinate system is the PDF one — origin bottom-left, y increasing
 * upwards. Callers work in the same system rather than in a flipped one,
 * because a flipped wrapper is one more thing that can be subtly wrong and the
 * certificate is laid out once.
 */
export class PdfPage {
  private readonly operations: string[] = []

  fillColor(hex: string): this {
    const { r, g, b } = hexToRgb(hex)
    this.operations.push(`${fixed(r)} ${fixed(g)} ${fixed(b)} rg`)
    return this
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.operations.push(`${fixed(x)} ${fixed(y)} ${fixed(width)} ${fixed(height)} re f`)
    return this
  }

  text(
    value: string,
    options: { x: number; y: number; font?: FontName; size?: number; color?: string; letterSpacing?: number },
  ): this {
    const font = options.font ?? 'Helvetica'
    const size = options.size ?? 11
    if (options.color) this.fillColor(options.color)

    const resource = font === 'Helvetica-Bold' ? '/F2' : '/F1'
    this.operations.push('BT')
    if (options.letterSpacing) this.operations.push(`${fixed(options.letterSpacing)} Tc`)
    this.operations.push(`${resource} ${fixed(size)} Tf`)
    this.operations.push(`1 0 0 1 ${fixed(options.x)} ${fixed(options.y)} Tm`)
    this.operations.push(`(${pdfString(value)}) Tj`)
    this.operations.push('ET')
    if (options.letterSpacing) this.operations.push('0 Tc')
    return this
  }

  /** Draws wrapped text downwards from `y` and returns the y after the last line. */
  paragraph(
    value: string,
    options: {
      x: number
      y: number
      maxWidth: number
      font?: FontName
      size?: number
      color?: string
      lineHeight?: number
    },
  ): number {
    const font = options.font ?? 'Helvetica'
    const size = options.size ?? 11
    const lineHeight = options.lineHeight ?? size * 1.45

    let y = options.y
    for (const line of wrap(value, font, size, options.maxWidth)) {
      this.text(line, { x: options.x, y, font, size, color: options.color })
      y -= lineHeight
    }
    return y
  }

  toContentStream(): string {
    return this.operations.join('\n')
  }
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Assemble a one-page PDF.
 *
 * The structure is the minimum a conforming reader needs: a catalogue, a page
 * tree with one page, a content stream, and the two standard fonts. The
 * cross-reference table records the byte offset of every object, which is why
 * the body is built as a list of strings and measured as it goes rather than
 * being concatenated at the end.
 */
export function buildPdf(page: PdfPage, metadata: { title: string; author: string }): Buffer {
  const content = page.toContentStream()

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(PAGE_WIDTH)} ${fixed(PAGE_HEIGHT)}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${pdfString(metadata.title)}) /Author (${pdfString(metadata.author)}) ` +
      '/Producer (Flipit SPV Investor Portal) >>',
  ]

  const header = '%PDF-1.4\n%âãÏÓ\n'
  const parts: string[] = [header]
  const offsets: number[] = []
  let position = Buffer.byteLength(header, 'latin1')

  for (const [index, body] of objects.entries()) {
    const serialised = `${index + 1} 0 obj\n${body}\nendobj\n`
    offsets.push(position)
    parts.push(serialised)
    position += Buffer.byteLength(serialised, 'latin1')
  }

  const xrefStart = position
  const rows = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ']
  for (const offset of offsets) {
    rows.push(`${String(offset).padStart(10, '0')} 00000 n `)
  }

  const trailer =
    `${rows.join('\n')}\n` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`

  parts.push(trailer)

  return Buffer.from(parts.join(''), 'latin1')
}
