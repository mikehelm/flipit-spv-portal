/**
 * The forty-eight acceptance criteria of BUILD_SPEC §22, and where each one is
 * checked. WP19.
 *
 * CODEX_TASKS: *"every one of the 48 acceptance criteria in spec §22 mapped to
 * a test or an explicit note explaining why it is manual. **Done when:** the
 * suite passes and a table maps each of the 48 criteria to its test."*
 *
 * A table like this is worth exactly as much as the checking behind it, so
 * `acceptance.test.ts` does four things rather than rendering it:
 *
 *   1. **Parses §22 out of BUILD_SPEC.md** and asserts each `criterion` here
 *      is that sentence, word for word. The table cannot drift from the
 *      specification, and a criterion cannot be quietly softened to match what
 *      was built.
 *   2. Asserts every referenced file exists.
 *   3. Asserts every referenced test name exists **in that file** — so a
 *      renamed or deleted test breaks the map rather than leaving a citation
 *      pointing at nothing.
 *   4. Asserts every criterion is either covered or carries a `manual` note,
 *      and that no entry claims both.
 *
 * `kind` distinguishes three things that are not the same:
 *
 *   - `unit` — a test in the vitest suite, run by `pnpm test`.
 *   - `database` — a check in a `scripts/verify-*.ts`, run against real
 *     Postgres. These exist because some of §22 is only true once there are
 *     rows: "in no one else's" needs a second investor to be meaningful.
 *   - `browser` — a check in `scripts/verify-viewport.ts`, which renders the
 *     real pages in Chromium. AC31 is not answerable any other way.
 *
 * `manual` is for a criterion no automated check can settle, or one whose
 * feature is deferred. Each says which, and why, in its own words.
 */

export type Coverage =
  | { kind: 'unit'; file: string; name: string }
  | { kind: 'database'; file: string; name: string }
  | { kind: 'browser'; file: string; name: string }

export interface Criterion {
  n: number
  /** Verbatim from BUILD_SPEC §22, with markdown emphasis removed. */
  criterion: string
  covered: Coverage[]
  /** Present only where nothing automated can settle it. */
  manual?: string
}

const unit = (file: string, name: string): Coverage => ({ kind: 'unit', file, name })
const database = (file: string, name: string): Coverage => ({ kind: 'database', file, name })
const browser = (file: string, name: string): Coverage => ({ kind: 'browser', file, name })

export const ACCEPTANCE_CRITERIA: Criterion[] = [
  {
    n: 1,
    criterion:
      'Uploading the sample CSV creates valid recipient records; a file with errors cannot be sent.',
    covered: [
      unit('src/lib/import/table.test.ts', 'reads a CSV into headers and rows'),
      unit('src/lib/import/validate.test.ts', 'one bad row stops the whole file, including the good rows'),
      unit(
        'src/lib/sending/review.test.ts',
        'never removes a blocked recipient from the table — it is shown, not hidden',
      ),
    ],
  },
  {
    n: 2,
    criterion:
      'Indirect ownership is calculated correctly, stored as an exact decimal, and the override is respected.',
    covered: [
      unit('src/lib/money.test.ts', 'computeIndirectPercentage — BUILD_SPEC §10'),
      unit(
        'src/lib/import/validate.test.ts',
        'respects an override and warns that it differs from the calculation',
      ),
      unit('src/db/schema.test.ts', 'has no floating-point column holding a value'),
    ],
  },
  {
    n: 3,
    criterion: 'The preview exactly matches the sent email snapshot.',
    covered: [
      unit(
        'src/lib/sending/approved-source.test.ts',
        'loads the template the same way on both sides of the gate',
      ),
      unit('src/lib/email/render.test.ts', 'renders the invitation with every figure in both parts'),
      unit(
        'src/lib/sending/snapshot.test.ts',
        'renders the preview from the same source the send snapshots',
      ),
      unit(
        'src/lib/sending/snapshot.test.ts',
        'has no second rendering path anywhere in the application',
      ),
      unit(
        'src/lib/sending/snapshot.test.ts',
        'differs from the email it will send only in the claim token',
      ),
      unit(
        'src/lib/sending/snapshot.test.ts',
        'stores the rendered subject and both bodies rather than re-rendering',
      ),
    ],
  },
  {
    n: 4,
    criterion:
      'Each send produces one personalized email to one recipient and records its result individually. No bulk-send path exists anywhere in the UI or API.',
    covered: [
      unit(
        'src/lib/email/transport/retry.test.ts',
        'takes one message, not a list — there is no bulk entry point',
      ),
      unit(
        'src/lib/email/transport/retry.test.ts',
        'reports every attempt so a send event can be written for each',
      ),
      unit(
        'src/lib/sending/snapshot.test.ts',
        'writes exactly one snapshot and one send event per call',
      ),
      unit(
        'src/lib/sending/snapshot.test.ts',
        'takes a single recipient and offers no list parameter',
      ),
      unit(
        'src/lib/sending/snapshot.test.ts',
        'exposes no bulk send in the server action or the row it is bound to',
      ),
    ],
  },
  {
    n: 5,
    criterion: 'Investor links reveal no personal data in the URL.',
    covered: [
      unit('src/db/schema.test.ts', 'portal tokens store only a hash (§15)'),
      unit('src/lib/crypto.test.ts', 'issues at least 128 bits of entropy'),
      unit('src/lib/crypto.test.ts', 'stores a hash that does not contain the token'),
      database('scripts/verify-lifecycle.ts', 'and works exactly once'),
      database(
        'scripts/verify-lifecycle.ts',
        'two simultaneous redemptions produce exactly one success',
      ),
      database('scripts/verify-lifecycle.ts', 'an expired claim link is refused'),
      database('scripts/verify-lifecycle.ts', 'no token is stored in the clear — only its hash'),
      unit(
        'src/lib/portal/links.test.ts',
        'reveals no part of the recipient’s name or address, in any encoding',
      ),
      unit(
        'src/lib/portal/links.test.ts',
        'reveals no offer id, account id, amount or percentage',
      ),
      unit(
        'src/lib/portal/links.test.ts',
        'no portal route accepts anything but a token in its URL',
      ),
      unit(
        'src/lib/portal/links.test.ts',
        'cannot be pointed at a host a caller supplied',
      ),
    ],
  },
  {
    n: 6,
    criterion:
      'Sending is impossible without a current compliance approval, and editing one character of the template disables sending until re-approval.',
    covered: [
      unit('src/lib/compliance/gate.test.ts', 'refuses a perfectly good recipient when no approval exists'),
      unit('src/lib/compliance/drift.test.ts', 'one changed character in the body voids the approval'),
      unit('src/lib/compliance/drift.test.ts', 'one changed character in the subject voids the approval'),
      unit(
        'src/lib/sending/approved-source.test.ts',
        'compares the rendered template hash with the approved hash before sending',
      ),
    ],
  },
  {
    n: 7,
    criterion:
      'A recipient in a jurisdiction outside the approved list is blocked individually, with the reason shown, while the rest of the batch proceeds.',
    covered: [
      unit(
        'src/lib/compliance/gate.test.ts',
        'blocks the US recipient alone while everyone else stays sendable',
      ),
      unit('src/lib/compliance/explain.test.ts', 'says the rest of the round is unaffected'),
    ],
  },
  {
    n: 8,
    criterion:
      'The dashboard shows mail connection health, and a missing or rejected credential blocks sending with a specific message.',
    covered: [
      unit(
        'src/lib/email/transport/health.test.ts',
        'reports a healthy connection with the authenticated address — §8.1',
      ),
      unit(
        'src/lib/email/transport/guard.test.ts',
        '1. blocks when the credential is missing, and says so',
      ),
    ],
  },
  {
    n: 9,
    criterion:
      'Claiming an invitation creates a verified, persistent investor account that can be signed back into later without the original link.',
    covered: [
      unit(
        'src/lib/portal/access.test.ts',
        'invited: the claim link works and nothing else exists yet',
      ),
      unit(
        'src/lib/portal/sign-in-email.test.ts',
        'states the expiry plainly, so a cold link reads as expected',
      ),
      database('scripts/verify-lifecycle.ts', 'an unaffected investor can still get one'),
    ],
  },
  {
    n: 10,
    criterion:
      'Suspending or closing an account immediately ends its sessions and invalidates its links. A suspended account cannot obtain a new sign-in link. A closed account can, and reaches a read-only view, when `closed_account_access` is `read_only`.',
    covered: [
      unit(
        'src/lib/portal/access.test.ts',
        'suspended: no new link, no access, and a neutral notice',
      ),
      unit(
        'src/lib/portal/access.test.ts',
        'closed with read_only: may sign back in, read only',
      ),
      database('scripts/verify-lifecycle.ts', 'every session is revoked'),
      database('scripts/verify-lifecycle.ts', 'every unspent link is revoked'),
      database('scripts/verify-lifecycle.ts', 'and may not be issued a new link'),
    ],
  },
  {
    n: 11,
    criterion:
      'An investor sees their status advance through commitment, acceptance, and funds received, with the amounts and dates the operator recorded.',
    covered: [
      unit(
        'src/lib/portal/timeline.test.ts',
        'marks earlier steps done, this one current and the rest ahead',
      ),
      unit(
        'src/lib/portal/timeline.test.ts',
        'writes a complete sentence when a fact is genuinely absent',
      ),
      database('scripts/verify-certificate.ts', 'the stage moved to funds received'),
    ],
  },
  {
    n: 12,
    criterion:
      'Recording funds received requires two-step confirmation and is written to the audit log.',
    covered: [
      database(
        'scripts/verify-certificate.ts',
        'without the confirmation tick, nothing is recorded',
      ),
      database('scripts/verify-certificate.ts', 'a mismatched re-typed amount records nothing'),
      database('scripts/verify-certificate.ts', 'and truly nothing was written'),
      unit(
        'src/lib/audit-coverage.test.ts',
        'records nothing when the confirmation is not ticked',
      ),
      unit(
        'src/lib/audit-coverage.test.ts',
        'records nothing when the re-typed amount is a cent out',
      ),
      unit(
        'src/lib/audit-coverage.test.ts',
        'records the action string the criterion names',
      ),
      unit(
        'src/lib/audit-coverage.test.ts',
        'keeps the bank reference off the funds-received entry (§5)',
      ),
    ],
  },
  {
    n: 13,
    criterion:
      "A published update appears in the intended investors' portals and in no one else's, and its notification email contains no financial detail.",
    covered: [
      unit(
        'src/lib/updates/audience.test.ts',
        'resolves an empty filter to nothing rather than to everybody',
      ),
      unit('src/lib/updates/notification.test.ts', 'contains no amount and no percentage'),
      unit(
        'src/lib/updates/notification.test.ts',
        'does not name the update it is announcing',
      ),
      database('scripts/verify-updates.ts', 'a targeted update publishes to one person'),
      database('scripts/verify-updates.ts', 'the intended recipient sees it'),
    ],
  },
  {
    n: 14,
    criterion:
      'Setting the service to read-only, sunset, or disabled produces the behaviour in §7, and the owner retains access and export throughout.',
    covered: [
      unit('src/lib/portal/access.test.ts', 'the service mode can only ever narrow access'),
      unit(
        'src/lib/portal/access.test.ts',
        'sunset still lets an investor in to take their records away',
      ),
      database('scripts/verify-rounds.ts', 'gives an active investor'),
      database('scripts/verify-export.ts', 'the export itself is audited'),
      unit(
        'src/lib/export/secrets.test.ts',
        'produces the same export bytes whatever mode the service is put into',
      ),
      unit(
        'src/lib/export/secrets.test.ts',
        'puts no service-mode precondition anywhere in the export path',
      ),
      unit(
        'src/lib/export/secrets.test.ts',
        'gates each export route on identity alone',
      ),
    ],
  },
  {
    n: 15,
    criterion: 'An investor account can hold a second offer under a second round without schema changes.',
    covered: [
      unit(
        'src/db/schema.test.ts',
        'investor accounts carry no round reference — they are durable (§4.3)',
      ),
      unit(
        'src/db/schema.test.ts',
        'an offer belongs to a round and an account, so accounts outlive rounds (§4.3)',
      ),
      unit(
        'src/db/second-offer.test.ts',
        'holds a second offer under a second round with no schema change',
      ),
      unit(
        'src/db/second-offer.test.ts',
        'matches an incoming row to the account that already exists',
      ),
      unit(
        'src/db/second-offer.test.ts',
        'scopes the recipient row to its round, so the same address can appear in the next one',
      ),
    ],
  },
  {
    n: 16,
    criterion: 'David can reply and the message is logged against the correct record and thread.',
    covered: [
      unit(
        'src/lib/qa/service.test.ts',
        're-opens when a follow-up arrives after the reply (§6.7.1)',
      ),
      database('scripts/verify-qa.ts', 'a follow-up joins the existing thread'),
      database('scripts/verify-qa.ts', 'the thread message is from the investor'),
    ],
  },
  {
    n: 17,
    criterion: 'Mike can view and export all data, including the audit log.',
    covered: [
      unit('src/lib/export/export.test.ts', 'is separate and rejects an operator at the Zod boundary'),
      database('scripts/verify-export.ts', 'the audit formatter refuses a non-owner request outright'),
    ],
  },
  {
    n: 18,
    criterion:
      'Unauthorized users cannot access investor or admin records. An unknown address cannot sign in and no record is created for it. Sign-in is enumeration-resistant: an unknown address and a wrong password fail identically.',
    covered: [
      unit(
        'src/lib/auth/credentials.test.ts',
        'fails identically for an unknown address and a wrong password',
      ),
      unit('src/lib/auth/credentials.test.ts', 'creates nothing for an unknown address'),
      unit('src/lib/auth/sign-in-policy.test.ts', 'has no self-registration path of any kind'),
      unit(
        'src/lib/portal/sign-in-timing.test.ts',
        'settles on every single return, with none left unpadded',
      ),
      unit(
        'src/lib/auth/second-factor-guard.test.ts',
        'the check lives in currentAdmin, which every guard already goes through',
      ),
      database(
        'scripts/verify-second-factor.ts',
        'the other session is still waiting — a stolen password left open stays useless',
      ),
    ],
  },
  {
    n: 19,
    criterion:
      'The operator cannot record, amend, or void a compliance approval; the control is owner-only and the attempt is logged.',
    covered: [
      unit(
        'src/actions/compliance.test.ts',
        'logs every refused attempt, naming the action and the role (§22 AC19)',
      ),
      unit(
        'src/lib/compliance/authority.test.ts',
        'refuses the operator every one of them — record, amend and void included',
      ),
    ],
  },
  {
    n: 20,
    criterion: 'Sending is unavailable in `read_only`, `sunset`, and `disabled` service modes.',
    covered: [
      unit(
        'src/lib/email/transport/guard.test.ts',
        '3. blocks when the service mode is not ACTIVE, naming the mode',
      ),
    ],
  },
  {
    n: 21,
    criterion:
      'A recipient row missing `sender_phone` with no configured default is caught at pre-flight, before the batch starts — not as a mid-batch failure.',
    covered: [
      unit(
        'src/lib/email/render.test.ts',
        'catches a missing sender_phone with no configured default, before any send',
      ),
      unit('src/lib/sending/preflight.test.ts', 'rendering and sender identity — AC21'),
    ],
  },
  {
    n: 22,
    criterion:
      'A file containing an invalid jurisdiction code blocks the whole file; a file containing a valid code that is merely outside the approved list does not.',
    covered: [
      unit('src/lib/import/validate.test.ts', 'an invalid ISO country code — AC22'),
      unit(
        'src/lib/import/validate.test.ts',
        'a valid code outside the approved list — AC7, AC22, §8.3',
      ),
      unit(
        'src/lib/compliance/jurisdictions.test.ts',
        'rejects anything that is not an assigned ISO 3166-1 alpha-2 code',
      ),
    ],
  },
  {
    n: 23,
    criterion:
      'A spreadsheet with unfamiliar column names, extra columns and mixed date formats produces a mapping proposal that David can correct, and imports correctly once confirmed.',
    covered: [
      unit('src/lib/import/mapping.test.ts', 'reads a column by what is in it when the header is unhelpful'),
      unit('src/lib/import/mapping.test.ts', 'asks about a date column that could go either way'),
      unit('src/lib/import/table.test.ts', 'names empty and duplicated headers rather than losing them'),
    ],
  },
  {
    n: 24,
    criterion: 'The app imports a file with no AI key configured, using manual column mapping.',
    covered: [
      unit(
        'src/lib/import/validate.test.ts',
        'produces byte-identical figures whether the mapping came from a model or a dropdown',
      ),
      unit('src/lib/import/mapping.test.ts', 'proposeMappingFromHeaders — the no-key path, AC24'),
    ],
  },
  {
    n: 25,
    criterion: 'The AI key is never displayed after saving, never logged, and never exported.',
    covered: [
      unit(
        'src/lib/crypto.test.ts',
        'never reveals whether a value is long, short, or what it starts with',
      ),
      unit('src/lib/email/transport/secret.test.ts', 'cannot be reached by JSON.stringify, even nested'),
      unit('src/lib/audit.test.ts', 'names every offending key so the fix is obvious'),
      database('scripts/verify-export.ts', 'no metadata key looks like a credential or a body'),
      unit(
        'src/lib/export/secrets.test.ts',
        'names no credential in any recipient or audit export header',
      ),
      unit(
        'src/lib/export/secrets.test.ts',
        'never selects, decrypts or returns the stored key from the settings action',
      ),
      unit(
        'src/lib/export/secrets.test.ts',
        'has no console call in any export module, export route or settings file',
      ),
      unit(
        'src/lib/export/secrets.test.ts',
        'reads the key the settings action itself uses, and reads it at every depth',
      ),
    ],
  },
  {
    n: 26,
    criterion:
      'A percentage column that could read as 5% or 0.05 raises an explicit question rather than being coerced.',
    covered: [
      unit('src/lib/import/mapping.test.ts', 'refuses to proceed while an ambiguity is unanswered — AC26'),
    ],
  },
  {
    n: 27,
    criterion:
      'No AI output is used in any monetary calculation — the indirect-ownership figure is identical whether or not AI was used to import.',
    covered: [
      unit(
        'src/lib/import/validate.test.ts',
        'produces byte-identical figures whether the mapping came from a model or a dropdown',
      ),
      unit('src/lib/import/ai.test.ts', 'carries no numbers across the boundary — only column names'),
    ],
  },
  {
    n: 28,
    criterion:
      'A reminder sends only to non-responders, respects the per-recipient cap, contains no offer terms, and requires its own approved template.',
    covered: [
      unit('src/lib/reminders/eligibility.test.ts', 'refuses every recorded response'),
      unit('src/lib/reminders/schedule.test.ts', 'never plans more than the cap'),
      unit('src/lib/reminders/eligibility.test.ts', 'refuses the one that would exceed it'),
      unit('src/lib/reminders/no-offer-terms.test.ts', 'the built-in reminder passes its own gate'),
      unit(
        'src/lib/reminders/schedule.test.ts',
        'loads the compliance context for REMINDER and never for INVITATION',
      ),
      database('scripts/verify-reminders.ts', 'a responder is never queued'),
    ],
  },
  {
    n: 29,
    criterion: 'A queued reminder can be cancelled before it sends, and the cancellation is logged.',
    covered: [database('scripts/verify-reminders.ts', 'a queued reminder can be cancelled')],
  },
  {
    n: 30,
    criterion:
      'The "Coming to your portal" tiles render without promising returns, dates, or specific functionality, and are configurable by the owner.',
    covered: [
      unit('src/lib/portal/roadmap.test.ts', 'rejects a promise of return, valuation or liquidity'),
      unit('src/lib/portal/roadmap.test.ts', 'rejects a timeline — §13.1: "No dates. No soon."'),
      unit('src/lib/portal/roadmap.test.ts', 'is rendered beneath the tiles on the investor portal'),
      unit(
        'src/lib/audit-coverage.test.ts',
        'calls the one audit helper from inside its own body',
      ),
      unit(
        'src/lib/audit-coverage.test.ts',
        'names every exported reminder mutation that writes to the database',
      ),
      unit(
        'src/lib/audit-coverage.test.ts',
        'registers cancelMany even though it delegates its writes',
      ),
    ],
    manual:
      'Half of this is not built. The wording constraint is enforced, and the standing ' +
      'line §13.1 requires is on the page and cannot be switched off. "Configurable by ' +
      'the owner" is not: the tiles are seeded and there is no screen to add, rename or ' +
      'hide one. `forbiddenWordsInTileLabel` is the gate that surface must call, and it ' +
      'exists ahead of it.',
  },
  {
    n: 31,
    criterion:
      'The portal renders correctly and legibly at 375px width, and text contrast meets WCAG AA against the dark palette.',
    covered: [
      browser('scripts/verify-viewport.ts', 'no horizontal scroll'),
      browser('scripts/verify-viewport.ts', 'every rendered string meets AA'),
      unit('src/lib/brand.contrast.test.ts', 'dim on bg — the one the specification names'),
      unit('src/lib/palette.test.ts', 'no screen contains a hex colour literal'),
    ],
  },
  {
    n: 32,
    criterion:
      "An uploaded image is served from the app's own domain, stripped of EXIF, and available to both the portal and the email templates.",
    covered: [],
    manual:
      'Not built. WP15 is deferred until somewhere to store a file is chosen — see the ' +
      'WP16 entry in PROGRESS.md for why base64-in-Postgres and a writable disk were ' +
      'both rejected. There is nothing to test and nothing that pretends there is.',
  },
  {
    n: 33,
    criterion:
      'David can record or upload a video, preview it in the real portal layout, replace it, and publish it — and nothing is investor-visible until he publishes.',
    covered: [],
    manual:
      'Not built, and deferred for the same reason as AC32: §13.3 wants recorded or ' +
      'uploaded video hosted on the application\'s own domain and served only to ' +
      'authenticated investors, and there is nowhere to put the file. §13.3 also says ' +
      'the whole feature is optional and removable, and that if David never records one ' +
      'the portal shows no gap where it would have been — which is the state today.',
  },
  {
    n: 34,
    criterion:
      'The flow prompts David to send himself a complete test invitation, including his video, before any real send is possible.',
    covered: [
      unit(
        'src/lib/email/transport/guard.test.ts',
        'refuses a test send addressed to anyone but the operator',
      ),
      unit(
        'src/lib/email/transport/guard.test.ts',
        'still requires a working credential — there is nothing to test with',
      ),
    ],
    manual:
      'The test send exists and is locked to the operator\'s own address. What is not ' +
      'built is the prompt — §13.3 wants it offered in the flow rather than found — and ' +
      '"including his video" depends on AC33. The half that protects a real recipient is ' +
      'in place; the half that is a nudge is not.',
  },
  {
    n: 35,
    criterion:
      'No investor-facing screen reveals the existence, identity, count, or aggregate contribution of any other investor.',
    covered: [
      unit('src/lib/qa/anonymity.test.ts', 'carries no account id anywhere in its serialised form'),
      unit(
        'src/lib/register/copy.test.ts',
        'never tells the investor how many people are on it',
      ),
      unit(
        'src/lib/portal/timeline.test.ts',
        'nothing in the timeline reveals another investor — §15',
      ),
      database('scripts/verify-qa.ts', 'no other account id appears'),
      database('scripts/verify-register.ts', 'no position appears'),
      database('scripts/verify-register.ts', 'no count appears'),
    ],
  },
  {
    n: 36,
    criterion:
      "A question submitted from the portal reaches David's queue and emails him, and the asker sees a confirmation.",
    covered: [
      unit('src/lib/qa/service.test.ts', 'waits when there is no answer at all'),
      unit(
        'src/lib/qa/messages.test.ts',
        'says plainly that nothing has gone to the investor yet',
      ),
      database('scripts/verify-qa.ts', 'a notification that cannot be sent does not lose the question'),
      unit(
        'src/lib/qa/defaults.test.ts',
        'confirms in the words PORTAL_COPY uses, once the question is recorded',
      ),
      unit(
        'src/lib/qa/defaults.test.ts',
        'is the same confirmation whatever the account, and repeats nothing back',
      ),
      unit(
        'src/lib/qa/defaults.test.ts',
        'confirms even when the notification to David could not get out',
      ),
    ],
  },
  {
    n: 37,
    criterion:
      'An answer defaults to private — visible only to the asker — and is published only when the box is explicitly ticked.',
    covered: [
      unit('src/lib/qa/visibility.test.ts', 'still lets a read-only visitor read their own correspondence'),
      database('scripts/verify-qa.ts', 'saving does not publish'),
      unit(
        'src/lib/qa/defaults.test.ts',
        'hands recordAnswer publish false when the field never arrives',
      ),
      unit(
        'src/lib/qa/defaults.test.ts',
        'reads a field that never arrived as unticked',
      ),
      unit(
        'src/lib/qa/defaults.test.ts',
        'has no visibility flag anywhere in the module that defaults to true',
      ),
    ],
  },
  {
    n: 38,
    criterion:
      'A published entry shows no name, initials, email, or identifying timestamp, and David can rewrite the question text for publication while the original is preserved on the record.',
    covered: [
      unit('src/lib/qa/anonymity.test.ts', 'exposes exactly six fields and no more'),
      unit(
        'src/lib/qa/anonymity.test.ts',
        'publishes the rewritten wording, never the original',
      ),
      unit('src/lib/qa/anonymity.test.ts', 'never leaks a day'),
      unit(
        'src/db/schema.test.ts',
        'a Q&A entry keeps the original question separate from the published one (§6.7)',
      ),
      database('scripts/verify-qa.ts', 'the shared page carries no asker name'),
    ],
  },
  {
    n: 39,
    criterion: 'The answer email to the asker is not sent until David presses send.',
    covered: [database('scripts/verify-qa.ts', 'saving does not send')],
  },
  {
    n: 40,
    criterion: 'David can create and publish a Q&A entry with no question behind it.',
    covered: [
      unit(
        'src/lib/qa/service.test.ts',
        'treats a seeded entry with no investor messages as settled',
      ),
      database('scripts/verify-qa.ts', 'the operator can write an entry directly (§6.7.4)'),
      database('scripts/verify-qa.ts', 'a seeded entry has no asker in the queue'),
    ],
  },
  {
    n: 41,
    criterion: 'Unpublishing removes an entry from the shared page and is audit-logged.',
    covered: [database('scripts/verify-qa.ts', 'an entry can be unpublished')],
  },
  {
    n: 42,
    criterion:
      'Reaching Funds received generates a branded PDF certificate the investor can download, carrying the correct figures and the not-a-share-certificate footer.',
    covered: [
      unit('src/lib/certificate/pdf.test.ts', 'says it is not a share certificate and not a title document'),
      unit(
        'src/lib/certificate/pdf.test.ts',
        'prints the figures exactly as recorded, without rounding or reformatting',
      ),
      database('scripts/verify-certificate.ts', 'a certificate is issued'),
      database('scripts/verify-certificate.ts', 'carrying the investor’s name'),
      database('scripts/verify-certificate.ts', 'the amount received'),
      unit(
        'src/lib/audit-coverage.test.ts',
        'gives each audited mutation an action string of its own',
      ),
      unit(
        'src/lib/qa/anonymity.test.ts',
        'returns null for a withdrawn entry even if the flag was left set',
      ),
    ],
  },
  {
    n: 43,
    criterion:
      'The anti-phishing page is publicly reachable without sign-in, is the only indexed route, and names the exact sending address and link domain.',
    covered: [
      unit(
        'src/lib/verify/verify.test.tsx',
        'renders without an authentication dependency and uses configured facts',
      ),
      unit('src/lib/verify/robots.test.ts', 'opts exactly two pages into indexing, and names them'),
      unit('src/lib/verify/robots.test.ts', 'allows the verification page back in'),
      browser(
        'scripts/verify-viewport.ts',
        'the verification page is reachable with no session at all',
      ),
      database('scripts/verify-deployment.ts', '${BASE_PATH}${path} is indexable'),
    ],
  },
  {
    n: 44,
    criterion:
      'The app refuses to send real invitations when its configured base URL is not the production value.',
    covered: [
      unit(
        'src/lib/email/transport/guard.test.ts',
        '4. blocks when this is not the production deployment',
      ),
      unit('src/lib/env.test.ts', 'marks the testing deployment as not production'),
      unit('src/lib/env.test.ts', 'production deployment guard (BUILD_SPEC §18.1, AC44)'),
      database(
        'scripts/verify-deployment.ts',
        'a real invitation is refused off the production deployment',
      ),
      database('scripts/verify-deployment.ts', 'a test send to the operator is still allowed here'),
    ],
  },
  {
    n: 45,
    criterion:
      'The blocked US recipient produces an explanation to the operator, and can only be unblocked with a recorded approval reference.',
    covered: [
      unit('src/lib/compliance/explain.test.ts', 'says exactly what unblocking requires — a recorded reference'),
      unit('src/lib/compliance/gate.test.ts', 'does not unblock without a reference — there is no blanket unblock'),
      unit(
        'src/actions/compliance.test.ts',
        'has no exported action that unblocks a jurisdiction for everybody',
      ),
    ],
  },
  {
    n: 46,
    criterion:
      'An investor can join and leave the register of interest from their portal, and never sees their position or anyone else\'s.',
    covered: [
      unit('src/lib/register/copy.test.ts', 'never uses queue language in the investor-facing copy'),
      database('scripts/verify-register.ts', 'they can see that they are on the register'),
      database('scripts/verify-register.ts', 'an investor can remove themselves'),
      database('scripts/verify-register.ts', 'and the portal reflects it immediately'),
    ],
  },
  {
    n: 47,
    criterion:
      'The register order is computed from funds-received date, then commitment date, then join date, and an operator override requires a recorded reason.',
    covered: [
      unit(
        'src/lib/register/order.test.ts',
        'puts settled funds first, then commitments, then everyone else',
      ),
      unit('src/lib/register/order.test.ts', 'an override needs a recorded reason (§5.2.2)'),
      database('scripts/verify-register.ts', 'an override with a thin reason is refused'),
      database('scripts/verify-register.ts', 'clearing the override restores the computed order'),
    ],
  },
  {
    n: 48,
    criterion:
      'An offer issued from the register passes through the jurisdiction gate and compliance approval exactly as an original offer does.',
    covered: [
      unit('src/lib/compliance/offers.test.ts', 'blocks everyone when there is no approval at all'),
      unit('src/lib/compliance/offers.test.ts', 'blocks an uncleared jurisdiction and leaves the cleared ones alone'),
      database('scripts/verify-register.ts', 'an offer to an uncleared jurisdiction is still created'),
      database('scripts/verify-register.ts', 'and is blocked individually by the gate'),
    ],
  },
]
