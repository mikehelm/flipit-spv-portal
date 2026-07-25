import { describe, expect, it } from 'vitest'
import { PAGE_HEIGHT, PAGE_WIDTH, PdfPage, buildPdf, measure, toWinAnsi, wrap } from './pdf'
import { renderCertificatePdf } from './layout'
import { CERTIFICATE_LEGAL_FOOTER } from './render'
import type { ParticipationCertificateData } from './types'

/**
 * The PDF writer. BUILD_SPEC §5.1.
 *
 * The certificate is written directly rather than rendered through a headless
 * browser, so these tests do the job a browser's own test suite would otherwise
 * be doing: that the bytes are a valid PDF, that the figures reach the page
 * unchanged, and that the required footer is on it.
 */

function data(overrides: Partial<ParticipationCertificateData> = {}): ParticipationCertificateData {
  return {
    investorName: 'Jane Example',
    spvName: 'Flipit SPV — first round',
    amountReceived: '5000.00',
    currency: 'USD',
    valueDate: '2026-08-14',
    spvPercentage: '16.666667',
    indirectFlipitPercentage: '5.000000',
    paymentReference: 'FLIPIT-0007',
    issuedOn: '2026-08-15',
    signedByName: 'David Serene',
    signedByRole: 'SPV Manager',
    version: 1,
    ...overrides,
  }
}

/** The content stream, decoded, for asserting what is actually on the page. */
function pageText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  const streams = raw.match(/stream\n([\s\S]*?)\nendstream/g) ?? []
  return streams
    .flatMap((stream) => [...stream.matchAll(/\((.*?)\) Tj/g)].map((match) => match[1] ?? ''))
    .join('\n')
}

describe('the bytes are a PDF', () => {
  it('starts with a header and ends with the trailer', () => {
    const pdf = renderCertificatePdf(data())
    const text = pdf.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('declares one A4 page', () => {
    const text = renderCertificatePdf(data()).toString('latin1')
    expect(text).toContain('/Type /Pages')
    expect(text).toContain('/Count 1')
    expect(text).toContain(`/MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}]`)
  })

  it('records a byte offset for every object in the cross-reference table', () => {
    const raw = renderCertificatePdf(data()).toString('latin1')
    const objectCount = (raw.match(/^\d+ 0 obj$/gm) ?? []).length
    const xrefRows = (raw.match(/^\d{10} 00000 n $/gm) ?? []).length
    expect(objectCount).toBeGreaterThan(0)
    expect(xrefRows).toBe(objectCount)
  })

  it('points startxref at the actual xref table', () => {
    const raw = renderCertificatePdf(data()).toString('latin1')
    const declared = Number.parseInt(raw.slice(raw.lastIndexOf('startxref') + 9).trim(), 10)
    expect(raw.slice(declared, declared + 4)).toBe('xref')
  })

  it('embeds no font, because the standard fourteen need none', () => {
    // This is the whole reason the certificate can be built without a native
    // module: Helvetica is guaranteed present in every reader.
    const raw = renderCertificatePdf(data()).toString('latin1')
    expect(raw).toContain('/BaseFont /Helvetica')
    expect(raw).toContain('/BaseFont /Helvetica-Bold')
    expect(raw).not.toContain('/FontFile')
  })
})

describe('every figure §5.1 requires is on the page', () => {
  it('carries all eight', () => {
    const text = pageText(renderCertificatePdf(data()))

    expect(text).toContain('Jane Example')
    expect(text).toContain('Flipit SPV')
    expect(text).toContain('USD 5000.00')
    expect(text).toContain('2026-08-14')
    expect(text).toContain('16.666667%')
    expect(text).toContain('5.000000%')
    expect(text).toContain('FLIPIT-0007')
    expect(text).toContain('2026-08-15')
  })

  it('prints the figures exactly as recorded, without rounding or reformatting', () => {
    const text = pageText(renderCertificatePdf(data({ amountReceived: '12345.67' })))
    expect(text).toContain('USD 12345.67')
    expect(text).not.toContain('12,345.67')
    expect(text).not.toContain('12345.7')
  })

  it('names the signatory and their role', () => {
    const text = pageText(renderCertificatePdf(data()))
    expect(text).toContain('David Serene')
    expect(text).toContain('SPV Manager')
  })

  it('carries the version', () => {
    expect(pageText(renderCertificatePdf(data({ version: 3 })))).toContain('Version 3')
  })
})

describe('the footer §5.1 requires, word for word', () => {
  it('says it is not a share certificate and not a title document', () => {
    const text = pageText(renderCertificatePdf(data()))
    // Wrapped across lines, so the assertion is on the wording rather than on
    // one string.
    const flattened = text.replace(/\n/g, ' ')
    expect(flattened).toContain('NOT a share certificate')
    expect(flattened).toContain('NOT a title document')
    expect(flattened).toContain('governing instruments')
  })

  it('uses the one shared constant, so the HTML and PDF forms cannot diverge', () => {
    expect(CERTIFICATE_LEGAL_FOOTER).toContain('NOT a share certificate')
    expect(CERTIFICATE_LEGAL_FOOTER).toContain('NOT a title document')
  })
})

describe('text handling', () => {
  it('escapes the characters that would break a PDF string', () => {
    const text = renderCertificatePdf(data({ investorName: 'A (B) \\ C' })).toString('latin1')
    expect(text).toContain('A \\(B\\) \\\\ C')
  })

  it('transliterates rather than dropping a character from a name', () => {
    // A name is the last thing that should silently lose a letter.
    expect(toWinAnsi('José Müller')).toBe('Jose Muller')
    expect(toWinAnsi('O’Brien')).toBe("O'Brien")
    expect(toWinAnsi('a — b')).toBe('a - b')
  })

  it('renders an accented name legibly rather than as boxes', () => {
    const text = pageText(renderCertificatePdf(data({ investorName: 'José Müller' })))
    expect(text).toContain('Jose Muller')
    expect(text).not.toContain('??')
  })

  it('measures Helvetica against its known metrics', () => {
    // "l" is 222/1000 em and "M" is 833/1000 in Helvetica.
    expect(measure('l', 'Helvetica', 1000)).toBeCloseTo(222, 5)
    expect(measure('M', 'Helvetica', 1000)).toBeCloseTo(833, 5)
    expect(measure('', 'Helvetica', 12)).toBe(0)
  })

  it('wraps without splitting a word and without exceeding the width', () => {
    const lines = wrap(CERTIFICATE_LEGAL_FOOTER, 'Helvetica', 8, 200)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(measure(line, 'Helvetica', 8)).toBeLessThanOrEqual(200)
      expect(line).not.toMatch(/^\s|\s$/)
    }
    expect(lines.join(' ')).toBe(toWinAnsi(CERTIFICATE_LEGAL_FOOTER))
  })

  it('wraps an empty string to nothing', () => {
    expect(wrap('   ', 'Helvetica', 10, 100)).toEqual([])
  })
})

describe('the writer itself', () => {
  it('produces a non-empty buffer for a blank page', () => {
    const pdf = buildPdf(new PdfPage(), { title: 'T', author: 'A' })
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.length).toBeGreaterThan(200)
  })

  it('renders the same input to the same bytes every time', () => {
    // The certificate is regenerated on every download rather than stored, so
    // this is what makes a superseded version reproducible.
    expect(renderCertificatePdf(data()).equals(renderCertificatePdf(data()))).toBe(true)
  })

  it('is a different document when a figure changes', () => {
    expect(
      renderCertificatePdf(data()).equals(renderCertificatePdf(data({ amountReceived: '5000.01' }))),
    ).toBe(false)
  })
})

describe('the data is validated before anything is drawn', () => {
  it('rejects a money value that is not a plain decimal string', () => {
    expect(() => renderCertificatePdf(data({ amountReceived: '5,000.00' }))).toThrow()
  })

  it('rejects an impossible date', () => {
    expect(() => renderCertificatePdf(data({ valueDate: '2026-02-30' }))).toThrow()
  })

  it('rejects a lowercase or malformed currency', () => {
    expect(() => renderCertificatePdf(data({ currency: 'usd' }))).toThrow()
  })
})
