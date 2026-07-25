# Build log — Flipit SPV Investor Portal

One section per work package. Newest at the bottom.
The **Uncertain** and **Deviations** sections are the ones worth reading.

---

## WP0 — Scaffold — done

**Built:** the shell of the application. Next.js with TypeScript in strict mode, Tailwind, the FLIPIT palette wired in as theme colours, and the "Made by Make with Mike" footer on every page. Prisma, Vitest, Zod and decimal.js installed. A landing page that reports which deployment it is and whether sending is permitted from it. `.env.example` documenting every variable and why it exists.

The environment module validates everything at boot and refuses to start the app if anything is missing or malformed — a wrong encryption key or base URL should stop the process, not be discovered later.

`basePath` is wired from the environment, verified working: with `BASE_PATH=/SPV`, the root returns 404, `/SPV` returns 200, and static assets are correctly prefixed.

**Decisions:**

- *Deployment guard implemented at WP0 rather than WP7.* AC44 says the app must refuse to send when its base URL is not the production value. I put the comparison in the environment module now so every later package can read `isProductionDeployment` rather than each re-deriving it. The comparison ignores trailing slashes and case.
- *Google sign-in variables are optional in the schema.* The app must start without them so the database and import work can be built and tested before OAuth credentials exist. WP2 will fail loudly at sign-in if they are absent rather than blocking boot.
- *Tailwind v4 `@theme` block* rather than a JS config — that is what this Tailwind version wants. Palette values are also exported from `src/lib/brand.ts` for anything generating colour outside CSS, such as the PDF certificate and the HTML email.

**Deviations:**

- *Next.js 16, not 15.* `create-next-app@latest` now ships 16. It is the same App Router architecture and nothing in the spec depends on 15. Flagging it because the task file names 15 explicitly.
- *Local Postgres runs on port 5433*, not the default 5432, to avoid colliding with anything already listening. Only affects `DATABASE_URL`.

**Checklist:** points 8, 9 and 12 apply at this stage. No logging of any credential exists yet — there is no logging at all. Every route is `noindex` by default via root metadata, with the verification page in WP14 to opt back in as the single exception. The production guard is implemented and has four tests covering it.

**Uncertain:**

- The palette came from the demo HTML file, not from flipit.com — the live site returns nothing useful to an automated fetch. It needs a two-minute eyeball check against the real site before launch.
- `ENCRYPTION_KEY` and `AUTH_SECRET` in the local `.env` are throwaway development values. They must be regenerated for any real deployment. Noted again in TEST_ME.md.

---

## WP1 — Data model — done

**Built:** the complete data model. 41 tables covering every entity in BUILD_SPEC §17, with relations, indexes, and an enum for every state machine — account status, offer stage, email status, service mode, block reason, token purpose, send outcome, contact method. One migration, applied cleanly to an empty database. An idempotent seed that creates the three privileged users from the allowlist, the service configuration singleton, the first round, the reminder schedule (7 and 2 days before, cap 2) and the four roadmap tiles. Run twice, it changes nothing the second time.

45 new tests. They assert every §17 entity exists, and they enforce the structural rules rather than trusting them:

- No column whose name implies it holds money or a percentage may be a floating-point type.
- Offers carry all four amounts — proposed, committed, accepted, received — as separate columns.
- `investor_accounts` has no round or offer reference, which is what makes an account durable across rounds.
- `portal_tokens` has `token_hash` and no `token`.
- `qa_entries` keeps `question_original` separate from `question_public`.
- `interest_register_entries` stores no rank or position — order is computed.
- `service_config` has `smtp_password_encrypted` and `open_ai_key_encrypted` and no plaintext equivalents.

These will fail loudly if someone later weakens them, which is the point.

**Decisions:**

- *Identifiers are random, not sequential.* Sequential ids leak how many investors exist and in what order they were added. They never appear in a URL either (§15), but the cost of getting this right is zero.
- *`indirect_percentage` is stored, not derived at read time.* If it were recomputed on display, a later change to the round's 30% figure would silently alter what an investor was told they were offered. The figure sent and the figure shown must be the same number.
- *`approved_jurisdictions` on the service config defaults to an empty array.* Nothing can be sent to anyone until a compliance approval names the cleared countries. The safe default is "nobody".
- *`original_deadline` on offers* is not in the spec, but §6.6 allows extending a deadline for named stragglers, and the audit trail needs to show what it was before.

**Deviations:**

- **Prisma replaced with Drizzle ORM.** This one matters, so the reasoning in full: Prisma downloads a native engine binary at install and migrate time from `binaries.prisma.sh`, which is unreachable from this build environment. Not slow — blocked. Every Prisma command fails, so the schema could not be validated, migrated, seeded or type-checked at all.

  Drizzle was chosen over working around it because it needs no binaries, it emits plain reviewable SQL migrations rather than an opaque diff, and it is already the ORM in the main FLIPIT repository, so the two codebases stay consistent. Type safety and the migration workflow are equivalent. Nothing in the spec depends on Prisma specifically.

  Worth a second opinion if you disagree — it is the kind of decision that is cheap now and expensive in three weeks.

- *Local Postgres runs on port 5433* to avoid a collision. Affects `DATABASE_URL` only.

**Checklist:** points 1, 5, 6, 10 and 11 are addressed structurally and have tests. Point 1 — no floating point column exists and a test enforces it. Point 6 — only hashes are stored. Point 8 remains true: still no logging of any kind. Points 2, 3, 4, 7, 9 and 12 belong to later packages.

**Uncertain:**

- The Drizzle substitution is the one thing here I would want a human to agree with.
- `numeric` comes back from the driver as a string, which is correct and deliberate — it goes straight into decimal.js. But it means every read site must resist the temptation to call `Number()` on it. The WP3 calculation tests will pin this down properly.

---

## WP2 — Authentication, roles, onboarding — done

**Built:** email-and-password sign-in for the two administrators, and the operator onboarding flow behind it. Argon2id at OWASP's current parameters (later replaced by scrypt — see the note at the end of this file), a twelve-character minimum checked against a common-password list, no composition rules. Progressive delay by address and by IP — 0, 0, 250ms, 500ms, 1s, 2s, 4s, 8s — then a fifteen-minute lock after ten failures. Server-side sessions as rows, twelve-hour expiry, revocable individually or all at once. Single-use expiring operator invites. The five-step operator onboarding from §2.1, resumable because progress is derived from stored facts rather than from wizard state. An owner settings page holding the OpenAI key, write-only and encrypted, never redisplayed.

First run works as §2.2 describes: the seed creates the allowlisted accounts with no password and prints a one-time expiring setup link for each. Redeeming a link establishes a session that can reach exactly one page — "choose a password" — and choosing one ends every session including that one. A password never appears in an environment variable, a configuration file, an audit entry or a log line.

Verified end to end against the running application, not only in unit tests: the link redeems once and refuses the second time; a session holding no password is redirected away from `/admin`, `/admin/settings` and `/admin/onboarding`; the correct password signs in; setting a password deletes every existing session row; the stored value is a real password verifier and not the password; and a wrong password, an unknown address and an allowlisted account that has never chosen a password all fail identically.

**Decisions:**

- *Sign-in looks every attempted address up, including one that is not on the allowlist.* Skipping the lookup for an address that cannot sign in anyway saves a query and changes no outcome, which is what made the earlier version look reasonable. It also made the storage layer observable: when the store failed, an allowlisted address answered "unavailable" and every other address answered "not accepted". Two different answers keyed exactly on allowlist membership, readable from the sign-in form by anyone who tried it. The lookup now runs for everybody and the allowlist is applied to the result. There is a test that fails if this is undone.
- *The operator invitation now links to the redemption route rather than to the accept page.* The accept page requires an admin session, and the invited operator has no way to have one — the only routes to a session are a password they have not chosen and a setup link nobody has minted for them. As issued, the invitation could not be accepted by its recipient at all. The token alone is now sufficient, which is what a single-use hashed invite is for, and the password gate catches them immediately afterwards.
- *Setting a first password ends every session, not just changing one.* §2.2 only requires it for a change. A setup link is a bearer token that has travelled through a console and possibly a chat window, so the session it created is precisely the one that should not outlive the moment a real credential exists.
- *Sign-in throttling moved from process memory into a `sign_in_attempts` table.* An in-memory lock lifts itself whenever anything restarts, and restarting is not a difficulty an attacker has to overcome — a deploy or a crash loop does it for them. A fifteen-minute lock that a redeploy clears is not a fifteen-minute lock.
- *An account with a session but no password can reach the password page and nothing else.* Server actions cannot redirect the way pages can, so the import authorization resolver returns "not signed in" for that state rather than redirecting. Failing closed in an action and redirecting in a page is the same rule expressed twice.

**Deviations:**

- **A second migration was needed.** WP1 froze the data model before §2.2 was added, so `users` had no password column and the database-backed credential store refused every lookup — password sign-in could not work at all, and the refusal was the enumeration leak described above. Migration `0001` adds `password_hash`, `password_set_at`, `password_changed_at`, the TOTP columns and `sign_in_attempts`. The columns the previous package listed as needed are exactly the columns added.
- *TOTP two-factor is not built.* **Correction, added later:** I quoted half a sentence. §2.2 says two-factor is "optional in v1 and strongly recommended, **mandatory before the production deployment sends anything real**." CODEX_TASKS carries the "optional in v1" half and drops the rest, and that is where I took it from without checking the spec itself. So this is not a nice-to-have deferred to a later package — it is a release gate sitting directly in front of the first real invitation.

  The columns exist so it can be added without another migration, and `otplib` and `qrcode` are already installed for it. There is no code behind any of it. This is now the highest-priority outstanding item, ahead of the remaining feature packages.
- *Onboarding step 5 — "send yourself a test invitation" — is an acknowledgement, not a verified send.* Nothing yet checks that a test email actually went out. WP5 owns sending; the check belongs there and the screen's wording should be tightened when it lands.

**Checklist:** points 6, 7 and 8 are the ones this package owns. Point 6 — every token in the package is random, stored only as a hash, single-use by conditional update rather than by read-then-write, and expiring. Point 7 — a password change deletes every session row in the same transaction that writes the verifier, so the two cannot come apart. Point 8 — `audit()` throws if metadata carries a key matching password, secret, token, credential or body, and there is a test for it; no password or token is passed to any logging call anywhere in the package. Point 1 — no monetary value appears in this package at all; the AI monthly cap is held as a string and compared through decimal.js.

**Uncertain:**

- The rate-limit table has no cleanup. Rows for addresses nobody ever tries again will sit there indefinitely. Harmless at this size, but it wants a periodic delete before this runs for years.
- The twelve-hour session is my choice, not the spec's. It seemed right for a session that reaches every investor's financial record, but it is the kind of number that is annoying if it is wrong and easy to change.

---

## WP3 — Import and calculations — done (built by the previous session; reviewed and accepted here)

**Built:** CSV and XLSX upload with delimiter sniffing and 5MB/5000-row limits. The §9.1 AI-assisted mapping — headers plus at most five sample rows to OpenAI, a proposed mapping returned, and a confirmation screen where every column is accepted or corrected before anything is imported. Explicit questions for ambiguous percentage, date and currency columns. Manual mapping from header heuristics whenever no key is configured or the model call fails. The §9 validation and the §10 calculation.

**Reviewed against the two rules that matter most here, and both hold:**

- *The model reads; it never computes.* The OpenAI response is normalised down to two fields — a source column that must exist in the uploaded file, and a target field that must be one of eleven known values. Everything else the model returns is discarded, and there is a test that feeds it converted values, a total and a computed percentage and asserts none of them survive. The single calculation function accepts only decimal strings and throws on anything else.
- *No money or percentage is ever a JavaScript number.* The parser rejects a numeric input outright rather than coercing it, and there is a static test asserting that `Number(`, `parseFloat(`, `parseInt(` and `.toNumber(` appear nowhere in the validation, mapping or persistence modules. The one place a JavaScript number is unavoidable — reading a numeric cell out of a binary XLSX, where the format itself stores a double — is converted to a string at the first opportunity and never used arithmetically.

There is a test that maps the same awkward sheet twice, once from a simulated model response and once from hand-picked dropdown assignments, and asserts the resulting rows are byte-identical.

**Deviations:** none from the task file.

**Uncertain:**

- *The AI monthly spend cap is stored and displayed but not enforced.* §9.1 asks for a ceiling and for usage to be shown on the settings page. The per-call token limit is enforced; the monthly figure is a number in the configuration that nothing reads and no usage is accumulated against it. This is a real gap and it is not mine to quietly close — it needs a decision about what to do when the cap is reached (refuse, or fall back to manual mapping, which is what I would choose). Recorded here rather than fixed.
- The awkward-file properties are each tested individually — renamed columns, reordered columns, mixed date formats, `5%` and `0.05` in one column — but not as a single composite fixture. Low risk, worth adding.

---

## WP4, WP5, WP6 — built in a parallel session, merged here

While this session was finishing WP2, a second agent pushed WP4 (email templates and preview), WP5 (email sending), WP6 (the compliance gate) and, out of order, parts of WP13, WP14 and WP17. That work is merged and green: 44 test files, 668 tests, typecheck and lint clean.

I have read the compliance gate closely because everything in WP7 depends on it, and it holds up: the batch helper exists specifically so no caller can write `if (anyBlocked) return`, `drift` is a required argument so an absent drift check cannot be mistaken for a passing one, and the refusal carries the §8.3 wording rather than a generic message. I did not re-derive WP4's and WP5's internals; their own tests are thorough and WP7 exercises both end to end.

Two things I noticed and did not change, because they belong to those packages:

- The reminder template's header comment claims a test asserts the rendered text contains no percentage and no currency figure. No such test exists. The template does look clean, but the claim should either become true or come out.
- The AI monthly spend cap is still stored and displayed without being enforced or accumulated against. Carried forward from WP3.

---

## WP7 — Sending flow — done

**Built:** the review table (§12), the pre-flight checklist (§19) and per-recipient sending (§14).

The review screen shows every recipient in the round with all the §12 columns, filters by email status, jurisdiction, name and address, and the summary cards. Compliance approval state and mail connection health sit at the top of the page and stay there, because they are the two things that silently break a send. The four money totals are the four amounts of §5 and there is no fifth; they are summed with decimal.js and arrive at the page as strings.

"Portal opened" counts accounts that have claimed and opened their portal. There is no tracking pixel and no link wrapping anywhere in this application, and a test asserts the summary has no other notion of "opened".

The pre-flight splits the twelve §19 items into eight the application works out and four only a person can answer. The eight offer nothing to click. The four get a confirm button, and confirming writes an audit entry with the operator's name and the time. Two of the four have a machine-checked floor underneath them: "all percentages and amounts validated" fails outright if a figure is actually missing, whatever was ticked, because an attestation can confirm a judgement but must not assert a fact that is false.

Sending is one form per row. The confirmation is the recipient's own address, typed out — a checkbox confirms that you clicked, and typing the address confirms which person you meant.

**Verified against real data in the database, not only in unit tests.** With three recipients — two in Australia, one in the United States — and an approval covering Australia only:

- with no approval recorded, nothing is sendable, pre-flight blocks, and calling the send function directly, bypassing the UI entirely, is still refused;
- with the approval in place, the two Australian recipients are sendable and the American one is blocked alone;
- the refusal names the country and is not generic;
- that one jurisdiction refusal does not block pre-flight for anybody else;
- sending to the blocked recipient writes a BLOCKED send event with its reason, sets that offer's email status to BLOCKED, writes no snapshot, and leaves the other two recipients untouched;
- with no sending account connected, a send fails loudly with a specific reason rather than quietly doing nothing.

**Decisions:**

- *The email snapshot is written before the transport is touched, not after a successful send.* §11.4 calls the snapshot immutable. A snapshot written on success would not exist for a failure, and a failure is exactly the case where knowing what was attempted matters most. A blocked recipient gets no snapshot, because nothing was composed for them.
- *The claim token is minted at send time and at no other point.* The preview uses a deliberately fake token of the same shape, so it exercises the template identically without issuing a credential. Pre-flight validation uses the same placeholder: rendering every recipient to check the template must not mint a working link for every recipient.
- *A permanent send failure revokes the token it just minted; a transient one does not.* The same invitation will be retried after a transient failure and should carry a link the investor can still use. Nothing is going to an address that permanently rejected us.
- *Pre-flight attestations live in the audit log, not in a column.* They record that a person confirmed something at a moment, which is what an audit entry is, and it means the checklist and the audit trail cannot disagree. A reset entry invalidates everything before it, so re-importing the file forces the checklist to be walked again.
- *There is no action anywhere in this package that takes a list of recipients.* §14 says sending is one at a time by design. The way to keep that true is for a bulk send to be something somebody would have to sit down and write, rather than something they reach by passing an array to a function that already exists.
- *A blocked recipient is shown in the table, not hidden from it.* A block stops a send; it does not erase the person from the review. There is a test for it.
- *The confirmation is the address rather than a checkbox.* The spec asks for "per-recipient send with confirmation" without saying what form it takes, so this is the conservative reading.

**Deviations:** none from the task file. The one thing WP7 does not do is advance the offer stage on send — `offers.stage` already defaults to `INVITATION_SENT`, and the two-step status advancement is WP8's, so writing it here would have meant two owners for one column.

**Checklist:** points 1, 2, 3 and 8 are the ones this package touches.

1. No monetary value is a JavaScript number. The totals go through decimal.js and there is a source-level test asserting `Number(`, `parseFloat(`, `parseInt(` and `.toNumber(` appear nowhere in the review module. That test strips comments before scanning, so the module's own explanation of why it avoids `Number()` does not trip the check that it avoids `Number()` — otherwise the easy way to make it pass is to delete the explanation.
2. No send path bypasses the compliance approval or the token check. Verified by calling the send function directly with no approval recorded and watching it refuse.
3. A jurisdiction block stops one recipient. Verified with three real recipients, and pinned by tests.
8. No log line carries a token, an email body or a key. The send events record a Message-ID, an outcome and a snapshot id; the audit entries record the same. Neither carries the subject or either body.

**Uncertain:**

- A real send has not happened, because no Gmail app password is configured in this environment. Every gate in front of the transport is verified; the transport itself has its own tests with a substituted client, but the first genuine send to the operator's own address is still a manual step.
- The review table renders as cards rather than as a wide table. That is a deliberate mobile-first reading of §12 — every column is present on every card — but on a desktop with forty recipients a real table would scan better. Worth a second opinion.
- Fourteen days for the claim token expiry is my choice; the spec says "expiring" without naming a duration.
---

## Review pass — 11 agents, 5 adversarial lenses

Five reviewers each attacked the build through one lens, reading the code rather than the comments. Two lenses came back clean, one clean with a caveat, two found real defects.

**Money — clean.** Every `numeric` column is declared without `mode: 'number'`, so Drizzle returns strings, and every consumer types them as strings. The reviewer grepped for `Number(`, `parseFloat`, `parseInt`, `.toNumber(`, `Math.` and `Intl.NumberFormat` across the tree; the only hits are rate-limit backoff, diff tables, certificate version numbers and SMTP response codes. `formatMoney` groups thousands with a string regex rather than `Intl` for exactly this reason. The single `z.coerce.number()` is a display-precision count, not a value.

**Authorization — clean.** All six exported compliance actions call `authorize()` before parsing or touching the database. No write to `compliance_approvals` exists outside that file. Role is never read from the session or from `users.role` — it is re-derived from the environment allowlist on every request, so removing an address revokes access immediately. No mutation path writes `users.email`, so an operator cannot move themselves onto the owner list.

**Leakage — clean.** `Secret` uses a private field plus `toJSON`/`toString`/`inspect.custom`, so `JSON.stringify`, template literals and `console.log` all yield `[redacted]`. `classifySendError` scrubs the credential out of retained server text. `env.ts` reports Zod paths on a boot failure, never the offending value. The OpenAI error is deliberately swallowed because the SDK echoes the request, and the request contains recipient rows.

**Gates — four defects in the machinery, though nothing reachable.** No path sends a real email yet: `sendOneEmail` is the only function that puts a message on the wire and it has no callers.

- **Fixed: `hashTemplateSource` had no domain separation.** It joined subject, HTML and text with a single space, which occurs freely in all three, so the hash did not uniquely identify the triple. The reviewer produced a working collision: move the opening words of the text part onto the end of the HTML part and the hash is unchanged. That hash is the *sole* mechanism behind AC6 — "editing one character disables sending" — so a template could have drifted with the approval still reading as valid, and the diff screen would have shown nothing changed. Now delimited with `\0`, which cannot appear in either field. Cheap now, expensive once real hashes are recorded.
- Also fixed: the delimiter had been written as a *literal* NUL byte in the source, which made `crypto.ts` binary to every tool and one careless editor save from silently reverting. Same value, now written as the escape `\0`.

**Blast radius — one confirmed defect, fixed.** There were **two independent jurisdiction lists**: `service_config.approved_jurisdictions`, written by the owner's settings page and read by the import, and `compliance_approvals.approved_jurisdictions`, written when an approval is recorded and read by the send gate. Nothing kept them in step.

The seed leaves the config list empty deliberately — until somebody qualified names the cleared countries, nobody is clearable. So in the ordinary setup order (record the approval, then import the spreadsheet) **every row imported blocked.** Not one recipient outside the list: the entire batch. That is precisely the failure §9 and AC7 forbid, and it would have looked like a broken import rather than a policy decision.

Import now reads the list the gate itself trusts. No approval still means every row blocks — correct, because with no approval nothing may be sent to anyone.

The reviewer also confirmed the negative: no function anywhere loops over recipients and sends. `gateBatch` is a plain map with no cross-recipient state, and one refusal cannot reach another decision.

**Still open from the gates lens:** three lower-severity findings in the gate machinery, none currently reachable. To be worked through before any send path is wired.

**State:** 668 tests, typecheck and lint clean.

---

## Deployment reconnaissance — and one dependency removed

Codex reported on the deployment target from Mike's machine. The useful facts: the Netlify CLI is authenticated, Netlify's Next Runtime 5 auto-detects this app, Scheduled Functions are available on the free plan, and `netlify.toml` successfully overrides the Node 24 default to 22. No Neon account exists yet. `flipit.com` sits on Cloudflare nameservers and is proxied, but which of the two accounts owns the zone is unconfirmed, and Wrangler cannot mutate DNS records — that is dashboard or API only.

Its build failed, but not for the reason I expected. Not `DATABASE_URL`: pnpm's `minimumReleaseAge` guard refused `@emnapi/runtime@1.11.3` as published within the last 24 hours. That is a supply-chain protection on Mike's machine working exactly as intended, and it clears on its own. Nothing to fix.

**Argon2 replaced with scrypt from Node's own crypto module.**

Buried in that report: `pnpm.onlyBuiltDependencies` is being ignored, and the native argon2 build would need confirming on the first real Netlify build. `argon2` is a native addon shipping prebuilt `.node` binaries, and the deployment target runs this application as bundled serverless functions. A native binary has to survive both the dependency install and the bundler's tracing to reach the runtime.

The failure mode is the worst available: everything passes locally, the deploy goes green, and then nobody can sign in — including the owner, to fix it. Discovered at the point where David is trying to get an invitation out.

scrypt is memory-hard, is in Node core with nothing to install or bundle, and OWASP lists it as an acceptable alternative to Argon2id where Argon2 is not available. Parameters are OWASP's scrypt baseline: N = 2^17, r = 8, p = 1 — roughly 128 MiB per hash, with `maxmem` raised explicitly because Node's 32 MiB default would otherwise make every hash throw.

Per-password random salt. The stored format is `scrypt$N$r$p$salt$hash`, so the parameters travel with each hash and can be raised later without invalidating existing passwords.

This deviates from §2.2, which names Argon2id. The reason is deployment, not cryptography, and it is recorded here rather than quietly done. For an admin login used by two people, removing an entire class of deployment failure is worth more than the margin between the two algorithms.

`argon2` is removed from the dependency tree entirely. There are now **no native modules in the application at all**, which removes the same risk for every future deploy rather than just this one.

**State:** 668 tests, typecheck and lint clean.
**One line of that review pass is now out of date, and it matters.** It says "no path sends a real email yet: `sendOneEmail` is the only function that puts a message on the wire and it has no callers." WP7 gave it one — `lib/sending/send-invitation.ts`, reached from the review screen. The three lower-severity gate findings the reviewer left open were left open on the basis that nothing was reachable. They are reachable now, and they should be worked through before a Gmail app password is connected to anything.

The two defects that pass did fix are both ones WP7 depends on completely. The template hash is the entire mechanism behind "editing one character disables sending", which is one of the twelve enforced pre-flight items; and the jurisdiction-list split would have made every imported row block, which is the exact failure the per-recipient gate exists to avoid.

---

## WP8 — Investor portal core — done (the core; the extras are not)

**Built:** the claim flow, passwordless return sign-in, investor sessions, the §4.2 account lifecycle, the eight-step timeline and the investor's own record.

Opening an emailed link claims it: single use enforced by a conditional update rather than a read-then-write, the account moves `invited` → `active`, the email is marked verified, and a session is established. Return visits use the passwordless flow — the investor types their address and a fresh link is minted, provided the account is in a state that may have one.

The lifecycle is the part worth reading. §4.2 spells out the sign-in rules "explicitly, because revocation alone does not answer it", and `lib/portal/access.ts` is that table transcribed as a pure function with nothing else in it. Suspension, closure and archiving all revoke every session and every unspent link in one function, so a later caller cannot do one and forget the other.

**Verified against the real database, with a second investor present throughout.** Twenty-four checks, all passing: a claim token works once and is refused the second time; an invented token, a revoked one and one belonging to a suspended account are all refused; suspension revokes every live session and every unspent link immediately, and then refuses to issue a new one; a status change with no reason is refused; an operator cannot archive an account; a closed account with the default `read_only` setting can still sign back in and reaches a read-only view of its own record; and no other investor's name or address appears anywhere in the loaded view.

**Decisions:**

- *The sign-in response is one string with no variants anywhere in the application.* An unknown address, a suspended account, an archived one and a live one all produce "If that address has a record with us, a sign-in link is on its way." The list of people invited into a private securities round is itself confidential, and a portal that answers "no such address" publishes it one guess at a time. The same reasoning gives every failed claim one page.
- *The service mode can only ever narrow access, never widen it.* An account that is suspended stays unreachable in every mode. Widening would mean a service setting could undo a suspension, which is the wrong way round — one is an operational posture, the other is a decision about a person. There is a test that checks every combination of five states and four modes.
- *A timeline step not yet reached shows the standard sentence and no facts whatsoever* — not a blank value, not a placeholder date, not a zero. A greyed-out step reading "Amount: —" invites the reader to fill in the blank themselves. Where a fact is genuinely missing on a step that *has* been reached, the sentence is written without it: "Your personalised invitation was sent." rather than "…was sent on ."
- *Sunset mode still issues sign-in links.* §7 says the portal is closing and investors should take their records with them; refusing sign-in during sunset would defeat the point of announcing it.
- *An investor session lasts thirty days, against the administrator's twelve hours.* An investor visits occasionally over months, and forcing a fresh emailed link every time turns a private record into a chore — and trains people to expect unprompted "sign in" emails, which is the exact habit §15.1 exists to break. Suspension kills the session immediately whatever its age.
- *Archiving is owner-only.* §4.2 gives the owner suspend and close over any account and says an operator cannot close the owner's access, but is silent on archiving. Archiving is a retention decision rather than day-to-day process management, so it went to the owner — the conservative reading.
- *A reason is required by the type signature, not only by the form.* A required field on a screen is something a future caller can route around by calling the function from somewhere else.
- *A claim is refused when the service is disabled.* §7 disables the portal, not merely its sign-in form.

**Deviations:** this is the core of WP8, not all of it. Still to do, and listed honestly rather than buried: the conversation thread, documents, the operator-side status advancement with its two-step confirmation and amount re-entry for funds received, and Google sign-in for an exactly-matching address. The response actions, the timeline, the immutable snapshot and the "coming to your portal" tiles are done. The sign-in link is minted, stored hashed and audited, but the email carrying it is not sent yet — a sign-in link is a notification and notifications go through the same gated transport as everything else, which is WP12's.

**Checklist:** points 5, 6 and 7 are this package's.

5. No investor-facing page, response or error reveals that another investor exists. `lib/portal/data.ts` is bound to one account id taken from the session and never from anything the browser sent; it loads no count, total or aggregate, so it has nothing to leak. Verified with a second investor in the database and their name and address absent from the serialised view. The timeline has a test asserting no wording about positions, queues, totals or other participants at any stage.
6. Claim and sign-in tokens are random, stored only as a hash, single-use by conditional update, and expiring — fourteen days for a claim link, forty-five minutes for a requested sign-in link.
7. Suspension revokes existing sessions *and* refuses new links. Both halves verified against the database.

**Uncertain:**

- Requesting a second sign-in link revokes the first. That is safer, and it is what the invite flow does, but somebody who clicks "email me a link" twice and then opens the first email will find it dead. I think that is the right trade; it is worth a second opinion.
- Forty-five minutes for a sign-in link and thirty days for a session are both my numbers. The spec says "expiring" without naming a duration for either.

---

## Note on the argon2 → scrypt substitution

A parallel session replaced argon2 with `node:crypto`'s scrypt while WP8 was being built. The build instructions name argon2 explicitly in the stack, so this needed Michael's agreement rather than mine.

**Decided: keep scrypt.** Michael agreed on 25 July 2026. The substitution stands, and the comments that still said "Argon2id" above scrypt code have been corrected — a comment naming the wrong algorithm is worse than no comment, because it is the thing a later reader will believe.

The implementation itself is sound: N = 2^17, r = 8, p = 1 — OWASP's current scrypt baseline, about 128 MiB per hash — a per-hash random salt, and `timingSafeEqual` for the comparison. It is a genuine memory-hard KDF, not a fast hash wearing a costume, and it removes the last dependency needing a native compile.

Two things worth knowing:

- Argon2id is still the better primitive on the merits. It is the newer design, it is what the Password Hashing Competition settled on, and it resists a wider range of hardware attacks. scrypt at these parameters is nonetheless a defensible choice and is what the OWASP cheat sheet recommends where Argon2id is unavailable.
- Nobody has set a password against the old scheme yet — the seed creates accounts with none — so switching now costs nothing. Switching after real passwords exist would mean a migration.

I raised the timeout on one sign-in test rather than lowering the cost: eleven real attempts at 128 MiB each takes about forty seconds, and the test now also asserts that an attempt costs more than ten milliseconds. If that test ever starts finishing quickly, somebody has weakened the parameters.

---

## The AI spend cap — closed

Carried forward as a gap since WP3: the monthly ceiling was stored and displayed but nothing counted against it, and §9.1 asks for both a cap and for usage to be shown.

**Decided by the owner on 25 July 2026: the cap warns and does not block.** The amounts are genuinely small, and an import that refused because a twenty-dollar ceiling was reached would stop the operator working over a rounding error.

**Built:** an `ai_usage_events` table, one row per call to the model. Token counts come from the provider's own `usage` field — nothing here estimates them. `lib/import/spend.ts` turns those counts into a cost against a published price list, sums the current UTC month, and returns a summary. The figure appears on the settings page beside the cap, with the state colouring the panel: quiet under 80%, amber above it, red over.

**Verified against the database.** An untouched month reads zero. Twenty realistic mapping calls — 1,200 prompt tokens and 300 completion tokens each — cost **one cent** in total, which is the number that makes the "warn, don't block" decision obviously right. A deliberate overrun is detected, the message says imports carry on, and an unpriced model is named rather than silently counted as free.

**Decisions:**

- *A failed call is counted.* A call that timed out or returned unusable JSON still cost money. Recording spend only against successful proposals would under-report by exactly the calls most worth knowing about — which is why the usage table is separate from `ai_proposals` rather than a column on it.
- *`recordAiUsage` never throws.* Failing to write a usage row must not fail an import. Losing the accounting for one call is a far smaller problem than losing the import, and the cap warns rather than blocks, so nothing downstream depends on the row existing.
- *Cost is stored at six decimal places, not two.* One mapping call costs a fraction of a cent. Rounded to two at the point of accumulation, every call would round to zero and a month of them would sum to nothing.
- *An unknown model is priced at zero and named in the summary.* A guessed price produces a confident wrong number, which is worse than an obvious gap — so the gap is reported: "the real figure is higher than this."
- *A cap of zero means no cap, not a cap of nothing.* Refusing every call because a field was left at its default would be a surprising way to break an import.
- *The month boundary is UTC.* A billing period is not in the viewer's timezone, and the figure should not change depending on who is looking at it.
- *The figure is labelled an estimate, on the screen, in those words.* It comes from a price list checked on 25 July 2026, and price lists go out of date. A number that looks like an invoice and is not one is worse than an obvious estimate.

**Checklist:** point 1. No monetary value here is a JavaScript number — token counts are integers because they are counts of things, and they become a `Decimal` the moment they become a cost. There is a source-level test asserting `Number(`, `parseFloat(` and `.toNumber(` appear nowhere in the module, with the comments stripped first so the module's own prose about avoiding `Number()` does not trip the check that it avoids `Number()`.

There is also a test asserting the module exposes **nothing that could be read as a refusal** — no `blocked`, no `allowed`, no `canProceed`, no thrown error naming the cap. If someone later makes an overrun fatal, that should be a decision taken deliberately, and this is what makes them notice they are taking it.

**Uncertain:**

- The price list is four entries of published pricing hard-coded with the date checked. It will drift. The unpriced-model path means drift shows up as an under-report with a visible warning rather than as a silent wrong number, but somebody should glance at it before launch.

---

## WP9 — Questions and answers — done

**Built:** §6.7 in full. An investor asks from their portal and gets the plain confirmation from PORTAL_COPY. The operator is emailed immediately. He answers in a queue that shows who asked, their offer detail and their account status. A single checkbox — unticked by default, every time — also publishes the answer to a shared page with the asker removed. The reply email to the person who asked is a third, separate press. He can write pairs himself, pin them, reorder them, and take them down again.

The part worth reading is `lib/qa/anonymity.ts`, because §6.7.3 is the one section of the spec that argues with itself and then answers. *"The published question never shows who asked"* — and then, immediately, *"That is not enough on its own, because people identify themselves inside the text."* So there are two mechanisms doing two different jobs.

`toPublicEntry` is **structural**. It builds the object the investor side renders, and that object has six fields: id, question, answer, pinned, and two coarsened periods. There is no asker field, no account id, no address, no timestamp. Nothing downstream can leak what it was never handed, and a test asserts the key set exactly rather than with `toContain` — a seventh field fails the test rather than shipping.

`scanForIdentifyingDetail` is **advisory**, aimed at the human, and it reads the wording the operator proposes to publish rather than the original. It looks for the things §6.7.3 names — amounts, percentages, addresses, telephone numbers, specific dates, references to a private conversation, first-person references to a holding. The spec's own example is a test: *"As we discussed on Tuesday, I'd want to put in more than the 5% you offered me…"* trips three rules.

**Verified against the real database, with a second investor present throughout.** Fifty-one checks in `scripts/verify-qa.ts`, all passing: the shared page contains no name, no address, no account id, no original wording and no exact date; a second investor sees the shared entry and nothing about who asked; one investor cannot append to another's thread and the refusal does not confirm the thread exists; saving an answer neither publishes nor sends; a refused send leaves nothing stamped as replied; suspension removes the form, the shared section and the thread together.

**Decisions:**

- *A published date is a month and a year, never a day.* §6.7.3 forbids "a date precise enough to identify". A day is: David answers within hours, and an investor who asked on the 14th recognises their own question by its date. A month cannot be matched to a conversation, and knowing roughly when an answer was given is genuinely useful, so the month stays and the day goes.
- *An investor-asked entry cannot publish without an explicit public rewrite, even when the original would have done.* The tempting shortcut is `questionPublic ?? questionOriginal`, and that is the version that publishes somebody's own words the first time the operator forgets. If the wording is already general he retypes it, which costs ten seconds and means somebody read it with publication in mind. An operator-authored entry needs no rewrite — nobody's words are being republished.
- *Where the scan finds something, publishing needs an acknowledgement; where it finds nothing, it does not.* §6.7.3 asks for "a reminder to check", and a reminder nobody has to acknowledge is a reminder nobody reads. The friction lands only on the entries that actually contain an amount or an address.
- *The two Q&A emails are deliberately NOT in the compliance template registry.* §6.7.6 says a private answer is "ordinary correspondence" and is not gated, and the operator notification is internal mail from the app to the person running it. Registering either would mean one word changed in an internal notification voids the approval that lets invitations go out — not a stricter reading of §8.2, a broken one. A test asserts the registry still holds exactly two kinds and that `messages.ts` imports no hashing.
- *Publishing is not owner-gated.* §6.7.6 reads like an argument for it — a published answer "carries the same weight as the invitation itself" — but the spec answers its own question in the next sentence: "The publish dialog says so, once, in one line." A notice, not a gate. Inventing an approval step would be inventing a rule about sending.
- *The §6.7.5 visibility switch is owner-only and is deliberately not a Q&A action.* It stays a `service_config` field written by the owner-only settings action. Modelling it as a `QaAction` would put it one role check away from the operator, which is the same mistake the compliance approval is kept off the settings page to avoid. There is a test asserting no action in `QA_ACTIONS` matches `/VISIB/`.
- *"Hidden until the round closes" means no round anywhere is open.* The switch is one system-wide setting, and what it protects against is the inference that other investors exist at all. Per-investor visibility would make the shared section appear for some people and not others, which is a stranger signal than either state on its own.
- *A read-only portal accepts no new question but still shows the investor their own thread.* The read-only notice already says messages are not being accepted; taking a question into a queue nobody will answer would make that sentence false. §7 read-only is "view and download", and their own correspondence is part of their record.
- *A notification that cannot be sent never fails the investor's submission.* The question is recorded first; the outcome of the email is written to the entry and shown in the queue. "Your question has been sent" stays true — it is sitting in David's queue — and whether the mail connection is configured is not the investor's business. Two new columns, `notified_at` and `notify_failure`, carry it.
- *A follow-up re-opens a thread without a status column.* An entry is waiting when it has no answer, or when the newest investor message is later than the last reply that went out. A stored status could disagree with the messages; a computed one cannot.
- *The notification subject does not carry the question.* Subjects appear on a lock screen and an investor's question can contain their own figures.

**Deviations:** none from the task file. Two columns were added to `qa_entries` (migration `0003`) for the notification outcome — the table existed from WP1 but had nowhere to record whether §6.7.1's "emails David immediately" actually happened, and a silent failure there looks exactly like an empty queue.

**Checklist:** points 1, 2, 5, 8 and 10 are this package's.

1. No monetary value is a JavaScript number. The queue's offer figures are formatted strings from `formatMoney`/`formatPercentage`, and a source-level test asserts `Number(`, `parseFloat`, `parseInt`, `.toNumber(` and `Intl.NumberFormat` appear nowhere in any `lib/qa` module. Comments are stripped before scanning, so a module's explanation of why it avoids `Number()` does not trip the check that it avoids `Number()`.
2. No send path bypasses anything. Both Q&A emails go through `sendOneEmail`, which is the only function in the codebase that puts a message on the wire; a source test asserts no `lib/qa` module constructs a transport, imports nodemailer, or re-implements the retry. Neither is compliance-gated, which is §6.7.6's explicit decision, not an omission — and the transport gate still refused both in verification, naming the missing credential.
5. No investor-facing page, response or error reveals another investor. The shared section unavoidably implies that other recipients exist, which is precisely why §6.7.5 exists and why the owner has a switch. Beyond that inference, verified with a second investor in the database: no name, no address, no account id, no count, no total, no ordinal.
8. No log line carries a token, a body or a key. Audit metadata records lengths, ids and outcomes; a source test rejects a message body in value position within any `metadata:` block, and `assertNoSecrets` would reject it again at runtime.
10. A published entry contains nothing identifying. This is the whole package. The projection is structural, the scan is advisory, and both are tested — including against the spec's own example sentence.

**Uncertain:**

- The shared Q&A implies other recipients exist. That is inherent to the feature and the spec says so plainly, and the default is visible on the reasoning that "a well-answered Q&A does more for confidence than the inference costs". That reasoning is Michael's to confirm before the first send, not mine — the switch is one click.
- The scan's rules are mine. They cover what §6.7.3 names, and a general "does this text identify anybody" detector does not exist. Somebody should read the rule list once and say whether anything obvious is missing.
- An operator editing a *published* answer stamps it as updated but does not re-run the acknowledgement unless the scan finds something in the new wording. That is consistent, but a second opinion on whether an edit to a live entry deserves a firmer confirmation would be welcome.

---

## WP10 — Register of interest — done

**Built:** §5.2 in full. An investor adds their name from their portal, optionally with an indicative figure, and can remove it again — both one click, both confirmed. The operator sees the register in computed order with each person's history, can move somebody with a recorded reason, can add a stranger who was never on the recipient list, and can issue an offer to anyone on it.

**The copy is a constant, not prose in a component**, and `copy.test.ts` reads the blockquote out of `BUILD_SPEC.md` and compares it paragraph by paragraph. §5.2.1 says why: *"The copy has to carry this precisely, because the whole feature lives or dies on not overstating."* If somebody edits either the spec or the screen, the test fails and they have to change both deliberately. There is a second test asserting the word "waitlist" appears nowhere, and that no investor-facing string contains "queue", "rank", "your position" or "ahead of".

**Issuing an offer writes exactly what the import writes.** A `recipients` row carrying the jurisdiction, then an `offers` row pointing at it, with `blocked` set by the same `isJurisdictionApproved` the import calls, reading the same list — the one on the current compliance approval. The gate has no branch for the register and no idea it exists, which is the point. Verified with a real approval covering GB only: an offer to Great Britain lands as a draft, an offer to the United States is created and blocked individually with a reason naming the country, and the first one is still a sendable draft afterwards.

**Verified against the real database.** Forty-nine checks in `scripts/verify-register.ts`, all passing: the three bands order correctly with real receipts and commitments; an early joiner does not overtake somebody who has settled; an override with a thin reason is refused and one with a real reason moves them and shows why; a stranger added by the operator gets an `INVITED` account that cannot be signed into; an invalid country code creates nothing at all; and the investor-facing view has exactly three fields with no other member's name, address or position anywhere in it.

**Decisions:**

- *The investor-facing view has three fields and nowhere to put a fourth.* `onRegister`, `indicativeAmount`, `canChange`. §5.2.2 forbids showing a position — "a displayed rank is a promise whatever the surrounding text says" — and the way that is kept true is the same as WP9's: the type has no field to assign one to. A test asserts the key set exactly.
- *An override names an absolute position, so it can move somebody down as well as up.* Overridden members are placed first, in ascending order of the position they were given; everyone else fills the remaining slots in computed order. Two people both moved to first is an instruction the operator can give, and the list still has to be a list — so the second takes the next free slot rather than one of them vanishing. A test asserts no arrangement of overrides can lose or duplicate anybody.
- *An override with no recorded reason is ignored by the ordering itself, not only refused by the form.* A row written straight into the database with a position and no reason does not move. §5.2.2 makes the reason the condition of the override, and a rule enforced only in a form is a rule a future caller routes around.
- *Rejoining after leaving resets the join date.* The third band is ordered "by the date they joined it", and somebody who left and came back joined on the day they came back. Keeping the original date would let leaving and rejoining be free, which is the small dishonesty that turns a register into a queue.
- *An issued offer does not remove anybody from the register.* Leaving is the investor's decision. An offer that is declined should not silently cost them their place, and §5.2 gives removal to them.
- *The operator supplies the amount, the SPV percentage and the jurisdiction; only the indirect percentage is computed.* §9 makes `spv_percentage` a supplied column, not a derived one, so deriving it here would invent a calculation rule the spec does not have. The indirect figure goes through `computeIndirectPercentage`, which is the one function allowed to compute it — the same one the import uses.
- *Issuing to somebody who already has a record in the open round is refused.* That is a duplicate, not a freed allocation, and `recipients` is unique on round and address anyway — better a sentence explaining it than a constraint violation.
- *A manually added stranger gets an account in `INVITED`.* That is §4.1's state for an account that exists but whose mailbox has not been verified. It cannot sign in; it gains portal access the ordinary way, by claiming an invitation, if one is ever issued.
- *Neither joining nor issuing sends anything.* The offer lands in Review and send as a draft and goes out one recipient at a time behind the pre-flight checklist (§14).
- *Leaving when already off the register is not an error.* The end state is what they asked for.

**Deviations:** none. No migration was needed — `interest_register_entries` from WP1 already had every column §5.2 requires.

**Checklist:** points 1, 2, 3 and 5 are this package's.

1. No monetary value is a JavaScript number. The indicative figure goes through `parseMoney` and is stored as an exact decimal string — verified as `'2500.00'` from the input `$2,500`. A source-level test asserts `parseFloat`, `parseInt`, `.toNumber(` and `Intl.NumberFormat` appear nowhere in `lib/register`, and that `Number(` appears nowhere except `Number.isInteger` on a list position, which is a count of places rather than a value.
2. No send path bypasses the compliance approval. Nothing in this package sends. `issueOfferFromRegister` creates a draft and asks the same jurisdiction function the import asks; there is no parameter that skips it and no path that sets `blocked = false` directly.
3. A jurisdiction block stops one recipient. Verified with two offers issued minutes apart from the same screen: the US one blocked, the GB one still a sendable draft.
5. No investor-facing response reveals another investor. The register is the feature most at risk of it — a rank is a statement about other people — and it is the reason §5.2.2 keeps the order operator-only. Verified with three other members present.

**Uncertain:**

- The register page offers no way to issue an offer with a *different* sender name or phone than the defaults, though the columns exist. The import can set them per row. Nobody has said whether a freed allocation ever comes from a different sender; I left the fields on the form but unlabelled as prominent, and it is worth a look.
- Where the whole register is ordered, somebody who has settled in an *earlier* round outranks somebody who committed in this one. That follows §5.2.2 read literally, and I think it is right — completing is completing — but it is a judgement about people's expectations rather than about the text.

---

## WP11 — Updates feed — done

**Built:** §6 in full. The operator writes an update, saves it as a draft, sees it rendered as the investor will see it, and publishes it to everyone, to a subset by status, or to one named person. It appears in the portal newest first with a published date. Published updates cannot be edited or deleted; a correction is a new update, and withdrawal leaves the row, the delivery rows and an audit entry with the reason.

**The notification email takes two arguments and both are links.** §6 says it *"carries no amounts, percentages, or personal detail"*, and the way that is guaranteed is that `buildUpdateNotification(portalLink, verificationLink)` has no parameter for a title, a body, a name or a figure. There is nothing to pass in. A test asserts the function's arity is two, that two calls are byte-identical, and that the visible text — markup stripped, so `width:100%` is not mistaken for a percentage — contains no digit at all outside the two URLs. A second test asserts the module imports neither the database nor `formatMoney`.

**The audience is resolved once, at publication, into `update_deliveries` rows**, and the investor's feed is a join through their own row. A targeted update reaching only its recipients is therefore a property of the schema rather than of somebody remembering to write a `where` clause. It also keeps the update immutable in the sense that matters: an account that changes status the next morning does not silently gain or lose a notice that was already published.

**Verified against the real database, with four investors present.** Forty-one checks in `scripts/verify-updates.ts`: a draft is on nobody's portal and has no delivery rows; an update addressed to one person is invisible to the other three and its text appears nowhere in their feeds; a status filter reaches only that status; a published update refuses every edit and every delete; withdrawal removes it from the portals while keeping the row, the reason and the delivery rows; and a withdrawn update cannot be notified about.

**Decisions:**

- *Publishing sends nothing.* §6 says publication "may optionally trigger a notification email", and §14 says there is no bulk send anywhere in the UI or the API. A notification that reached forty people because one button was pressed is a bulk send whatever the button says, so the two are reconciled the conservative way: publishing queues the notifications and lists the recipients, and each one is its own press to one address — the same rule as an invitation. The one unattended sender in this application is the reminder, and §6.5 spells out the constraints that make it safe; nothing here inherits them.
- *Suspended and archived accounts can never be addressed, including by a status filter that names them.* §4.2 gives neither any portal access, so a delivery row for one would be a record of a communication that did not happen. A filter resolving to nobody resolves to nobody — it is never widened to "everyone", which is the failure that would send a targeted notice to the whole list.
- *`ALL` includes `INVITED`.* §6 says "all active investors"; an account in `INVITED` has been sent an invitation and has not opened it yet, and excluding them means the first thing they see on claiming is a feed with a hole in it.
- *A withdrawn update leaves no tombstone on the investor's screen.* §6 puts the tombstone in the audit log. "This notice was withdrawn" on the page would be a second communication about the thing that was withdrawn.
- *A published update is never deleted, only withdrawn.* A tombstone that destroys the evidence of what was published is not a tombstone. A source test asserts there is exactly one `db.delete` in the module and that it is the one discarding an unpublished draft.
- *Publishing to an audience that currently matches nobody is refused* rather than succeeding quietly. An update with no readers is a draft that thinks it is published.
- *Notifying somebody who has been suspended since publication is refused.* A suspension between the two is a decision about a person, and an email telling them to open a portal they cannot reach is pointless at best.
- *Read state is per-delivery and is the investor's own.* The operator sees whether each recipient opened it; no investor sees anything about anybody else's.
- *A withdrawal reason is at least ten characters and goes only in the audit log.*

**Deviations:** none. No migration was needed — `portal_updates` and `update_deliveries` from WP1 already had every column §6 requires.

**Checklist:** points 1, 2, 5 and 8 are this package's.

1. No monetary value is a JavaScript number. Nothing in this package handles money at all, and a source test asserts `Number(`, `parseFloat`, `parseInt` and `.toNumber(` appear nowhere in `lib/updates`.
2. No send path bypasses anything. The notification goes through `sendOneEmail` and its gate refused it in verification, naming the missing credential. A source test asserts no `lib/updates` module constructs a transport or imports nodemailer, and that no function is named `notifyAll`, `sendAll`, `sendMany`, `sendBatch` or `sendBulk`.
5. No investor-facing response reveals another investor. Verified with four accounts: a targeted update is absent from the other three feeds, its text appears nowhere in them, and no other investor's name is in the serialised view. The notification email is identical for every recipient, so it has nothing to leak either.
8. No log line carries a body or a credential. The audit metadata records counts, ids and the audience shape — never the body, and never the list of addresses, because a roster of investors in the audit log is a roster of investors. The audit guard caught one key called `bodyCharacters` during this package and threw rather than redacting; the key is now `characters`, and the guard being blunt is what made that a thirty-second fix rather than a silent one.

**Uncertain:**

- Publishing lists the recipients and expects a press each. With forty investors that is forty presses. I believe that is the right reading of §14, and the alternative — one button that emails everybody — is exactly the shape the rule exists to forbid. But if Michael wants a middle ground, the honest one is a per-recipient confirmation that stays one-at-a-time rather than a loop, and that is a decision rather than a fix.
- An investor's read state is recorded but nothing marks it read automatically yet; the action exists and is bound to the session's own account. Wiring it to the page needs a client component on the portal and I left it out rather than adding one for a non-essential signal.
