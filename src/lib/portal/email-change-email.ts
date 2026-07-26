/**
 * The two messages an address change produces. BUILD_SPEC §13, §15.1.
 *
 * **One goes to the new address** and carries a link that, when opened, moves
 * the contact address on a record. It is sent to an address this application
 * has no reason yet to believe belongs to the investor — that is the entire
 * point of sending it — so it carries **nothing about the record**. No name, no
 * amount, no percentage, no mention of the offer, the round, or the raise. If
 * an investor mistypes a character and it lands in a stranger's mailbox, the
 * stranger learns that somebody typed their address into something at Flipit
 * and nothing else. That constraint is enforced by the shape of the function:
 * it takes two links and a duration, and has no parameter for anything else.
 *
 * **One goes to the old address** once the change has happened, and it is the
 * more important of the two. Moving a contact address is what an account
 * takeover looks like from the inside, and the person still holding the old
 * mailbox is the only one positioned to notice. It says what happened, does not
 * name the new address — that address now belongs to whoever performed the
 * change, and printing it in a message to a mailbox that may have been
 * compromised is handing over a second fact for free — and gives a route to
 * raise it with a person.
 *
 * Neither is compliance-gated, for the reason set out at the head of
 * `sign-in-email.ts`: §8.2's approval covers the two emails that communicate an
 * offer of securities. These say an address was changed.
 */

const FONT =
  "'Helvetica Neue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"

const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b1d33;`
const SMALL = `margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;`

export interface ComposedEmailChangeMessage {
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

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
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
${body}
</table>
</td>
</tr>
</table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// To the new address — the one that carries the link
// ---------------------------------------------------------------------------

export const EMAIL_CHANGE_CONFIRM_SUBJECT = 'Confirm this address for your Flipit portal'

export const EMAIL_CHANGE_CONFIRM_LEAD =
  'This address has been given as the new contact address for a private Flipit investor ' +
  'portal record. Opening the link below is what makes the change take effect.'

/**
 * The line that matters most in this message.
 *
 * A person who did not ask for this has received it because somebody typed
 * their address, deliberately or by mistake. Telling them plainly that doing
 * nothing is the correct and sufficient response is more use than any warning
 * this application could raise, and it is true: without this link being opened,
 * no record anywhere refers to their address.
 */
export const EMAIL_CHANGE_CONFIRM_UNREQUESTED_LINE =
  'If you did not ask for this, do nothing. Nothing has been changed, the link expires on ' +
  'its own, and no record uses this address unless the link below is opened.'

/**
 * @param confirmLink The single-use link. Never logged, never stored in
 * plaintext, never returned to the browser that caused it to be sent.
 * @param verificationLink §15.1, so somebody not expecting this can check that
 * it is genuine without clicking anything in it.
 * @param expiresInMinutes Stated plainly, so a cold link reads as expected
 * rather than as the application being broken.
 */
export function buildEmailChangeConfirmation(
  confirmLink: string,
  verificationLink: string,
  expiresInMinutes: number,
): ComposedEmailChangeMessage {
  const expiry = `This link works once and expires in ${expiresInMinutes} minutes.`

  const html = shell(
    EMAIL_CHANGE_CONFIRM_SUBJECT,
    `<tr>
<td style="padding:28px 24px 8px;">
<p style="${P}">${escapeHtml(EMAIL_CHANGE_CONFIRM_LEAD)}</p>
<p style="${P}"><a href="${escapeHtml(confirmLink)}" style="font-family:${FONT};font-size:16px;font-weight:bold;color:#0b3fd6;">Confirm this address</a></p>
<p style="${SMALL}">${escapeHtml(expiry)}</p>
<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;word-break:break-all;">If the link does not work, copy this address into your browser:<br>${escapeHtml(confirmLink)}</p>
<p style="${SMALL}">${escapeHtml(EMAIL_CHANGE_CONFIRM_UNREQUESTED_LINE)}</p>
</td>
</tr>
<tr>
<td style="padding:8px 24px 26px;border-top:1px solid #e3e7f0;">
<p style="${SMALL}">We will never email you a change of bank details.</p>
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;word-break:break-all;">Not sure this email is genuine? Type ${escapeHtml(verificationLink)} into your browser rather than clicking.</p>
</td>
</tr>`,
  )

  const text = `FLIPIT — INVESTOR PORTAL

${EMAIL_CHANGE_CONFIRM_LEAD}

${confirmLink}

${expiry}

${EMAIL_CHANGE_CONFIRM_UNREQUESTED_LINE}

------------------------------------------------------------
We will never email you a change of bank details.

Not sure this email is genuine? Type ${verificationLink} into your browser rather than clicking.
`

  return { subject: EMAIL_CHANGE_CONFIRM_SUBJECT, html, text }
}

// ---------------------------------------------------------------------------
// To the old address — the one that raises the alarm
// ---------------------------------------------------------------------------

export const EMAIL_CHANGE_NOTICE_SUBJECT =
  'The contact address on your Flipit portal record has changed'

export const EMAIL_CHANGE_NOTICE_LEAD =
  'The contact address on a private Flipit investor portal record has been changed, and ' +
  'this address is no longer the one it uses. This message is being sent here so that you ' +
  'know it happened.'

/**
 * What to do about it, and it is deliberately a person rather than a button.
 *
 * There is no "undo" link in this message, and that absence is the design. An
 * undo link in a mailbox is a credential, and this is precisely the message
 * that gets sent when a mailbox may no longer be in the right hands. Reversing
 * an address change is an operator action taken after a conversation.
 */
export const EMAIL_CHANGE_NOTICE_ACTION_LINE =
  'If you did not ask for this, say so straight away — the change can be undone, but only ' +
  'by a person, and the sooner the better.'

export const EMAIL_CHANGE_NOTICE_NO_CONTACT_LINE =
  'If you did not ask for this, reply to the last message you had from us and say so ' +
  'straight away. The change can be undone, but only by a person.'

/**
 * @param contactAddress Where to raise it. Null when nothing is configured, in
 * which case the message says to reply to previous correspondence rather than
 * naming an address that is not one — the same rule as `contact.ts`.
 */
export function buildEmailChangeNotice(
  contactAddress: string | null,
  verificationLink: string,
): ComposedEmailChangeMessage {
  const address = contactAddress?.trim() ?? ''
  const hasContact = address !== ''

  const actionHtml = hasContact
    ? `${escapeHtml(EMAIL_CHANGE_NOTICE_ACTION_LINE)} Write to <a href="mailto:${escapeHtml(address)}" style="color:#0b3fd6;">${escapeHtml(address)}</a>.`
    : escapeHtml(EMAIL_CHANGE_NOTICE_NO_CONTACT_LINE)

  const actionText = hasContact
    ? `${EMAIL_CHANGE_NOTICE_ACTION_LINE} Write to ${address}.`
    : EMAIL_CHANGE_NOTICE_NO_CONTACT_LINE

  const html = shell(
    EMAIL_CHANGE_NOTICE_SUBJECT,
    `<tr>
<td style="padding:28px 24px 8px;">
<p style="${P}">${escapeHtml(EMAIL_CHANGE_NOTICE_LEAD)}</p>
<p style="${P}">${actionHtml}</p>
</td>
</tr>
<tr>
<td style="padding:8px 24px 26px;border-top:1px solid #e3e7f0;">
<p style="${SMALL}">We will never email you a change of bank details.</p>
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;word-break:break-all;">Not sure this email is genuine? Type ${escapeHtml(verificationLink)} into your browser rather than clicking.</p>
</td>
</tr>`,
  )

  const text = `FLIPIT — INVESTOR PORTAL

${EMAIL_CHANGE_NOTICE_LEAD}

${actionText}

------------------------------------------------------------
We will never email you a change of bank details.

Not sure this email is genuine? Type ${verificationLink} into your browser rather than clicking.
`

  return { subject: EMAIL_CHANGE_NOTICE_SUBJECT, html, text }
}
