/**
 * The reminder. BUILD_SPEC §6.5.
 *
 * This is the only email in the system that sends without a human pressing
 * send at that moment, and the constraints on it are the reason that is
 * acceptable:
 *
 *   - **No offer terms, amounts, or percentages.** Not the investment amount,
 *     not the SPV percentage, not the indirect interest, not the aggregate
 *     raise. "Those live in the portal, which is where the investor should be
 *     looking anyway." A test asserts the rendered text part contains no `%`,
 *     no `USD`, and no currency figure at all.
 *   - It restates the deadline and nothing else.
 *   - **Its own template, its own hash, its own compliance approval** (§8.2).
 *     Reminders do not send under the invitation's approval, which is why this
 *     is a separate module rather than a shortened branch of the invitation.
 *
 * It is also deliberately much shorter. A nudge that restates the whole offer
 * is a second solicitation, not a nudge.
 */

export const REMINDER_SUBJECT = 'A reminder about your private Flipit invitation'

const FONT =
  "'Helvetica Neue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"

const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b1d33;`

export const REMINDER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${REMINDER_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f6f8fc;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#f6f8fc;">Your private Flipit portal is waiting. Please respond by {{response_deadline}}.</div>

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
<td style="padding-top:6px;font-family:${FONT};font-size:12px;line-height:1.5;letter-spacing:1px;text-transform:uppercase;color:#9498b5;">Private investment invitation</td>
</tr>
</table>
</td>
</tr>

<tr>
<td style="padding:28px 24px 4px;">

<p style="${P}">Dear {{recipient_name}},</p>

<p style="${P}">This is a short reminder that your private Flipit portal is open and waiting for your response.</p>

<p style="margin:0 0 20px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b1d33;"><strong>Please respond by {{response_deadline}}.</strong></p>

<p style="${P}">Everything about the invitation &mdash; the details, your documents, and the response options &mdash; is in the portal. Nothing is repeated in this email.</p>

</td>
</tr>

<tr>
<td align="center" style="padding:8px 24px 4px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="#F59A23" style="background-color:#F59A23;border-radius:4px;">
<a href="{{secure_portal_link}}" style="display:inline-block;padding:15px 32px;font-family:${FONT};font-size:16px;font-weight:bold;line-height:1.2;color:#0b0c22;text-decoration:none;">Open your private portal</a>
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td align="center" style="padding:12px 24px 16px;">
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#5a5f78;word-break:break-all;">If the button does not work, copy this address into your browser:<br><a href="{{secure_portal_link}}" style="color:#1b4fa8;text-decoration:underline;">{{secure_portal_link}}</a></p>
</td>
</tr>

<tr>
<td style="padding:0 24px;">

<p style="${P}">If you would rather not take part, you do not need to do anything. You are also welcome to reply to this email and say so.</p>

<p style="${P}">Kind regards,</p>

<p style="margin:0 0 4px;font-family:${FONT};font-size:16px;line-height:1.6;font-weight:bold;color:#1b1d33;">{{sender_name}}</p>
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;">SPV Manager</p>
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;"><a href="mailto:{{sender_email}}" style="color:#1b4fa8;text-decoration:underline;">{{sender_email}}</a></p>
{{#if contact_phone}}
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;">Telephone {{sender_phone}}</p>
{{/if}}
{{#if contact_whatsapp}}
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;">WhatsApp {{sender_phone}}</p>
{{/if}}

</td>
</tr>

<tr>
<td style="padding:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #cbd1de;">
<tr>
<td style="padding-top:16px;">
<p style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:1.6;color:#5a5f78;">This message was sent to you personally. It is not an offer to the public, investment advice, or a recommendation. We will never email you a change of bank details.</p>
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#5a5f78;word-break:break-all;">Not sure this email is genuine? Type <a href="{{verification_link}}" style="color:#1b4fa8;text-decoration:underline;">{{verification_link}}</a> into your browser rather than clicking.</p>
</td>
</tr>
</table>
</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`

export const REMINDER_TEXT = `FLIPIT — PRIVATE INVESTMENT INVITATION

Dear {{recipient_name}},

This is a short reminder that your private Flipit portal is open and waiting for your response.

Please respond by {{response_deadline}}.

Everything about the invitation - the details, your documents, and the response options - is in the portal. Nothing is repeated in this email.

{{secure_portal_link}}

If you would rather not take part, you do not need to do anything. You are also welcome to reply to this email and say so.

Kind regards,

{{sender_name}}
SPV Manager
{{sender_email}}
{{#if contact_phone}}
Telephone {{sender_phone}}
{{/if}}
{{#if contact_whatsapp}}
WhatsApp {{sender_phone}}
{{/if}}

------------------------------------------------------------
This message was sent to you personally. It is not an offer to the public, investment advice, or a recommendation. We will never email you a change of bank details.

Not sure this email is genuine? Type {{verification_link}} into your browser rather than clicking.
`
