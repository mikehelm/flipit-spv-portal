/**
 * Wording the round's client components need. BUILD_SPEC §6.6.
 *
 * Pure and separate from `close.ts` for the reason `lib/portal/stages.ts` is
 * separate from `advance.ts`: importing a string from a module that imports the
 * database pulls the postgres driver into the browser bundle and breaks the
 * production build, and nothing but `pnpm build` catches it.
 */

export const CLOSE_CONFIRMATION_NOTICE =
  'Closing the round stops further responses and marks unfilled allocations as available. It ' +
  'does not close anybody’s account, delete anything, or stop an investor reading their own ' +
  'record. It is not reversible from this screen.'
