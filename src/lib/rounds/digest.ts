/**
 * The deadline-date email to the operator. BUILD_SPEC §6.6.
 *
 * *"On the deadline date the app emails David — **not the investors** — with a
 * summary… That email says plainly that it is **his call**: close the round
 * now, extend the deadline for everyone, or extend it for named stragglers."*
 *
 * Two things to notice about the recipient: it is the operator's own address,
 * taken from the allowlist and never from a parameter; and no investor is ever
 * copied. This is internal mail about a decision, and the decision is his.
 *
 * The body carries names and figures, which is right — he is entitled to both,
 * and the whole point is that he can decide without opening the application.
 * That is also why it goes to nobody else.
 */

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents, users } from '@/db/schema'
import { audit, systemActor, type Actor } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { sendOneEmail } from '@/lib/email/transport'
import { absoluteUrl } from '@/lib/email/variables'
import { isoToday } from '@/lib/money'
import { escapeHtml } from '@/lib/qa/messages'
import { loadRoundSummary, type RoundSummary } from './summary'

export const ROUND_PATH = '/round'

/** §6.6: "he is reminded again on a configurable cadence." Days between digests. */
export const DIGEST_CADENCE_DAYS = 7

export const DIGEST_ACTION = 'round.deadline_digest_sent'

const FONT =
  "'Helvetica Neue',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"
const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1b1d33;`
const SMALL = `margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:#4a4d68;`

export interface ComposedDigest {
  subject: string
  html: string
  text: string
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:6px 0;font-family:${FONT};font-size:14px;color:#4a4d68;">${escapeHtml(label)}</td><td style="padding:6px 0;font-family:${FONT};font-size:14px;font-weight:bold;color:#1b1d33;">${escapeHtml(value)}</td></tr>`
}

/**
 * Build the digest. Pure — takes a summary and returns three strings.
 *
 * The three options §6.6 names are stated in the body in the spec's own terms,
 * and so is the fact that doing nothing is one of them: "If you do nothing, the
 * round stays open."
 */
export function buildRoundDigest(summary: RoundSummary): ComposedDigest {
  const subject = `${summary.name}: a response deadline has been reached`

  const stragglers = summary.participants
    .filter((row) => row.responseChoice === 'NO_RESPONSE' && row.deadlineReached)
    .map((row) => `${row.name} <${row.email}> — deadline ${row.responseDeadline}`)

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;width:100%;background-color:#f6f8fc;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f6f8fc;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #cbd1de;border-radius:4px;">
<tr><td style="padding:22px 24px;background-color:#070823;border-radius:4px 4px 0 0;">
<div style="font-family:${FONT};font-size:22px;font-weight:bold;letter-spacing:3px;color:#ffffff;">FLIPIT</div>
<div style="padding-top:6px;font-family:${FONT};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#9498b5;">Round status</div>
</td></tr>
<tr><td style="padding:28px 24px 8px;">
<p style="${P}">A response deadline has been reached in <strong>${escapeHtml(summary.name)}</strong>. Nothing has changed and nothing has closed. This is for you to decide.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 18px;background-color:#f6f8fc;border-left:3px solid #F59A23;">
<tr><td style="padding:14px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${row('Invited', String(summary.counts.total))}
${row('Responded', String(summary.counts.responded))}
${row('Not responded', String(summary.counts.notResponded))}
${row('Asked for more time', String(summary.counts.extended))}
${row('Committed', `USD ${summary.totals.committed} of USD ${summary.totals.aggregate}`)}
${row('Received', `USD ${summary.totals.received}`)}
</table>
</td></tr>
</table>

${
  stragglers.length > 0
    ? `<p style="${P}">Still to respond, past their deadline:</p><ul style="${P}">${stragglers
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join('')}</ul>`
    : `<p style="${P}">Everybody past their deadline has responded.</p>`
}

<p style="${P}"><strong>It is your call.</strong> You can close the round now, extend the deadline for everyone, or extend it for named people you know need longer or who have asked. <strong>If you do nothing, the round stays open</strong> and you will be reminded again in ${DIGEST_CADENCE_DAYS} days. A deadline passing closes nobody's opportunity by itself.</p>

<p style="${P}"><a href="${escapeHtml(absoluteUrl(ROUND_PATH))}" style="font-family:${FONT};font-size:16px;font-weight:bold;color:#0b3fd6;">Open the round summary</a></p>
</td></tr>
<tr><td style="padding:8px 24px 26px;border-top:1px solid #e3e7f0;">
<p style="${SMALL}">This message went to you and to nobody else. No investor has been told a deadline has passed.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  const text = `FLIPIT — ROUND STATUS

A response deadline has been reached in ${summary.name}. Nothing has changed and nothing has closed. This is for you to decide.

Invited:              ${summary.counts.total}
Responded:            ${summary.counts.responded}
Not responded:        ${summary.counts.notResponded}
Asked for more time:  ${summary.counts.extended}
Committed:            USD ${summary.totals.committed} of USD ${summary.totals.aggregate}
Received:             USD ${summary.totals.received}

${
  stragglers.length > 0
    ? `STILL TO RESPOND, PAST THEIR DEADLINE\n${stragglers.map((line) => `  - ${line}`).join('\n')}`
    : 'Everybody past their deadline has responded.'
}

IT IS YOUR CALL. You can close the round now, extend the deadline for everyone, or extend it for named people you know need longer or who have asked. If you do nothing, the round stays open and you will be reminded again in ${DIGEST_CADENCE_DAYS} days. A deadline passing closes nobody's opportunity by itself.

${absoluteUrl(ROUND_PATH)}

------------------------------------------------------------
This message went to you and to nobody else. No investor has been told a deadline has passed.
`

  return { subject, html, text }
}

// ---------------------------------------------------------------------------
// Sending it
// ---------------------------------------------------------------------------

export type DigestOutcome =
  | { sent: true; messageId: string }
  | { sent: false; reason: string }

/** When the last digest for this round went out, from the audit log. */
export async function lastDigestAt(roundId: string): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, 'round'),
        eq(auditEvents.entityId, roundId),
        eq(auditEvents.action, DIGEST_ACTION),
      ),
    )
    .orderBy(auditEvents.createdAt)

  return rows[rows.length - 1]?.createdAt ?? null
}

/**
 * Whether a digest is due. §6.6.
 *
 * Due when a deadline has been reached and either none has been sent for this
 * round or the cadence has elapsed since the last one. Deliberately not "on the
 * deadline date exactly" — a scheduler that misses a day would then never send
 * it at all, and the operator would be waiting for an email that is not coming.
 */
export function digestDue(input: {
  summary: RoundSummary
  lastSentAt: Date | null
  now: Date
  cadenceDays?: number
}): boolean {
  if (input.summary.closedAt !== null) return false
  if (input.summary.counts.deadlineReached === 0) return false

  if (input.lastSentAt === null) return true

  const cadenceMs = (input.cadenceDays ?? DIGEST_CADENCE_DAYS) * 24 * 60 * 60 * 1000
  return input.now.getTime() - input.lastSentAt.getTime() >= cadenceMs
}

/**
 * Send the digest to the operator, if one is due.
 *
 * The recipient is the operator's own address. There is no parameter here
 * naming a recipient, and no investor is ever copied.
 */
export async function sendRoundDigest(input: {
  roundId: string
  actor?: Actor
  now?: Date
  force?: boolean
}): Promise<DigestOutcome> {
  const now = input.now ?? new Date()
  const actor = input.actor ?? systemActor

  const summary = await loadRoundSummary(input.roundId, { now })
  if (!summary) return { sent: false, reason: 'That round could not be found.' }

  if (!input.force) {
    const lastSentAt = await lastDigestAt(input.roundId)
    if (!digestDue({ summary, lastSentAt, now })) {
      return { sent: false, reason: 'No digest is due for this round.' }
    }
  }

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) {
    return { sent: false, reason: 'No operator account exists, so there is nobody to email.' }
  }

  const config = await readServiceConfig()
  const message = buildRoundDigest(summary)

  let attempt
  try {
    attempt = await sendOneEmail({
      intent: 'NOTIFICATION',
      message: {
        to: operator.email,
        fromName: config.defaultSenderName ?? 'Flipit',
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      actor,
      now,
    })
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'Sending is currently refused.',
    }
  }

  if (attempt.outcome !== 'SUCCEEDED') {
    return { sent: false, reason: attempt.failure.message }
  }

  await audit({
    actor,
    entityType: 'round',
    entityId: input.roundId,
    action: DIGEST_ACTION,
    // Counts, never names. The email carries the names; the log carries the
    // fact that it was sent and what it said in aggregate.
    metadata: {
      on: isoToday(now),
      notResponded: summary.counts.notResponded,
      deadlineReached: summary.counts.deadlineReached,
    },
  })

  return { sent: true, messageId: attempt.result.messageId }
}

/** Every open round with a reached deadline. For the scheduled job. */
export async function roundsNeedingDigest(now: Date = new Date()): Promise<string[]> {
  const { rounds } = await import('@/db/schema')

  const open = await db.select({ id: rounds.id }).from(rounds).where(isNull(rounds.closedAt))

  const due: string[] = []
  for (const round of open) {
    const summary = await loadRoundSummary(round.id, { now })
    if (!summary) continue
    const lastSentAt = await lastDigestAt(round.id)
    if (digestDue({ summary, lastSentAt, now })) due.push(round.id)
  }

  return due
}
