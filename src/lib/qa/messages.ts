/**
 * The two emails Q&A sends. BUILD_SPEC §6.7.1, §6.7.2.
 *
 * Deliberately **not** registered in `lib/email/templates`. That registry is
 * the set of templates the compliance approval hashes and gates (§8.2), and
 * §6.7.6 is explicit that these two are not that:
 *
 *   - The **new-question notification** goes to the operator. It is internal
 *     mail from the application to the person running it, not a communication
 *     to an investor at all.
 *   - The **reply to the asker** is, in the spec's words, *"ordinary
 *     correspondence"* and *"not gated"*.
 *
 * Putting either in the approved-template registry would mean a single word
 * changed in an internal notification voids the approval that lets invitations
 * go out — which is not a stricter reading of §8.2, it is a broken one.
 *
 * They are still built the same way as the approved templates: table layout,
 * inline styles, 600px, a mandatory plain-text alternative carrying the same
 * information, and legible with images blocked (§11.5). An email a recipient
 * cannot read is not made acceptable by being ungated.
 *
 * Pure. Takes what it is given, returns a subject and two bodies, touches
 * nothing.
 */

const FONT =
  "'Helvetica Neue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"

const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b1d33;`
const SMALL = `margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;`

export interface ComposedMessage {
  subject: string
  html: string
  text: string
}

/**
 * Escape for HTML. Every value in these messages is typed by a human — an
 * investor's question or the operator's answer — and goes straight into the
 * body, so this is the boundary that stops a question containing `<script>`
 * from becoming one.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Human-typed prose to HTML: escaped, blank lines become paragraphs. */
function paragraphs(value: string, style: string = P): string {
  const blocks = value
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== '')

  if (blocks.length === 0) return ''

  return blocks
    .map((block) => `<p style="${style}">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

function shell(title: string, eyebrow: string, body: string, footer: string): string {
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
<td style="padding-top:6px;font-family:${FONT};font-size:12px;line-height:1.5;letter-spacing:1px;text-transform:uppercase;color:#9498b5;">${escapeHtml(eyebrow)}</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding:28px 24px 8px;">
${body}
</td>
</tr>
<tr>
<td style="padding:8px 24px 26px;border-top:1px solid #e3e7f0;">
${footer}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`
}

function quoteBlock(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 18px;">
<tr>
<td style="padding:14px 16px;background-color:#f6f8fc;border-left:3px solid #F59A23;">
<p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#6c7290;">${escapeHtml(label)}</p>
${paragraphs(value, `margin:0 0 10px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1b1d33;`)}
</td>
</tr>
</table>`
}

// ---------------------------------------------------------------------------
// 1. The new-question notification — §6.7.1
// ---------------------------------------------------------------------------

export interface QuestionNotificationInput {
  /** Who asked. This goes to the operator, who is entitled to know. */
  askerName: string
  askerEmail: string
  questionBody: string
  /**
   * A one-line summary of the asker's offer, so the operator has context
   * without opening the queue. Formatted strings only — no numbers reach here.
   */
  offerSummary: string | null
  /** Where to answer it. Absolute, under this deployment. */
  queueLink: string
}

/**
 * §6.7.1: *"A new question emails David immediately. It is the one thing in
 * this process where a slow reply costs a decision."*
 *
 * The subject deliberately does not carry the question text. Subjects show in
 * phone notifications on a lock screen, and an investor's question can contain
 * their own figures.
 */
export function buildQuestionNotification(input: QuestionNotificationInput): ComposedMessage {
  const subject = `New investor question from ${input.askerName}`

  const contextLine = input.offerSummary
    ? `<p style="${SMALL}">Their record: ${escapeHtml(input.offerSummary)}</p>`
    : `<p style="${SMALL}">No offer is recorded against this account yet.</p>`

  const html = shell(
    subject,
    'Investor question',
    `<p style="${P}">${escapeHtml(input.askerName)} (${escapeHtml(input.askerEmail)}) has asked a question in their portal.</p>
${quoteBlock('Their question', input.questionBody)}
${contextLine}
<p style="${P}"><a href="${escapeHtml(input.queueLink)}" style="font-family:${FONT};font-size:16px;font-weight:bold;color:#0b3fd6;">Answer it in the questions queue</a></p>`,
    `<p style="${SMALL}">Nothing has been sent to them beyond the confirmation on the page. Your answer only reaches them when you press send, and it is only added to the shared Q&amp;A if you tick the publish box.</p>`,
  )

  const text = `FLIPIT — INVESTOR QUESTION

${input.askerName} (${input.askerEmail}) has asked a question in their portal.

THEIR QUESTION
${input.questionBody.trim()}

${input.offerSummary ? `Their record: ${input.offerSummary}` : 'No offer is recorded against this account yet.'}

Answer it in the questions queue:
${input.queueLink}

------------------------------------------------------------
Nothing has been sent to them beyond the confirmation on the page. Your answer only reaches them when you press send, and it is only added to the shared Q&A if you tick the publish box.
`

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// 2. The reply to the person who asked — §6.7.2
// ---------------------------------------------------------------------------

export interface AnswerReplyInput {
  recipientName: string
  /** The investor's own words, quoted back so the reply makes sense alone. */
  questionOriginal: string
  answer: string
  /** The portal, not a claim link. Returning investors sign in for themselves. */
  portalLink: string
  senderName: string
  senderEmail: string
  verificationLink: string
}

/**
 * The reply the operator has to press send on. §6.7.2: *"nothing goes to an
 * investor because a checkbox was ticked. He sees the rendered email first."*
 *
 * Carries no figures of its own. Whatever the answer says is what the operator
 * wrote; this function adds a greeting, the quoted question, a portal link and
 * the standard footer, and nothing else. In particular it does not restate the
 * offer — an investor who wants their numbers has them in the portal, and an
 * email that repeats them is a second communication of the offer terms.
 */
export function buildAnswerReply(input: AnswerReplyInput): ComposedMessage {
  const subject = 'A reply to your question about the Flipit SPV'

  const html = shell(
    subject,
    'Private investment invitation',
    `<p style="${P}">Dear ${escapeHtml(input.recipientName)},</p>
<p style="${P}">Thank you for your question. Here is my reply.</p>
${quoteBlock('You asked', input.questionOriginal)}
${paragraphs(input.answer)}
<p style="${P}">Your private portal has the full detail of your invitation, and this reply will appear there too.</p>
<p style="${P}"><a href="${escapeHtml(input.portalLink)}" style="font-family:${FONT};font-size:16px;font-weight:bold;color:#0b3fd6;">Open your private portal</a></p>
<p style="${P}">Kind regards,<br>${escapeHtml(input.senderName)}<br>SPV Manager<br>${escapeHtml(input.senderEmail)}</p>`,
    `<p style="${SMALL}">This message was sent to you personally. It is not an offer to the public, investment advice, or a recommendation. The formal terms of any investment are set out solely in the subscription and SPV documents. We will never email you a change of bank details.</p>
<p style="${SMALL}">Not sure this email is genuine? Type ${escapeHtml(input.verificationLink)} into your browser rather than clicking.</p>`,
  )

  const text = `FLIPIT — PRIVATE INVESTMENT INVITATION

Dear ${input.recipientName},

Thank you for your question. Here is my reply.

YOU ASKED
${input.questionOriginal.trim()}

${input.answer.trim()}

Your private portal has the full detail of your invitation, and this reply will appear there too.

${input.portalLink}

Kind regards,

${input.senderName}
SPV Manager
${input.senderEmail}

------------------------------------------------------------
This message was sent to you personally. It is not an offer to the public, investment advice, or a recommendation. The formal terms of any investment are set out solely in the subscription and SPV documents. We will never email you a change of bank details.

Not sure this email is genuine? Type ${input.verificationLink} into your browser rather than clicking.
`

  return { subject, html, text }
}
