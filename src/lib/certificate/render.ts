import { participationCertificateDataSchema } from './types'
import type { ParticipationCertificateData } from './types'

export const CERTIFICATE_LEGAL_FOOTER =
  'This certificate confirms receipt of funds and a recorded position. It is NOT a share certificate and NOT a title document. The subscription and SPV documents remain the governing instruments.'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function field(label: string, value: string): string {
  return `<div class="field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
}

/**
 * Print-ready, self-contained HTML. Helvetica and the FLIPIT palette are
 * embedded so an HTML-to-PDF adapter cannot silently substitute branding.
 */
export function renderParticipationCertificateHtml(
  input: ParticipationCertificateData,
): string {
  const data = participationCertificateDataSchema.parse(input)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Participation certificate — ${escapeHtml(data.investorName)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #070823; color: #e7e9f5; font-family: Helvetica, Arial, sans-serif; }
    .page { min-height: 297mm; padding: 22mm 20mm 18mm; display: flex; flex-direction: column; }
    .mark { color: #F59A23; font-size: 12px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; }
    h1 { margin: 12mm 0 3mm; font-size: 30px; line-height: 1.1; }
    .version { margin: 0; color: #9498b5; font-size: 12px; }
    .rule { width: 44mm; height: 3px; margin: 9mm 0; background: #F59A23; }
    .statement { margin: 0 0 10mm; max-width: 150mm; color: #cbd1de; font-size: 15px; line-height: 1.6; }
    dl { margin: 0; padding: 7mm; background: #14162f; border: 1px solid rgba(255,255,255,.12); }
    .field { display: grid; grid-template-columns: 58mm 1fr; gap: 6mm; padding: 3.2mm 0; border-bottom: 1px solid rgba(255,255,255,.09); }
    .field:last-child { border-bottom: 0; }
    dt { color: #9498b5; font-size: 12px; }
    dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
    .signature { margin-top: 13mm; }
    .signature strong { display: block; font-size: 15px; }
    .signature span { color: #9498b5; font-size: 12px; }
    footer { margin-top: auto; padding-top: 10mm; border-top: 1px solid rgba(255,255,255,.12); color: #9498b5; font-size: 9px; line-height: 1.45; }
  </style>
</head>
<body>
  <main class="page">
    <header>
      <div class="mark">FLIPIT</div>
      <h1>Participation certificate</h1>
      <p class="version">Version ${data.version} · Issued ${escapeHtml(data.issuedOn)}</p>
      <div class="rule"></div>
    </header>
    <p class="statement">This records that funds have been received and the position below has been recorded for ${escapeHtml(data.investorName)} in ${escapeHtml(data.spvName)}.</p>
    <dl>
      ${field('Investor', data.investorName)}
      ${field('SPV', data.spvName)}
      ${field('Amount received', `${data.currency} ${data.amountReceived}`)}
      ${field('Value date', data.valueDate)}
      ${field('SPV percentage', `${data.spvPercentage}%`)}
      ${field('Indirect Flipit percentage', `${data.indirectFlipitPercentage}%`)}
      ${field('Payment reference', data.paymentReference)}
      ${field('Date of issue', data.issuedOn)}
    </dl>
    <section class="signature" aria-label="Operator sign-off">
      <strong>${escapeHtml(data.signedByName)}</strong>
      <span>${escapeHtml(data.signedByRole)}</span>
    </section>
    <footer>${escapeHtml(CERTIFICATE_LEGAL_FOOTER)}</footer>
  </main>
</body>
</html>`
}

/**
 * The one integration seam for PDF production. The caller supplies the
 * project's eventual browser/host renderer; this package stays database-free
 * and dependency-free while still returning the renderer's PDF Buffer.
 */
export async function generateParticipationCertificatePdf(
  input: ParticipationCertificateData,
  renderHtmlToPdf: (html: string) => Buffer | Promise<Buffer>,
): Promise<Buffer> {
  const html = renderParticipationCertificateHtml(input)
  const pdf = await renderHtmlToPdf(html)
  if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
    throw new Error('The HTML-to-PDF adapter must return a non-empty PDF Buffer.')
  }
  return pdf
}
