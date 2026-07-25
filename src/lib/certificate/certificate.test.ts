import { describe, expect, it } from 'vitest'
import {
  appendCorrectedCertificateVersion,
  CERTIFICATE_LEGAL_FOOTER,
  generateParticipationCertificatePdf,
  renderParticipationCertificateHtml,
  type ParticipationCertificateData,
} from '.'

const certificate: ParticipationCertificateData = {
  investorName: 'Alex Investor',
  spvName: 'Flipit Global SPV',
  amountReceived: '12500.40',
  currency: 'USD',
  valueDate: '2026-08-04',
  spvPercentage: '4.166800',
  indirectFlipitPercentage: '1.250040',
  paymentReference: '000042',
  issuedOn: '2026-08-05',
  signedByName: 'David Serene',
  signedByRole: 'SPV Operator',
  version: 1,
}

describe('participation certificate', () => {
  it('renders the exact recorded figures and operator sign-off', () => {
    const html = renderParticipationCertificateHtml(certificate)

    expect(html).toContain('USD 12500.40')
    expect(html).toContain('4.166800%')
    expect(html).toContain('1.250040%')
    expect(html).toContain('000042')
    expect(html).toContain('David Serene')
    expect(html).toContain('SPV Operator')
  })

  it('always carries the mandatory legal footer', () => {
    expect(renderParticipationCertificateHtml(certificate)).toContain(
      CERTIFICATE_LEGAL_FOOTER,
    )
  })

  it('returns the PDF buffer supplied by the single renderer seam', async () => {
    const expected = Buffer.from('%PDF-1.7 test')
    const actual = await generateParticipationCertificatePdf(
      certificate,
      (html) => {
        expect(html).toContain(CERTIFICATE_LEGAL_FOOTER)
        return expected
      },
    )

    expect(actual).toEqual(expected)
  })

  it('retains and supersedes the old version when a figure is corrected', () => {
    const correctedAt = '2026-08-06T10:00:00.000Z'
    const history = appendCorrectedCertificateVersion(
      [{ data: certificate, supersededAt: null }],
      { ...certificate, amountReceived: '13000.40' },
      correctedAt,
    )

    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({
      data: { version: 1, amountReceived: '12500.40' },
      supersededAt: correctedAt,
    })
    expect(history[1]).toMatchObject({
      data: { version: 2, amountReceived: '13000.40' },
      supersededAt: null,
    })
  })
})
