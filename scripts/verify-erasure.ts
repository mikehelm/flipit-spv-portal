/**
 * The erasure procedure, against real Postgres, with a second investor present.
 * OPEN_DECISIONS.md item 12.
 *
 * `plan.test.ts` proves the declaration is complete and internally consistent.
 * It cannot prove that the executor implements it, and it cannot prove the one
 * thing that actually matters here, which is *isolation*: an erasure that
 * quietly took a neighbouring investor's conversation with it would pass every
 * unit test in the repository, because no unit test has a neighbour.
 *
 * So there are two investors throughout, seeded identically, and every check on
 * the erased one is paired with the same check on the other. The pairing is the
 * point; a check that only reads the erased row proves the UPDATE ran, not that
 * it ran where it was aimed.
 *
 * What is covered:
 *
 *   - every column the plan names, read back after the run
 *   - the second investor, untouched, column for column
 *   - the figures, unchanged on both — an erasure removes the person, not
 *     the round
 *   - the audit log: relabelled, nothing removed, nothing added but the
 *     erasure's own row, and the erased address gone from metadata
 *   - the stored document bytes, actually gone from a real store
 *   - idempotence: a second run refuses rather than making a second fiction
 *   - a preview that touches nothing
 *
 *   pnpm verify:erasure
 */

import 'dotenv/config'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  accountStatusEvents,
  auditEvents,
  commitments,
  conversationMessages,
  documentPackages,
  emailChangeRequests,
  emailSnapshots,
  fundsReceipts,
  interestRegisterEntries,
  investorAccounts,
  investorResponses,
  investorSessions,
  offerStatusEvents,
  offers,
  participationCertificates,
  paymentInstructions,
  portalTokens,
  qaEntries,
  qaThreadMessages,
  recipients,
  rounds,
  sendEvents,
  signInAttempts,
  users,
} from '@/db/schema'
import type { AdminIdentity } from '@/lib/auth/guards'
import {
  ERASURE_BEGAN_ACTION,
  ERASURE_INCOMPLETE_ACTION,
  eraseAccount,
  previewErasure,
} from '@/lib/erasure/erase'
import { readUnfinishedErasures } from '@/lib/erasure/unfinished'
import { erasureFindings } from '@/lib/health/rules'
import { ERASED_MARKER, ERASED_STORAGE_KEY, looksErased, pseudonymEmail } from '@/lib/erasure/plan'
import { issueToken } from '@/lib/crypto'
import { resetEnvCache } from '@/lib/env'
import { mediaStore, newStorageKey, resetMediaStoreCache } from '@/lib/media/store'
import {
  FakeS3,
  FAKE_S3_ACCESS_KEY_ID,
  FAKE_S3_BUCKET,
  FAKE_S3_REGION,
  FAKE_S3_SECRET,
} from '@/test/fake-s3'
import { everyOf } from '@/lib/verify/vacuous'

const PREFIX = 'ErasureVerify'

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * The real seeded owner, not a made-up identity.
 *
 * `account_status_events.actor_user_id` is a foreign key, so an invented actor
 * fails at the last statement of the transaction — after the stored bytes have
 * already been destroyed. The verification has to use somebody who exists for
 * the same reason a real erasure does.
 */
let owner: AdminIdentity

async function cleanup(): Promise<void> {
  /*
   * Driven off the round rather than off the email prefix, because after a run
   * the accounts no longer carry the prefix — that is the whole point of the
   * thing being verified. A cleanup that looked for `ErasureVerify%` would find
   * the erased investor on the first run and miss them on every one after.
   */
  await db.delete(auditEvents).where(like(auditEvents.entityId, `${PREFIX}%`))
  await db.delete(signInAttempts).where(like(signInAttempts.key, `${PREFIX}%`))
  await db.delete(auditEvents).where(like(auditEvents.actorLabel, 'erased-%@erased.invalid'))

  const roundRows = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(like(rounds.name, `${PREFIX}%`))
  const roundIds = roundRows.map((row) => row.id)
  if (roundIds.length === 0) return

  const ownedOffers = await db
    .select({ id: offers.id, accountId: offers.accountId })
    .from(offers)
    .where(inArray(offers.roundId, roundIds))
  const offerIds = ownedOffers.map((row) => row.id)
  const accountIds = [...new Set(ownedOffers.map((row) => row.accountId))]

  // `portal_tokens.offer_id`, `conversation_messages.offer_id` and
  // `qa_entries.offer_id` all reference offers with no onDelete, so they go
  // before the offers do.
  if (offerIds.length > 0) {
    await db.delete(portalTokens).where(inArray(portalTokens.offerId, offerIds))
    await db.delete(conversationMessages).where(inArray(conversationMessages.offerId, offerIds))
    await db.delete(qaEntries).where(inArray(qaEntries.offerId, offerIds))
    await db.delete(offers).where(inArray(offers.id, offerIds))
  }

  if (accountIds.length > 0) {
    await db.delete(portalTokens).where(inArray(portalTokens.accountId, accountIds))
    await db.delete(conversationMessages).where(inArray(conversationMessages.accountId, accountIds))
    await db.delete(auditEvents).where(inArray(auditEvents.actorAccountId, accountIds))
    await db.delete(auditEvents).where(inArray(auditEvents.entityId, accountIds))
    await db.delete(investorAccounts).where(inArray(investorAccounts.id, accountIds))
  }

  await db.delete(recipients).where(inArray(recipients.roundId, roundIds))
  await db.delete(rounds).where(inArray(rounds.id, roundIds))
}

/**
 * One investor with something in every table the plan touches.
 *
 * Deliberately maximal. A fixture with two rows proves an UPDATE compiles; the
 * check that matters is that nothing was missed, and nothing can be missed in a
 * table that is empty.
 */
async function seedInvestor(slug: string, roundId: string) {
  const email = `${PREFIX}-${slug}@example.test`

  const [recipient] = await db
    .insert(recipients)
    .values({
      roundId,
      name: `${slug} Person`,
      email,
      jurisdiction: 'GB',
      internalNotes: 'Spoke to him on the mobile; wants the short version.',
      senderName: 'David Serene',
      senderEmail: 'serenedavid@gmail.com',
      senderPhone: '+44 7700 900000',
    })
    .returning()

  const [account] = await db
    .insert(investorAccounts)
    .values({ email, name: `${slug} Person`, status: 'ACTIVE', emailVerifiedAt: new Date() })
    .returning()

  const [offer] = await db
    .insert(offers)
    .values({
      roundId,
      accountId: account!.id,
      recipientId: recipient!.id,
      proposedAmountUsd: '25000.00',
      committedAmountUsd: '25000.00',
      acceptedAmountUsd: '25000.00',
      receivedAmountUsd: '25000.00',
      spvPercentage: '2.500000',
      indirectPercentage: '0.750000',
      responseDeadline: '2026-09-01',
      stage: 'FUNDS_RECEIVED',
      responseChoice: 'INTERESTED',
      responseNote: `Yes — count ${slug} in for the full amount.`,
      blockDetail: `${slug} was held pending advice on his jurisdiction.`,
    })
    .returning()

  const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await db.insert(investorSessions).values({
    sessionToken: `${PREFIX}-${slug}-session`,
    accountId: account!.id,
    expires: later,
  })
  const { hash } = issueToken()
  await db.insert(portalTokens).values({
    accountId: account!.id,
    purpose: 'CLAIM',
    tokenHash: hash,
    expiresAt: later,
  })

  await db.insert(accountStatusEvents).values({
    accountId: account!.id,
    fromStatus: 'INVITED',
    toStatus: 'ACTIVE',
    reason: `${slug} claimed his link from the office in Bangkok.`,
    investorNotified: true,
  })

  await db.insert(offerStatusEvents).values({
    offerId: offer!.id,
    fromStage: 'INVITATION_SENT',
    toStage: 'FUNDS_RECEIVED',
    reason: `${slug} paid on the Tuesday.`,
    investorNote: `Told ${slug} the funds had landed.`,
    internalNote: `${slug} is slow on email, phone him.`,
  })

  const [snapshot] = await db
    .insert(emailSnapshots)
    .values({
      offerId: offer!.id,
      kind: 'INVITATION',
      subject: `An invitation for ${slug} Person`,
      htmlBody: `<p>Dear ${slug}, your allocation is USD 25,000.</p>`,
      textBody: `Dear ${slug}, your allocation is USD 25,000.`,
      fromAddress: 'serenedavid@gmail.com',
      fromName: 'David Serene',
      toAddress: email,
      templateHash: 'a'.repeat(64),
    })
    .returning()

  await db.insert(sendEvents).values({
    offerId: offer!.id,
    snapshotId: snapshot!.id,
    kind: 'INVITATION',
    outcome: 'FAILED_PERMANENT',
    errorDetail: `550 mailbox unavailable for ${email}`,
  })

  await db.insert(emailChangeRequests).values({
    accountId: account!.id,
    newEmail: `${PREFIX}-${slug}-new@example.test`,
    previousEmail: email,
    tokenHash: `${PREFIX}-${slug}-change`,
    expiresAt: later,
  })

  await db.insert(investorResponses).values({
    offerId: offer!.id,
    choice: 'INTERESTED',
    message: `Delighted — ${slug}.`,
  })

  await db.insert(conversationMessages).values([
    {
      accountId: account!.id,
      offerId: offer!.id,
      direction: 'FROM_INVESTOR',
      body: `Hello David, it is ${slug}. Where do I send the money?`,
      emailMessageId: `<${slug}-1@mail.example.test>`,
      inReplyTo: `<${slug}-0@mail.example.test>`,
    },
    {
      accountId: account!.id,
      offerId: offer!.id,
      direction: 'FROM_OPERATOR',
      body: `Hello ${slug}, the details are attached.`,
    },
  ])

  await db.insert(commitments).values({
    offerId: offer!.id,
    amountUsd: '25000.00',
    spvPercentage: '2.500000',
    agreedAt: new Date(),
    note: `${slug} agreed on the call.`,
  })

  await db.insert(paymentInstructions).values({
    offerId: offer!.id,
    issuedAt: new Date(),
    deliveryNote: `Phoned ${slug} to read them out.`,
  })

  await db.insert(fundsReceipts).values({
    offerId: offer!.id,
    amount: '25000.00',
    currency: 'USD',
    valueDate: '2026-07-20',
    reference: `SWIFT ref ${slug} PERSON 25000`,
  })

  await db.insert(participationCertificates).values({
    offerId: offer!.id,
    data: { name: `${slug} Person`, amountUsd: '25000.00' },
  })

  const [entry] = await db
    .insert(qaEntries)
    .values({
      askedByAccountId: account!.id,
      offerId: offer!.id,
      questionOriginal: `This is ${slug} at 14 Acacia Avenue — when does the round close?`,
      questionPublic: 'When does the round close?',
      answer: 'When David presses the button. There is no hard date.',
      isPublished: true,
      publishedAt: new Date(),
      notifyFailure: `could not reach ${email}`,
    })
    .returning()

  await db.insert(qaThreadMessages).values({
    entryId: entry!.id,
    direction: 'FROM_INVESTOR',
    body: `Thanks — ${slug}.`,
  })

  await db.insert(interestRegisterEntries).values({
    accountId: account!.id,
    joinedAt: new Date(),
    indicativeAmountUsd: '25000.00',
    operatorOrderOverride: 1,
    overrideReason: `${slug} asked to be first and David agreed.`,
  })

  await db.insert(signInAttempts).values({
    key: email,
    failures: 3,
    firstFailureAt: new Date(),
  })

  // Two audit rows: one the investor wrote (relabelled), one an administrator
  // wrote about them with the address inside metadata (swept).
  await db.insert(auditEvents).values([
    {
      actorAccountId: account!.id,
      actorLabel: email,
      entityType: 'portal',
      entityId: `${PREFIX}-${account!.id}`,
      action: 'portal.signed_in',
      metadata: { method: 'link' },
    },
    {
      actorUserId: null,
      actorLabel: 'serenedavid@gmail.com',
      entityType: 'offer',
      entityId: `${PREFIX}-${offer!.id}`,
      action: 'invitation.sent',
      metadata: { to: email, offerId: offer!.id },
    },
  ])

  return { account: account!, offer: offer!, recipient: recipient!, entry: entry!, email }
}

async function main(): Promise<void> {
  await cleanup()

  const ownerRow = await db.query.users.findFirst({ where: eq(users.role, 'OWNER') })
  if (!ownerRow) throw new Error('Run `pnpm db:seed` first.')
  owner = { id: ownerRow.id, email: ownerRow.email, name: ownerRow.name, role: 'OWNER' }

  const [round] = await db
    .insert(rounds)
    .values({ name: `${PREFIX} round`, aggregateTargetUsd: '500000.00', flipitShare: '30.000000' })
    .returning()

  const alice = await seedInvestor('alice', round!.id)
  const bob = await seedInvestor('bob', round!.id)

  // -------------------------------------------------------------------------
  console.log('\nThe preview, which must change nothing')

  const preview = await previewErasure(alice.account.id)
  check('a preview is returned for a real account', preview !== null)
  check('and null for one that does not exist', (await previewErasure('no-such-account')) === null)

  if (preview) {
    check('it counts the offer', preview.counts.offers === 1)
    check('it counts the recipient row', preview.counts.recipients === 1)
    check('it counts both conversation messages', preview.counts.conversationMessages === 2)
    check('it counts the audit rows it would relabel', preview.counts.auditRowsRelabelled === 1)
    check('it does not report the account as already erased', !preview.alreadyErased)
    check('nothing blocks it — no stored objects in this fixture', preview.blockedBy === null)
  }

  const afterPreview = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, alice.account.id),
  })
  check('the account is exactly as it was', afterPreview?.email === alice.email)

  // -------------------------------------------------------------------------
  console.log('\nThe erasure')

  const result = await eraseAccount({ accountId: alice.account.id, actor: owner })
  check('it succeeds', result.ok, result.ok ? undefined : result.message)
  if (!result.ok) {
    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(1)
  }

  const pseudonym = pseudonymEmail(alice.account.id)

  const erased = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, alice.account.id),
  })
  check('the name is a pseudonym', looksErased(erased?.name ?? null))
  check('the address is under .invalid, which resolves nowhere', erased?.email === pseudonym)
  check('the mailbox is no longer marked verified', erased?.emailVerifiedAt === null)
  check('the account is archived', erased?.status === 'ARCHIVED')

  const aliceRecipient = await db.query.recipients.findFirst({
    where: eq(recipients.id, alice.recipient.id),
  })
  check('the recipient name is a pseudonym', looksErased(aliceRecipient?.name ?? null))
  check(
    'the recipient address is derived from the recipient row, not the account',
    aliceRecipient?.email === pseudonymEmail(alice.recipient.id),
  )
  check('the internal notes are gone', aliceRecipient?.internalNotes === null)
  check('the per-recipient sender overrides are gone', aliceRecipient?.senderName === null)
  check('the jurisdiction survives — it is the compliance record', aliceRecipient?.jurisdiction === 'GB')

  const statusRows = await db
    .select()
    .from(accountStatusEvents)
    .where(eq(accountStatusEvents.accountId, alice.account.id))
  const seeded = statusRows.filter((row) => row.toStatus === 'ACTIVE')
  check(
    'the seeded status reason is redacted',
    everyOf(seeded, (row) => row.reason === ERASED_MARKER),
  )
  check(
    'and a new event records the archiving in fixed words, not anybody’s prose',
    statusRows.some((row) => row.toStatus === 'ARCHIVED' && row.reason.startsWith('Erased at')),
  )

  const aliceOffer = await db.query.offers.findFirst({ where: eq(offers.id, alice.offer.id) })
  check('the response note is gone', aliceOffer?.responseNote === null)
  check('the block detail is gone', aliceOffer?.blockDetail === null)

  console.log('\nThe figures, which are the record and must survive')
  check('the proposed amount is untouched', aliceOffer?.proposedAmountUsd === '25000.00')
  check('the committed amount is untouched', aliceOffer?.committedAmountUsd === '25000.00')
  check('the accepted amount is untouched', aliceOffer?.acceptedAmountUsd === '25000.00')
  check('the received amount is untouched', aliceOffer?.receivedAmountUsd === '25000.00')
  check('the SPV percentage is untouched', aliceOffer?.spvPercentage === '2.500000')
  check('the indirect percentage is untouched', aliceOffer?.indirectPercentage === '0.750000')
  check('the stage is untouched', aliceOffer?.stage === 'FUNDS_RECEIVED')
  check('the response choice is untouched', aliceOffer?.responseChoice === 'INTERESTED')

  console.log('\nEvery other table the plan names')

  const [statusEvent] = await db
    .select()
    .from(offerStatusEvents)
    .where(eq(offerStatusEvents.offerId, alice.offer.id))
  check(
    'the stage change keeps its stages and loses its prose',
    statusEvent?.toStage === 'FUNDS_RECEIVED' &&
      statusEvent?.reason === null &&
      statusEvent?.investorNote === null &&
      statusEvent?.internalNote === null,
  )

  const [snap] = await db
    .select()
    .from(emailSnapshots)
    .where(eq(emailSnapshots.offerId, alice.offer.id))
  check('the email subject is redacted', snap?.subject === ERASED_MARKER)
  check('the html body is redacted', snap?.htmlBody === ERASED_MARKER)
  check('the text body is redacted', snap?.textBody === ERASED_MARKER)
  check('the recipient address is the pseudonym', snap?.toAddress === pseudonym)
  check(
    'the template hash survives, so which template was sent is still provable',
    snap?.templateHash === 'a'.repeat(64),
  )
  check('the sender is not the investor and is untouched', snap?.fromName === 'David Serene')

  const [send] = await db.select().from(sendEvents).where(eq(sendEvents.offerId, alice.offer.id))
  check('the SMTP error detail is gone', send?.errorDetail === null)
  check('the outcome survives — a failed send is still a failed send', send?.outcome === 'FAILED_PERMANENT')

  const [change] = await db
    .select()
    .from(emailChangeRequests)
    .where(eq(emailChangeRequests.accountId, alice.account.id))
  check('the requested address is the pseudonym', change?.newEmail === pseudonym)
  check('the previous address is gone', change?.previousEmail === null)

  const [response] = await db
    .select()
    .from(investorResponses)
    .where(eq(investorResponses.offerId, alice.offer.id))
  check('the response message is gone', response?.message === null)
  check('the choice survives', response?.choice === 'INTERESTED')

  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.accountId, alice.account.id))
  check('both message bodies are redacted', everyOf(messages, (row) => row.body === ERASED_MARKER))
  check(
    'and the Message-IDs that thread back to the mailbox are gone',
    everyOf(messages, (row) => row.emailMessageId === null && row.inReplyTo === null),
  )

  const [commitment] = await db
    .select()
    .from(commitments)
    .where(eq(commitments.offerId, alice.offer.id))
  check('the commitment note is gone', commitment?.note === null)
  check('the commitment amount is untouched', commitment?.amountUsd === '25000.00')

  const [instruction] = await db
    .select()
    .from(paymentInstructions)
    .where(eq(paymentInstructions.offerId, alice.offer.id))
  check('the delivery note is gone', instruction?.deliveryNote === null)

  const [receipt] = await db
    .select()
    .from(fundsReceipts)
    .where(eq(fundsReceipts.offerId, alice.offer.id))
  check('the bank reference is redacted', receipt?.reference === ERASED_MARKER)
  check('the amount received is untouched', receipt?.amount === '25000.00')
  check('the value date is untouched', receipt?.valueDate === '2026-07-20')

  const [certificate] = await db
    .select()
    .from(participationCertificates)
    .where(eq(participationCertificates.offerId, alice.offer.id))
  check('the certificate snapshot is replaced by a marker', certificate?.data?.erased === true)
  check(
    'and the name it froze is not in it any more',
    !JSON.stringify(certificate?.data ?? {}).includes('alice'),
  )

  const [question] = await db.select().from(qaEntries).where(eq(qaEntries.id, alice.entry.id))
  check('the original question is redacted', question?.questionOriginal === ERASED_MARKER)
  check('the de-identified rewrite is gone too', question?.questionPublic === null)
  check('the entry is unpublished, so it leaves the shared page', question?.isPublished === false)
  check('the delivery failure, which quoted the address, is gone', question?.notifyFailure === null)
  check(
    'the answer is deliberately kept — it is the operator’s writing, read by everyone',
    question?.answer === 'When David presses the button. There is no hard date.',
  )

  const [thread] = await db
    .select()
    .from(qaThreadMessages)
    .where(eq(qaThreadMessages.entryId, alice.entry.id))
  check('the follow-up thread is redacted', thread?.body === ERASED_MARKER)

  const [register] = await db
    .select()
    .from(interestRegisterEntries)
    .where(eq(interestRegisterEntries.accountId, alice.account.id))
  check('the register override reason is gone', register?.overrideReason === null)
  check('the indicative amount is untouched', register?.indicativeAmountUsd === '25000.00')

  const attempts = await db.select().from(signInAttempts).where(eq(signInAttempts.key, alice.email))
  check('the throttle counter keyed by the address is removed outright', attempts.length === 0)

  console.log('\nSessions and links')
  const liveSessions = await db
    .select()
    .from(investorSessions)
    .where(
      and(eq(investorSessions.accountId, alice.account.id), sql`${investorSessions.revokedAt} is null`),
    )
  check('every session is revoked', liveSessions.length === 0)
  const liveLinks = await db
    .select()
    .from(portalTokens)
    .where(and(eq(portalTokens.accountId, alice.account.id), sql`${portalTokens.revokedAt} is null`))
  check('every unspent link is revoked', liveLinks.length === 0)

  console.log('\nThe audit log — relabelled, never emptied')

  const investorRows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.actorAccountId, alice.account.id))
  check('the row the investor wrote is still there', investorRows.length === 1)
  check('and it carries the pseudonym', investorRows[0]?.actorLabel === pseudonym)
  check('and its action is untouched', investorRows[0]?.action === 'portal.signed_in')

  const adminRow = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, `${PREFIX}-${alice.offer.id}`))
  check(
    'an administrator’s row that quoted the address in metadata is swept',
    JSON.stringify(adminRow[0]?.metadata ?? {}).includes(pseudonym),
  )
  check(
    'and the erased address appears nowhere in it',
    !JSON.stringify(adminRow[0]?.metadata ?? {}).includes(alice.email),
  )

  const erasureRow = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, 'investor_account.erased'))
  const mine = erasureRow.filter((row) => row.entityId === alice.account.id)
  check('the erasure wrote a row of its own', mine.length === 1)
  check('signed by the owner who ran it', mine[0]?.actorLabel === owner.email)
  check(
    'and its metadata names no person',
    !JSON.stringify(mine[0]?.metadata ?? {}).includes('alice'),
  )

  const anywhere = await db.execute(
    sql`select count(*)::int as n from audit_events where metadata::text like ${'%' + alice.email + '%'}`,
  )
  check('the erased address is in no audit metadata anywhere', Number(anywhere[0]?.n) === 0)

  // -------------------------------------------------------------------------
  console.log('\nThe second investor, who asked for nothing')

  const bobAccount = await db.query.investorAccounts.findFirst({
    where: eq(investorAccounts.id, bob.account.id),
  })
  check('their name is untouched', bobAccount?.name === 'bob Person')
  check('their address is untouched', bobAccount?.email === bob.email)
  check('their status is untouched', bobAccount?.status === 'ACTIVE')

  const bobRecipient = await db.query.recipients.findFirst({
    where: eq(recipients.id, bob.recipient.id),
  })
  check('their recipient row is untouched', bobRecipient?.name === 'bob Person')
  check('their internal notes survive', bobRecipient?.internalNotes !== null)

  const bobMessages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.accountId, bob.account.id))
  check('their conversation is intact', bobMessages.length === 2)
  check(
    'and none of it is redacted',
    everyOf(bobMessages, (row) => row.body !== ERASED_MARKER && row.body.includes('bob')),
  )

  const [bobSnap] = await db
    .select()
    .from(emailSnapshots)
    .where(eq(emailSnapshots.offerId, bob.offer.id))
  check('their email snapshot still has its body', bobSnap?.htmlBody.includes('bob') === true)
  check('and still names them as the recipient', bobSnap?.toAddress === bob.email)

  const [bobQuestion] = await db.select().from(qaEntries).where(eq(qaEntries.id, bob.entry.id))
  check('their published question is still published', bobQuestion?.isPublished === true)
  check('and still has its text', bobQuestion?.questionPublic !== null)

  const bobAttempts = await db.select().from(signInAttempts).where(eq(signInAttempts.key, bob.email))
  check('their throttle counter is untouched', bobAttempts.length === 1)

  const bobAudit = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.actorAccountId, bob.account.id))
  check('their audit row still carries their own address', bobAudit[0]?.actorLabel === bob.email)

  const bobSessions = await db
    .select()
    .from(investorSessions)
    .where(
      and(eq(investorSessions.accountId, bob.account.id), sql`${investorSessions.revokedAt} is null`),
    )
  check('their session is still live', bobSessions.length === 1)

  // -------------------------------------------------------------------------
  console.log('\nRunning it twice')

  const again = await eraseAccount({ accountId: alice.account.id, actor: owner })
  check('a second run refuses', !again.ok)
  check(
    'and says the account has already been erased rather than failing obscurely',
    !again.ok && again.reason === 'ALREADY_ERASED',
  )

  const stillOne = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, 'investor_account.erased'))
  check(
    'and it wrote no second erasure row',
    stillOne.filter((row) => row.entityId === alice.account.id).length === 1,
  )

  const previewAfter = await previewErasure(alice.account.id)
  check('the preview now reports the account as already erased', previewAfter?.alreadyErased === true)

  const missing = await eraseAccount({ accountId: 'no-such-account', actor: owner })
  check('an unknown account refuses', !missing.ok)
  check('with NO_SUCH_ACCOUNT', !missing.ok && missing.reason === 'NO_SUCH_ACCOUNT')

  // -------------------------------------------------------------------------
  console.log('\nNothing identifying is left behind')

  const leaks = await db.execute(sql`
    select count(*)::int as n from (
      select 1 from investor_accounts where email = ${alice.email} or name like '%alice%'
      union all select 1 from recipients where email = ${alice.email} or internal_notes like '%alice%'
      union all select 1 from email_snapshots where to_address = ${alice.email} or html_body like '%alice%'
      union all select 1 from conversation_messages where body like '%alice%'
      union all select 1 from qa_entries where question_original like '%alice%'
      union all select 1 from funds_receipts where reference like '%alice%'
    ) as found
  `)
  check('the word "alice" survives in no table the plan touches', Number(leaks[0]?.n) === 0)

  const bobSurvives = await db.execute(sql`
    select count(*)::int as n from conversation_messages where body like '%bob%'
  `)
  check('and "bob" survives in his, which is what proves the query works', Number(bobSurvives[0]?.n) > 0)

  const docs = await db
    .select()
    .from(documentPackages)
    .where(eq(documentPackages.offerId, alice.offer.id))
  check('no document rows in the first fixture', docs.length === 0)
  check(
    'and the storage-key marker is not something a real key could collide with',
    ERASED_STORAGE_KEY.length < 32,
  )

  // -------------------------------------------------------------------------
  console.log('\nThe files, actually destroyed')

  /*
   * The one part of an erasure that is not reversible in principle, and until
   * now it was the one part nothing drove. The first fixture has no documents,
   * so `store.remove()` was reached by no check at all and "the bytes are gone"
   * rested on one line of code.
   *
   * So: a real filesystem store, a real object under a real key, a third
   * investor who holds it, and a `stat` afterwards. `stat` rather than a read,
   * because a read that returns nothing is also what an empty file looks like.
   */
  const storeDirectory = await mkdtemp(join(tmpdir(), 'erasure-verify-'))
  const previousStore = process.env.MEDIA_STORE
  const previousDirectory = process.env.MEDIA_DIR
  process.env.MEDIA_STORE = 'filesystem'
  process.env.MEDIA_DIR = storeDirectory
  resetEnvCache()
  resetMediaStoreCache()

  try {
    const store = mediaStore()
    check('a filesystem store is configured for this section', store !== null)

    const carol = await seedInvestor('carol', round!.id)
    const key = newStorageKey('doc')
    const bytes = new TextEncoder().encode('%PDF-1.4 a signed subscription agreement')
    await store!.put(key, bytes, 'application/pdf')

    check('the object is in the store before the erasure', (await store!.stat(key)) !== null)

    await db.insert(documentPackages).values({
      offerId: carol.offer.id,
      title: 'Subscription agreement — carol Person',
      description: 'Countersigned copy returned by carol.',
      storageKey: key,
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      issuedAt: new Date(),
    })

    const carolPreview = await previewErasure(carol.account.id)
    check('the preview counts the stored file', carolPreview?.counts.storedObjects === 1)
    check('the preview counts the document row', carolPreview?.counts.documentPackages === 1)
    check('and nothing blocks it, because the store is reachable', carolPreview?.blockedBy === null)

    const carolResult = await eraseAccount({ accountId: carol.account.id, actor: owner })
    check('the erasure succeeds', carolResult.ok, carolResult.ok ? undefined : carolResult.message)
    check(
      'and reports one object destroyed',
      carolResult.ok && carolResult.objectsDestroyed === 1,
    )

    check('the object is gone from the store', (await store!.stat(key)) === null)

    const [carolDoc] = await db
      .select()
      .from(documentPackages)
      .where(eq(documentPackages.offerId, carol.offer.id))
    check('the document title is redacted', carolDoc?.title === ERASED_MARKER)
    check('the description is gone', carolDoc?.description === null)
    check('the storage key is the marker, not the old key', carolDoc?.storageKey === ERASED_STORAGE_KEY)
    check(
      'and the row still records that a document existed, at its size and version',
      carolDoc?.sizeBytes === bytes.byteLength && carolDoc?.version === 1,
    )
    check(
      'and it is still issued — an erasure changes no document’s lifecycle',
      carolDoc?.issuedAt !== null,
    )

    // ---- and the refusal, with the store taken away -----------------------
    const dave = await seedInvestor('dave', round!.id)
    const daveKey = newStorageKey('doc')
    await store!.put(daveKey, bytes, 'application/pdf')
    await db.insert(documentPackages).values({
      offerId: dave.offer.id,
      title: 'Subscription agreement — dave Person',
      storageKey: daveKey,
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
    })

    process.env.MEDIA_STORE = ''
    resetEnvCache()
    resetMediaStoreCache()

    const refused = await eraseAccount({ accountId: dave.account.id, actor: owner })
    check('with no store configured, an erasure of somebody holding files refuses', !refused.ok)
    check(
      'with MEDIA_STORE_UNREACHABLE',
      !refused.ok && refused.reason === 'MEDIA_STORE_UNREACHABLE',
    )

    const daveAccount = await db.query.investorAccounts.findFirst({
      where: eq(investorAccounts.id, dave.account.id),
    })
    check('and it changed nothing at all — the name is untouched', daveAccount?.name === 'dave Person')
    check('the address is untouched', daveAccount?.email === dave.email)
    check('and the status is untouched', daveAccount?.status === 'ACTIVE')

    process.env.MEDIA_STORE = 'filesystem'
    resetEnvCache()
    resetMediaStoreCache()
    const daveStore = mediaStore()
    check('and the file it would not erase is still there', (await daveStore!.stat(daveKey)) !== null)

    const daveBlocked = await previewErasure(dave.account.id)
    check('the preview says nothing blocks it once the store is back', daveBlocked?.blockedBy === null)

    // ---- a file on the disk that will not delete --------------------------
    /*
     * **The refusal above is the store being absent. This is the store being
     * present and saying no**, on a filesystem — which until now could not
     * happen, because `remove()` caught every error and returned. A read-only
     * mount, a permission the process does not have, a directory where a file
     * should be: all three were swallowed, and the erasure counted the object
     * as destroyed and told the owner it could not be recovered.
     *
     * Producing the fault takes a directory where the object should be. `rm`
     * refuses that with ERR_FS_EISDIR for root and for anybody else, which is
     * what makes it the one usable fault here — this runs as root often enough
     * that `chmod` proves nothing.
     */
    const frank = await seedInvestor('frank', round!.id)
    // Two documents, and the blocked one has to be second in destruction
    // order — the loop is ordered by key now — so that exactly one object is
    // destroyed before the refusal.
    const frankKeys = [newStorageKey('doc'), newStorageKey('doc')].sort()
    const frankGoes = frankKeys[0]!
    const frankBlocked = frankKeys[1]!

    await store!.put(frankGoes, bytes, 'application/pdf')
    for (const [index, frankKey] of frankKeys.entries()) {
      await db.insert(documentPackages).values({
        offerId: frank.offer.id,
        title: `Subscription agreement ${index} — frank Person`,
        storageKey: frankKey,
        contentType: 'application/pdf',
        sizeBytes: bytes.byteLength,
      })
    }
    // A directory with something in it, where the second object should be.
    await mkdir(join(storeDirectory, frankBlocked), { recursive: true })
    await writeFile(join(storeDirectory, frankBlocked, 'in-the-way'), 'x')

    const frankResult = await eraseAccount({ accountId: frank.account.id, actor: owner })
    check('a file the disk will not delete stops the erasure', !frankResult.ok)
    check(
      'and it is reported as partial, because the first one really did go',
      !frankResult.ok && frankResult.reason === 'OBJECTS_PARTIALLY_DESTROYED',
      !frankResult.ok ? frankResult.reason : 'it succeeded',
    )
    check(
      'the file that could be destroyed is gone',
      (await store!.stat(frankGoes)) === null,
    )
    check(
      'and the owner is not told that nothing was changed',
      !frankResult.ok && !/Nothing was changed/i.test(frankResult.message),
      !frankResult.ok ? frankResult.message : '',
    )
    const frankAccount = await db.query.investorAccounts.findFirst({
      where: eq(investorAccounts.id, frank.account.id),
    })
    check('the record still describes the investor', frankAccount?.name === 'frank Person')

    const frankUnfinished = (await readUnfinishedErasures()).find(
      (row) => row.accountId === frank.account.id,
    )
    check('and it is on the health report as unfinished', frankUnfinished?.stage === 'INCOMPLETE')
    check('with one file counted as destroyed', frankUnfinished?.objectsDestroyed === 1)

    // Clear the obstruction and finish the job, which is the documented remedy.
    await rm(join(storeDirectory, frankBlocked), { recursive: true, force: true })
    const frankRetry = await eraseAccount({ accountId: frank.account.id, actor: owner })
    check('with the obstruction cleared, running it again succeeds', frankRetry.ok)
    check(
      'and the finding clears',
      !(await readUnfinishedErasures()).some((row) => row.accountId === frank.account.id),
    )
  } finally {
    if (previousStore === undefined) delete process.env.MEDIA_STORE
    else process.env.MEDIA_STORE = previousStore
    if (previousDirectory === undefined) delete process.env.MEDIA_DIR
    else process.env.MEDIA_DIR = previousDirectory
    resetEnvCache()
    resetMediaStoreCache()
    await rm(storeDirectory, { recursive: true, force: true })
  }

  // -------------------------------------------------------------------------
  console.log('\nAn object store, and one object that will not delete')

  /*
   * Two things nothing has ever done, and they need each other.
   *
   * **An erasure has only ever destroyed bytes on a filesystem.** The section
   * above uses `MEDIA_STORE="filesystem"`, and so does `verify:erasure-bytes`.
   * The object store is the one to use on any deployment without a disk that
   * survives a restart — which is every serverless one, and is what
   * `.env.example` recommends — and no erasure has ever issued a `DELETE` to a
   * bucket. `verify:object-store` proves the client puts and gets and lists;
   * the delete an erasure depends on is exercised there only as cleanup.
   *
   * **And nothing has ever failed part way through.** `eraseAccount` removes
   * every object in a loop and returns `OBJECT_NOT_DESTROYED` on the first one
   * that throws — *before* it opens the transaction, so the record is untouched.
   * That refusal has been reached with no store at all, which fails before the
   * loop starts. It has never been reached from inside the loop, which is where
   * a real bucket fails: an object lock, a legal hold, a key the credentials can
   * read and put but not delete.
   *
   * The second is the interesting one, because the answer is uncomfortable and
   * is better written down than assumed. **An erasure is not atomic across the
   * two stores.** Bytes destroyed before the failing object are gone, the record
   * still names them, and nothing anywhere records that it happened. What makes
   * that survivable is that the erasure can be run again — which is a property
   * of `remove()` being indifferent to an object that is already absent, and is
   * checked below rather than assumed.
   */
  const bucket = new FakeS3()
  await bucket.start()
  const beforeBucket = {
    store: process.env.MEDIA_STORE,
    endpoint: process.env.MEDIA_S3_ENDPOINT,
    region: process.env.MEDIA_S3_REGION,
    name: process.env.MEDIA_S3_BUCKET,
    id: process.env.MEDIA_S3_ACCESS_KEY_ID,
    secret: process.env.MEDIA_S3_SECRET_ACCESS_KEY,
  }

  try {
    process.env.MEDIA_STORE = 'object-store'
    process.env.MEDIA_S3_ENDPOINT = bucket.endpoint
    process.env.MEDIA_S3_REGION = FAKE_S3_REGION
    process.env.MEDIA_S3_BUCKET = FAKE_S3_BUCKET
    process.env.MEDIA_S3_ACCESS_KEY_ID = FAKE_S3_ACCESS_KEY_ID
    process.env.MEDIA_S3_SECRET_ACCESS_KEY = FAKE_S3_SECRET
    resetEnvCache()
    resetMediaStoreCache()

    const store = mediaStore()
    check('an object store is configured for this section', store?.kind === 'object-store')

    const erin = await seedInvestor('erin', round!.id)
    const keys = [newStorageKey('doc'), newStorageKey('doc'), newStorageKey('doc')]
    for (const [index, key] of keys.entries()) {
      const bytes = new TextEncoder().encode(`%PDF-1.4 agreement ${index} for erin`)
      await store!.put(key, bytes, 'application/pdf')
      await db.insert(documentPackages).values({
        offerId: erin.offer.id,
        title: `Subscription agreement ${index} — erin Person`,
        description: 'Countersigned copy.',
        storageKey: key,
        contentType: 'application/pdf',
        sizeBytes: bytes.byteLength,
      })
    }
    check(
      'three objects are in the bucket, over a socket that verified every signature',
      everyOf(keys, (key) => bucket.objects.has(key)),
      `${bucket.objects.size} objects, ${bucket.requests} requests`,
    )

    // ---- one object refuses to go ----------------------------------------
    //
    // The *second key in destruction order*, not the second one created. The
    // loop now reads its keys ordered, so locking this one means exactly one
    // object is destroyed before the refusal — every time, on every run. The
    // previous version of this section could not say which of the three went,
    // and said so in a comment.
    const inDestructionOrder = [...keys].sort()
    const locked = inDestructionOrder[1]!
    bucket.refuseDeleteOf.add(locked)

    const partial = await eraseAccount({ accountId: erin.account.id, actor: owner })
    check('an object that will not delete refuses the erasure', !partial.ok)
    check(
      'with OBJECTS_PARTIALLY_DESTROYED, because one object had already gone',
      !partial.ok && partial.reason === 'OBJECTS_PARTIALLY_DESTROYED',
      !partial.ok ? partial.reason : 'it succeeded',
    )
    check(
      'and the refusal counts the bytes it destroyed on its way to refusing',
      !partial.ok && partial.objectsDestroyed === 1,
      !partial.ok ? `${partial.objectsDestroyed}` : '',
    )
    check(
      'the destruction order is fixed, so exactly the first key went',
      !bucket.objects.has(inDestructionOrder[0]!) &&
        bucket.objects.has(inDestructionOrder[1]!) &&
        bucket.objects.has(inDestructionOrder[2]!),
      [...bucket.objects.keys()].length + ' left in the bucket',
    )
    check(
      'and the message does NOT say nothing was changed, because something was',
      !partial.ok && !/Nothing was changed/i.test(partial.message),
      !partial.ok ? partial.message : '',
    )
    check(
      'it says the file is gone and cannot be recovered',
      !partial.ok && /cannot be recovered/.test(partial.message),
      !partial.ok ? partial.message : '',
    )
    check(
      'and that the database was not touched, which is the half a reader assumes',
      !partial.ok && /database was NOT changed/.test(partial.message),
      !partial.ok ? partial.message : '',
    )
    check(
      'and does not quote the storage key, which is a capability',
      !partial.ok && !partial.message.includes(locked),
    )

    /*
     * The claim the refusal makes, checked against the database rather than
     * taken from the message. This is the whole reason the bytes go first: a
     * store that cannot be emptied must leave a record that still describes
     * the person, not a half-erased one.
     */
    const erinAfter = await db.query.investorAccounts.findFirst({
      where: eq(investorAccounts.id, erin.account.id),
    })
    check('the account is exactly as it was — the name', erinAfter?.name === 'erin Person')
    check('the address', erinAfter?.email === erin.email)
    check('and the status', erinAfter?.status === 'ACTIVE')
    const erinDocs = await db
      .select({ key: documentPackages.storageKey })
      .from(documentPackages)
      .where(eq(documentPackages.offerId, erin.offer.id))
    check(
      'and all three document rows still name their own keys',
      erinDocs.length === 3 && everyOf(erinDocs, (row) => keys.includes(row.key!)),
    )
    check('the object that refused is still in the bucket', bucket.objects.has(locked))

    /*
     * **The residue, now recorded rather than merely stated.**
     *
     * An erasure is not atomic across the database and the object store and
     * cannot be — the bytes have to go first, or a failure leaves them behind
     * for ever. The previous version of this section proved the residue exists
     * and then printed a note saying *"nothing records it"*. This is that note,
     * turned into two audit rows and a health finding.
     */
    const lostAlready = keys.filter((key) => !bucket.objects.has(key))
    check(
      'exactly one of the three is gone for good',
      lostAlready.length === 1,
      `${lostAlready.length} destroyed`,
    )

    const erasureRows = await db
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, erin.account.id))
    const began = erasureRows.filter((row) => row.action === ERASURE_BEGAN_ACTION)
    const incomplete = erasureRows.filter((row) => row.action === ERASURE_INCOMPLETE_ACTION)

    check('a line was written before anything was destroyed', began.length === 1)
    check(
      'and one recording that it stopped part way through',
      incomplete.length === 1,
      `${incomplete.length} rows`,
    )
    check(
      'which counts what it destroyed and what it left',
      (incomplete[0]?.metadata as { objectsDestroyed?: number; objectsRemaining?: number })
        ?.objectsDestroyed === 1 &&
        (incomplete[0]?.metadata as { objectsRemaining?: number })?.objectsRemaining === 2,
      JSON.stringify(incomplete[0]?.metadata),
    )
    check(
      'and names no storage key, because the audit log is exported and read on a screen',
      !JSON.stringify(erasureRows).includes(locked),
    )

    const unfinished = await readUnfinishedErasures()
    const mine = unfinished.find((row) => row.accountId === erin.account.id)
    check('the half-finished erasure is reported as unfinished', mine !== undefined)
    check('as stopped rather than vanished', mine?.stage === 'INCOMPLETE')
    check('with the count the row recorded', mine?.objectsDestroyed === 1)

    const finding = erasureFindings({
      now: new Date(),
      reminders: {
        roundOpen: false,
        scheduleEnabled: false,
        lastRunCompletedAt: null,
        stuck: [],
      },
      lastMediaCheck: null,
      unfinishedErasures: unfinished,
    })[0]
    check('and it reaches the health report as a fault', finding?.severity === 'WRONG')
    check(
      'that tells the reader the record still describes the investor',
      /database was not touched/i.test(finding?.detail ?? ''),
      finding?.detail,
    )
    check(
      'and the finding names no address',
      !/[\w.+-]+@[\w-]+\.[\w.]+/.test(
        `${finding?.headline} ${finding?.detail} ${finding?.remedy}`,
      ),
    )

    // ---- and it can be run again -----------------------------------------
    /*
     * The property that makes the paragraph above survivable rather than a
     * dead end. A `remove()` that threw on an object already destroyed would
     * mean an erasure that failed half way could never be completed: every
     * retry would fail on the first key, for ever, and the only way out would
     * be a person editing the database by hand.
     */
    bucket.refuseDeleteOf.clear()
    const retry = await eraseAccount({ accountId: erin.account.id, actor: owner })
    check('with the lock lifted, running it again succeeds', retry.ok, retry.ok ? '' : retry.reason)
    check(
      'and it destroys all three, including the ones already gone',
      retry.ok && retry.objectsDestroyed === 3,
      retry.ok ? `${retry.objectsDestroyed}` : '',
    )
    check(
      'the bucket holds none of them',
      everyOf(keys, (key) => !bucket.objects.has(key)),
    )
    const erinErased = await db.query.investorAccounts.findFirst({
      where: eq(investorAccounts.id, erin.account.id),
    })
    check(
      'and the record is erased on the second run',
      erinErased?.email === pseudonymEmail(erin.account.id),
    )
    const erinDocsAfter = await db
      .select({ key: documentPackages.storageKey })
      .from(documentPackages)
      .where(eq(documentPackages.offerId, erin.offer.id))
    check(
      'with every document row carrying the erased marker',
      erinDocsAfter.length === 3 &&
        everyOf(erinDocsAfter, (row) => row.key === ERASED_STORAGE_KEY),
    )

    /*
     * And the finding clears. A rule that keeps raising a problem after the
     * remedy has been carried out is one somebody learns to scroll past, which
     * is worse than not having it.
     */
    const stillUnfinished = await readUnfinishedErasures()
    check(
      'the second run clears the finding',
      !stillUnfinished.some((row) => row.accountId === erin.account.id),
      JSON.stringify(stillUnfinished),
    )
  } finally {
    await bucket.stop()
    for (const [name, value] of Object.entries({
      MEDIA_STORE: beforeBucket.store,
      MEDIA_S3_ENDPOINT: beforeBucket.endpoint,
      MEDIA_S3_REGION: beforeBucket.region,
      MEDIA_S3_BUCKET: beforeBucket.name,
      MEDIA_S3_ACCESS_KEY_ID: beforeBucket.id,
      MEDIA_S3_SECRET_ACCESS_KEY: beforeBucket.secret,
    })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    resetEnvCache()
    resetMediaStoreCache()
  }

  await cleanup()

  const leftBehind = await db.select().from(rounds).where(like(rounds.name, `${PREFIX}%`))
  const strays = await db
    .select()
    .from(investorAccounts)
    .where(eq(investorAccounts.id, alice.account.id))
  check('verification data is removed', leftBehind.length === 0 && strays.length === 0)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
