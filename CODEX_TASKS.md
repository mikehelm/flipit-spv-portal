# Implementation Plan — Flipit SPV Investor Portal

**For the implementing agent. Read `BUILD_SPEC.md` first — it is the source of truth. This file is the order of work and the definition of done.**

Version 1.0 · 2026-07-25

---

## How to work

- **Build in the order below.** Each work package depends on the ones before it.
- **Stop and report after each package.** Do not run several packages together. A short summary of what you built, what you changed from the plan, and anything ambiguous you had to decide.
- **Every package ends green.** `pnpm typecheck`, `pnpm lint` and `pnpm test` must pass before you move on. A package with failing checks is not finished.
- **If the spec and this file disagree, the spec wins.** If the spec is silent or ambiguous, choose the more conservative option and say so in your report. Never invent a rule about money, sending, or access.
- **Never send email to any address other than the operator's own during development.** There is no exception to this.

---

## Conventions — apply throughout

**Stack (fixed, do not substitute):** Next.js 15 App Router · TypeScript strict · PostgreSQL · Prisma · Auth.js · Tailwind · Zod · pnpm · Vitest.

**Money and percentages.** Prisma `Decimal` in the database, `decimal.js` in application code. Never `number`, never floating point, at any point in the path from spreadsheet to display. Rounding happens only at render time, using the configured decimal places.

**Server-side authorization on every route.** Every API route and server action independently checks the session and role. Never rely on the UI having hidden a button. Investor routes additionally check that the requested record belongs to the requesting account.

**Validation.** Zod schema at every boundary — request bodies, form actions, uploaded rows, environment variables. Parse, do not cast.

**Audit logging.** A single `audit()` helper called from the same layer as the mutation, never from the UI. Every entry: actor, timestamp, entity type, entity id, action, non-secret metadata. Append-only; no updates or deletes.

**Errors.** Never swallow. User-facing messages say what happened and what to do; specifics go to the log. Blocked actions always state the reason (see §8 of the spec) — a generic "something went wrong" on a blocked send is a bug.

**Secrets.** Environment variables only, validated at boot with Zod, and the app refuses to start if a required one is missing. The SMTP app password and the OpenAI key are encrypted at rest. Never log a credential, an email body, or the key.

**Time.** Store UTC. Display in the viewer's timezone. Deadlines are dates, not timestamps — a deadline of the 10th means end of the 10th in the investor's timezone, and edge cases resolve in the investor's favour.

**`basePath`.** Read from an environment variable from the first commit. Every internal link, asset, cookie path and OAuth callback must respect it. It will run under `/SPV` before it runs at a domain root.

**Naming.** Files kebab-case, React components PascalCase, database tables snake_case via `@@map`, routes plural (`/recipients`, `/investors`).

**Testing.** Vitest. Unit tests for anything that calculates, hashes, tokenises, or gates. Integration tests for the gates specifically — those are the tests that matter most and they must fail loudly if someone weakens the rule later.

---

## WP0 — Scaffold

**Build:** Next.js 15 + TypeScript strict + Tailwind + App Router + `src/`. Prisma with PostgreSQL. Vitest. ESLint. `.env.example` listing every variable with a comment. `README.md` with local setup in copy-pasteable steps. Zod-validated env module. `basePath` wired from env. Base layout using the §13.2 palette, with the "Made by Make with Mike" footer.

**Done when:** `pnpm dev` serves a styled page under both `/` and a configured `basePath`, and `pnpm typecheck && pnpm lint && pnpm test` pass on an empty suite.

## WP1 — Data model

**Build:** the full Prisma schema for every entity in spec §17, with relations, indexes, and enums for every state machine (account status, offer status, email status, service mode). Initial migration. A seed script creating the owner allowlist and a `ServiceConfig` row with defaults.

**Watch:** `InvestorAccount` is durable and holds many `Offer` rows across many `Round` rows (§4.3) — get this right now, it is expensive later. Proposed, committed, accepted and received amounts are four separate columns (§5).

**Done when:** the migration applies to an empty database, the seed runs twice without error, and a written note confirms every §17 entity exists.

## WP2 — Authentication, roles, onboarding

**Build:** Auth.js with Google OAuth. Email allowlist mapping addresses to roles — `mike@flipthepage.com` and `mike@flipit.com` as owner, `serenedavid@gmail.com` as operator. A sign-in from any other address creates nothing and is rejected. Single-use, expiring operator invite. The operator onboarding flow in spec §2.1, all five steps, resumable if abandoned. A settings page for the owner holding the OpenAI key (write-only, encrypted, never redisplayed) and service configuration.

**Done when:** an unknown Google account cannot sign in or create a record; the operator completes onboarding and their contact-method choice is stored; the OpenAI key round-trips encrypted and is never returned to the client.

## WP3 — Import and calculations

**Build:** CSV/XLSX upload. The AI-assisted mapping in spec §9.1 — headers plus a bounded row sample to OpenAI, a proposed mapping returned, and a confirmation screen where the operator accepts or corrects every column before anything imports. Explicit questions for ambiguous percentage, date and currency columns. Manual mapping when no key is configured. Then the §9 validation, with file-level errors and per-recipient blocks kept strictly separate. The §10 calculation.

**Watch:** the model reads; it never computes. The indirect-ownership figure must be byte-identical with and without AI assistance, and there must be a test proving it.

**Done when:** a deliberately awkward spreadsheet — renamed columns, wrong order, extra columns, mixed date formats, `5%` and `0.05` in the same column — imports correctly after operator confirmation; the same file imports with no API key via manual mapping.

## WP4 — Email templates and preview

**Build:** the designed HTML email in spec §11.5 with a mandatory plain-text alternative, table layout, inline styles, 600px, legible with images blocked. Variable resolution with the §11.2 fallback chain. Fail-loud rendering after fallbacks. Immutable `EmailSnapshot` on send. Preview in the dashboard that renders the real thing for a real recipient. Separate reminder template.

**Done when:** previewing any recipient shows their real figures; a missing `sender_phone` with no configured default is caught at pre-flight rather than mid-send; the text part carries the same information as the HTML part.

## WP5 — Email sending

**Build:** Gmail SMTP with an app password (spec §8.1) — `smtp.gmail.com`, port 587, STARTTLS. An `EmailTransport` interface with `SmtpTransport` as the working implementation and `GmailApiTransport` stubbed so the transport is genuinely swappable by configuration. App password encrypted at rest, write-only in the UI, never logged. Connection health on the dashboard with a "test connection" action that authenticates without sending. Individual send. `Message-ID` set and recorded, `In-Reply-To` honoured so replies thread. Retry with backoff on transient failures, permanent failures surfaced differently.

**Watch:** no bulk send anywhere, in the UI or the API. Sending is one recipient at a time by design (§14).

**Done when:** a test send reaches the operator's own address and appears in his Gmail Sent folder; a missing or rejected app password blocks sending with a specific message naming the problem; the app password is never returned to the client or written to a log.

## WP6 — The compliance gate

**Build:** `ComplianceApproval` — owner-only to create, amend or void. Template hashing over the source including conditional blocks, both HTML and text parts. Hash comparison at send time with a visible diff on mismatch. Per-recipient jurisdiction gating against the approved list. Individual approval override against a recorded reference. The operator-facing explanation for the blocked US recipient in spec §8.3.

**Watch:** this is the most important package in the build. A recipient outside the approved list blocks alone; the rest of the batch is unaffected. The operator cannot record, amend or void an approval — enforce it server-side and test it.

**Done when:** all of: no approval means no send; changing one character of the template disables sending until re-approval; a US recipient is blocked individually with an explanation while others send; an operator attempting to record an approval is refused and the attempt is logged.

## WP7 — Sending flow

**Build:** the review table (spec §12) with all columns, filters and summary cards. Compliance state and mail connection health permanently visible. The §19 pre-flight checklist, machine-enforcing the gate items and validating template rendering for every recipient in the batch before the first send. Per-recipient send with confirmation, and a progress view of who has and has not been sent.

**Watch:** the app refuses to send real invitations when its configured base URL is not the production value (spec §18.1). Portal links embed the domain and would break on migration.

**Done when:** pre-flight catches every failure class before anything sends, and the four money totals reconcile against the seeded data.

## WP8 — Investor portal core

**Build:** claim flow — single-use hashed token, email verified, account moves `invited` → `active`. Passwordless return sign-in, plus Google sign-in when the address matches exactly. The account lifecycle in §4.2 including the sign-in-after-suspension rules in the same section. The immutable email snapshot, offer detail, the eight-step timeline (§5), response actions changeable until the deadline, the conversation thread, documents, and the "Coming to your portal" tiles (§13.1). Operator-side status advancement, with two-step confirmation and amount re-entry for funds received.

**Watch:** enumeration resistance on both sign-in and claim. No investor-facing screen may reveal the existence, identity, count or aggregate contribution of any other investor.

**Done when:** an investor claims, signs out, returns days later via a fresh link, and sees their record; suspension immediately ends sessions and refuses new links; a closed account with `closed_account_access: read_only` can still sign back in.

## WP9 — Questions and answers

**Build:** spec §6.7 in full. Investor submits, sees confirmation, operator is emailed. Operator answers with the publish checkbox defaulting to unticked. Published entries fully anonymised, with an editable public version of the question and the original preserved. The reply email requires an explicit send. Operator-authored entries with no question behind them. Pin, reorder, unpublish. The one-line compliance notice in the publish dialog.

**Done when:** a published entry contains nothing identifying, an unpublished answer is visible only to its asker, and the reply email does not exist until the operator presses send.

## WP10 — Register of interest

**Build:** spec §5.2. Join and leave from the portal. The exact non-promissory copy from §5.2.1, verbatim. The computed order in §5.2.2, visible only to the operator, with overrides requiring a recorded reason. Optional indicative amount. Issuing an offer from the register creates a normal `Offer` against the existing account and passes through every gate.

**Done when:** no investor can see any position; an offer issued from the register is blocked by the jurisdiction gate exactly as an original offer would be.

## WP11 — Updates feed

**Build:** spec §6. Draft, preview, publish. Audience of all, filtered, or one. Immutable once published; corrections are new entries; withdrawal leaves a tombstone. Notification email carrying no financial detail.

**Done when:** a targeted update reaches only its intended recipients and the notification email contains no amounts or percentages.

## WP12 — Reminders

**Build:** spec §6.5. Scheduled job. Default 7 and 2 days before each deadline, non-responders only, active accounts only, per-recipient cap default 2, its own approved template, no offer terms in the body. A visible queue the operator can cancel or reschedule from. Nothing sends outside `active` service mode.

**Watch:** this is the only unattended sender in the system. Every constraint above is load-bearing.

**Done when:** a responder is never chased, the cap holds, a queued reminder can be cancelled, and reminders stop in every non-active service mode.

## WP13 — Participation certificate

**Build:** spec §5.1. PDF generated on funds received, FLIPIT branded, correct figures, downloadable from the portal. Regeneration on correction with the superseded version retained. The not-a-share-certificate footer.

**Done when:** the PDF renders with correct figures and a corrected amount produces a new version without destroying the old.

## WP14 — Anti-phishing page and indexing

**Build:** spec §15.1. Public, no sign-in, memorable path, safe to reach by typing. Names the exact sending address and link domain. Carries the payment-details warning. Linked from the invitation footer and the portal. `noindex` on every other route, `robots.txt`, no sitemap entries for portal paths.

**Done when:** the verification page is the only indexable route in the application.

## WP15 — Media and video

**Build:** spec §13.2 media library — upload, name, describe, reuse across portal and email; EXIF stripped; served from the app's own domain; size and type limits. Spec §13.3 video — in-browser recording and file upload, private preview in the real layout, replace, explicit publish, caption field, served only to authenticated investors, never indexed.

**Done when:** an unpublished video is unreachable by any investor, and an uploaded image is served from the app's own domain with metadata stripped.

## WP16 — Service modes and closing the round

**Build:** spec §7 modes — `active`, `read_only`, `sunset`, `disabled` — with the stated investor and admin behaviour, and sending disabled outside `active`. The export precondition on `disabled` with a logged owner override. Spec §6.6 round closing — the deadline-date email to the operator, global and per-recipient extensions, the explicit close button, and the rule that inaction closes nothing.

**Done when:** each mode produces its specified behaviour, the owner retains access and export throughout, and no deadline ever closes anything on its own.

## WP17 — Export and audit

**Build:** CSV and XLSX export per spec §20 with all four amounts and full status history. Owner-only audit log export and viewer with filtering by actor, entity and action.

**Done when:** an export opens cleanly in Excel with correct decimals, and the audit log shows blocked sends with their reasons.

## WP18 — Branding, mobile, accessibility

**Build:** the §13.2 palette applied consistently. Mobile-first — every screen correct at 375px before desktop is considered. WCAG AA contrast, checking `--dim` on `--bg` specifically. Keyboard navigation and focus states throughout. The page curl used as a restrained brand mark, not an animation.

**Done when:** every investor-facing screen is verified at 375px and contrast passes.

## WP19 — Tests

**Build:** the full suite. At minimum: decimal precision and the override; token entropy, hashing, single use and expiry; app-password encryption round-tripping and never being serialised to the client; the compliance gate including hash drift, per-recipient jurisdiction blocking and the owner-only restriction; suspension revoking sessions and refusing new links; closed-account read-only sign-in; the sender fallback chain and pre-flight detection of unresolved variables; sending blocked outside `active`; AI mapping never altering a calculated figure; reminder filtering and cap; and every one of the 48 acceptance criteria in spec §22 mapped to a test or an explicit note explaining why it is manual.

**Done when:** the suite passes and a table maps each of the 48 criteria to its test.

## WP20 — Deployment

**Build:** deployment under `mikehelm.com/SPV` with `basePath` set, then the documented migration to `spv.flipit.com`. Google OAuth callbacks for both. Hosted privacy policy. Migration runbook covering DNS, callbacks, the privacy-policy URL, and the base-URL guard. Backup and restore, with restore actually tested.

**Watch:** no real invitation may be sent from the testing deployment. Portal links embed the domain and every one issued from `mikehelm.com/SPV` dies on migration.

**Done when:** the app runs under a path prefix with every link correct, and the runbook has been followed once end to end.

---

## Review checklist — what will be checked on handback

1. Is any monetary value ever a JavaScript `number`?
2. Can any send path bypass the compliance approval or the token check?
3. Does a jurisdiction block stop one recipient or the whole batch?
4. Can an operator record, amend or void a compliance approval?
5. Does any investor-facing response, page or error reveal that another investor exists?
6. Are claim and sign-in tokens single-use, hashed at rest, and expiring?
7. Does suspension revoke existing sessions *and* refuse new links?
8. Does any log line contain a token, an email body, or the OpenAI key?
9. Is any route other than the anti-phishing page indexable?
10. Does a published Q&A entry contain anything identifying?
11. Can the AI path change a calculated figure?
12. Does the app refuse to send when its base URL is not the production value?
