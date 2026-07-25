/**
 * The email carrying a sign-in link. BUILD_SPEC §4.1, §4.2, §15.1.
 *
 * This is the message a returning investor gets when they ask for a way back
 * in. Until now the link was minted, stored hashed, and never sent — so the
 * portal told every returning investor *"If that address has a record with us,
 * a sign-in link is on its way"* and nothing was ever on its way. Anyone whose
 * session lapsed was locked out by a sentence that was not true.
 *
 * **It is not compliance-gated, and that is deliberate.** §8.2's approval
 * covers the invitation and the reminder — the two emails that communicate an
 * offer of securities. This one says a person asked to sign in and here is the
 * door. It is the same category as the update notification (§6) and the Q&A
 * reply (§6.7.6): ordinary correspondence with somebody who already holds a
 * record. Registering it would mean that changing one word here voids the
 * approval that lets invitations go out, which is not a stricter reading of
 * §8.2 — it is a broken one.
 *
 * **It carries the link and nothing else.** No name, no amount, no percentage,
 * no mention of the offer, the round, or the raise. Two reasons. A sign-in
 * email lands in a mailbox that may be the reason the person is signing in
 * again, and it is the message an attacker would most like to trigger for
 * somebody else's address; neither is a good place for the terms of a private
 * placement. So this function takes two links and a duration, and has no
 * parameter for anything else — which is what makes the rule hold against a
 * careless edit rather than against good intentions.
 */

const FONT =
  "'Helvetica Neue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"

const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b1d33;`
const SMALL = `margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;`

export const SIGN_IN_EMAIL_SUBJECT = 'Your Flipit investor portal sign-in link'

export const SIGN_IN_EMAIL_LEAD =
  'Somebody asked for a link to your private Flipit investor portal. If that was you, here it is.'

/**
 * The line that matters most in the whole message.
 *
 * An unrequested sign-in email is what an attempt on somebody's account looks
 * like from the inside, and the recipient is the only person positioned to
 * notice. Telling them plainly that ignoring it is safe — and that it expires
 * on its own — is more use than any warning the application could raise.
 */
export const SIGN_IN_EMAIL_UNREQUESTED_LINE =
  'If you did not ask for this, you can ignore this email. The link expires on its own and nobody can use it without opening it from this message.'

export interface ComposedSignInEmail {
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
 * @param signInLink The single-use link. Never logged, never stored in
 * plaintext, and never returned to the browser that asked for it.
 * @param verificationLink §15.1 — so somebody who was not expecting this can
 * check that it is genuine without clicking anything in it.
 * @param expiresInMinutes Stated plainly, so a link that has gone cold reads as
 * expected rather than as the application being broken.
 */
export function buildSignInEmail(
  signInLink: string,
  verificationLink: string,
  expiresInMinutes: number,
): ComposedSignInEmail {
  const expiry = `This link works once and expires in ${expiresInMinutes} minutes.`

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(SIGN_IN_EMAIL_SUBJECT)}</title>
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
<p style="${P}">${escapeHtml(SIGN_IN_EMAIL_LEAD)}</p>
<p style="${P}"><a href="${escapeHtml(signInLink)}" style="font-family:${FONT};font-size:16px;font-weight:bold;color:#0b3fd6;">Sign in to your private portal</a></p>
<p style="${SMALL}">${escapeHtml(expiry)}</p>
<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;word-break:break-all;">If the link does not work, copy this address into your browser:<br>${escapeHtml(signInLink)}</p>
<p style="${SMALL}">${escapeHtml(SIGN_IN_EMAIL_UNREQUESTED_LINE)}</p>
</td>
</tr>
<tr>
<td style="padding:8px 24px 26px;border-top:1px solid #e3e7f0;">
<p style="${SMALL}">We will never email you a change of bank details.</p>
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;word-break:break-all;">Not sure this email is genuine? Type ${escapeHtml(verificationLink)} into your browser rather than clicking.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`

  const text = `FLIPIT — INVESTOR PORTAL

${SIGN_IN_EMAIL_LEAD}

${signInLink}

${expiry}

${SIGN_IN_EMAIL_UNREQUESTED_LINE}

------------------------------------------------------------
We will never email you a change of bank details.

Not sure this email is genuine? Type ${verificationLink} into your browser rather than clicking.
`

  return { subject: SIGN_IN_EMAIL_SUBJECT, html, text }
}
