/**
 * Wording the operator's client components need. BUILD_SPEC §6.
 *
 * Pure, and separate from `service.ts` for the reason `lib/portal/stages.ts`
 * is separate from `advance.ts`: importing one string from a module that
 * imports the database pulls the whole postgres driver into the browser bundle
 * and breaks the production build. Typecheck, lint and the test suite all pass
 * straight through that, because none of them draws the server/client boundary.
 */

/** §6: "Withdrawal is possible but leaves a tombstone in the audit log." */
export const WITHDRAWAL_NOTICE =
  'Withdrawing removes it from every portal. It does not un-send it — anyone who has already ' +
  'read it has already read it, and anyone who was emailed still has the email. The withdrawal, ' +
  'its reason and the title are recorded in the audit log.'
