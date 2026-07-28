/**
 * One investor holding a different number of rows of each of sixteen kinds, and
 * the sixteen sentences the erasure card is supposed to draw about them.
 *
 * Two browser-driven scripts need this record and they need it for different
 * reasons, which is why it lives here rather than in either of them.
 *
 *   - `verify:account-access` asks whether each sentence carries the **right**
 *     number, which is a question about `erasureLines()` in
 *     `investors/page.tsx` and can only be answered by a record where every
 *     count differs.
 *   - `verify:viewport` asks whether sixteen of them **fit** at 375px, which is
 *     a question about the layout and needs the list at its full height with
 *     the longest labels and two-digit numbers on it.
 *
 * One fixture, so the second script cannot drift into measuring a shorter list
 * than the first one checks.
 *
 * **It lives under `scripts/` rather than in `src/`, and that is not filing.**
 * `open-decisions.test.ts` scans `src/` and fails if anything in it hard-deletes
 * an investor account, an offer or a recipient — item 12 says the erasure
 * pseudonymises in place. Two more guards in `src/` do the same for snapshot
 * rows and for what may issue a document. This file removes its own fixture,
 * so putting it in `src/` set all three off. The answer to a guard that fires
 * correctly is not an exemption: a test fixture that deletes test rows is not
 * application code and does not belong where application code is looked for.
 *
 * **Nothing here imports `erasureLines()`, and that is deliberate.** The
 * sentences below are typed out. A check that took its expected wording from
 * the code under test would pass a relabelling, which is the exact failure
 * `verify:account-access` exists to catch.
 */

import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
  accountStatusEvents,
  auditEvents,
  conversationMessages,
  documentPackages,
  emailChangeRequests,
  emailSnapshots,
  fundsReceipts,
  interestRegisterEntries,
  investorAccounts,
  investorResponses,
  offerStatusEvents,
  offers,
  participationCertificates,
  qaEntries,
  qaThreadMessages,
  recipients,
  rounds,
} from '@/db/schema'
import { ERASED_STORAGE_KEY } from '@/lib/erasure/plan'
import { newStorageKey } from '@/lib/media/store'

/**
 * The sixteen lines the erasure card can draw, and a **different** number
 * against every one of them.
 *
 * The point of the distinct numbers is the only thing this can prove that a
 * unit test cannot. `erasureLines()` in `investors/page.tsx` is sixteen
 * hand-written pairs of a sentence and a field name, and the failure available
 * to it is not a crash but a *swap* — `documentPackages` drawn against
 * "certificates blanked", `qaEntries` against "follow-up messages". Every count
 * is then a real number computed by a real query and every sentence is true of
 * something; it is simply true of the wrong thing. On a fixture where the rows
 * are one of each, or three of two kinds, that swap renders identically and no
 * assertion anywhere can see it.
 *
 * So the fixture holds one row of one kind, two of another, and so on to
 * sixteen, and the screen is read for all sixteen sentences with their numbers
 * attached. Any permutation of the labels moves at least two numbers.
 *
 * The values are not arbitrary where the schema has an opinion. `register
 * entries` is 1 because `interest_register_entries.account_id` is unique;
 * `recipients` is 2 and `offers` is 5 because `offers_recipient_idx` is unique,
 * so two offers carry a recipient and three carry none; `bank references` is 3
 * because `funds_receipts.offer_id` is unique and there are five offers. The
 * ceiling on the other thirteen is nothing but this list.
 *
 * `stored files` is 7 = the four document packages plus three of the six
 * certificates, which are the certificates given a storage key. That is also
 * what makes the *first* phase of the journey possible: a record with stored
 * files and no media store configured is the one state in which the card
 * refuses to offer the form at all.
 */
export const ERASURE_COUNTS: readonly { readonly label: string; readonly n: number }[] = [
  { label: 'offers, whose figures stay', n: 5 },
  { label: 'stored files destroyed outright', n: 7 },
  { label: 'document records redacted', n: 4 },
  { label: 'conversation messages redacted', n: 9 },
  { label: 'emails as sent, redacted', n: 8 },
  { label: 'questions redacted and unpublished', n: 10 },
  { label: 'follow-up messages on those questions', n: 11 },
  { label: 'response messages cleared', n: 12 },
  { label: 'bank references redacted', n: 3 },
  { label: 'certificates blanked', n: 6 },
  { label: 'imported recipient rows pseudonymised', n: 2 },
  { label: 'status-change reasons redacted', n: 13 },
  { label: 'stage-change notes cleared', n: 14 },
  { label: 'address-change requests pseudonymised', n: 15 },
  { label: 'register entries with their reason cleared', n: 1 },
  { label: 'audit rows relabelled — none removed', n: 16 },
]

/**
 * One investor holding a different number of rows of each of sixteen kinds.
 *
 * Every number here comes from `ERASURE_COUNTS` rather than from a literal, so
 * the list a reader checks the screen against and the list the database is
 * built from cannot drift apart. What is *not* shared is the sentence: those
 * are typed out in `ERASURE_COUNTS` and read off the screen, and neither side
 * imports `erasureLines()`. A test that took its expected wording from the code
 * under test would pass a relabelling, which is the whole failure being hunted.
 */
export async function seedErasureFixture(prefix: string): Promise<{
  account: { id: string }
  investorEmail: string
  offer: { id: string }
}> {
  const want = (label: string): number => {
    const row = ERASURE_COUNTS.find((entry) => entry.label === label)
    if (!row) throw new Error(`No expected count declared for “${label}”.`)
    return row.n
  }
  const times = (n: number): number[] => Array.from({ length: n }, (_, index) => index)

  const [round] = await db
    .insert(rounds)
    .values({
      name: erasureFixtureRound(prefix),
      aggregateTargetUsd: '250000.00',
      flipitShare: '30.000000',
    })
    .returning()

  const investorEmail = `${prefix}-target@example.invalid`

  const [account] = await db
    .insert(investorAccounts)
    .values({ email: investorEmail, name: `${prefix} Target`, status: 'ACTIVE' })
    .returning()

  // `offers_recipient_idx` is unique, so a recipient carries at most one offer.
  // Two recipients and five offers is therefore three offers with none — which
  // is an ordinary state (an account claimed without an import behind it) and
  // the only way these two counts can differ.
  const recipientRows = await db
    .insert(recipients)
    .values(
      times(want('imported recipient rows pseudonymised')).map((index) => ({
        roundId: round!.id,
        name: `${prefix} Target ${index}`,
        email: `${prefix}-target-${index}@example.invalid`,
        jurisdiction: 'GB',
        internalNotes: `Wants the short version. Row ${index}.`,
      })),
    )
    .returning()

  const offerRows = await db
    .insert(offers)
    .values(
      times(want('offers, whose figures stay')).map((index) => ({
        roundId: round!.id,
        accountId: account!.id,
        recipientId: recipientRows[index]?.id ?? null,
        proposedAmountUsd: `${10000 + index}.00`,
        spvPercentage: '1.000000',
        indirectPercentage: '0.300000',
        responseDeadline: '2026-09-01',
        responseNote: `Offer ${index}: yes, from the erasure screen fixture.`,
      })),
    )
    .returning()

  /** Round-robin across the offers, so no count is trapped by a unique index. */
  const onOffer = (index: number): string => offerRows[index % offerRows.length]!.id

  await db.insert(accountStatusEvents).values(
    times(want('status-change reasons redacted')).map((index) => ({
      accountId: account!.id,
      fromStatus: 'INVITED' as const,
      toStatus: 'ACTIVE' as const,
      reason: `Status reason ${index} from the erasure screen fixture.`,
    })),
  )

  await db.insert(offerStatusEvents).values(
    times(want('stage-change notes cleared')).map((index) => ({
      offerId: onOffer(index),
      fromStage: 'INVITATION_SENT' as const,
      toStage: 'RESPONSE_RECORDED' as const,
      reason: `Stage reason ${index} from the erasure screen fixture.`,
      internalNote: `Internal note ${index} from the erasure screen fixture.`,
    })),
  )

  await db.insert(emailSnapshots).values(
    times(want('emails as sent, redacted')).map((index) => ({
      offerId: onOffer(index),
      kind: 'INVITATION' as const,
      subject: `Snapshot ${index} from the erasure screen fixture`,
      htmlBody: `<p>Snapshot ${index}.</p>`,
      textBody: `Snapshot ${index}.`,
      fromAddress: 'serenedavid@example.invalid',
      fromName: 'David Serene',
      toAddress: investorEmail,
      templateHash: 'b'.repeat(64),
    })),
  )

  await db.insert(conversationMessages).values(
    times(want('conversation messages redacted')).map((index) => ({
      accountId: account!.id,
      offerId: onOffer(index),
      direction: index % 2 === 1 ? ('FROM_OPERATOR' as const) : ('FROM_INVESTOR' as const),
      body: `Message ${index} from the erasure screen fixture.`,
    })),
  )

  await db.insert(investorResponses).values(
    times(want('response messages cleared')).map((index) => ({
      offerId: onOffer(index),
      choice: 'INTERESTED' as const,
      message: `Response ${index} from the erasure screen fixture.`,
    })),
  )

  await db.insert(emailChangeRequests).values(
    times(want('address-change requests pseudonymised')).map((index) => ({
      accountId: account!.id,
      newEmail: `${prefix}-new-${index}@example.invalid`,
      previousEmail: investorEmail,
      tokenHash: `${prefix}-change-${index}`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })),
  )

  // `funds_receipts.offer_id` is unique, so this one is capped by the offers.
  await db.insert(fundsReceipts).values(
    times(want('bank references redacted')).map((index) => ({
      offerId: offerRows[index]!.id,
      amount: '1000.00',
      currency: 'USD',
      valueDate: '2026-07-20',
      reference: `SWIFT ref ${index} from the erasure screen fixture`,
    })),
  )

  await db.insert(documentPackages).values(
    times(want('document records redacted')).map((index) => ({
      offerId: onOffer(index),
      title: `Subscription agreement ${index}`,
      description: `Document ${index} from the erasure screen fixture.`,
      storageKey: newStorageKey('doc'),
      contentType: 'application/pdf',
      sizeBytes: 1024 + index,
    })),
  )

  // Only some of the certificates carry a stored file, which is the ordinary
  // state — a certificate is regenerated from `data` and normally stores
  // nothing. It also makes "stored files" a number that is neither the
  // documents nor the certificates.
  await db.insert(participationCertificates).values(
    times(want('certificates blanked')).map((index) => ({
      offerId: onOffer(index),
      version: index + 1,
      storageKey: index < CERTIFICATES_WITH_A_STORED_FILE ? newStorageKey('doc') : null,
      data: { name: `${prefix} Target`, amountUsd: '10000.00' },
    })),
  )

  const entryRows = await db
    .insert(qaEntries)
    .values(
      times(want('questions redacted and unpublished')).map((index) => ({
        askedByAccountId: account!.id,
        offerId: onOffer(index),
        questionOriginal: `Question ${index} from the erasure screen fixture.`,
        questionPublic: `Question ${index}?`,
        answer: 'When David presses the button.',
        isPublished: true,
        publishedAt: new Date(),
      })),
    )
    .returning()

  await db.insert(qaThreadMessages).values(
    times(want('follow-up messages on those questions')).map((index) => ({
      entryId: entryRows[index % entryRows.length]!.id,
      direction: 'FROM_INVESTOR' as const,
      body: `Follow-up ${index} from the erasure screen fixture.`,
    })),
  )

  // Unique per account, so this one can only ever be 1.
  await db.insert(interestRegisterEntries).values(
    times(want('register entries with their reason cleared')).map(() => ({
      accountId: account!.id,
      joinedAt: new Date(),
      indicativeAmountUsd: '25000.00',
      overrideReason: 'Asked to be first and David agreed.',
    })),
  )

  await db.insert(auditEvents).values(
    times(want('audit rows relabelled — none removed')).map((index) => ({
      actorAccountId: account!.id,
      actorLabel: investorEmail,
      entityType: 'portal',
      entityId: account!.id,
      action: 'portal.signed_in',
      metadata: { method: 'link', index },
    })),
  )

  return { account: account!, investorEmail, offer: offerRows[0]! }
}

/** How many of the six certificates carry a storage key. */
export const CERTIFICATES_WITH_A_STORED_FILE = 3

/** The round name this fixture hangs everything from, for a given prefix. */
export function erasureFixtureRound(prefix: string): string {
  return `${prefix} round`
}

/**
 * Remove it, found by round rather than by address.
 *
 * After a successful erasure the account no longer carries the prefix — which
 * is the point of the thing being tested — so an address rule would leave the
 * record behind precisely on the runs that worked.
 */
export async function removeErasureFixture(prefix: string): Promise<void> {
  const roundRows = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.name, erasureFixtureRound(prefix)))
  if (roundRows.length === 0) return
  const roundIds = roundRows.map((row) => row.id)

  const ownedOffers = await db
    .select({ id: offers.id, accountId: offers.accountId })
    .from(offers)
    .where(inArray(offers.roundId, roundIds))
  const offerIds = ownedOffers.map((row) => row.id)
  const accountIds = [...new Set(ownedOffers.map((row) => row.accountId))]

  if (offerIds.length > 0) {
    await db.delete(conversationMessages).where(inArray(conversationMessages.offerId, offerIds))
    // `qa_entries.offer_id` has no `onDelete`, so the offers cannot go first.
    // Everything else this fixture writes cascades from an offer or an account.
    await db.delete(qaEntries).where(inArray(qaEntries.offerId, offerIds))
    await db.delete(offers).where(inArray(offers.id, offerIds))
  }
  if (accountIds.length > 0) {
    await db.delete(conversationMessages).where(inArray(conversationMessages.accountId, accountIds))
    await db.delete(qaEntries).where(inArray(qaEntries.askedByAccountId, accountIds))
    await db.delete(auditEvents).where(inArray(auditEvents.actorAccountId, accountIds))
    await db.delete(auditEvents).where(inArray(auditEvents.entityId, accountIds))
    await db.delete(investorAccounts).where(inArray(investorAccounts.id, accountIds))
  }
  await db.delete(recipients).where(inArray(recipients.roundId, roundIds))
  await db.delete(rounds).where(inArray(rounds.id, roundIds))
}

/**
 * Take the storage keys away, which is the edit that unblocks the form.
 *
 * `previewErasure` sets `blockedBy` when a record holds stored files and no
 * media store is configured, and that state replaces the whole form with a
 * notice. A script that wants to reach the form on a server with no media store
 * has to do to these two columns exactly what an erasure does to them.
 */
export async function clearStoredFiles(accountId: string): Promise<void> {
  const offerIds = (
    await db.select({ id: offers.id }).from(offers).where(eq(offers.accountId, accountId))
  ).map((row) => row.id)
  if (offerIds.length === 0) return
  await db
    .update(documentPackages)
    .set({ storageKey: ERASED_STORAGE_KEY })
    .where(inArray(documentPackages.offerId, offerIds))
  await db
    .update(participationCertificates)
    .set({ storageKey: null })
    .where(inArray(participationCertificates.offerId, offerIds))
}
