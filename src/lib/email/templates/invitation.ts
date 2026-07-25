/**
 * The invitation. BUILD_SPEC §11.5, copy from EMAIL_TEMPLATE.txt.
 *
 * The approved wording is reproduced sentence for sentence. Where the copy
 * named David directly it now reads `{{sender_name}}`, which renders to the
 * identical text and stops the email contradicting the configured sender.
 *
 * Design constraints, all of them from §11.5 and none of them negotiable:
 *
 *   - Table layout, inline styles. Email clients have not moved on.
 *   - 600px maximum, legible at 375px.
 *   - Dark header carrying the wordmark, light readable body.
 *   - **Orange is used for the portal button and nothing else.**
 *   - **It must read correctly with images blocked**, which is how many
 *     clients open mail by default. So there are no images at all: the
 *     wordmark is live text, the button is a table cell with a background
 *     colour, and no background image carries meaning.
 *   - The offer figures sit in a bordered panel that survives being read
 *     alone — it repeats the recipient's name and carries its own footnote,
 *     because this is the part people screenshot and forward.
 *   - No tracking pixel (§12). No "Made by Make with Mike" (§13.2 — a maker's
 *     credit does not belong on a formal instrument about someone's money).
 *
 * The plain-text part is not a courtesy. §11.5 makes it mandatory and requires
 * it to carry the same information; a test asserts every figure present in one
 * part is present in the other.
 */

export const INVITATION_SUBJECT = 'Private invitation to participate in Flipit'

const FONT =
  "'Helvetica Neue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"

const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b1d33;`

export const INVITATION_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${INVITATION_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f6f8fc;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#f6f8fc;">A private invitation to participate in the Flipit SPV. Please respond by {{response_deadline}}.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f6f8fc;">
<tr>
<td align="center" style="padding:24px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #cbd1de;border-radius:4px;">

<!-- Header: dark band, live text wordmark, no image to block -->
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

<!-- Body -->
<tr>
<td style="padding:28px 24px 8px;">

<p style="${P}">Dear {{recipient_name}},</p>

{{#if personal_line}}
<p style="${P}">{{personal_line}}</p>
{{/if}}

<p style="${P}">Flipit has completed an extended period of development, planning, and corporate restructuring. The company is now moving into a more active phase focused on commercial launch, product activation, promotion, new feature releases, and user growth.</p>

<p style="${P}">Before pursuing broader financing, we are first completing a limited private investment process with a carefully selected group of individuals who are familiar with Flipit and who we believe could be valuable participants in its next stage.</p>

<p style="${P}">A British Virgin Islands special purpose vehicle, or SPV, is being established to invest in Flipit Global Limited, the Hong Kong company that owns and operates the current Flipit business. The SPV may acquire up to 30% of Flipit Global Limited for a total aggregate investment of USD 30,000.</p>

{{#if use_of_funds}}
<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5a5f78;">Use of funds</p>
<p style="${P}">{{use_of_funds}}</p>
{{/if}}

<p style="${P}">We would like to offer you the following opportunity:</p>

</td>
</tr>

<!-- Offer panel: bordered, self-contained, safe to read alone -->
<tr>
<td style="padding:0 24px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f6f8fc;border:2px solid #0d0f2e;border-radius:4px;">
<tr>
<td style="padding:18px 18px 6px;">
<p style="margin:0 0 2px;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5a5f78;">Proposed participation</p>
<p style="margin:0 0 14px;font-family:${FONT};font-size:14px;line-height:1.5;color:#1b1d33;">Prepared for {{recipient_name}} &middot; Flipit Global SPV</p>
</td>
</tr>
<tr>
<td style="padding:0 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr>
<td style="padding:8px 0;border-top:1px solid #cbd1de;font-family:${FONT};font-size:15px;line-height:1.5;color:#5a5f78;">Proposed investment</td>
<td align="right" style="padding:8px 0;border-top:1px solid #cbd1de;font-family:${FONT};font-size:15px;line-height:1.5;font-weight:bold;color:#1b1d33;white-space:nowrap;">USD {{investment_amount}}</td>
</tr>
<tr>
<td style="padding:8px 0;border-top:1px solid #cbd1de;font-family:${FONT};font-size:15px;line-height:1.5;color:#5a5f78;">Proposed ownership of the SPV</td>
<td align="right" style="padding:8px 0;border-top:1px solid #cbd1de;font-family:${FONT};font-size:15px;line-height:1.5;font-weight:bold;color:#1b1d33;white-space:nowrap;">{{spv_percentage}}%</td>
</tr>
<tr>
<td style="padding:8px 0;border-top:1px solid #cbd1de;font-family:${FONT};font-size:15px;line-height:1.5;color:#5a5f78;">Approximate indirect economic interest in Flipit Global Limited</td>
<td align="right" style="padding:8px 0;border-top:1px solid #cbd1de;font-family:${FONT};font-size:15px;line-height:1.5;font-weight:bold;color:#1b1d33;white-space:nowrap;">{{indirect_flipit_percentage}}%</td>
</tr>
<tr>
<td style="padding:8px 0;border-top:1px solid #cbd1de;font-family:${FONT};font-size:15px;line-height:1.5;color:#5a5f78;">Please respond by</td>
<td align="right" style="padding:8px 0;border-top:1px solid #cbd1de;font-family:${FONT};font-size:15px;line-height:1.5;font-weight:bold;color:#1b1d33;white-space:nowrap;">{{response_deadline}}</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding:12px 18px 18px;">
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#5a5f78;">The indirect interest shown above assumes the SPV completes its proposed acquisition of 30% of Flipit Global Limited. Responding is not a binding investment commitment and no payment is requested at this stage.</p>
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td style="padding:20px 24px 0;">

<p style="${P}">This is a new investment in the current structure and will be governed by new subscription and SPV documentation.</p>

<p style="${P}">{{sender_name}} is leading the formation and administration of the SPV and will coordinate the investment process. He is also expected to assume the role of Chief Executive Officer of Flipit Global Limited, subject to completion of the relevant agreements and formal corporate approvals.</p>

<p style="${P}">Please respond no later than {{response_deadline}} by using the secure private link below.</p>

</td>
</tr>

<!-- The one primary action. The only orange in the email. -->
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
<td align="center" style="padding:12px 24px 20px;">
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#5a5f78;word-break:break-all;">If the button does not work, copy this address into your browser:<br><a href="{{secure_portal_link}}" style="color:#1b4fa8;text-decoration:underline;">{{secure_portal_link}}</a></p>
</td>
</tr>

<tr>
<td style="padding:0 24px;">

<p style="${P}">The link opens your own private portal. It will display this offer and allow you to indicate whether you wish to proceed, ask questions, or update your preferred email address. The portal remains yours for the duration of this process: you can return to it at any time to see where things stand, read updates, access your documents, and see confirmation once your participation has been accepted and any funds received. If you return later without this email, simply enter your address and a fresh sign-in link will be sent to you.</p>

<p style="${P}">No payment is requested at this stage, and submitting a response does not create a binding investment commitment.</p>

<p style="${P}">Before any investment is accepted or funds are requested, you will receive the proposed SPV structure, subscription documents, risk disclosures, and other relevant materials for review.</p>

</td>
</tr>

<!-- Payment safety notice. Bordered so it survives skim-reading. -->
<tr>
<td style="padding:4px 24px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#fdf3f2;border-left:4px solid #c0392b;">
<tr>
<td style="padding:14px 16px;">
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#1b1d33;"><strong>We will never email you a change of bank details.</strong> When payment instructions are issued, verify them with {{sender_name}} by voice before transferring any funds.</p>
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td style="padding:20px 24px 0;">

<p style="${P}">If you decline or do not respond by the deadline, your proposed allocation may be offered to other eligible participants or used for another company-approved purpose, subject to the final documents and applicable law.</p>

<p style="${P}">For questions about the investment, your proposed allocation, or the SPV, please contact {{sender_name}} through the private portal or reply to this email.</p>

<p style="${P}">Kind regards,</p>

<p style="margin:0 0 4px;font-family:${FONT};font-size:16px;line-height:1.6;font-weight:bold;color:#1b1d33;">{{sender_name}}</p>
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;">SPV Manager</p>
<p style="margin:0 0 8px;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;">Proposed Chief Executive Officer, Flipit Global Limited</p>
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;"><a href="mailto:{{sender_email}}" style="color:#1b4fa8;text-decoration:underline;">{{sender_email}}</a></p>
{{#if contact_phone}}
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;">Telephone {{sender_phone}}</p>
{{/if}}
{{#if contact_whatsapp}}
<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#5a5f78;">WhatsApp {{sender_phone}}</p>
{{/if}}

</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #cbd1de;">
<tr>
<td style="padding-top:16px;">
<p style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:1.6;color:#5a5f78;">This invitation was sent to you personally. It is not an offer to the public, investment advice, or a recommendation. The formal terms of any investment are set out solely in the subscription and SPV documents you receive.</p>
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:#5a5f78;word-break:break-all;">Not sure this email is genuine? You can check independently &mdash; type <a href="{{verification_link}}" style="color:#1b4fa8;text-decoration:underline;">{{verification_link}}</a> into your browser rather than clicking, and it will confirm the exact sending address and the exact link domain this process uses.</p>
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

export const INVITATION_TEXT = `FLIPIT — PRIVATE INVESTMENT INVITATION

Dear {{recipient_name}},

{{#if personal_line}}
{{personal_line}}

{{/if}}
Flipit has completed an extended period of development, planning, and corporate restructuring. The company is now moving into a more active phase focused on commercial launch, product activation, promotion, new feature releases, and user growth.

Before pursuing broader financing, we are first completing a limited private investment process with a carefully selected group of individuals who are familiar with Flipit and who we believe could be valuable participants in its next stage.

A British Virgin Islands special purpose vehicle, or SPV, is being established to invest in Flipit Global Limited, the Hong Kong company that owns and operates the current Flipit business. The SPV may acquire up to 30% of Flipit Global Limited for a total aggregate investment of USD 30,000.

{{#if use_of_funds}}
USE OF FUNDS

{{use_of_funds}}

{{/if}}
We would like to offer you the following opportunity:

------------------------------------------------------------
PROPOSED PARTICIPATION
Prepared for {{recipient_name}} - Flipit Global SPV

  Proposed investment ................ USD {{investment_amount}}
  Proposed ownership of the SPV ...... {{spv_percentage}}%
  Approximate indirect economic
    interest in Flipit Global Limited  {{indirect_flipit_percentage}}%
  Please respond by .................. {{response_deadline}}

The indirect interest shown above assumes the SPV completes its
proposed acquisition of 30% of Flipit Global Limited. Responding is
not a binding investment commitment and no payment is requested at
this stage.
------------------------------------------------------------

This is a new investment in the current structure and will be governed by new subscription and SPV documentation.

{{sender_name}} is leading the formation and administration of the SPV and will coordinate the investment process. He is also expected to assume the role of Chief Executive Officer of Flipit Global Limited, subject to completion of the relevant agreements and formal corporate approvals.

Please respond no later than {{response_deadline}} by using the secure private link below:

{{secure_portal_link}}

The link opens your own private portal. It will display this offer and allow you to indicate whether you wish to proceed, ask questions, or update your preferred email address. The portal remains yours for the duration of this process: you can return to it at any time to see where things stand, read updates, access your documents, and see confirmation once your participation has been accepted and any funds received. If you return later without this email, simply enter your address and a fresh sign-in link will be sent to you.

No payment is requested at this stage, and submitting a response does not create a binding investment commitment.

Before any investment is accepted or funds are requested, you will receive the proposed SPV structure, subscription documents, risk disclosures, and other relevant materials for review.

WE WILL NEVER EMAIL YOU A CHANGE OF BANK DETAILS. When payment instructions are issued, verify them with {{sender_name}} by voice before transferring any funds.

If you decline or do not respond by the deadline, your proposed allocation may be offered to other eligible participants or used for another company-approved purpose, subject to the final documents and applicable law.

For questions about the investment, your proposed allocation, or the SPV, please contact {{sender_name}} through the private portal or reply to this email.

Kind regards,

{{sender_name}}
SPV Manager
Proposed Chief Executive Officer, Flipit Global Limited
{{sender_email}}
{{#if contact_phone}}
Telephone {{sender_phone}}
{{/if}}
{{#if contact_whatsapp}}
WhatsApp {{sender_phone}}
{{/if}}

------------------------------------------------------------
This invitation was sent to you personally. It is not an offer to the public, investment advice, or a recommendation. The formal terms of any investment are set out solely in the subscription and SPV documents you receive.

Not sure this email is genuine? You can check independently - type {{verification_link}} into your browser rather than clicking, and it will confirm the exact sending address and the exact link domain this process uses.
`
