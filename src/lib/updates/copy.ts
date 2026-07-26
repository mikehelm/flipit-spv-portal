/**
 * Wording the operator's client components need. BUILD_SPEC §6.
 *
 * Pure, and separate from `service.ts` for the reason `lib/portal/stages.ts`
 * is separate from `advance.ts`: importing one string from a module that
 * imports the database pulls the whole postgres driver into the browser bundle
 * and breaks the production build. Typecheck, lint and the test suite all pass
 * straight through that, because none of them draws the server/client boundary.
 */

/**
 * §6: the accounts an update can never reach.
 *
 * It lives here rather than beside `ADDRESSABLE_STATUSES` in `audience.ts` for
 * the reason above, met a second time and with a quieter symptom. That module
 * holds a `zod` schema, and importing this one string from a client component
 * pulled the whole of zod into the browser bundle. Zod then probes for
 * `new Function`; the Content-Security-Policy refuses it; zod catches the throw
 * and carries on interpreted. So nothing broke — and every visit to `/updates`
 * reported a `script-src eval` violation that no test could see and that would
 * have camouflaged a real one.
 */
export const NON_ADDRESSABLE_NOTE =
  'Suspended and archived accounts are never included. Neither has portal access, so an update ' +
  'addressed to one would be recorded as delivered somewhere nobody can look.'

/** §6: "Withdrawal is possible but leaves a tombstone in the audit log." */
export const WITHDRAWAL_NOTICE =
  'Withdrawing removes it from every portal. It does not un-send it — anyone who has already ' +
  'read it has already read it, and anyone who was emailed still has the email. The withdrawal, ' +
  'its reason and the title are recorded in the audit log.'
