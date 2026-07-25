/**
 * Every write the Q&A makes. BUILD_SPEC §6.7.
 *
 * The server actions in `src/actions/qa.ts` do authorization, validation and
 * `revalidatePath`; everything below is the mutation itself, so the rules can
 * be tested against a real database without a session.
 *
 * Four things run through all of it:
 *
 *   1. **The original question is never overwritten.** §6.7.3: "the original
 *      text is preserved unchanged on the private record and in the audit log."
 *      No function here writes `question_original` after the row is created.
 *   2. **Publishing and emailing are separate.** §6.7.2: "Publishing to the
 *      page happens on save; emailing the asker happens on send. They are
 *      separate actions and either can happen without the other." There is no
 *      code path where one causes the other.
 *   3. **Nothing reaches an investor without an explicit press.** `recordAnswer`
 *      does not send. `sendAnswerReply` is the only function that puts a reply
 *      on the wire and it is only ever called from the send button.
 *   4. **Audit everything.** §6.7: "Every question, answer, edit, publication,
 *      unpublication, and send is audit-logged with actor and timestamp." The
 *      audit metadata carries lengths and ids, never the text — `assertNoSecrets`
 *      would reject a `body` key anyway, and the rule is the same one.
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  investorAccounts,
  offers,
  qaEntries,
  qaThreadMessages,
  users,
} from '@/db/schema'
import { audit, type Actor } from '@/lib/audit'
import { readServiceConfig } from '@/lib/auth/service-config'
import { absoluteUrl, loadSenderDefaults } from '@/lib/email/variables'
import { sendOneEmail } from '@/lib/email/transport'
import { formatMoney, formatPercentage } from '@/lib/money'
import { publishBlock, PUBLISH_BLOCK_MESSAGE, scanForIdentifyingDetail } from './anonymity'
import { buildAnswerReply, buildQuestionNotification } from './messages'

/** Where the operator answers. One constant, so the email and the nav agree. */
export const QA_QUEUE_PATH = '/questions'
export const PORTAL_PATH = '/portal'

/** §6.7.1, verbatim from PORTAL_COPY. Shown to the investor on submit. */
export const QUESTION_RECEIVED_MESSAGE =
  'Thank you — your question has been sent to David. He’ll reply by email, and the answer ' +
  'will appear here too.'

export type QaEntryRow = typeof qaEntries.$inferSelect

// ---------------------------------------------------------------------------
// Asking — §6.7.1
// ---------------------------------------------------------------------------

export interface AskQuestionInput {
  accountId: string
  body: string
  /** Continue an existing thread rather than starting one (§6.7.1). */
  entryId?: string | null
  now?: Date
}

export type AskQuestionResult =
  | { ok: true; entryId: string; isFollowUp: boolean }
  | { ok: false; message: string }

/**
 * Record a question and attach it to the account's current offer.
 *
 * A follow-up appends to an existing thread, and the thread must belong to this
 * account — checked in the `where` clause, so a guessed entry id finds nothing
 * rather than finding somebody else's thread. The refusal is worded so it does
 * not confirm that some other entry exists under that id (§15).
 */
export async function askQuestion(input: AskQuestionInput): Promise<AskQuestionResult> {
  const now = input.now ?? new Date()
  const body = input.body.trim()

  if (body === '') {
    return { ok: false, message: 'A question needs some text before it can be sent.' }
  }

  if (input.entryId) {
    const existing = await db.query.qaEntries.findFirst({
      where: and(
        eq(qaEntries.id, input.entryId),
        eq(qaEntries.askedByAccountId, input.accountId),
      ),
    })

    if (!existing) {
      return {
        ok: false,
        message: 'That question could not be added to. Nothing was changed.',
      }
    }

    await db.insert(qaThreadMessages).values({
      entryId: existing.id,
      direction: 'FROM_INVESTOR',
      body,
    })

    // A follow-up re-opens the thread for the operator without destroying the
    // answer already given: `answer` stays, and the queue treats an entry whose
    // newest message is from the investor as awaiting a reply.
    await db.update(qaEntries).set({ updatedAt: now }).where(eq(qaEntries.id, existing.id))

    await audit({
      actor: { kind: 'investor', id: input.accountId, label: 'investor' },
      entityType: 'qa_entry',
      entityId: existing.id,
      action: 'qa.follow_up_asked',
      metadata: { characters: body.length, followUp: true },
    })

    return { ok: true, entryId: existing.id, isFollowUp: true }
  }

  const offerRows = await db
    .select({ id: offers.id })
    .from(offers)
    .where(eq(offers.accountId, input.accountId))
    .orderBy(desc(offers.createdAt))
    .limit(1)

  const [created] = await db
    .insert(qaEntries)
    .values({
      askedByAccountId: input.accountId,
      offerId: offerRows[0]?.id ?? null,
      questionOriginal: body,
    })
    .returning({ id: qaEntries.id })

  const entryId = created!.id

  await db.insert(qaThreadMessages).values({
    entryId,
    direction: 'FROM_INVESTOR',
    body,
  })

  await audit({
    actor: { kind: 'investor', id: input.accountId, label: 'investor' },
    entityType: 'qa_entry',
    entityId: entryId,
    action: 'qa.question_asked',
    // The length, never the question. §15.
    metadata: { characters: body.length, followUp: false },
  })

  return { ok: true, entryId, isFollowUp: false }
}

// ---------------------------------------------------------------------------
// The operator notification — §6.7.1
// ---------------------------------------------------------------------------

export interface NotifyResult {
  sent: boolean
  /** The gate's own sentence when it refused. Operator-facing, no credential. */
  detail: string | null
}

/**
 * Tell the operator a question is waiting.
 *
 * **This never fails the investor's submission.** The question is already
 * recorded by the time this runs; a mail connection that is not yet configured,
 * or a deployment that is not the production one, must not turn "your question
 * has been sent" into an error page. The outcome is written to the entry and
 * shown in the queue instead, so a notification that did not get out is visible
 * to the operator the moment he opens the page rather than being silent.
 *
 * The recipient is the operator's own address, taken from the allowlist. There
 * is no parameter here naming an arbitrary recipient.
 */
export async function notifyOperatorOfQuestion(
  entryId: string,
  options: { now?: Date } = {},
): Promise<NotifyResult> {
  const now = options.now ?? new Date()

  const entry = await db.query.qaEntries.findFirst({ where: eq(qaEntries.id, entryId) })
  if (!entry) return { sent: false, detail: 'That question no longer exists.' }

  const operatorRows = await db
    .select({ email: users.email, name: users.name, displayName: users.displayName })
    .from(users)
    .where(eq(users.role, 'OPERATOR'))
    .limit(1)

  const operator = operatorRows[0]
  if (!operator) {
    const detail =
      'No operator account exists yet, so there is nobody to notify. The question is recorded ' +
      'and will appear in the questions queue.'
    await recordNotifyOutcome(entryId, null, detail)
    return { sent: false, detail }
  }

  const account = entry.askedByAccountId
    ? await db.query.investorAccounts.findFirst({
        where: eq(investorAccounts.id, entry.askedByAccountId),
      })
    : null

  if (!account) {
    const detail = 'This entry has no asker, so there is nothing to notify anyone about.'
    await recordNotifyOutcome(entryId, null, detail)
    return { sent: false, detail }
  }

  const message = buildQuestionNotification({
    askerName: account.name,
    askerEmail: account.email,
    questionBody: latestInvestorText(entry),
    offerSummary: await offerSummaryLine(entry),
    queueLink: absoluteUrl(QA_QUEUE_PATH),
  })

  try {
    const attempt = await sendOneEmail({
      intent: 'NOTIFICATION',
      message: {
        to: operator.email,
        fromName: operator.displayName ?? operator.name ?? 'Flipit',
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      actor: { kind: 'system', label: 'qa-notification' },
      now,
    })

    if (attempt.outcome === 'SUCCEEDED') {
      await recordNotifyOutcome(entryId, now, null)
      return { sent: true, detail: null }
    }

    await recordNotifyOutcome(entryId, null, attempt.failure.message)
    return { sent: false, detail: attempt.failure.message }
  } catch (error) {
    // A §8.1/§7/§18.1 refusal. Already audited by the gate, and its message is
    // specific by construction — show it verbatim rather than replacing it.
    const detail =
      error instanceof Error
        ? error.message
        : 'The notification could not be sent, and no reason was recorded.'
    await recordNotifyOutcome(entryId, null, detail)
    return { sent: false, detail }
  }
}

async function recordNotifyOutcome(
  entryId: string,
  notifiedAt: Date | null,
  failure: string | null,
): Promise<void> {
  await db
    .update(qaEntries)
    .set({ notifiedAt, notifyFailure: failure })
    .where(eq(qaEntries.id, entryId))
}

/** The newest thing the investor said on this thread, for the notification. */
function latestInvestorText(entry: QaEntryRow): string {
  return entry.questionOriginal
}

async function offerSummaryLine(entry: QaEntryRow): Promise<string | null> {
  if (!entry.askedByAccountId) return null

  const config = await readServiceConfig()
  const rows = await db
    .select({
      proposedAmountUsd: offers.proposedAmountUsd,
      spvPercentage: offers.spvPercentage,
      responseDeadline: offers.responseDeadline,
      stage: offers.stage,
    })
    .from(offers)
    .where(
      entry.offerId
        ? eq(offers.id, entry.offerId)
        : eq(offers.accountId, entry.askedByAccountId),
    )
    .orderBy(desc(offers.createdAt))
    .limit(1)

  const offer = rows[0]
  if (!offer) return null

  return (
    `${formatMoney(offer.proposedAmountUsd)} for ` +
    `${formatPercentage(offer.spvPercentage, { decimalPlaces: config.decimalPlaces })} of the SPV, ` +
    `deadline ${offer.responseDeadline}, currently ${offer.stage.toLowerCase().replace(/_/g, ' ')}`
  )
}

// ---------------------------------------------------------------------------
// Answering — §6.7.2
// ---------------------------------------------------------------------------

export interface RecordAnswerInput {
  entryId: string
  answer: string
  /** The de-identified rewrite. Required before an investor-asked entry publishes. */
  questionPublic: string | null
  /** "Also publish this answer to the shared Q&A." Unticked by default. */
  publish: boolean
  /** The operator confirming he has read the public wording as a stranger would. */
  acknowledgedIdentifyingDetail: boolean
  actor: Actor
  actorUserId: string | null
  now?: Date
}

export type RecordAnswerResult =
  | { ok: true; published: boolean }
  | { ok: false; message: string; needsAcknowledgement?: boolean }

/**
 * Save an answer, and publish it only if the box was ticked.
 *
 * Saving never emails anybody. The reply is a separate, explicit action, and
 * this function returns without touching the transport whatever the caller
 * passed.
 */
export async function recordAnswer(input: RecordAnswerInput): Promise<RecordAnswerResult> {
  const now = input.now ?? new Date()
  const answer = input.answer.trim()
  const questionPublic = input.questionPublic?.trim() ?? null

  if (answer === '') {
    return { ok: false, message: 'An answer needs some text before it can be saved.' }
  }

  const entry = await db.query.qaEntries.findFirst({ where: eq(qaEntries.id, input.entryId) })
  if (!entry) return { ok: false, message: 'That entry could not be found.' }

  const wasPublished = entry.isPublished && entry.unpublishedAt === null

  const next: Partial<typeof qaEntries.$inferInsert> = {
    answer,
    questionPublic,
    answeredById: input.actorUserId,
    answeredAt: entry.answeredAt ?? now,
    updatedAt: now,
  }

  if (input.publish) {
    const blocked = publishBlock({
      ...entry,
      answer,
      questionPublic,
    })
    if (blocked) return { ok: false, message: PUBLISH_BLOCK_MESSAGE[blocked] }

    const findings = scanForIdentifyingDetail(questionPublic ?? entry.questionOriginal, answer)
    if (findings.length > 0 && !input.acknowledgedIdentifyingDetail) {
      return {
        ok: false,
        needsAcknowledgement: true,
        message:
          'Before this publishes, confirm you have read the public wording as a stranger ' +
          'would. The check found ' +
          findings.map((finding) => `${finding.label.toLowerCase()} (“${finding.excerpt}”)`).join(', ') +
          '. Any of those can identify the person who asked.',
      }
    }

    next.isPublished = true
    next.publishedAt = entry.publishedAt ?? now
    next.unpublishedAt = null
    // §6.7.3: "Editing a published answer stamps it as updated."
    if (wasPublished) next.updatedAtLabel = now
  }

  await db.update(qaEntries).set(next).where(eq(qaEntries.id, input.entryId))

  await audit({
    actor: input.actor,
    entityType: 'qa_entry',
    entityId: input.entryId,
    action: wasPublished ? 'qa.answer_edited' : 'qa.answer_recorded',
    metadata: {
      answerCharacters: answer.length,
      publicQuestionSet: questionPublic !== null,
      publishRequested: input.publish,
      wasPublished,
    },
  })

  if (input.publish && !wasPublished) {
    await audit({
      actor: input.actor,
      entityType: 'qa_entry',
      entityId: input.entryId,
      action: 'qa.published',
      metadata: { firstPublication: entry.publishedAt === null },
    })
  }

  return { ok: true, published: input.publish }
}

// ---------------------------------------------------------------------------
// Publishing, unpublishing, ordering — §6.7.3
// ---------------------------------------------------------------------------

export async function unpublishEntry(input: {
  entryId: string
  actor: Actor
  now?: Date
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = input.now ?? new Date()

  const entry = await db.query.qaEntries.findFirst({ where: eq(qaEntries.id, input.entryId) })
  if (!entry) return { ok: false, message: 'That entry could not be found.' }
  if (!entry.isPublished) {
    return { ok: false, message: 'That entry is not published, so there is nothing to remove.' }
  }

  await db
    .update(qaEntries)
    .set({ isPublished: false, unpublishedAt: now, updatedAt: now })
    .where(eq(qaEntries.id, input.entryId))

  // §6.7.3: "Unpublishing is logged."
  await audit({
    actor: input.actor,
    entityType: 'qa_entry',
    entityId: input.entryId,
    action: 'qa.unpublished',
    metadata: { hadBeenPublishedSince: entry.publishedAt?.toISOString() ?? null },
  })

  return { ok: true }
}

export async function setPinned(input: {
  entryId: string
  pinned: boolean
  actor: Actor
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const entry = await db.query.qaEntries.findFirst({ where: eq(qaEntries.id, input.entryId) })
  if (!entry) return { ok: false, message: 'That entry could not be found.' }

  await db
    .update(qaEntries)
    .set({ pinned: input.pinned })
    .where(eq(qaEntries.id, input.entryId))

  await audit({
    actor: input.actor,
    entityType: 'qa_entry',
    entityId: input.entryId,
    action: input.pinned ? 'qa.pinned' : 'qa.unpinned',
  })

  return { ok: true }
}

/**
 * Move one entry up or down the shared list.
 *
 * Swapping with the neighbour rather than assigning an absolute position keeps
 * the operation meaningful when two entries share a sort order, and means the
 * caller never has to send an index the list might have moved on from.
 */
export async function moveEntry(input: {
  entryId: string
  direction: 'UP' | 'DOWN'
  actor: Actor
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const published = await db
    .select()
    .from(qaEntries)
    .where(and(eq(qaEntries.isPublished, true), isNull(qaEntries.unpublishedAt)))
    .orderBy(desc(qaEntries.pinned), asc(qaEntries.sortOrder), asc(qaEntries.publishedAt))

  const index = published.findIndex((entry) => entry.id === input.entryId)
  if (index === -1) {
    return { ok: false, message: 'That entry is not on the shared page, so it cannot be moved.' }
  }

  const targetIndex = input.direction === 'UP' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= published.length) {
    return {
      ok: false,
      message:
        input.direction === 'UP'
          ? 'That entry is already first.'
          : 'That entry is already last.',
    }
  }

  // Renumber the whole list from its current displayed order, then swap. This
  // repairs any historical ties rather than working around them.
  const order = published.map((entry) => entry.id)
  const [moved] = order.splice(index, 1)
  order.splice(targetIndex, 0, moved!)

  for (const [position, id] of order.entries()) {
    await db.update(qaEntries).set({ sortOrder: position }).where(eq(qaEntries.id, id))
  }

  await audit({
    actor: input.actor,
    entityType: 'qa_entry',
    entityId: input.entryId,
    action: 'qa.reordered',
    metadata: { direction: input.direction, from: index, to: targetIndex },
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Operator-authored entries — §6.7.4
// ---------------------------------------------------------------------------

export interface SeedEntryInput {
  question: string
  answer: string
  publish: boolean
  actor: Actor
  actorUserId: string | null
  now?: Date
}

/**
 * A question-and-answer pair the operator wrote himself, so the section is not
 * empty on day one (§6.7.4).
 *
 * There is no asker, so `asked_by_account_id` is null — which is what makes the
 * anonymity question moot for these: nobody's words are being republished. The
 * identifying-detail scan still runs, because an operator can just as easily
 * write "the 5% we offered Michael" as an investor can.
 */
export async function createSeededEntry(
  input: SeedEntryInput,
): Promise<{ ok: true; entryId: string } | { ok: false; message: string }> {
  const now = input.now ?? new Date()
  const question = input.question.trim()
  const answer = input.answer.trim()

  if (question === '' || answer === '') {
    return { ok: false, message: 'A seeded entry needs both a question and an answer.' }
  }

  const [created] = await db
    .insert(qaEntries)
    .values({
      askedByAccountId: null,
      questionOriginal: question,
      questionPublic: question,
      answer,
      answeredById: input.actorUserId,
      answeredAt: now,
      isPublished: input.publish,
      publishedAt: input.publish ? now : null,
    })
    .returning({ id: qaEntries.id })

  const entryId = created!.id

  await audit({
    actor: input.actor,
    entityType: 'qa_entry',
    entityId: entryId,
    action: 'qa.seeded',
    metadata: {
      questionCharacters: question.length,
      answerCharacters: answer.length,
      published: input.publish,
    },
  })

  if (input.publish) {
    await audit({
      actor: input.actor,
      entityType: 'qa_entry',
      entityId: entryId,
      action: 'qa.published',
      metadata: { firstPublication: true, seeded: true },
    })
  }

  return { ok: true, entryId }
}

// ---------------------------------------------------------------------------
// The reply email — §6.7.2, explicit send only
// ---------------------------------------------------------------------------

export interface AnswerReplyPreview {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * Render the reply exactly as it would be sent. §6.7.2: "He sees the rendered
 * email first."
 *
 * A read. It mints no token, sends nothing and writes nothing — a preview that
 * did any of those would be a send by another name.
 */
export async function previewAnswerReply(entryId: string): Promise<AnswerReplyPreview | null> {
  const entry = await db.query.qaEntries.findFirst({ where: eq(qaEntries.id, entryId) })
  if (!entry?.askedByAccountId || !entry.answer) return null

  const account = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, entry.askedByAccountId),
  })
  if (!account) return null

  const defaults = await loadSenderDefaults()
  const message = buildAnswerReply({
    recipientName: account.name,
    questionOriginal: entry.questionOriginal,
    answer: entry.answer,
    portalLink: absoluteUrl(PORTAL_PATH),
    senderName: defaults.defaultSenderName ?? 'Flipit',
    senderEmail:
      defaults.defaultSenderEmail ?? defaults.authenticatedSenderEmail ?? '',
    verificationLink: defaults.verificationLink,
  })

  return { to: account.email, ...message }
}

export type SendReplyResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }

/**
 * Send the answer to the person who asked. Called from one button and nowhere
 * else (§6.7.2, §14 — one recipient, no bulk form of this exists).
 *
 * Not gated on the compliance approval, and that is the spec's decision rather
 * than an omission: §6.7.6 says "private answers to one person are ordinary
 * correspondence and are not gated". The transport gate (§8.1 credential, §7
 * service mode, §18.1 deployment) still applies, because it always does.
 */
export async function sendAnswerReply(input: {
  entryId: string
  actor: Actor
  now?: Date
}): Promise<SendReplyResult> {
  const now = input.now ?? new Date()

  const entry = await db.query.qaEntries.findFirst({ where: eq(qaEntries.id, input.entryId) })
  if (!entry) return { ok: false, message: 'That entry could not be found.' }
  if (!entry.askedByAccountId) {
    return {
      ok: false,
      message:
        'This entry was written directly rather than asked by anyone, so there is no one to ' +
        'reply to. It can be published to the shared Q&A instead.',
    }
  }
  if (!entry.answer?.trim()) {
    return { ok: false, message: 'Write the answer before sending it.' }
  }

  const preview = await previewAnswerReply(input.entryId)
  if (!preview) {
    return {
      ok: false,
      message: 'The reply could not be rendered, so nothing was sent. Check the sender settings.',
    }
  }

  let attempt
  try {
    attempt = await sendOneEmail({
      intent: 'REPLY',
      message: {
        to: preview.to,
        fromName: (await loadSenderDefaults()).defaultSenderName ?? 'Flipit',
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
      },
      actor: input.actor,
      now,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Sending is currently refused.'
    await audit({
      actor: input.actor,
      entityType: 'qa_entry',
      entityId: input.entryId,
      action: 'qa.reply_blocked',
      metadata: { reasonGiven: true },
    })
    return { ok: false, message }
  }

  if (attempt.outcome !== 'SUCCEEDED') {
    await audit({
      actor: input.actor,
      entityType: 'qa_entry',
      entityId: input.entryId,
      action: 'qa.reply_failed',
      metadata: { outcome: attempt.outcome, reason: attempt.failure.reason },
    })
    return { ok: false, message: attempt.failure.message }
  }

  await db
    .update(qaEntries)
    .set({ answerEmailSentAt: now, updatedAt: now })
    .where(eq(qaEntries.id, input.entryId))

  await db.insert(qaThreadMessages).values({
    entryId: input.entryId,
    direction: 'FROM_OPERATOR',
    body: entry.answer,
  })

  await audit({
    actor: input.actor,
    entityType: 'qa_entry',
    entityId: input.entryId,
    action: 'qa.reply_sent',
    // The Message-ID, never the body. §15.
    metadata: { messageId: attempt.result.messageId, attempts: attempt.attempts },
  })

  return { ok: true, messageId: attempt.result.messageId }
}

// ---------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------

/**
 * Is this entry waiting on the operator?
 *
 * True when it has no answer at all, or when the investor has said something
 * since the last reply went out — which is how a follow-up re-opens a thread
 * without a status column that could disagree with the messages.
 */
export function isAwaitingAnswer(input: {
  answer: string | null
  answerEmailSentAt: Date | null
  lastInvestorMessageAt: Date | null
}): boolean {
  if (!input.answer?.trim()) return true
  if (!input.lastInvestorMessageAt) return false
  if (!input.answerEmailSentAt) return true
  return input.lastInvestorMessageAt.getTime() > input.answerEmailSentAt.getTime()
}

/** The newest investor message per entry, for `isAwaitingAnswer`. */
export async function lastInvestorMessageTimes(): Promise<Map<string, Date>> {
  const rows = await db
    .select({
      entryId: qaThreadMessages.entryId,
      at: sql<Date>`max(${qaThreadMessages.createdAt})`,
    })
    .from(qaThreadMessages)
    .where(eq(qaThreadMessages.direction, 'FROM_INVESTOR'))
    .groupBy(qaThreadMessages.entryId)

  return new Map(rows.map((row) => [row.entryId, new Date(row.at)]))
}
