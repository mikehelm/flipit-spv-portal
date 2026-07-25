/**
 * The eight stages, as labels and arithmetic. BUILD_SPEC §5.
 *
 * Pure, and it exists **because it is pure**. The operator's advancement forms
 * are client components and they need the labels; the mutations that use the
 * same labels are in `advance.ts`, which imports the database. Importing one
 * constant from that module pulled the entire postgres driver into the browser
 * bundle and broke the production build — a failure `pnpm typecheck`, `lint`
 * and `test` all pass cleanly through, because none of them draws the
 * server/client boundary.
 *
 * So the presentational half lives here, with no import that touches the
 * database, and `advance.ts` re-exports it for server callers.
 */

import { OFFER_STAGES, type OfferStage } from './timeline'

export const STAGE_LABEL: Readonly<Record<OfferStage, string>> = {
  INVITATION_SENT: 'Invitation sent',
  RESPONSE_RECORDED: 'Response recorded',
  DOCUMENTS_ISSUED: 'Documents issued',
  COMMITMENT_AGREED: 'Commitment agreed',
  ALLOCATION_ACCEPTED: 'Allocation accepted',
  PAYMENT_INSTRUCTIONS_ISSUED: 'Payment instructions issued',
  FUNDS_RECEIVED: 'Funds received',
  COMPLETED: 'Completed',
}

export function stageIndex(stage: OfferStage): number {
  return OFFER_STAGES.indexOf(stage)
}

/**
 * The next stage, or null at the end.
 *
 * Advancing is deliberately one step at a time. Jumping from "documents issued"
 * straight to "funds received" would leave an investor's timeline claiming
 * things happened that nobody recorded, and the timeline is what they read to
 * know where they stand.
 */
export function nextStage(stage: OfferStage): OfferStage | null {
  return OFFER_STAGES[stageIndex(stage) + 1] ?? null
}

/** §5 requires a reason for a correction; this is the teeth on it. */
export const MIN_CORRECTION_REASON = 10

export const FUNDS_CONFIRMATION_NOTICE =
  'Recording funds received tells the investor their money has arrived and generates their ' +
  'participation certificate. Re-type the amount and tick the confirmation — it is a financial ' +
  'assertion they will rely on.'
