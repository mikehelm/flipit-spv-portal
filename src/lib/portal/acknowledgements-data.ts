/**
 * Reading and recording acknowledgements. BUILD_SPEC §13, §8.2.
 *
 * The wording lives in `acknowledgement_items`, which an owner edits. What an
 * investor ticked lives in `response_acknowledgements`, which nobody edits —
 * it is append-only and it carries a copy of the words rather than a pointer to
 * them, so editing the wording later cannot rewrite what somebody agreed to.
 *
 * Nothing here reads or returns anything belonging to another investor: every
 * query is keyed on one offer, and the offer is established by the caller from
 * the session before this module is reached.
 */

import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { acknowledgementItems, responseAcknowledgements } from '@/db/schema'

export interface AcknowledgementItem {
  id: string
  label: string
  required: boolean
  revision: number
}

/** The live wording, in order. Archived items are never offered. */
export async function activeAcknowledgementItems(): Promise<AcknowledgementItem[]> {
  const rows = await db
    .select({
      id: acknowledgementItems.id,
      label: acknowledgementItems.label,
      required: acknowledgementItems.required,
      revision: acknowledgementItems.revision,
    })
    .from(acknowledgementItems)
    .where(isNull(acknowledgementItems.archivedAt))
    .orderBy(asc(acknowledgementItems.sortOrder), asc(acknowledgementItems.createdAt))

  return rows
}

/**
 * The item ids ticked in this offer's most recent set, so the form comes back
 * with the boxes as the investor left them.
 *
 * "Most recent set" rather than "every row ever": the table is append-only, so
 * a box ticked in March and cleared in April still has its March row. The set
 * that counts is the one written with the latest response.
 */
export async function currentAcknowledgements(offerId: string): Promise<Set<string>> {
  const latest = await db
    .select({ acknowledgedAt: responseAcknowledgements.acknowledgedAt })
    .from(responseAcknowledgements)
    .where(eq(responseAcknowledgements.offerId, offerId))
    .orderBy(desc(responseAcknowledgements.acknowledgedAt))
    .limit(1)

  if (latest.length === 0) return new Set()

  const rows = await db
    .select({ itemId: responseAcknowledgements.itemId })
    .from(responseAcknowledgements)
    .where(
      and(
        eq(responseAcknowledgements.offerId, offerId),
        eq(responseAcknowledgements.acknowledgedAt, latest[0].acknowledgedAt),
      ),
    )

  return new Set(rows.map((row) => row.itemId).filter((id): id is string => id !== null))
}

export interface RecordAcknowledgementsInput {
  offerId: string
  /** The ids the investor ticked, filtered by the caller against live items. */
  ticked: AcknowledgementItem[]
  at: Date
}

/**
 * Write one row per ticked box, with the words as shown.
 *
 * Nothing is deleted and nothing is updated. Unticking a box in a later
 * response is recorded by that response's set not containing it, which is a
 * fact with a timestamp rather than an absence.
 */
export async function recordAcknowledgements(
  input: RecordAcknowledgementsInput,
): Promise<void> {
  if (input.ticked.length === 0) return

  await db.insert(responseAcknowledgements).values(
    input.ticked.map((item) => ({
      offerId: input.offerId,
      itemId: item.id,
      label: item.label,
      revision: item.revision,
      acknowledgedAt: input.at,
    })),
  )
}

/**
 * What one investor has acknowledged, newest first, for the operator's record
 * screen — the words they were shown, not the words that are configured now.
 */
export async function acknowledgementHistory(offerId: string): Promise<
  Array<{ label: string; revision: number; acknowledgedAt: Date }>
> {
  return await db
    .select({
      label: responseAcknowledgements.label,
      revision: responseAcknowledgements.revision,
      acknowledgedAt: responseAcknowledgements.acknowledgedAt,
    })
    .from(responseAcknowledgements)
    .where(eq(responseAcknowledgements.offerId, offerId))
    .orderBy(desc(responseAcknowledgements.acknowledgedAt))
}
