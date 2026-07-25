/**
 * The update notification email. BUILD_SPEC §6.
 *
 * *"The notification email says only that an update is available and links to
 * the portal — **it carries no amounts, percentages, or personal detail**."*
 *
 * So this function takes **one argument**: the portal link. It has no parameter
 * for the update's title, its body, the recipient's name, or any figure —
 * which is the reason the rule cannot be broken by a careless edit somewhere
 * else. There is nothing to pass in.
 *
 * That also means every recipient gets a byte-identical message. An email that
 * is the same for everybody cannot leak anything about anybody.
 *
 * The wording is PORTAL_COPY's, verbatim, including the closing line that
 * explains why the update itself is not in the email.
 */

const FONT =
  "'Helvetica Neue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"

const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b1d33;`
const SMALL = `margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;`

export const UPDATE_NOTIFICATION_SUBJECT =
  'A new update is available in your Flipit investor portal'

export const UPDATE_NOTIFICATION_LEAD =
  'There is a new update waiting for you in your private portal.'

export const UPDATE_NOTIFICATION_SECURITY_LINE =
  'For your security, updates are not included in this email.'

export interface ComposedNotification {
  subject: string
  html: string
  text: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * @param portalLink The portal, not a claim link. A returning investor signs in
 * for themselves; minting a credential to announce a notice would make every
 * update an authentication event.
 * @param verificationLink §15.1, so somebody who was not expecting this can
 * check it without clicking anything in it.
 */
export function buildUpdateNotification(
  portalLink: string,
  verificationLink: string,
): ComposedNotification {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(UPDATE_NOTIFICATION_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f6f8fc;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f6f8fc;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #cbd1de;border-radius:4px;">
<tr>
<td style="padding:22px 24px;background-color:#070823;border-radius:4px 4px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="font-family:${FONT};font-size:22px;font-weight:bold;letter-spacing:3px;color:#ffffff;">FLIPIT</td>
</tr>
<tr>
<td style="padding-top:6px;font-family:${FONT};font-size:12px;line-height:1.5;letter-spacing:1px;text-transform:uppercase;color:#9498b5;">Investor portal</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding:28px 24px 8px;">
<p style="${P}">${escapeHtml(UPDATE_NOTIFICATION_LEAD)}</p>
<p style="${P}"><a href="${escapeHtml(portalLink)}" style="font-family:${FONT};font-size:16px;font-weight:bold;color:#0b3fd6;">Open your private portal</a></p>
<p style="${SMALL}">${escapeHtml(UPDATE_NOTIFICATION_SECURITY_LINE)}</p>
</td>
</tr>
<tr>
<td style="padding:8px 24px 26px;border-top:1px solid #e3e7f0;">
<p style="${SMALL}">We will never email you a change of bank details.</p>
<p style="${SMALL}">Not sure this email is genuine? Type ${escapeHtml(verificationLink)} into your browser rather than clicking.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`

  const text = `FLIPIT — INVESTOR PORTAL

${UPDATE_NOTIFICATION_LEAD}

${portalLink}

${UPDATE_NOTIFICATION_SECURITY_LINE}

------------------------------------------------------------
We will never email you a change of bank details.

Not sure this email is genuine? Type ${verificationLink} into your browser rather than clicking.
`

  return { subject: UPDATE_NOTIFICATION_SUBJECT, html, text }
}
