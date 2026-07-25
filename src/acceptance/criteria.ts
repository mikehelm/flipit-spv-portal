/**
 * The 48 acceptance criteria of BUILD_SPEC §22, and where each one is proved.
 *
 * This file holds evidence, never criterion text. The text lives in
 * BUILD_SPEC.md §22 and is read from there — by `criteria.test.ts`, which
 * checks the numbering still lines up, and by `scripts/acceptance-table.ts`,
 * which writes ACCEPTANCE.md. A copy of the wording here would be a second
 * source of truth, and the second one is always the one that goes stale.
 *
 * Three kinds of evidence, in descending order of how cheaply they run:
 *
 *   `tests`   — Vitest. Runs in `pnpm test`, on every commit, with no database.
 *   `scripts` — `scripts/verify-*.ts`. Runs the real flow against a real
 *               Postgres. Automated, but needs a database, a build or a
 *               browser, so it runs before a release rather than on every
 *               commit. The string recorded is the label passed to that
 *               script's `check()`.
 *   `manual`  — a human has to look. The note says what they look at and why a
 *               machine cannot.
 *
 * A criterion with no evidence of any kind carries `outstanding`, which says
 * plainly what is missing and what it is waiting on. Three do. None of them is
 * an oversight and each names its blocker.
 *
 * Every string below is verified to exist by `criteria.test.ts` — a test name
 * that has been renamed, or a check label that has been deleted, fails the
 * suite rather than quietly becoming a claim about nothing.
 */

export interface TestReference {
  /** Repo-relative path of a Vitest file. */
  file: string
  /** Exact `describe()` or `it()` name, as written in that file. */
  name: string
}

export interface ScriptReference {
  /** Repo-relative path of a `scripts/verify-*.ts` file. */
  file: string
  /** Exact label passed to that script's `check()`. */
  label: string
}

export interface AcceptanceCriterion {
  /** 1-48, matching the numbering of BUILD_SPEC §22. */
  id: number
  tests?: TestReference[]
  scripts?: ScriptReference[]
  /** Why a human has to look, and at what. */
  manual?: string
  /** What is missing, and what it is waiting on. */
  outstanding?: string
}

export const ACCEPTANCE_CRITERIA: AcceptanceCriterion[] = [
  {
    id: 1,
    tests: [
      { file: 'src/lib/import/validate.test.ts', name: 'produces exact stored values and the §10 calculation' },
      {
        file: 'src/lib/import/validate.test.ts',
        name: 'FILE-LEVEL errors — nothing in the file can be imported',
      },
      {
        file: 'src/lib/import/validate.test.ts',
        name: 'one bad row stops the whole file, including the good rows',
      },
      { file: 'src/lib/import/table.test.ts', name: 'reads a CSV into headers and rows' },
    ],
  },
  {
    id: 2,
    tests: [
      { file: 'src/lib/money.test.ts', name: 'computeIndirectPercentage — BUILD_SPEC §10' },
      { file: 'src/lib/money.test.ts', name: 'is exact where binary floating point is not' },
      { file: 'src/lib/money.test.ts', name: 'is byte-identical however the same figure arrived' },
      {
        file: 'src/lib/import/validate.test.ts',
        name: 'respects an override and warns that it differs from the calculation',
      },
    ],
    scripts: [{ file: 'scripts/verify-certificate.ts', label: 'the indirect percentage' }],
  },
  {
    id: 3,
    tests: [
      {
        file: 'src/lib/sending/snapshot.test.ts',
        name: 'renders the preview from the same source the send snapshots',
      },
      { file: 'src/lib/sending/snapshot.test.ts', name: 'has no second rendering path anywhere in the application' },
      { file: 'src/lib/sending/snapshot.test.ts', name: 'differs from the email it will send only in the claim token' },
      {
        file: 'src/lib/sending/snapshot.test.ts',
        name: 'stores the rendered subject and both bodies rather than re-rendering',
      },
    ],
  },
  {
    id: 4,
    tests: [
      { file: 'src/lib/sending/snapshot.test.ts', name: 'writes exactly one snapshot and one send event per call' },
      { file: 'src/lib/sending/snapshot.test.ts', name: 'takes a single recipient and offers no list parameter' },
      { file: 'src/lib/email/transport/index.test.ts', name: 'exports no function that sends to more than one recipient' },
      {
        file: 'src/lib/email/transport/smtp.test.ts',
        name: 'has no bulk path: a comma-separated recipient list is not an address',
      },
    ],
  },
  {
    id: 5,
    tests: [
      {
        file: 'src/lib/portal/links.test.ts',
        name: 'reveals no part of the recipient’s name or address, in any encoding',
      },
      { file: 'src/lib/portal/links.test.ts', name: 'reveals no offer id, account id, amount or percentage' },
      { file: 'src/lib/portal/links.test.ts', name: 'no portal route accepts anything but a token in its URL' },
      { file: 'src/db/schema.test.ts', name: 'portal tokens store only a hash (§15)' },
    ],
  },
  {
    id: 6,
    tests: [
      { file: 'src/lib/compliance/gate.test.ts', name: 'refuses a perfectly good recipient when no approval exists' },
      { file: 'src/lib/compliance/gate.test.ts', name: 'refuses a cleared recipient when the template has drifted' },
      { file: 'src/lib/compliance/drift.test.ts', name: 'one changed character in the body voids the approval' },
      { file: 'src/lib/compliance/drift.test.ts', name: 'one changed character in the subject voids the approval' },
    ],
  },
  {
    id: 7,
    tests: [
      {
        file: 'src/lib/compliance/gate.test.ts',
        name: 'blocks the US recipient alone while everyone else stays sendable',
      },
      { file: 'src/lib/sending/preflight.test.ts', name: 'leaves everybody else sendable and the checklist ready' },
      { file: 'src/lib/compliance/explain.test.ts', name: 'names the person and says they are held, not sent' },
      { file: 'src/lib/import/validate.test.ts', name: 'a valid code outside the approved list — AC7, AC22, §8.3' },
    ],
    scripts: [{ file: 'scripts/verify-register.ts', label: 'and is blocked individually by the gate' }],
  },
  {
    id: 8,
    tests: [
      {
        file: 'src/lib/email/transport/health.test.ts',
        name: 'reports a healthy connection with the authenticated address — §8.1',
      },
      { file: 'src/lib/email/transport/health.test.ts', name: 'separates never-tested from failed' },
      { file: 'src/lib/email/transport/guard.test.ts', name: '1. blocks when the credential is missing, and says so' },
      { file: 'src/lib/email/transport/guard.test.ts', name: 'gives each of the four a DIFFERENT message' },
    ],
  },
  {
    id: 9,
    tests: [
      { file: 'src/lib/portal/access.test.ts', name: 'invited: the claim link works and nothing else exists yet' },
      { file: 'src/lib/portal/access.test.ts', name: 'active: full access to their own record' },
      {
        file: 'src/lib/portal/links.test.ts',
        name: 'reaches the same route, which redeems a sign-in token as well as a claim',
      },
      { file: 'src/db/schema.test.ts', name: 'investor accounts carry no round reference — they are durable (§4.3)' },
    ],
    scripts: [
      { file: 'scripts/verify-viewport.ts', label: 'the claim link opens the portal' },
      { file: 'scripts/verify-lifecycle.ts', label: 'an unaffected investor can still get one' },
    ],
  },
  {
    id: 10,
    tests: [
      { file: 'src/lib/portal/access.test.ts', name: 'suspended: no new link, no access, and a neutral notice' },
      { file: 'src/lib/portal/access.test.ts', name: 'closed with read_only: may sign back in, read only' },
      { file: 'src/lib/portal/access.test.ts', name: 'holds across every service mode' },
    ],
    scripts: [
      { file: 'scripts/verify-lifecycle.ts', label: 'every session is revoked' },
      { file: 'scripts/verify-lifecycle.ts', label: 'every unspent link is revoked' },
      { file: 'scripts/verify-lifecycle.ts', label: 'asking for a new link produces nothing' },
      { file: 'scripts/verify-lifecycle.ts', label: 'closing revokes everything too' },
    ],
  },
  {
    id: 11,
    tests: [
      { file: 'src/lib/portal/timeline.test.ts', name: 'marks earlier steps done, this one current and the rest ahead' },
      { file: 'src/lib/portal/timeline.test.ts', name: 'reflects the choice the investor actually made' },
      { file: 'src/lib/portal/timeline.test.ts', name: 'gives every step an explanation, at every stage — §5' },
    ],
    scripts: [
      { file: 'scripts/verify-certificate.ts', label: 'a step cannot be skipped' },
      { file: 'scripts/verify-certificate.ts', label: 'the stage moved to funds received' },
    ],
  },
  {
    id: 12,
    tests: [
      { file: 'src/lib/audit-coverage.test.ts', name: 'records nothing when the confirmation is not ticked' },
      { file: 'src/lib/audit-coverage.test.ts', name: 'records nothing when the re-typed amount is a cent out' },
      { file: 'src/lib/audit-coverage.test.ts', name: 'records the action string the criterion names' },
      { file: 'src/lib/audit-coverage.test.ts', name: 'keeps the bank reference off the funds-received entry (§5)' },
    ],
    scripts: [
      { file: 'scripts/verify-certificate.ts', label: 'without the confirmation tick, nothing is recorded' },
      { file: 'scripts/verify-certificate.ts', label: 'a mismatched re-typed amount records nothing' },
    ],
  },
  {
    id: 13,
    tests: [
      { file: 'src/lib/updates/audience.test.ts', name: 'never includes a suspended or archived account' },
      { file: 'src/lib/updates/audience.test.ts', name: 'resolves an empty filter to nothing rather than to everybody' },
      { file: 'src/lib/updates/notification.test.ts', name: 'contains no amount and no percentage' },
      { file: 'src/lib/updates/notification.test.ts', name: 'is byte-identical for every recipient' },
    ],
    scripts: [
      { file: 'scripts/verify-updates.ts', label: 'a targeted update publishes to one person' },
      { file: 'scripts/verify-updates.ts', label: 'the intended recipient sees it' },
    ],
  },
  {
    id: 14,
    tests: [
      { file: 'src/lib/portal/access.test.ts', name: 'read_only service makes an active account read-only' },
      { file: 'src/lib/portal/access.test.ts', name: 'sunset still lets an investor in to take their records away' },
      { file: 'src/lib/portal/access.test.ts', name: 'disabled closes the door to everybody, including a claim' },
      {
        file: 'src/lib/export/secrets.test.ts',
        name: 'produces the same export bytes whatever mode the service is put into',
      },
      { file: 'src/lib/export/secrets.test.ts', name: 'puts no service-mode precondition anywhere in the export path' },
    ],
  },
  {
    id: 15,
    tests: [
      {
        file: 'src/db/schema.test.ts',
        name: 'an offer belongs to a round and an account, so accounts outlive rounds (§4.3)',
      },
      { file: 'src/db/schema.test.ts', name: 'investor accounts carry no round reference — they are durable (§4.3)' },
      { file: 'src/db/second-offer.test.ts', name: 'holds a second offer under a second round with no schema change' },
      { file: 'src/db/second-offer.test.ts', name: 'matches an incoming row to the account that already exists' },
    ],
  },
  {
    id: 16,
    tests: [
      { file: 'src/lib/qa/messages.test.ts', name: 'quotes the question back so the reply stands alone' },
      { file: 'src/lib/email/transport/message-id.test.ts', name: 'buildReferences — threading' },
      { file: 'src/lib/qa/service.test.ts', name: 're-opens when a follow-up arrives after the reply (§6.7.1)' },
    ],
    scripts: [
      { file: 'scripts/verify-qa.ts', label: 'the question is on the thread' },
      { file: 'scripts/verify-qa.ts', label: 'a follow-up joins the existing thread' },
    ],
  },
  {
    id: 17,
    tests: [
      { file: 'src/lib/export/export.test.ts', name: 'is separate and rejects an operator at the Zod boundary' },
      {
        file: 'src/lib/export/export.test.ts',
        name: 'keeps every amount in a separate exact text cell through XLSX round trip',
      },
      { file: 'src/lib/export/export.test.ts', name: 'owner-only audit export' },
    ],
    scripts: [
      { file: 'scripts/verify-export.ts', label: 'the audit CSV builds' },
      { file: 'scripts/verify-export.ts', label: 'the audit formatter refuses a non-owner request outright' },
    ],
  },
  {
    id: 18,
    tests: [
      {
        file: 'src/lib/auth/credentials.test.ts',
        name: 'fails identically for an unknown address and a wrong password',
      },
      { file: 'src/lib/auth/credentials.test.ts', name: 'creates nothing for an unknown address' },
      { file: 'src/lib/auth/credentials.test.ts', name: 'answers a stranger exactly as it answers the owner — AC18' },
      { file: 'src/lib/import/authz.test.ts', name: 'refuses when nobody is signed in' },
    ],
  },
  {
    id: 19,
    tests: [
      {
        file: 'src/lib/compliance/authority.test.ts',
        name: 'refuses the operator every one of them — record, amend and void included',
      },
      { file: 'src/actions/compliance.test.ts', name: 'refuses every compliance mutation, with a message that says who can' },
      {
        file: 'src/actions/compliance.test.ts',
        name: 'logs every refused attempt, naming the action and the role (§22 AC19)',
      },
    ],
  },
  {
    id: 20,
    tests: [
      {
        file: 'src/lib/email/transport/guard.test.ts',
        name: '3. blocks when the service mode is not ACTIVE, naming the mode',
      },
      { file: 'src/lib/email/transport/guard.test.ts', name: 'throws a SendBlockedError carrying the reason codes' },
      { file: 'src/lib/reminders/eligibility.test.ts', name: 'refuses in every non-active mode' },
    ],
  },
  {
    id: 21,
    tests: [
      {
        file: 'src/lib/email/render.test.ts',
        name: 'catches a missing sender_phone with no configured default, before any send',
      },
      { file: 'src/lib/email/render.test.ts', name: 'validateBatch — pre-flight, BUILD_SPEC §19 and AC21' },
      {
        file: 'src/lib/sending/preflight.test.ts',
        name: 'fails both items when sender_phone does not resolve, and names the recipients',
      },
    ],
  },
  {
    id: 22,
    tests: [
      { file: 'src/lib/import/validate.test.ts', name: 'an invalid ISO country code — AC22' },
      { file: 'src/lib/import/validate.test.ts', name: 'a valid code outside the approved list — AC7, AC22, §8.3' },
      {
        file: 'src/lib/import/iso-countries.test.ts',
        name: 'refuses a bloc with an explanation rather than picking a member',
      },
    ],
  },
  {
    id: 23,
    tests: [
      { file: 'src/lib/import/mapping.test.ts', name: 'reads a column by what is in it when the header is unhelpful' },
      { file: 'src/lib/import/mapping.test.ts', name: 'asks about a date column that could go either way' },
      { file: 'src/lib/import/validate.test.ts', name: 'applies the date order answer' },
      { file: 'src/lib/import/ai.test.ts', name: 'always returns one entry per real column, in file order' },
    ],
  },
  {
    id: 24,
    tests: [
      { file: 'src/lib/import/mapping.test.ts', name: 'proposeMappingFromHeaders — the no-key path, AC24' },
      { file: 'src/lib/import/mapping.test.ts', name: 'maps a straightforwardly named file' },
      { file: 'src/lib/import/validate.test.ts', name: 'produces the same figures again from the header-name heuristic' },
    ],
  },
  {
    id: 25,
    tests: [
      { file: 'src/lib/export/secrets.test.ts', name: 'names no credential in any recipient or audit export header' },
      {
        file: 'src/lib/export/secrets.test.ts',
        name: 'never selects, decrypts or returns the stored key from the settings action',
      },
      { file: 'src/lib/export/secrets.test.ts', name: 'has no console call in any export module, export route or settings file' },
      { file: 'src/db/schema.test.ts', name: 'credentials are stored encrypted, by column name (§8.1, §9.1)' },
    ],
  },
  {
    id: 26,
    tests: [
      { file: 'src/lib/money.test.ts', name: 'raises a percentage column that could be 5% or 0.05 — AC26' },
      { file: 'src/lib/import/mapping.test.ts', name: 'refuses to proceed while an ambiguity is unanswered — AC26' },
      { file: 'src/lib/money.test.ts', name: 'shows the consequence of each answer' },
    ],
  },
  {
    id: 27,
    tests: [
      { file: 'src/lib/import/ai.test.ts', name: 'carries no numbers across the boundary — only column names' },
      {
        file: 'src/lib/import/validate.test.ts',
        name: 'produces byte-identical figures whether the mapping came from a model or a dropdown',
      },
      { file: 'src/lib/import/validate.test.ts', name: 'AC27 — no AI output is used in any monetary calculation' },
    ],
  },
  {
    id: 28,
    tests: [
      { file: 'src/lib/reminders/eligibility.test.ts', name: 'refuses every recorded response' },
      { file: 'src/lib/reminders/eligibility.test.ts', name: 'refuses the one that would exceed it' },
      { file: 'src/lib/reminders/no-offer-terms.test.ts', name: 'carries no offer terms' },
      {
        file: 'src/lib/reminders/schedule.test.ts',
        name: 'loads the compliance context for REMINDER and never for INVITATION',
      },
    ],
    scripts: [
      { file: 'scripts/verify-reminders.ts', label: 'a responder is never queued' },
      { file: 'scripts/verify-reminders.ts', label: 'a blocked offer is never queued' },
    ],
  },
  {
    id: 29,
    tests: [
      { file: 'src/lib/audit-coverage.test.ts', name: 'calls the one audit helper from inside its own body' },
      { file: 'src/lib/audit-coverage.test.ts', name: 'names every exported reminder mutation that writes to the database' },
      { file: 'src/lib/audit-coverage.test.ts', name: 'registers cancelMany even though it delegates its writes' },
    ],
    scripts: [
      { file: 'scripts/verify-reminders.ts', label: 'a queued reminder can be cancelled' },
      { file: 'scripts/verify-reminders.ts', label: 'rebuilding the queue does not resurrect it' },
    ],
  },
  {
    id: 30,
    tests: [
      { file: 'src/lib/portal/roadmap.test.ts', name: 'rejects a promise of return, valuation or liquidity' },
      { file: 'src/lib/portal/roadmap.test.ts', name: 'accepts the four labels §13.1 suggests' },
      { file: 'src/lib/portal/roadmap.test.ts', name: 'is rendered beneath the tiles on the investor portal' },
    ],
    outstanding:
      'The copy rules are enforced and the tiles render, but they are configurable only by editing the seed: ' +
      'no owner-facing surface writes roadmap_tiles. `forbiddenWordsInTileLabel` is the gate that surface must ' +
      'call at write time. Until it exists, the second half of this criterion — "configurable by the owner" — ' +
      'is not met.',
  },
  {
    id: 31,
    tests: [
      { file: 'src/lib/brand.contrast.test.ts', name: 'every text token on every surface meets WCAG AA' },
      { file: 'src/lib/brand.contrast.test.ts', name: 'dim on bg — the one the specification names' },
      { file: 'src/lib/accessibility.test.ts', name: 'every grid declares a base column count' },
      { file: 'src/lib/accessibility.test.ts', name: 'the viewport is declared, and zoom is not capped' },
    ],
    scripts: [
      { file: 'scripts/verify-viewport.ts', label: '${label}: no horizontal scroll at ${VIEWPORT.width}px' },
      { file: 'scripts/verify-viewport.ts', label: '${label}: every rendered string meets AA' },
      { file: 'scripts/verify-viewport.ts', label: '${label}: every tap target is at least 44px' },
    ],
  },
  {
    id: 32,
    outstanding:
      'WP15 is deferred and this criterion is its first half. The deployment has no blob store, and both ways ' +
      'of faking one are worse than waiting: base64 in Postgres puts megabytes in the row every portal read ' +
      'touches, and a writable disk does not survive a serverless invocation. Needs a storage decision — ' +
      'Netlify Blobs, S3 or R2 — after which the package is straightforward. Nothing else depends on it.',
  },
  {
    id: 33,
    outstanding:
      'WP15 is deferred and this criterion is its second half. Recorded video needs the same blob store as the ' +
      'media library, and rather more of it. Only the onboarding step id exists today. See criterion 32.',
  },
  {
    id: 34,
    tests: [
      { file: 'src/lib/sending/preflight.test.ts', name: 'has all twelve §19 items' },
      { file: 'src/lib/sending/preflight.test.ts', name: 'is not ready while an attestation is outstanding' },
      { file: 'src/lib/email/transport/guard.test.ts', name: 'refuses a test send addressed to anyone but the operator' },
      { file: 'src/lib/auth/onboarding.test.ts', name: 'are the ones the spec lists, in order, including 4b' },
    ],
    manual:
      'The prompt, the test send and the pre-flight tick are all enforced and tested. Whether the test ' +
      'invitation was actually *reviewed* is a judgement only the operator can make, which is why §19 lists it ' +
      'as an attestation rather than a machine check. "Including his video" waits on WP15 — see criterion 33.',
  },
  {
    id: 35,
    tests: [
      { file: 'src/lib/portal/timeline.test.ts', name: 'holds for every stage, with every fact populated' },
      { file: 'src/lib/portal/access.test.ts', name: 'mentions no other investor, in any state' },
      { file: 'src/lib/email/templates/templates.test.ts', name: 'says nothing about any other investor — §35' },
      { file: 'src/lib/register/copy.test.ts', name: 'never tells the investor how many people are on it' },
    ],
    scripts: [
      { file: 'scripts/verify-qa.ts', label: 'a second investor sees only their own thread' },
      { file: 'scripts/verify-register.ts', label: 'no position appears' },
    ],
  },
  {
    id: 36,
    tests: [
      { file: 'src/lib/qa/defaults.test.ts', name: 'confirms in the words PORTAL_COPY uses, once the question is recorded' },
      { file: 'src/lib/qa/defaults.test.ts', name: 'is the same confirmation whatever the account, and repeats nothing back' },
      { file: 'src/lib/qa/messages.test.ts', name: 'names who asked, because it goes to the operator' },
    ],
    scripts: [
      { file: 'scripts/verify-qa.ts', label: 'a question is recorded' },
      { file: 'scripts/verify-qa.ts', label: 'the queue names who asked' },
    ],
  },
  {
    id: 37,
    tests: [
      { file: 'src/lib/qa/defaults.test.ts', name: 'hands recordAnswer publish false when the field never arrives' },
      { file: 'src/lib/qa/defaults.test.ts', name: 'reads a field that never arrived as unticked' },
      { file: 'src/lib/qa/defaults.test.ts', name: 'has no visibility flag anywhere in the module that defaults to true' },
      { file: 'src/lib/qa/anonymity.test.ts', name: 'returns null for an entry that is not published' },
    ],
    scripts: [{ file: 'scripts/verify-qa.ts', label: 'an unpublished, unsent answer is not shown to them' }],
  },
  {
    id: 38,
    tests: [
      { file: 'src/lib/qa/anonymity.test.ts', name: 'exposes exactly six fields and no more' },
      { file: 'src/lib/qa/anonymity.test.ts', name: 'publishes the rewritten wording, never the original' },
      { file: 'src/lib/qa/anonymity.test.ts', name: 'coarsens a timestamp to a month and a year' },
      { file: 'src/lib/qa/service.test.ts', name: 'has no update that writes question_original after creation' },
    ],
    scripts: [
      { file: 'scripts/verify-qa.ts', label: 'the shared page carries no asker name' },
      { file: 'scripts/verify-qa.ts', label: 'the shared page carries the rewrite, not the original' },
    ],
  },
  {
    id: 39,
    tests: [
      { file: 'src/lib/qa/service.test.ts', name: 'keeps sendOneEmail out of recordAnswer and createSeededEntry' },
      { file: 'src/lib/qa/defaults.test.ts', name: 'says plainly that nothing has gone anywhere when it saved unpublished' },
    ],
    scripts: [
      { file: 'scripts/verify-qa.ts', label: 'saving does not send' },
      { file: 'scripts/verify-qa.ts', label: 'a refused send does not stamp the entry as replied' },
    ],
  },
  {
    id: 40,
    tests: [
      { file: 'src/lib/qa/anonymity.test.ts', name: 'does not require a rewrite for an entry the operator wrote himself' },
      { file: 'src/lib/qa/service.test.ts', name: 'treats a seeded entry with no investor messages as settled' },
    ],
    scripts: [
      { file: 'scripts/verify-qa.ts', label: 'the operator can write an entry directly (§6.7.4)' },
      { file: 'scripts/verify-qa.ts', label: 'a seeded entry has nobody to reply to and says so' },
    ],
  },
  {
    id: 41,
    tests: [
      { file: 'src/lib/audit-coverage.test.ts', name: 'gives each audited mutation an action string of its own' },
      { file: 'src/lib/audit-coverage.test.ts', name: 'every mutation an acceptance criterion says is logged (§22 AC12, AC29, AC41)' },
      { file: 'src/lib/qa/anonymity.test.ts', name: 'returns null for a withdrawn entry even if the flag was left set' },
    ],
    scripts: [
      { file: 'scripts/verify-qa.ts', label: 'an entry can be unpublished' },
      { file: 'scripts/verify-qa.ts', label: 'an unpublished entry leaves the shared page' },
    ],
  },
  {
    id: 42,
    tests: [
      { file: 'src/lib/certificate/certificate.test.ts', name: 'renders the exact recorded figures and operator sign-off' },
      { file: 'src/lib/certificate/certificate.test.ts', name: 'always carries the mandatory legal footer' },
      { file: 'src/lib/certificate/pdf.test.ts', name: 'says it is not a share certificate and not a title document' },
    ],
    scripts: [
      { file: 'scripts/verify-certificate.ts', label: 'a certificate is issued' },
      { file: 'scripts/verify-certificate.ts', label: 'which is a real PDF' },
    ],
  },
  {
    id: 43,
    tests: [
      {
        file: 'src/lib/verify/verify.test.tsx',
        name: 'renders without an authentication dependency and uses configured facts',
      },
      { file: 'src/lib/verify/robots.test.ts', name: 'opts exactly one page into indexing' },
      { file: 'src/lib/verify/robots.test.ts', name: 'exempts the verification page and the two crawler files' },
    ],
  },
  {
    id: 44,
    tests: [
      { file: 'src/lib/email/transport/guard.test.ts', name: '4. blocks when this is not the production deployment' },
      { file: 'src/lib/env.test.ts', name: 'marks the testing deployment as not production' },
      { file: 'src/lib/env.test.ts', name: 'production deployment guard (BUILD_SPEC §18.1, AC44)' },
    ],
  },
  {
    id: 45,
    tests: [
      { file: 'src/lib/compliance/explain.test.ts', name: 'says exactly what unblocking requires — a recorded reference' },
      {
        file: 'src/lib/compliance/gate.test.ts',
        name: 'the block carries the §8.3 explanation, naming what unblocking requires',
      },
      { file: 'src/lib/compliance/gate.test.ts', name: 'does not unblock without a reference — there is no blanket unblock' },
      { file: 'src/actions/compliance.test.ts', name: 'refuses the owner too when no reference is given' },
    ],
  },
  {
    id: 46,
    tests: [
      { file: 'src/lib/register/copy.test.ts', name: 'never tells the investor how many people are on it' },
      { file: 'src/lib/register/copy.test.ts', name: 'never uses queue language in the investor-facing copy' },
    ],
    scripts: [
      { file: 'scripts/verify-register.ts', label: 'an investor can remove themselves' },
      { file: 'scripts/verify-register.ts', label: 'no position appears' },
      { file: 'scripts/verify-register.ts', label: 'the view has exactly three fields' },
    ],
  },
  {
    id: 47,
    tests: [
      { file: 'src/lib/register/order.test.ts', name: 'puts settled funds first, then commitments, then everyone else' },
      { file: 'src/lib/register/order.test.ts', name: 'orders settled investors by value date, earliest first' },
      { file: 'src/lib/register/order.test.ts', name: 'is ignored when no reason was recorded' },
      { file: 'src/lib/register/order.test.ts', name: 'moves somebody up when a reason was recorded' },
    ],
    scripts: [{ file: 'scripts/verify-register.ts', label: 'an override with a thin reason is refused' }],
  },
  {
    id: 48,
    tests: [
      { file: 'src/lib/compliance/offers.test.ts', name: 'blocks an uncleared jurisdiction and leaves the cleared ones alone' },
      { file: 'src/lib/compliance/offers.test.ts', name: 'marks a newly blocked draft as BLOCKED' },
    ],
    scripts: [
      { file: 'scripts/verify-register.ts', label: 'an offer can be issued to a cleared jurisdiction' },
      { file: 'scripts/verify-register.ts', label: 'and is blocked individually by the gate' },
      { file: 'scripts/verify-register.ts', label: 'its email status is DRAFT — nothing was sent' },
    ],
  },
]

/** BUILD_SPEC §22 numbers 48 of them, and so does this file. */
export const EXPECTED_CRITERIA_COUNT = 48
