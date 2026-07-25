/**
 * The certificate, drawn. BUILD_SPEC §5.1, §13.2.
 *
 * Everything §5.1 lists is on the page: the investor's name, the SPV, the
 * amount received, the value date, the SPV percentage, the resulting indirect
 * Flipit percentage, the reference, and the date of issue. Then David's name
 * and his stated role, and the footer line the spec requires word for word —
 * *"it confirms receipt of funds and a recorded position. It is not a share
 * certificate, not a title document, and must say so in a footer line."*
 *
 * The figures arrive as strings and are printed as strings. Nothing on this
 * page has ever been a JavaScript number.
 */

import { CERTIFICATE_LEGAL_FOOTER } from './render'
import { PAGE_HEIGHT, PAGE_WIDTH, PdfPage, buildPdf, measure } from './pdf'
import { participationCertificateDataSchema, type ParticipationCertificateData } from './types'

/** §13.2. */
const INK = '#070823'
const PANEL = '#14162f'
const ACCENT = '#F59A23'
const TEXT = '#e7e9f5'
const DIM = '#9498b5'
const BRIGHT = '#ffffff'

const MARGIN = 56

export function renderCertificatePdf(input: ParticipationCertificateData): Buffer {
  const data = participationCertificateDataSchema.parse(input)
  const page = new PdfPage()
  const contentWidth = PAGE_WIDTH - MARGIN * 2

  // The page itself.
  page.fillColor(INK).rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  let y = PAGE_HEIGHT - MARGIN - 14

  page.text('FLIPIT', {
    x: MARGIN,
    y,
    font: 'Helvetica-Bold',
    size: 16,
    color: ACCENT,
    letterSpacing: 3.4,
  })

  y -= 46
  page.text('Participation certificate', {
    x: MARGIN,
    y,
    font: 'Helvetica-Bold',
    size: 26,
    color: BRIGHT,
  })

  y -= 20
  page.text(`Version ${data.version} · Issued ${data.issuedOn}`, {
    x: MARGIN,
    y,
    size: 10,
    color: DIM,
  })

  y -= 22
  page.fillColor(ACCENT).rect(MARGIN, y, 124, 3)

  y -= 34
  y = page.paragraph(
    `This records that funds have been received and the position below has been recorded for ` +
      `${data.investorName} in ${data.spvName}.`,
    { x: MARGIN, y, maxWidth: contentWidth - 40, size: 12, color: '#cbd1de', lineHeight: 18 },
  )

  // --- The panel of facts -------------------------------------------------
  const fields: Array<[string, string]> = [
    ['Investor', data.investorName],
    ['SPV', data.spvName],
    ['Amount received', `${data.currency} ${data.amountReceived}`],
    ['Value date', data.valueDate],
    ['SPV percentage', `${data.spvPercentage}%`],
    ['Indirect Flipit percentage', `${data.indirectFlipitPercentage}%`],
    ['Payment reference', data.paymentReference],
    ['Date of issue', data.issuedOn],
  ]

  const rowHeight = 26
  const panelPadding = 18
  const panelHeight = fields.length * rowHeight + panelPadding * 2 - 8

  y -= 18
  const panelTop = y
  page.fillColor(PANEL).rect(MARGIN, panelTop - panelHeight, contentWidth, panelHeight)

  let rowY = panelTop - panelPadding - 10
  for (const [index, [label, value]] of fields.entries()) {
    page.text(label, { x: MARGIN + panelPadding, y: rowY, size: 9.5, color: DIM })
    page.text(value, {
      x: MARGIN + panelPadding + 168,
      y: rowY,
      size: 11,
      color: TEXT,
      font: 'Helvetica-Bold',
    })

    if (index < fields.length - 1) {
      page
        .fillColor('#2a2d52')
        .rect(MARGIN + panelPadding, rowY - 9, contentWidth - panelPadding * 2, 0.6)
    }

    rowY -= rowHeight
  }

  y = panelTop - panelHeight - 44

  // --- Sign-off -----------------------------------------------------------
  page.text(data.signedByName, { x: MARGIN, y, size: 13, font: 'Helvetica-Bold', color: BRIGHT })
  y -= 15
  page.text(data.signedByRole, { x: MARGIN, y, size: 10, color: DIM })

  // --- The footer §5.1 requires -------------------------------------------
  const footerTop = MARGIN + 46
  page.fillColor('#2a2d52').rect(MARGIN, footerTop, contentWidth, 0.6)

  page.paragraph(CERTIFICATE_LEGAL_FOOTER, {
    x: MARGIN,
    y: footerTop - 16,
    maxWidth: contentWidth,
    size: 8,
    color: DIM,
    lineHeight: 11,
  })

  return buildPdf(page, {
    title: `Participation certificate — ${data.investorName}`,
    author: data.signedByName,
  })
}

/** Exported for the layout test, which checks nothing overflows the page. */
export { measure }
