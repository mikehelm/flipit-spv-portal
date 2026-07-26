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

---

## WP12 — Reminders — done

**Built:** §6.5 in full. A visible queue of upcoming reminders with dates and recipients, a configurable schedule defaulting to 7 and 2 days before each recipient's own deadline, a hard cap defaulting to 2, cancel and reschedule individually or in bulk, and a scheduled job (`pnpm reminders:run`) that works through what is due.

**This is the one place in the application that sends without a human pressing send at that moment**, and the whole package is written on that basis.

`lib/reminders/eligibility.ts` is §6.5's audience rule transcribed as a pure function that returns a *reason*, never a boolean. Every constraint is there — responded, account status, blocked, invitation actually sent, cap, deadline, service mode, schedule switch — and the scheduler evaluates it **twice**: once when it builds the queue and again immediately before it sends. Nothing about "it was eligible last Tuesday" survives to the moment of sending, which is what makes queueing days in advance safe. There is a test asserting the function takes two arguments and that its source contains no `force`, `override`, `bypass`, `ignoreCap` or `skipChecks`.

**Verified against the real database, with five recipients in five different states.** Twenty-seven checks in `scripts/verify-reminders.ts`: a responder is never queued and answering deletes every planned reminder for that person; a blocked offer, a suspended account and somebody who was never sent an invitation are all absent from the queue; four scheduled days with a cap of two produces two reminders and drops the ones nearest the deadline; a cancelled reminder is never resurrected by a rebuild; a reminder cannot be moved into the past or past the response deadline; and in read-only mode both a single send and a whole run send nothing while the queue keeps explaining itself.

**Decisions:**

- *There is no "send it now" button anywhere.* The operator can see, cancel and reschedule — which is exactly what §6.5 gives him. A manual send would be a second path into the same transport with a different set of checks in front of it, and two paths eventually disagree. The one that exists is the one with the constraints.
- *A cap of two binds the plan, not just the send.* A schedule of `[21, 14, 7, 2]` with a cap of two produces two reminders rather than four that get refused later, and it keeps the two furthest from the deadline. Dropping the earliest would mean the last thing an investor hears is a week before they run out of time; dropping the latest means the last chance to respond is the one that survives.
- *Reminders go out at 09:00 UTC.* The spec names days, not an hour. No hour is polite everywhere; one that is polite somewhere beats an arbitrary midnight that reads as automated.
- *A reminder more than two days overdue is skipped, not sent late.* If the scheduler has not run — a deploy, an outage, a cron nobody wired up — a "respond within seven days" nudge arriving four days late describes a deadline that has moved. Two days survives a weekend outage and keeps the message true when it lands.
- *A service-mode hold does not consume the reminder.* Every other refusal writes `skipped_reason` and the row is finished. Read-only, sunset and disabled leave the row alone: §6.5 says reminders respect the mode, not that the mode destroys them, and the service may be active again tomorrow while the deadline is still a fortnight away.
- *A cancelled reminder is never recreated by a rebuild.* Cancelling is an instruction from a person and outranks a recomputation. A reminder that a recomputation decides should no longer exist is *deleted* rather than marked cancelled, because nobody instructed it and a "cancelled" row would put the operator's name on the application's decision.
- *The cap counts reminders that were actually sent.* A cancelled or skipped one is not a reminder anybody received, and counting it would let a cancellation quietly use up somebody's allowance.
- *A failed reminder does not rewrite `offers.email_status`.* That column is the state of the *invitation*, which arrived perfectly a week ago. `sendInvitation` gained an `updateOfferEmailStatus` flag for this; the reminder's outcome lives in `reminder_events` and `send_events`, where somebody looking for it would go. Its `intent` now follows its `kind` too, so the audit log stops calling reminders invitations.
- *A transient transport failure leaves the row due* so the next run retries it, until staleness catches it. A permanent one stops it.
- *The job is a script, not an HTTP route.* A URL that emails investors is one misconfigured proxy away from being reachable by somebody who should not reach it. `pnpm reminders:run` has no listener and no authentication surface.
- *A run is bounded (50 by default)* so a first run against a long-neglected queue cannot become an unbounded burst. What is left is reported and picked up next time.

**Deviations:** none. No migration was needed — `reminder_schedules` and `reminder_events` from WP1 already had every column §6.5 requires. One small change outside the package: `sendInvitation` gained the `updateOfferEmailStatus` flag described above, and its blocked branch now skips an empty `UPDATE` rather than throwing.

**Checklist:** points 1, 2, 3 and 8 are this package's.

1. No monetary value is a JavaScript number. Reminders handle none at all — §6.5 forbids amounts and percentages in the body — and a source test asserts `formatMoney`, `formatPercentage`, `parseFloat` and `.toNumber(` appear nowhere in `lib/reminders`.
2. No send path bypasses the compliance approval. The runner loads the gate context for `REMINDER` and passes it to `sendInvitation`, which applies the same gate an invitation gets. A source test asserts `run.ts` contains `loadGateContext('REMINDER')`, does not contain `loadGateContext('INVITATION')`, and sends with `kind: 'REMINDER'` — so a reminder can never go out under the invitation's approval. In verification the send was refused with the no-approval message, verbatim. A second source test asserts the eligibility re-check appears before the send call in `sendOne`.
3. A refusal stops one recipient. `sendOne` takes one reminder id and evaluates its own gate; the runner's loop carries no state between iterations and one refusal cannot reach another.
8. No log line carries a token, a body or a key. The audit metadata records offer ids, sequences, Message-IDs and reason codes. The scheduled job prints counts and reasons, never an address, a subject or a body.

**Uncertain:**

- 09:00 UTC and the two-day staleness window are both my numbers. Neither is in the spec and both are one-line changes.
- The runner is a script and nothing schedules it yet. On Netlify that is a Scheduled Function calling into the same `runDueReminders`; wiring it is WP20's, and it should not be wired at all until a compliance approval for the reminder template exists, because until then every run is a queue of refusals.
- Rescheduling reads the picker's wall-clock time as UTC. For an operator in Bangkok that is a seven-hour surprise. The queue labels every time "UTC" and the field says so, but a proper timezone-aware picker would be better.

---

## WP13 — Participation certificate, and WP8's deferred status advancement — done

Two things, because one needs the other: §5.1 generates the certificate *once an investor reaches funds received*, and until this package nothing could put them there.

**Built (§5, the operator side of the timeline):** an investor record page with all four amounts shown as four amounts, the eight-step timeline, one-step-at-a-time advancement, corrections that require a reason and keep the original, and the funds-received form with its two-step confirmation.

**Built (§5.1):** the certificate, as a real PDF, generated on funds received, downloadable from the portal, reissued on a correction with the superseded version retained and still readable.

**The PDF is written directly, in about three hundred lines, with no dependencies.** This is the significant decision in the package and it is the same reasoning that replaced argon2 with scrypt. The obvious way to get a branded PDF is a headless browser; the deployment target runs this app as bundled serverless functions, and a headless Chromium is a 300 MB native binary that has to survive both the dependency install and the bundler's tracing. The failure mode is the worst available — everything passes locally, the deploy goes green, and the first investor to have their funds recorded gets an error instead of their certificate, at the exact moment they are least willing to be relaxed about it.

A PDF is a small text format: a few objects, a content stream of drawing operators, and a table of byte offsets. The fourteen standard fonts need no embedding. `lib/certificate/pdf.ts` does that and nothing else — no images, no embedded fonts, no second page. It is not a PDF library and should not become one.

**The output was checked as a document, not only as bytes.** `qpdf --check` reports no syntax or stream encoding errors, `pdfinfo` reads the title, author and page count, and the page was rasterised and looked at. One defect showed up that way and only that way: a middle dot in "Version 1 · Issued …" was rendering as a question mark, because the transliteration table did not cover it. Byte-level tests would never have caught it.

**Verified against the real database.** Forty-nine checks in `scripts/verify-certificate.ts`: a step cannot be skipped; funds received cannot be reached by the ordinary advance at all; a correction needs a reason; without the tick or with a mismatched re-typed amount nothing whatsoever is written; `$5,000` and `5000.00` are accepted as the same amount because they are compared as decimals; a future value date and a missing reference are refused; the certificate carries every figure §5.1 lists and the required footer; a correction produces version 2 while version 1 stays readable and still states its *own* original figures; and another investor sees none of it.

**Decisions:**

- *A certificate version is a frozen snapshot and the PDF is regenerated from it on every download.* Nothing is stored as a file. There is no blob store in this deployment, and a document that rebuilds byte-for-byte from eight fields is a derived value. More importantly it is what makes a retained superseded version honest: it still says what it said, rather than quietly restating the corrected figures. A test asserts the same input renders to identical bytes and a changed figure renders to different ones.
- *`storage_key` stays on the table, nullable and normally null*, for a future deployment that does keep files.
- *A name is transliterated, never dropped.* Curly quotes, dashes and the ellipsis have exact ASCII equivalents; accented Latin letters fold to their base letter, which is wrong but legible and far better than a blank box on somebody's certificate.
- *Advancing is one step at a time.* Jumping from "documents issued" to "funds received" would leave a timeline claiming things happened that nobody recorded, and the timeline is what the investor reads to know where they stand.
- *`advanceStage` refuses `FUNDS_RECEIVED` outright*, with a message naming the right form. Two paths into a financial assertion is one too many.
- *The re-typed amounts are compared as decimals.* `$5,000` and `5000.00` are the same amount; `5000.01` is not. A string comparison would reject the first pair and teach the operator to copy and paste, which defeats the point of typing it twice.
- *The certificate is issued in the same request as the funds record.* §5.1 says it is generated once they reach that step, and an investor who has just been told their money arrived should not wait for a second button.
- *Reissuing an identical certificate is refused.* A correction that changed nothing is not a correction, and versions that all say the same thing make the record harder to read.
- *A certificate is looked up by its own id **and** the offer it belongs to*, and the download route requires that offer to belong to the session's account. A guessed id finds nothing, and the response is byte-identical to the one for an id that does not exist.
- *Superseded versions stay downloadable.* §5.1 retains them on the record, and a record you cannot read is not retained.
- *Issuing is refused when no signatory name is configured*, rather than signing the certificate "Flipit". §5.1 says it is signed off by David in his stated role.

**Deviations:** none from the task file. Migration `0004` makes `participation_certificates.storage_key` nullable and adds a `data` column for the snapshot. One change outside the package: `lib/portal/data.ts` now loads certificates onto the portal view.

**Checklist:** points 1, 5 and 8 are this package's.

1. No monetary value is a JavaScript number. The certificate takes decimal strings validated by a Zod schema that rejects anything but a plain decimal, prints them unchanged, and a test asserts `12345.67` appears as `12345.67` and never as `12,345.67` or `12345.7`. The re-typed amount comparison goes through `decimal.js`. The only numbers in `pdf.ts` are typographic — points, widths in 1/1000 em, byte offsets.
5. No investor-facing response reveals another investor. The download route answers a certificate that is not yours with exactly the response it gives one that does not exist. Verified with a second investor: none of the first one's certificates or their ids appear anywhere in the second one's view.
8. No log line carries a credential or a body. The audit entries record a version, an offer id and a count. The payment reference is deliberately *not* in the audit metadata — it is on the record and on the certificate, and it does not need a third copy in a log.

**Uncertain:**

- The signatory's role is hard-coded as "SPV Manager", matching the invitation template's sign-off. §5.1 says "his stated role" and onboarding does not currently capture one. A settings field would be better; the current value is at least consistent with what the investor has already been sent.
- The PDF has no logo image, because embedding one would mean an image handler in `pdf.ts` and the whole point of that file is that it stays small. The branding is the wordmark, the palette and the accent rule. Worth a look at the rasterised page before launch — it is in this session's notes as a rendered image.

---

## WP14 — Anti-phishing page and indexing — done, and a build gate added

The verification page itself was built early in a parallel session and is good: it names Michael and David, the exact sending address, the exact link domain, what the email will and will not ask, the standing payment-details warning, and a route to verify by other means. This package checked it against §15.1, wired it in, and fixed the indexing — which was broken.

**`robots.ts` was at `app/verify/robots.ts`.** Next.js only publishes that metadata file from the root of `app/`; nested, it generates `/verify/robots.txt`, which is a path no crawler ever requests. **The site had no robots.txt at all**, and the unit test passed the whole time because it called the function rather than asking where the file was. It is now `src/app/robots.ts`, and the test asserts the file's *location* as well as its contents — and asserts that no nested copy has reappeared.

**Built:** the sitemap §15 implies — one entry, the verification page, and a test asserting no portal, admin or api path is in it. `X-Robots-Tag` response headers in `next.config.ts`: `noindex, nofollow, noarchive, nosnippet` on every path, with `/verify`, `/robots.txt` and `/sitemap.xml` opted back in. A link to the page from the public front door, alongside the existing ones from the portal sign-in, the dead-link page and the invitation footer.

**`pnpm build` is now part of the gate**, and there is a `pnpm check` script that runs typecheck, lint, tests and build together.

That is the other finding of this package, and it is worth stating plainly: **the production build catches a whole class of defect that typecheck, lint and the test suite pass straight through.** Building this package found two, both shipped in earlier packages and both fatal to a deploy:

- `updates/parts.tsx` (WP11) imported one string constant from `lib/updates/service.ts`, which imports the database. That pulled the entire postgres driver into the browser bundle. `Module not found: Can't resolve 'tls'`.
- `recipients/[offerId]/parts.tsx` (WP13) did the same through `lib/portal/advance.ts`.

Neither is visible to `tsc`, to eslint, or to vitest, because none of them draws the server/client boundary. Both are now split: the presentational half lives in a database-free module (`lib/portal/stages.ts`, `lib/updates/copy.ts`) and the server module re-exports it. Every package from here runs `pnpm build` before it is called finished.

**Decisions:**

- *robots.txt is the polite one of three layers, not an access control.* It is a request, and a crawler that ignores it is not doing anything a browser could not. The header and the per-route `noindex` are the other two, and every private route is behind a session check regardless.
- *The header matters more than the meta tag.* A `<meta name="robots">` only exists inside an HTML document. A downloaded participation certificate — an investor's name and the amount they transferred — has no head to put a tag in. `X-Robots-Tag` covers route handlers, PDFs and API replies.
- *The sitemap carries no `lastModified`.* It would be the time this deployment was built, which is information about the operation rather than about the page, and the page's usefulness does not decay.
- *`X-Frame-Options: DENY` and `Referrer-Policy: no-referrer` went in alongside.* Not indexing, but the same one-line-per-risk shape: an investor's portal must not be framed by a third party, and a referrer header must not carry a claim token to an outside site.

**Deviations:** none.

**Checklist:** point 9 is this package's, and it is now true rather than nominally true.

9. The verification page is the only indexable route. Three tests: exactly one `page.tsx` in the tree sets `index: true` and it is `verify/page.tsx`; the root layout's default is `index: false` so a page that forgets is still safe; and the catch-all header sets `noindex` for everything a meta tag cannot reach. The generated `robots.txt` and `sitemap.xml` were read out of a real production build rather than inferred.

**Uncertain:**

- `/verify` is a memorable path but it is not obviously *ours*. Somebody who has thrown the email away has to remember the domain as well. §15.1 wants it "safe to reach by typing", which it is, but the practical version of that is the address being on something they already have — worth a line in the invitation's plain-text part beyond the footer link.

---

## WP16 — Service modes and closing the round — done. WP15 deferred, with the reason.

**§7 was already in place** and this package verified it rather than rebuilding it: the four modes, the investor behaviour in each, the admin side staying full in every mode but `disabled`, sending requiring `active`, and the export precondition on moving to `disabled` with its logged owner override. Thirty-five database checks include every mode against an active investor.

**§6.6 is new.** The whole section turns on its last three sentences: *"If David does nothing, nothing happens. The round stays open and he is reminded again on a configurable cadence. **Silence never closes anyone's opportunity.**"*

So there is no scheduled job that closes anything, nothing that closes on a date, and exactly one function anywhere that writes `rounds.closed_at`. It takes `confirmed: true` and refuses without it — and there is a source test asserting the count of writes is one, that the parameter exists, and that no function in the module is named anything like `autoClose`, `closeIfDue` or `expireRound`.

What a passed deadline does is send the operator an email saying it is his call. It goes to his own address, taken from the allowlist and never from a parameter, and no investor is copied — the email says so in its own footer. It names the three options §6.6 lists and the fourth: *"If you do nothing, the round stays open."*

**Verified against the real database.** Thirty-five checks in `scripts/verify-rounds.ts`, with one recipient past their deadline, one still with time, and one who has answered: a passed deadline leaves the round open, the offer untouched and the investor able to respond; a deadline can be extended but never brought forward and never into the past; the original deadline survives so "who asked for more time" stays answerable; a global extension moves the non-responders and leaves the person who already answered alone; closing without the confirmation and closing early without acknowledging it both refuse *and leave the round open*; and a closed round refuses a second close, an extension and a digest.

**Decisions:**

- *Closing and reopening are owner-only; extending is the operator's.* §6.6 says "David decides" about *when*, and giving somebody more time is process. Closing marks unfilled allocations available and unlocks §21, which is a decision about the raise. Where the spec is silent on who, the conservative reading wins.
- *Reopening exists, and needs a reason.* §6.6 does not mention it. A mis-click at the end of a raise being permanent is a worse state than a reopen with a recorded reason.
- *Closing while somebody still has time needs a second, separate acknowledgement* naming how many people it affects. He is allowed to do it — they may all have answered — but not by accident.
- *A global extension moves only the non-responders.* Somebody who has answered does not need more time, and moving their deadline would make their portal disagree with the email they were sent.
- *A deadline can only be extended from this screen, never brought forward.* That would take away time an investor has already been told they have.
- *`original_deadline` is written once and never overwritten.* It is the entire basis of "who asked for more time"; an extension that overwrote it would leave nothing to compare against.
- *The digest is due whenever a deadline has been reached and the cadence has elapsed — not only on the day itself.* A scheduler that misses a day must not mean the email never arrives and the operator waits for something that is not coming.
- *The digest rides along with the reminder job*, because that is the only scheduled thing in the system. It sends and closes nothing, and a source test asserts the module contains neither `closedAt:` nor `closeRound`.
- *Extending emails nobody.* Telling an investor their deadline moved is an update or a reminder, written deliberately. The screen says so.
- *Closing emails nobody either*, and the confirmation says so.
- *The digest states USD explicitly.* The columns are named `*_usd` and `formatMoney` produces a bare grouped figure; a total in an email with no currency beside it is a figure waiting to be misread.

**WP15 — media and video — is deferred, and this is the reason.** §13.2 and §13.3 need somewhere to put a file: uploaded images, EXIF stripped and served from the app's own domain, and recorded video served only to authenticated investors. This deployment has no blob store, and the two ways to fake one are both worse than waiting — base64 in Postgres puts multi-megabyte video in the row that every portal read touches, and a writable disk does not survive a serverless invocation. WP13's certificate avoided the problem by being regenerable from eight fields; a photograph is not. **What it needs is a decision about storage** — the natural fits alongside Netlify are Netlify Blobs, S3 or R2 — and then it is a straightforward package. Nothing else depends on it: the portal, the emails and the certificate all work without a single uploaded file.

**Checklist:** points 1, 2 and 5 are this package's.

1. No monetary value is a JavaScript number. The four totals are summed with `sumDecimals` and formatted at the edge; a source test asserts `parseFloat`, `.toNumber(` and bare `Number(` appear nowhere in `lib/rounds`.
2. No send path bypasses anything. The digest goes through `sendOneEmail` and was refused in verification with the gate's own message, and a source test asserts no module here constructs a transport.
5. No investor-facing response reveals another investor. The digest is the one message in this package and it goes to the operator alone — it is not investor-facing at all, and its footer says so. Nothing about a deadline or a closure reaches an investor unless somebody writes an update.

**Uncertain:**

- Seven days between digests is my number; §6.6 says "configurable cadence" and it is currently a constant rather than a setting. One field on the settings page would fix that, and I would rather it were chosen than defaulted.
- Closing "marks unfilled allocations as available" in §6.6. What that unlocks is §21, which is not built, so today closing stops responses and records itself and nothing more. That is honest but incomplete, and the register of interest (WP10) is where an available allocation would go.

---

## WP17 — Export and audit — done

The two formatting modules were built early in a parallel session and are good: CSV with a byte-order mark so Excel opens it as UTF-8, XLSX through the workbook writer, spreadsheet-injection neutralisation on every cell, and an audit formatter whose schema requires the literal `requestedByRole: 'OWNER'`. **Nothing fed them.** There was no query producing a row and no screen to press.

**Built:** `lib/export/data.ts`, which is the only part of the export path that touches the database; download routes for both exports; and the owner's audit-log viewer with the filters §20 asks for — actor, entity, action, and a date range.

The three history arrays come from the append-only event tables rather than from the current columns, so the export carries **what happened** rather than only where things ended up. A correction in an offer's timeline appears with its reason.

**`last_export_at` is written in one place, after the bytes exist.** §7 makes moving to `disabled` conditional on a completed export in the preceding seven days, and an export that threw halfway is not a completed export. Verified: running one stamps the column the §7 gate reads.

**Verified against the real database.** Twenty-nine checks in `scripts/verify-export.ts`: all four amounts present, distinct and exact — `5000.00`, `4800.00`, `4750.00`, `4750.00`, still strings, still unrounded after a round trip through a real XLSX workbook parsed back out; the timeline history carrying both events including the correction's reason; a cell beginning with `=` neutralised rather than left as a live formula; the audit formatter refusing a non-owner request outright; and no metadata key anywhere in two thousand audit entries matching a credential or a body.

**Decisions:**

- *The recipient export is available to both roles; the audit export is the owner's.* §20 makes only the audit export owner-only, and the recipient data is the same information the review screen already shows the operator. Making him ask for a copy of what is on his own screen would be theatre.
- *The audit export has two locks on the same door.* `requireOwner()` on the route, and the formatter's schema requiring the literal `'OWNER'`. Either alone would do; both together mean a future route that forgets the guard still fails.
- *Only the recipient export stamps `last_export_at`.* §7's precondition is about investor data being safe before the service is disabled. An audit export is a different document and should not satisfy that gate.
- *A missing jurisdiction exports as `ZZ`* — the ISO user-assigned code — rather than blank or absent. A recipient row is required for the compliance gate, so a missing one is a data problem the export should make visible, and `ZZ` reads as clearly wrong in a spreadsheet where an empty cell reads as nothing at all.
- *The viewer shows the most recent 200 entries and says so.* An unbounded page over an append-only log gets slower every week and nobody notices until it stops loading.
- *`updated_contact_email` exports as null.* §20 lists it; §4 does not build the change-of-address flow, and `email_change_requests` exists but nothing writes it. Exporting a column that is always empty is honest; inventing a value would not be.

**Deviations:** none. No migration.

**Checklist:** points 1, 4, 5 and 8 are this package's.

1. No monetary value is a JavaScript number. The export schema's `exactDecimal` rejects anything but a plain decimal string, the data layer passes the driver's strings through untouched, and the verification parses a real XLSX back out and asserts `5000.00` is still `5000.00`.
4. The operator cannot record, amend or void a compliance approval, and nothing in this package changes that — the audit viewer is read-only and the export path has no write except `last_export_at` and the audit entry recording itself.
5. No investor-facing response reveals another investor. Neither export is investor-facing; both are behind an admin guard and both carry `X-Robots-Tag: noindex`.
8. No log line carries a token, a body or a key. The export's own audit entry records a kind, a format, a row count and a byte count — verified to contain no address. A scan of every audit entry in the database found no key matching `password`, `secret`, `token`, `apiKey`, `credential`, `htmlBody`, `textBody` or `body`, which is what `assertNoSecrets` has been enforcing at write time all along.

**Uncertain:**

- The audit viewer filters on exact values from dropdowns built from the distinct values present. That is precise and cannot be mistyped, but there is no free-text search across metadata — looking for one offer id means exporting and using a spreadsheet. Fine for now; worth knowing.
- `loadRecipientExportRows` runs several queries per recipient. At forty recipients that is fine. At four hundred it would want a rewrite, and the shape of the fix is joins rather than loops.

---


Not a work package. Two defects found while a second session was building WP12 to WP14 in parallel; that session's implementation of all three is the one on `main` and this is additive to it.

**The gate could pass on one document while a different one was sent.** `checkTemplateDrift` hashes `loadCurrentTemplate(kind)`, which prefers a stored `email_templates` row over the shipped default. `sendInvitation` rendered `templateSource(kind)`, which only ever returns the shipped default. Nothing writes a stored row today, so the two agreed and every test passed — but the moment one existed the owner would have approved one wording and a different wording would have gone out, with the compliance state reporting green the whole time. That is checklist point 2, and it is the exact failure §8.2 exists to prevent.

Both sides now load the template the same way, and that is no longer the only thing holding it shut: `assertApprovedSource` compares the hash of what was actually rendered against `approval.approved_template_hash` in the second before the snapshot is written, and a mismatch throws. It refuses rather than warns, and the message names both hashes and says nothing was sent. `approved-source.test.ts` asserts the loaders match, asserts the comparison sits between the render and the send rather than after it, and would fail if `templateSource` reappeared in the sending path.

**§6.5's "no offer terms" was tested but not enforced.** WP4 tests that the built-in reminder carries no amount or percentage, which is a test of a constant. Once the send loads the current template rather than the built-in one, an edited reminder can carry a figure and nothing would stop it — in the one email nobody watches go out. `lib/reminders/no-offer-terms.ts` now runs against whatever is about to be sent, and only for `REMINDER`, because the invitation carries the figures on purpose.

It checks two ways, because either alone is insufficient. **Structurally**, which variables the source references: a template mentioning `{{investment_amount}}` carries an amount whatever the value is for one recipient, and the forbidden list is §6.5's three figures plus `use_of_funds` and `personal_line`, both free text the operator writes and either capable of carrying a figure. **Literally**, what the finished text says: a hard-coded "USD 5,000" references no variable at all and the structural check would wave it through. The literal patterns are narrow enough not to fire on the one number a reminder is meant to contain — a deadline renders as "10 March 2026", with no symbol, separator or decimal point — and the HTML is scanned with markup removed so `width:100%` in a table attribute is not read as a percentage. The invitation template is the control: a test renders it, runs it through the gate and asserts it fails, because a check that nothing fails is a check that measures nothing.

**Checklist:** points 2 and 12 are this change's. No send path can now reach the transport with a template the recorded approval does not cover, and a reminder that carries a figure is refused with a message naming the offending variable or pattern. 978 tests, typecheck, lint and a production build all clean; the reminder, updates and register database verifications all still pass.

**Uncertain:** nothing writes an `email_templates` row yet, so the first fix is closing a gap ahead of the surface that would open it rather than fixing live breakage. Whoever builds template editing should read `approved-source.test.ts` first — it is the statement of what that surface must not break.

---

## Hardening — suspension was unreachable, and the sign-in form leaked by timing

Not a work package. Two live defects found by auditing the twelve-point checklist across the whole codebase rather than package by package, which is how both survived: neither breaks a test, and both sit in code that reads as finished.

### Nobody could suspend an account

`changeAccountStatus` has existed since WP8 and is correct — it writes the status, revokes every session and every unspent link **in the same function** so a caller cannot do one and forget the other, writes the `AccountStatusEvent` with actor, reason and whether the investor was told, and refuses an operator who tries to archive. **It had no callers.** Not an action, not a route, not a script, not a test. `revokeAllPortalAccess` had none either.

So §4.2's *"Suspension and closure take effect immediately — active sessions are terminated, outstanding links are revoked"* was a true statement about unreachable code, and checklist point 7 could not be exercised. TEST_ME told the reader to suspend an investor and watch their session die on the next click; there was no way to do it. If an investor's mailbox were compromised tomorrow, their thirty-day session and their unspent fourteen-day claim link would both stay live and nothing in the application could stop them.

**Built:** `/investors` — every account with its status, its offer count, whether the mailbox is verified, when they last signed in, and the full status history with each reason and who recorded it. Each row shows **how many live sessions and unspent links the person holds right now**, because §4.2's sentence is worth seeing before the decision rather than after it. The change form asks for the destination, a reason of at least ten characters, whether the investor has been told, and the word `SUSPEND`, `CLOSE` or `ARCHIVE` typed out — a click on the wrong row looks exactly like a click on the right one, and typing the word does not.

**The action adds no rule of its own.** Every refusal comes back from `changeAccountStatus`, including the owner-only check on archiving, so a second caller cannot get a different answer from this one. Re-checking the role in the action would create two places that have to agree, which is one place that eventually will not.

**Verified against the real database, with a second investor present throughout.** Thirty checks in `scripts/verify-lifecycle.ts`: a suspension with no reason is refused *and changes nothing*; an operator cannot archive; two live sessions and two unspent links all die at once; the other investor's two and two are untouched; a suspended account cannot claim, cannot be issued a link, and asking for one produces nothing while an unaffected investor still gets theirs; the status event carries the reason, the actor and the notified flag; restoring is possible but does not un-revoke anything; and a closed account on the default `read_only` can still sign back in.

### The public sign-in form told you who was on the recipient list

`requestSignInLink` returns one sentence for every address — §4.1 requires that, and it did it. The **work** was not the same, which is the same leak wearing a different hat:

| address | queries |
| --- | --- |
| unknown | one SELECT |
| known but suspended | one SELECT, one audit INSERT |
| known and eligible | one SELECT, one UPDATE, two INSERTs |

The portal sign-in form is public, unauthenticated and unthrottled, so an attacker can sample it as often as they like. Three distinct latency bands, keyed exactly on account existence and eligibility, identify anybody holding a private securities invitation — which is precisely what §15 exists to protect, and the identical sentence does nothing to hide it. The module's own header claimed *"the same response and the same delay"*.

The admin path has done this correctly since WP2: it always verifies a hash, real or dummy, and sleeps to a floor. Every exit from `requestSignInLink` is now padded to `SIGN_IN_LINK_FLOOR_MS`, measured from before the first query.

**Padding to a floor rather than equalising the work is deliberate.** Equal work has to be re-established every time somebody adds a query, and nothing fails when they forget. A floor keeps holding. The tests are structural rather than statistical for the same reason a security property should not be a flaky test: they assert that every return settles, that the padding is built before the first query rather than after it, and that the action still has exactly one return carrying one sentence.

**Checklist:** points 5 and 7 are this change's.

5. No investor-facing response reveals another investor. The response body was already identical; the timing is now too. Verified that the operator's account list — which does load every investor, because it is an admin surface — carries no token hash.
7. Suspension revokes existing sessions **and** refuses new links. Both halves, in one function, now reachable from a screen, and verified against a real database with two investors.

**Uncertain:**

- The floor is 150ms. It has to exceed the slowest legitimate path or it achieves nothing for the case that matters most; four round trips to a same-region Postgres fits inside it comfortably, but a database on the far side of an ocean would not. Worth re-measuring once the production database is real.
- There is still no rate limit on the portal sign-in form. The admin form has progressive throttling by address and by IP; the investor form has none. With the timing closed there is nothing obvious left to learn from sampling it, but a bare public form that mints tokens deserves the same treatment, and that is a small package rather than a line.
- Two related gaps found in the same audit and **not** fixed here, because both are known and documented rather than accidental: the sign-in link is minted and never emailed, so a returning investor is told a link is on its way and receives nothing; and re-sending an invitation leaves the previous claim token live, where the sign-in path revokes the old one first. The first is the larger of the two — it locks out every investor whose session lapses — and it is a small, self-contained package.

---

## Hardening — the sign-in link is now actually sent

Not a work package. The third defect from the same audit, and the one an investor would hit first.

`requestSignInLink` has minted a token, hashed it and stored it since WP8. Nothing sent it. So the portal told every returning investor *"If that address has a record with us, a sign-in link is on its way"*, wrote a row that expired unused forty-five minutes later, and sent nothing. **Anybody whose session lapsed was locked out by a sentence that was not true**, with no way back in short of the operator issuing a fresh invitation.

**Built:** `lib/portal/sign-in-email.ts`, the message, and `lib/portal/send-sign-in-link.ts`, the one function that delivers it.

**It is not compliance-gated, and that is a decision rather than an omission.** §8.2's approval covers the invitation and the reminder — the two emails that communicate an offer of securities. This one says somebody asked to sign in and here is the door. It is the same category as the update notification (§6) and the Q&A reply (§6.7.6). Registering it would mean one word changed in an operational email voids the approval that lets invitations go out, which is not a stricter reading of §8.2 but a broken one. A test asserts the module hashes no template and names no template kind.

**Decisions:**

- *It carries the link and nothing else.* `buildSignInEmail` takes two links and a duration, and has no parameter for a name, an amount, a percentage, a deadline or the round. Two reasons, and the second is the one that decided it: a sign-in email lands in a mailbox that may be the very reason the person is signing in again, and it is the message an attacker would most like to trigger for somebody else's address. Neither is a good place for the terms of a private placement. A test asserts the arity, that the visible text carries no digit outside the link and the stated expiry, and that the words "allocation", "deadline", "invitation" and "SPV" appear nowhere once the links are stripped.
- *The lead says "Somebody asked", not "You asked".* An unrequested sign-in email is exactly what an attempt on somebody's account looks like from the inside, and the recipient is the only person positioned to notice. "You asked for this" would be a false statement in precisely the case that matters. It is followed by a plain line saying that ignoring it is safe and the link expires on its own — more use to them than any warning the application could raise on its own.
- *The address is never a parameter.* `deliverSignInLink` takes an account id and looks the address up. This is the one email an unauthenticated stranger can cause to be sent, and the only thing between that and an open relay is that the recipient cannot come from the request. A test asserts there is no `email: string` in the module's signatures and no `to: input.…` anywhere in it.
- *Delivery runs in `after()`, once the response has gone.* This is load-bearing rather than a performance nicety. The previous commit padded every path through `requestSignInLink` to a fixed floor so a known address cannot be told from an unknown one by timing; awaiting an SMTP round trip in the action would have undone all of it, because the issued path would take seconds and the other two would not. That is a far louder signal than the one just closed. The sentence goes back immediately and identically; the email follows. A test asserts `deliverSignInLink` appears nowhere in the action body before the `after` callback.
- *A failure is silent to the investor and loud in the audit log.* They have already been told the one sentence §4.1 requires, and telling them the send failed would confirm the address exists — which is the whole thing the identical sentence exists to hide. `portal.sign_in_link_delivered` and `portal.sign_in_link_not_delivered` record which it was, with the failure class and the attempt count and never the address, the token or the body.

**Checklist:** points 2, 5, 6 and 8 are this change's.

2. No send path bypasses anything. It goes through `sendOneEmail`, whose gate covers the credential (§8.1), the service mode (§7) and the deployment (§18.1); a test asserts the module constructs no transport and imports no mail library. It is deliberately outside the compliance approval, for the reason above.
5. No investor-facing response reveals another investor. The action still has exactly one return carrying one sentence, asserted by a test, and the delivery outcome cannot reach it.
6. The token is single-use, hashed at rest and expiring — unchanged from WP8. It now travels in exactly one place, the email, and a test asserts it reaches no audit metadata.
8. No log line carries a token, an address or a body. Asserted against every `metadata:` block in the module.

**Uncertain:**

- Forty-five minutes is WP8's number and it is short for an email. It is right for a link that is one click from being reissued, but somebody who asks from a phone and opens it on a laptop an hour later gets a dead link and has to ask again. Worth a look once real people are using it.
- `after()` runs the send on the same invocation once the response has flushed. On Netlify that is supported, but it is not a queue: if the function is killed between the response and the send, the link is minted and never delivered and the investor is told it is on its way. The audit log shows nothing at all in that case, which is the one failure mode here that is silent in both directions. A retry surface — the operator seeing "asked for a link, never delivered" — would close it, and that is a small package rather than a line.

---

## WP18 — Branding, mobile, accessibility — done

Four things were asked for: the §13.2 palette applied consistently, every screen correct at 375px before desktop, WCAG AA contrast with `--dim` on `--bg` specifically named, and keyboard navigation and focus states throughout. Plus the page curl as a restrained brand mark.

**The palette was not applied consistently, and `brand.ts` was dead code.** Nothing imported it. The palette was applied by copying hex strings: six hundred and forty-two literals across forty-four screen files, nineteen of them colours that appear nowhere in §13.2's table. That is not a style problem — it is why two accessibility failures had been sitting in plain sight since WP2, because nobody diffs six hundred hex strings.

Every one is now a named token. `brand.ts` is the single definition, `globals.css` declares the same names for Tailwind, and `palette.test.ts` fails the build on a hex literal anywhere under `src/app` or `src/components`, on a token in one file that disagrees with the other, and on any of the three retired colours reappearing.

**Two of those undeclared colours were below AA, and one of them was on the investor's own portal.**

- `#6c7290` was the labels on the four figures an investor is invited to read — *Investment amount*, *Your share of the SPV*, *Indirect Flipit interest*, *Response deadline* — at **4.16:1 on `bg` and 3.75:1 on `paper`**, against AA's 4.5. It was in nineteen files. It is now `--muted`, `#7f849f`, 4.81:1 at its worst.
- `#2a2d52` was the border on the timeline's "ahead" step markers at **1.35:1 against `paper`** — a state-carrying graphical object, which 1.4.11 wants at 3:1. It is now `--edge`, `#616585`, 3.13:1 at its worst.

The pairing §13.2 actually names, `--dim` on `--bg`, was fine all along at 6.95:1. `brand.contrast.test.ts` now computes all fifty pairings rather than the one, and pins the arithmetic against WCAG's own worked examples — black on white is exactly 21, `#767676` on white passes 4.5 and `#777777` does not.

**Seven controls suppressed the focus ring**, `focus:outline-none` beside `focus:border-orange`, leaving a colour-only focus indicator — 1.4.1 and 2.4.7. Two of the seven were on the investor's portal: the box they type their response into, and the box they ask a question in. **Twelve links and five form controls were below 44px**, including the investor's certificate download and the portal's own sign-out button at 20px. All gone.

**A skip link** now precedes the navigation, every `<main>` carries the landmark it targets, the admin shell has `<header>` and `<main>` rather than two divs, the document declares a viewport at device width — it did not, so a phone would have rendered at 980px and scaled down — and `prefers-reduced-motion` is honoured.

**§13.1's standing line was missing.** *"A standing line beneath the tiles: **Features shown are in development, are indicative only, and form no part of the investment being offered.**"* The tiles were built; the line was not. §13.1 calls that section "the easiest place in the build to say something unintended", so this is the omission in this package that matters most. It is now a constant in a module with no database import, rendered beneath the tiles, with no prop and no column that could remove it.

**Verified in a real browser, at 375px, on twenty screens.** `scripts/verify-viewport.ts` (`pnpm verify:viewport`) builds the app, starts it, seeds an investor with an offer, claims a real portal link, signs the owner in through the real form, and then measures: no document-level horizontal scroll, nothing outside the 375px box, every non-inline interactive element at least 44px, and — the check that catches what source-reading cannot — **the WCAG ratio of every string the browser actually painted, against the background it was actually painted on**. Ninety-nine checks, all passing. It found the 20px sign-out button, the 36px file input, the 40px audit-log selects and the 42px date fields; none of those are visible in a class list.

**Decisions:**

- *The email templates and the participation certificate keep their own palette, deliberately.* §11.5 asks the invitation for a light body — "dark header carrying the logo, light readable body" — so it is a different palette by design rather than by drift. More to the point, §8.2 hashes the template, and a recorded approval covers a specific hash. Restyling an approved instrument would invalidate an approval nobody asked to invalidate. `palette.test.ts` asserts the exclusion so it reads as a decision rather than as files somebody missed.
- *`--muted` is a new token rather than a brighter `--dim`.* Raising the failing colour to `--dim` would have fixed the contrast and flattened the type hierarchy on the portal — the label and the figure would have carried the same weight. `--muted` is the dimmest value that clears 4.5:1 on every surface with headroom, and a test asserts it stays visibly below `--dim`.
- *44px, not 24px.* WCAG 2.5.8 asks for 24 and 2.5.5 for 44. §13.2's "excellent at 375px" is a phone in one hand, so this build takes the larger figure.
- *Inline links in prose are exempt from the target-size rule.* 2.5.5 exempts a target "in a sentence or [whose] size is otherwise constrained by the line-height of non-target text", and padding a word until it breaks its own line is not an improvement. The exemption is `display: inline`, so a link styled as a button is still measured.
- *A deliberate horizontal scroller is not an overflow.* The admin navigation is a tab strip wider than the screen that scrolls within its own box, which is a normal phone pattern. The verification exempts anything inside an `overflow-x: auto` ancestor — but only for the per-element check. The document's own `scrollWidth` is measured separately and is not exempt, because that is the one that hides a figure off the edge of a page about somebody's money.
- *The maker's credit has two switches and no third.* §13.2 wants it configurable per surface, and rules out the invitation and the certificate in a sentence with no discretion in it. So there are columns for the two surfaces §13.2 allows and no column that could put it on either instrument. A test asserts the column list is exactly those three, so a fourth has to be argued for.
- *The credit's optional link is permit-listed to http and https.* It is owner-entered text that reaches an anchor on a page an investor is reading. `javascript:`, `data:` and a bare hostname are dropped rather than rendered.
- *The audit entry for the credit records whether a link was set, not the link.* It is not a secret and recording it would be defensible; a boolean is the smaller thing to record and answers the question the log is asked.
- *The footer left the root layout.* It reads service configuration, and a database read in the root layout makes every static page dynamic — including `/verify`, which WP14 wants cheap and reachable when somebody is checking whether an email is genuine. The admin shell and the investor portal render their own, and a test asserts those are the only two places.
- *A roadmap tile whose label breaks §13.1 is not rendered.* Names only, no dates, nothing that reads as return, valuation, liquidity or a timeline. Nothing writes these today except the seed, so nothing can currently be dropped without somebody noticing; when a tile-editing surface is built it must refuse at write time and name the offending word, and `forbiddenWordsInTileLabel` is what it should call.
- *The page curl does not move, structurally.* §13.2: "Do not animate it aggressively; this is an investment document, not the product demo." There is no transform, no transition and no keyframe in the component, and a test asserts it. It is `aria-hidden` and `focusable="false"`, so it never lands between an investor and the button they are reaching for.

**Twenty grids could not shrink, and one of them had already broken.** A Tailwind `grid` with no `grid-cols-*` gets a single implicit column sized to `max-content` — as wide as its widest child wants to be. The audit log's filter form was one, and it was fine until the log contained a longer action name, at which point a `<select>` sized to its longest option pushed the document to 404px and the owner's screen scrolled sideways at 375px. `sm:grid-cols-2` does not help: below the breakpoint — which is where §13.2 says to look first — it does nothing. Every grid now declares `grid-cols-1`, whose `minmax(0, 1fr)` is what lets a child shrink, and a test fails on a `grid` class without an unprefixed column count.

**Deviations:** one migration, `0005`, adding three columns to `service_config` for the credit. No other schema change.

**Merged with a parallel session** that built the Investors screen, the sign-in link send and the suspension controls. Its two new screens carried hex literals and a 36px control; both were tokenised and raised, and its screens are in the 375px verification — which is the argument for the palette test being a test rather than a convention. One hundred and four checks now pass across twenty-one screens.

**Two things fixed in passing, both outside this package's scope:**

- `scripts/verify-export.ts` was failing on its own secret scan. The check ran a regex over the serialised JSON, which matches a *value* as readily as a key — and a sign-in legitimately records `{ method: 'password' }`, the authentication method, which is exactly the sort of thing an audit log exists to record. `assertNoSecrets` has always checked keys, correctly. The scan now does too. A false alarm on a real check is how the check ends up switched off.
- The viewport verification could not reach the portal until `APP_URL` was set to the origin the test server actually listens on. That is §18.1 working as designed — every portal link embeds `APP_URL` — but it presented as the server appearing to crash, and the note is in the script so the next person does not spend the same half hour on it.

**Checklist:** points 5, 8 and 9 are this package's; 1, 2 and 12 were re-checked because this package touched forty-four files.

1. No monetary value is a JavaScript number. This package added three modules that use numbers — contrast ratios, pixel widths and font sizes — and no money passes through any of them. `lib/money.ts`, `lib/sending`, `lib/compliance` and `lib/email` are untouched by this diff.
2. No send path bypasses anything. Nothing under `lib/sending` or `lib/compliance` is modified. The one new server action writes three columns on `service_config` and sends nothing.
5. No investor-facing response reveals another investor. The footer reads the `service_config` singleton — one row, no investor data, no count of anything. The credit is the same text for everybody. The roadmap tiles were already global rather than per-investor and remain so.
8. No log line carries a token, a body or a key. The one new audit entry records two booleans and a third saying whether a link exists. Verified against the real database: no metadata key in two thousand entries matches a credential or a body, now checked as a key rather than as a substring of a value.
9. The verification page is still the only indexable route. Nothing in this package touches `robots.ts`, `sitemap.ts` or a route's metadata; WP14's tests still pass.
12. The app still refuses to send when its base URL is not the production value. Unchanged — and demonstrated in passing: the verification server runs with `APP_URL` set to `127.0.0.1`, where sending is refused, which is why the script can drive the whole application without any risk of an email leaving it.

**Uncertain:**

- The 375px verification is a script, not part of `pnpm check`. It needs a build, a database and a browser, which is thirty seconds rather than one, and putting it in the gate would make every commit depend on a Chromium download. It should run before a release, and `pnpm verify:viewport` is the command. Whoever sets up CI should decide where it belongs.
- `--muted` at 4.81:1 clears AA and does not clear AAA's 7:1. §13.2 asks for AA. If the intent was ever AAA, the whole dark palette needs revisiting rather than one token.
- The palette is still "lifted from the demo file, which is a faithful copy but not the source of truth" — §13.2's own words. Nothing here verified it against flipit.com, and the note in `brand.ts` still says to.
- `forbiddenWordsInTileLabel` is a gate ahead of a surface that does not exist yet, the same shape as WP17's follow-up. The word list is mine, from §13.1's prose; somebody should read it before tiles become editable.

---

## WP19 — Tests — done

The suite was already large — 1,122 tests before this package. What did not exist was the thing WP19 actually asks for: *"every one of the 48 acceptance criteria in spec §22 mapped to a test or an explicit note explaining why it is manual"*, and *"a table maps each of the 48 criteria to its test."*

**A coverage table nobody verifies is a document that reassures and decays.** So the table is source — `src/lib/acceptance.ts` — and `acceptance.test.ts` checks four things about it:

1. **It reads §22 out of BUILD_SPEC.md and asserts every criterion is quoted word for word.** Without this the easiest way to make a criterion pass is to reword the criterion. Forty-eight separate assertions, one per criterion, so a failure names which sentence drifted.
2. Every cited file exists.
3. **Every citation resolves to a real test label in that file** — not to a substring of the file. This is the assertion that makes the rest mean anything, and the first draft failed it fifty-two times.
4. Every criterion is either covered or carries a written note of at least eighty characters, so "manual" is never an answer by itself.

`ACCEPTANCE.md` is generated from the same source by `pnpm acceptance`, and a test fails if it goes stale.

**The first draft of the table passed with fifty-two citations that proved nothing.** They were single words — `hash`, `audit`, `mode`, `position`, `credential` — matched as substrings against the whole file. Every one resolved. A length threshold was the obvious fix and the wrong one: it rejected `no count appears`, which is a real check with a short name, while `production` at ten characters would have squeaked past on a different day. The right fix was structural — extract every string a `describe`, `it` or `check` is labelled with, and require the citation to *equal* one of them. Template-literal labels are the single concession, matched as a substring because part of the text is a variable.

**Two gaps in coverage, found by doing this rather than by reading:**

- **The claim token had no test of single use or expiry**, which WP19 names in its own minimum list. `claimPortalToken` is careful — single use is a conditional `UPDATE` rather than a read-then-write, precisely so two simultaneous redemptions cannot both succeed — and none of that was exercised anywhere. It could not be: the property belongs to the database, not to the code. `verify-lifecycle.ts` now redeems a live link, redeems it again, **fires two redemptions at once and asserts exactly one succeeds**, and refuses an expired one, a revoked one and one nobody issued. Twelve checks, and one of them confirms no token is stored in the clear.
- **AC12's note was wrong.** I wrote that the two-step confirmation on funds received had no automated check. `verify-certificate.ts` has had three all along — *"without the confirmation tick, nothing is recorded"*, *"a mismatched re-typed amount records nothing"*, and *"and truly nothing was written"*. The note came off. A map is as capable of understating coverage as overstating it, and the understatement is the one that gets work done twice.

**AC43 gained a check it should always have had.** §15.1's whole point is that somebody who has thrown the email away can type the address into a browser. The viewport verification now asserts the verification page renders with an empty cookie jar — no session, nothing — which is the property, rather than inferring it from the route not having a guard.

**Where the forty-eight stand: 46 have at least one automated check; 2 have none; 4 carry a note.**

The two with none are AC32 and AC33 — the image library and the personal video — both waiting on WP15's storage decision. The four notes are those two, plus:

- **AC30** — the wording constraint on the roadmap tiles is enforced and the standing line cannot be removed, but *"configurable by the owner"* is not built. There is no screen to add, rename or hide a tile.
- **AC34** — the test send exists and is locked to the operator's own address, which is the half that protects a real recipient. The half that is a nudge — §13.3's prompt in the flow — is not built, and *"including his video"* waits on AC33.

**Decisions:**

- *The table is TypeScript, not markdown.* A markdown table cannot be type-checked, cannot be iterated over by a test, and cannot fail. The markdown is generated from it.
- *Three kinds of check, named separately.* A `unit` test runs in `pnpm test`; a `database` check needs real Postgres and exists because some of §22 is only true once there are rows — "in no one else's" is meaningless with one investor; a `browser` check renders the real page, and AC31 is not answerable any other way. The distinction matters when somebody asks what `pnpm test` passing actually proves.
- *A separate assertion that WP19's own minimum list is covered by a **unit** test.* Eleven criteria where a database script is not enough, because those are the rules that must hold before a row exists — decimal precision, the compliance gate, the owner-only restriction, the base-URL guard and the rest. Named in the test with why.
- *Citations match a label, not the file.* Explained above; it is the whole difference between this table and a plausible one.
- *A `manual` note has a minimum length.* Eighty characters. Arbitrary, and it is the only rule here that is — but a note that reads "manual" or "not built" is not a reason, and the shortest honest one in this file is four lines.

**Deviations:** none. No migration, no schema change.

**Checklist:** this package added tests and one verification section, and changed no behaviour. Points 5, 6 and 8 are the ones it touched.

5. No investor-facing response reveals another investor. The claim verification asserts every refusal — used, expired, revoked, invented — shows the investor the same single sentence, which is §15's requirement stated as a test rather than as a comment.
6. Claim and sign-in tokens are single-use, hashed at rest and expiring. This is the point of the new section, and it is now demonstrated against a real database rather than described in a header comment.
8. No log line carries a token, a body or a key. The new checks assert that what is stored is the hash and never the token, and nothing in this package logs.

**Uncertain:**

- The label extraction is a regular expression over source. It handles `it('…')`, `describe("…")` and `check(\`…\`)` including the multi-line form, and it would miss a label built by concatenation. None exist today; if one appears, the citation will fail and read as a missing test, which is the safe direction but a confusing message.
- AC30 and AC34 are each half-built, and the table says so in prose. There is no machine-readable notion of "partly covered", so somebody reading only the counts will see 46 of 48 and be slightly too cheerful. The notes are where the truth is.

---

## WP20 — Deployment — done, with one part that cannot be done from here

**Two live defects, both found by serving the application and asking it, and both invisible to every test in the suite.**

**The anti-phishing page was `noindex`.** WP14 exempted `/verify` from the blanket `X-Robots-Tag: noindex` in `next.config.ts`, and its test asserted the exemption was in the returned array. It was. The served response carried `noindex` anyway, because **Next.js applies every matching `headers()` entry in order and a later one overwrites an earlier one for the same key** — so the `/:path*` catch-all won. §15.1's whole purpose is a page somebody can find when they are wondering whether an email is real, and AC43 says in as many words that it "is the only indexed route". It was the only route that was *not* indexed, at the domain root and under the prefix alike, and had been since WP14. The catch-all now excludes the public routes by negative lookahead. The landing page needed its own entry alongside, because a path-to-regexp group will not match an empty segment and `/` fell straight through into no policy at all — which the first run of the new verification caught within a minute of the first fix.

**`robots.txt` named the wrong paths under the prefix.** A path in robots.txt is relative to the *domain root*, never to the application. Served from `mikehelm.com/SPV`, `Disallow: /` asks a crawler to stay away from the whole of mikehelm.com — somebody else's site — and `Allow: /verify` names a path that does not exist. Next.js applies `basePath` to the sitemap URL because it is absolute and does not apply it to the rule strings. Now it does.

There is a larger point in that, and it is in the runbook: **under a path prefix, `robots.txt` is not served from the domain root at all, so no crawler will ever read it.** On the testing deployment the `X-Robots-Tag` header is the only layer keeping the application out of an index — which is exactly the layer that was broken.

**`pnpm verify:deployment` is the new thing.** It builds with `BASE_PATH=/SPV`, serves it, and asks a running server forty-one questions: that every route answers under the prefix and 404s without it; that every `href` and `src` in the delivered HTML carries the prefix; that the session cookie is scoped to the prefix rather than offered to the whole domain; that `X-Robots-Tag` is right on both sides of the public/private line; that the crawler files name prefixed paths; that **a real claim link redeems end to end and the portal renders the investor's own figures**; and that a real invitation is refused off the production deployment while a test send to the operator is not. It rebuilds without the prefix afterwards, so it leaves the tree as it found it.

**Backup and restore, with the restore actually performed.** `pnpm backup` writes a custom-format dump; `pnpm backup restore` reads `RESTORE_DATABASE_URL` and refuses if it is `DATABASE_URL` or unset. `pnpm verify:restore` does the whole round trip against a scratch database and then **reads the figures back out** — `4750.50` still `4750.50` with its trailing zero, six decimal places still six, a non-ASCII name intact, the audit log the same length, and the tables, indexes and unique constraints all present. A restore that dropped the unique index on an investor's address passes every row count and fails on the first duplicate.

**A privacy policy at `/privacy`.** §18: *"A real domain is needed before Gmail verification can start, because the privacy policy has to be hosted on it."* Public, indexable, reads no database, and a test asserts it imports nothing that could hand it an investor record. It is the second of exactly two indexable routes and the test that used to say "exactly one" now says "exactly two" and names both.

**`DEPLOYMENT.md`** is the runbook: environment table for both phases, DNS, the data move, what to re-enter and why, the post-migration checks, taking the old deployment down, backup cadence, and a table of the refusals somebody will meet at speed with what each one means.

**Decisions:**

- *There is no Google OAuth callback to update, and the runbook says so rather than leaving a checklist item nobody can complete.* §18 and §20 both mention one; §2.2 and this build do not have one. Sign-in is email and password in this application's own database. Gmail is still involved — for sending, via an SMTP app password — but that is a credential, not an OAuth grant, and it carries no callback URL. What does survive from §18's Gmail paragraph is the hosted privacy policy, which is built.
- *The privacy policy is public and indexable, and deliberately not a second anti-phishing page.* §15.1 makes `/verify` the one address an investor is told to type, and a second public page describing the process would dilute that. So this one describes data handling and, where somebody might be trying to work out whether a message is genuine, sends them to `/verify` rather than answering.
- *The two lists of public routes — `next.config.ts` and `robots.ts` — are asserted to agree.* A route indexable in one and not the other is precisely the defect that shipped in WP14.
- *The dump is custom-format, not plain SQL.* `pg_restore` can be redirected to another database name and refuses a truncated file outright; `psql < file.sql` replays half of it and leaves a database that looks restored.
- *Restore reads a second environment variable and refuses to write to `DATABASE_URL`.* Restoring last week over this week is the one mistake here that cannot be undone, and the runbook for that day is read by somebody already having a bad morning.
- *The verification rebuilds without the prefix when it finishes*, in a `finally`. A build with `/SPV` baked in would silently break `pnpm start` for whoever ran it next.
- *`ENCRYPTION_KEY` is not carried between deployments by default.* It encrypts the SMTP password and the OpenAI key; moving the data without it leaves rows that decrypt to nothing, and the symptom is "no sending credential is stored" rather than a key error. Re-entering two secrets is two minutes and cannot fail quietly.
- *The old deployment comes down rather than being left running.* A stale copy of a securities portal that still works is worse than one that does not — it shows an investor a record nobody is updating.

**Deviations:** the Google OAuth callback work in the task list does not apply to this build, for the reason above. Everything else in WP20 is built.

**What cannot be done from here.** §20's *"the runbook has been followed once end to end"* needs DNS for `flipit.com`, a hosting account and a managed Postgres. None exists in this environment. What this package could do instead of claiming it: make every step of the runbook that is checkable by machine into a check that runs — the prefix, the links, the cookie path, the headers, the crawler files, the guard, the backup and the restore — so the parts left for a person are DNS, a certificate, and pressing the buttons.

**Checklist:** points 5, 8, 9 and 12 are this package's.

5. No investor-facing response reveals another investor. The privacy policy reads no database, and a test asserts it imports neither `@/db` nor any portal loader. The deployment verification signs in as one investor and asserts the portal shows that investor's figures.
8. No log line carries a token, a body or a key. The backup script prints where it read from and where it wrote to, and `redactUrl` removes the password first — with a test for a password containing `@` and `:`, and one asserting that a connection string it cannot parse is printed as nothing at all rather than partially.
9. **This is the package's finding.** The verification page is now genuinely the indexable route rather than nominally, and the privacy policy joins it deliberately, named in a test. Both are checked against a running server, at the domain root and under the prefix.
12. The app refuses to send when its base URL is not the production value — now demonstrated on a real deployment under a real prefix, with the test-send carve-out shown still working beside it.

**Uncertain:**

- The negative lookahead in `next.config.ts` is a path-to-regexp construction and it is not obvious. It is commented, and the source test asserts the `(?!` is still there, but the thing that would actually catch its removal is `pnpm verify:deployment` — which is not in `pnpm check` because it builds twice and takes a couple of minutes.
- Two-factor sign-in was still a release gate and still unbuilt when this package was written. It is built now — see the entry below — and the runbook wants a paragraph on recovering an account whose device and codes are both gone.
- The backup lands on local disk. Off-host storage is a decision about where, and the runbook says not-the-same-host and that a dump is the most sensitive single artefact this system produces — but nothing enforces it.

---

## WP19, merged with the parallel session — the criteria that had no test, and two audit faults

This session built WP19 independently and reached the same conclusion about what the package is: a mapping is worth nothing unless something checks it. The parallel session's registry — `src/lib/acceptance.ts`, quoting §22 word for word and resolving every citation to a real label — landed first and WP20 is built on it, so it is the one that stands. This session's registry was discarded rather than merged; two coverage tables would be one more than can be kept true.

What survives from this side is the part the two sessions did not duplicate: **six test files, each written for a criterion that had no direct test at all**, and the two defects that writing them exposed. The citations below have been folded into `src/lib/acceptance.ts` where they close a gap.

The suite is now **1,457 tests across 79 files**. The eight database-backed verification scripts pass 311 checks between them, re-run in full after this session's two source changes.

**Six new test files, each filling a criterion that had no direct coverage:**

- `src/lib/sending/snapshot.test.ts` — AC3 and AC4. The preview and the sent snapshot are one document: both sides load the same source, build the renderer input from the same fields, and resolve sender defaults through the same loader, and there is no second rendering path anywhere in the application. A regression check confirmed the test catches a divergent renderer added under `src/`. The snapshot is stored rather than re-rendered at read time, is written before the transport is touched, and no update path rewrites it.
- `src/lib/portal/links.test.ts` — AC5. A claim link carries a token and nothing else: no part of the name or address in any encoding, no offer id, account id, amount, percentage or jurisdiction; 256 bits, URL-safe, stored only as a hash, and looked up by hash so the raw value never reaches a query. A link cannot be pointed at a caller-supplied host — scheme, `//`, traversal, query and fragment all stay one path segment. The portal has exactly two dynamic segments, both opaque, and reads no search parameter anywhere.
- `src/lib/audit-coverage.test.ts` — AC12, AC29, AC41, the half of each that says a mutation *is logged*. A registry of `{ module, function, expected action }` scanned by brace-matching from the declaration, so a neighbouring function's `audit()` call cannot satisfy the check; plus the funds-received two-step proved functionally — nothing is recorded without the tick, or when the re-typed amount is a cent out, and there is no parameter that skips the comparison.
- `src/lib/export/secrets.test.ts` — AC25's "never displayed, never logged, never exported", and AC14's "the owner retains access and export throughout". No export header or schema field names a credential; a credential smuggled onto a row is stripped at the Zod boundary in both CSV and XLSX; the settings action never selects, decrypts or returns the stored key, and one screen reads it as a boolean. The service-mode half is an absence proof: the export path never reads `service_mode`, and the one §7 gate near an export is on *entering* `disabled`.
- `src/lib/qa/defaults.test.ts` — AC36's confirmation and AC37's explicit tick. An unchecked box submits nothing, so the helper reads absence as unticked and never coerces truthiness; the publish flag can only come from the form; the asker's confirmation is one constant with nothing interpolated, identical for every account, and arrives even when the notification to the operator could not get out.
- `src/db/second-offer.test.ts` — AC15. Nothing unique names `account_id` alone or the pair, the index that exists is deliberately plain, the account carries no round-shaped column, the recipient row is unique on (round, email) rather than on email, and the import path matches an incoming row to the account that already exists rather than making a second copy of a person.

**Decisions.**

- *One registry, not two.* The parallel session's `src/lib/acceptance.ts` is the table; this session's `src/acceptance/` was deleted in the merge. They had converged on the same guarantees independently — quote §22 verbatim, resolve every citation to a real label in a real file — and a second table would decay quietly while looking authoritative. The new citations were folded into the surviving one.
- *Where a criterion had no test, the answer was a test, not a note.* Six of them looked covered because a neighbouring concern was tested. AC3 had a template-loading test and no comparison of preview against snapshot; AC5 had token entropy and nothing about the URL; AC12, AC29 and AC41 each said "and it is logged" with nothing checking that clause. A citation pointing at an adjacent test is how a table gets to 48 without getting to done.
- *`refreshQueue`'s audit actor defaults to `systemActor` rather than staying silent.* The alternative — requiring an actor — would have made the scheduled run's signature lie about who is calling it.
- *`assertNoSecrets` reads keys at every depth, and still never reads values.* Depth matters because metadata is serialised verbatim into the audit export cell. Values stay unread because `scripts/verify-export.ts` scanned them once and refused `{ method: 'password' }`, which is an audit log doing its job; the false alarm is how a real check ends up switched off.
- *A booleaned key is admitted.* `{ openAiKeyReplaced: true }` records that the owner changed the key, which is the point of auditing the settings screen. A boolean, a number, null or an empty string cannot carry a credential; anything with text under a forbidden name is refused.

**Deviations.** Two source changes, both fixes to defects the new tests surfaced, and neither in scope for a test package — recorded here rather than silently folded in:

- `src/lib/reminders/queue.ts`: `refreshQueue` audited only `if (input.actor && …)`, and the scheduled run at `run.ts:278` calls it without one. The unattended path created and deleted queued reminders with no audit entry at all. Now falls back to `systemActor`.
- `src/lib/audit.ts`: `assertNoSecrets` matched top-level key names only, and `openAiKey` — the field name `updateAiSettingsAction` itself uses — matched none of the forbidden words. Now recursive, with `openai` and `passphrase` added, and gated on whether the value could carry a secret at all. Three characterisation tests that had pinned the old behaviour were rewritten to assert the new.

No schema change. No migration.

**Checklist.** Points 8 and 2 are this package's; the rest were re-checked because the package touched the audit helper, which every mutation calls.

1. No monetary value is a JavaScript number. The two changed source files handle no money. `src/lib/money.ts`, `lib/sending`, `lib/compliance` and `lib/email` are untouched by this diff.
2. No send path bypasses anything. `lib/sending` and `lib/compliance` are unmodified. The queue change adds an audit call and touches no eligibility check; `schedule.test.ts`'s "has no send path that skips the eligibility re-check" still passes.
3. A jurisdiction block still stops one recipient. Untouched, and `verify-register.ts` re-run: 49 checks pass.
4. The operator still cannot record, amend or void an approval. Untouched; `actions/compliance.test.ts` unchanged and passing.
5. No investor-facing response reveals another investor. This package added tests only on that front — `links.test.ts` adds four assertions that a link cannot carry another person's data, and the eight verification scripts, each of which runs with a second investor present, pass 311 checks.
6. Claim and sign-in tokens are single-use, hashed and expiring — now asserted from the URL end as well: the raw token is not a column anywhere, and lookup is by hash.
7. Suspension revokes sessions and refuses new links. Untouched; `verify-lifecycle.ts` re-run, 30 checks pass.
8. No log line carries a token, a body or a key — strengthened, not merely re-checked. The guard now reads nested keys, and `verify-export.ts` re-confirms against the real database that no metadata key looks like a credential or a body.
9. The verification page is still the only indexable route. Nothing here touches `robots.ts`, `sitemap.ts` or any route's metadata.
10. A published Q&A entry carries nothing identifying. Untouched; `verify-qa.ts` re-run, 51 checks pass.
11. The AI path cannot change a calculated figure. Untouched, and now cited under AC27 by the test that proves the figures are byte-identical either way.
12. The app still refuses to send when its base URL is not the production value. Untouched.

**Uncertain.**

- *AC30 is a real gap, not a test gap.* The tiles render and their wording is gated, but nothing writes `roadmap_tiles` except the seed, so "configurable by the owner" is not met. `forbiddenWordsInTileLabel` is the gate the missing surface must call at write time — it has been waiting since WP18 for a surface to guard. It is small, and it is the next thing worth building.
- *`recordExport` stamps `lastExportAt` only for a recipients export*, so an audit-log export never satisfies §7's precondition for entering `disabled`. That is the stricter reading and is left standing, but it is undocumented and the operator gets no message explaining which export counts.
- *`cancelMany` writes no entry of its own.* The trail is the per-reminder `reminder.cancelled` entries, which satisfies AC29, but a bulk cancellation is not recoverable from the log as a single act.
- *The verification scripts are cited but not gated.* `pnpm test` does not run them, and nothing enforces that they have been run recently. Whoever sets up CI should decide where they belong; the argument for a release stage rather than a commit hook is unchanged from WP18.
- *Two sessions built WP19 in parallel and neither knew.* The merge cost an hour and threw away a working registry. Nothing in the repository says which package is being worked on, and PROGRESS.md is only written at the end — which is exactly too late to prevent this. A one-line claim file, written first, would have.

## Two-factor — the release gate, closed

Not a numbered work package. §2.2 makes TOTP *"mandatory before the production deployment sends anything real"*, which is a **release gate rather than an optional extra** — the phrasing this repository has used for it since WP2. Every package since has listed it under "not built yet" and it was the last thing standing between the build and a real send. It is built.

**What §2.2 is actually paying for is stated in §2.2 itself.** Dropping Google sign-in means *"the password becomes the only thing between an attacker and investor names, amounts, and the ability to send mail as the operator. That is a real trade and it is paid for here, not waved away."* Argon2id-class hashing, the length rule, the rate limiting, the revocable sessions and the audit log were all built. Two-factor was the outstanding half.

**A pending session is not an administrator, and that is enforced in one place.** `sessions.second_factor_at` is null until a code is entered. `currentAdmin()` — the function every guard on every page and every server action already goes through — resolves it and returns null while it is pending. So `requireAdmin`, `requirePasswordSet`, `requireOwner`, `requireOperator` and `requireOnboardedAdmin` all inherit the check without knowing about it, **and a guard that never heard of two-factor fails closed rather than open**. A test asserts that chain, and asserts that exactly two files in the application read a session `currentAdmin()` has refused: the page that renders the form, and the action that receives it.

**A session starts un-elevated by default.** `createAdminSession` takes an option that defaults to false, and neither sign-in path sets it — password sign-in and the one-time setup link both produce a plain session, and only a verified code elevates one. A test asserts no caller passes `secondFactorSatisfied: true`.

**Elevation is by session token, never by user id.** Elevating every session a user holds would elevate one an attacker had opened with a stolen password and left waiting; the database verification opens two sessions for one account, elevates one, and checks the other is still waiting. It is also conditional on the session not already being elevated, so a replayed submission cannot re-stamp one.

**The release gate itself is `SECOND_FACTOR_NOT_ENROLLED` in the send guard**, and it binds exactly where §2.2's sentence says: a real send, on the production deployment. A test send to the operator's own address is not "anything real", and neither is anything on the testing deployment — which is what keeps the whole of §19's pre-flight rehearsable before the last gate closes. **It adds a condition and weakens nothing**: no override, no setting, no environment variable, and a test asserts no such thing appears in the module.

**Verified against a real database.** Twenty-five checks in `scripts/verify-second-factor.ts` (`pnpm verify:2fa`): the secret stored encrypted and decrypting back; enrolment unconfirmed until a code is entered; a five-minute-old code refused; ten recovery codes stored as hashes with none in the clear; two sessions elevated independently; a recovery code spent once and refused the second time, against the row rather than in memory; the gate refusing a real invitation, permitting it once switched on, leaving a test send alone, and following the state back down when two-factor is turned off; and no audit entry for the account containing the secret or any recovery code.

**Decisions:**

- *The gate reads the **operator's** account, not the acting user's.* The scheduled sends — reminders, update notifications — have no acting user at all, so a per-request rule would either break the reminder job or carve an exception into it. §2.2 names the stake as *"the ability to send mail as the operator"*, and every message this application produces leaves from the operator's mailbox. One rule, covering both the interactive and the scheduled path.
- *`operatorTwoFactorEnrolled` is **required** on the guard config rather than optional with a default.* An optional field with a default is a field somebody forgets, and the default would be wrong in exactly the case that matters. Making it required cost one line in the test helper and means a new call site has to state it.
- *The gate reads its own evidence inside `sendOneEmail`.* A gate whose evidence the caller supplies is a gate the caller can get wrong.
- *One field for both a TOTP code and a recovery code.* Two fields would tell somebody watching which one was being tried, and would make a person who has lost their phone hunt for the right box while they are already anxious.
- *One sentence for every failure*, exactly as the password step has. A message distinguishing a wrong code from an unknown recovery code would tell somebody holding a stolen password which of the two factors they had cleared.
- *The second step is throttled on the same counters as the first.* A six-digit code is a million possibilities; an unthrottled form walks it in an afternoon, and a separately-throttled one lets an attacker spend the password budget and the code budget independently. `clientIp` moved out of `actions/auth.ts` into its own module so both steps key identically.
- *±1 period, and no more.* Thirty seconds either side covers reading a code and typing it. Every additional period is another minute in which a code read off somebody's screen is still worth something. The accepted steps are an exported constant with a test asserting there are three.
- *Confirming enrolment requires a live code.* An account cannot be locked out by a QR that was never successfully scanned.
- *Switching two-factor on ends every other session for that account.* Sessions opened under one-factor rules must not survive the change, or switching it on would have altered nothing for the sessions that already existed.
- *Turning it off asks for the password; reissuing recovery codes asks for a code.* A session is a bearer token on a machine somebody may have walked away from. And when the question is "do you still hold the second factor", a code is the answer and a password is not.
- *There is no screen on which the owner turns two-factor off for the operator.* A second factor somebody else can remove is not a second factor. Recovering an account whose device and codes are both gone is a database change, made deliberately, and the second-factor page says so.
- *The QR is a server-rendered data URL.* It is the secret in visual form, so it is never fetched from a URL a proxy could log, and it exists only between starting enrolment and confirming it.
- *The recovery-code alphabet excludes `0`, `1`, `I`, `O`, `L` and `U`.* The first five because they are misread off paper, which is the only way anybody ever reads one; `U` because it turns a random string into a word more often than the rest.
- *Enumeration: the second step is visible only after a correct password*, so the fact that an account has two-factor is disclosed only to somebody who already has the password. That is unavoidable in any two-step design and is not a new disclosure.

**Deviations:** one migration, `0006`, adding `sessions.second_factor_at`. The `users` columns §2.2 needs — `totp_secret_encrypted`, `totp_confirmed_at`, `recovery_codes_hashed` — were provided by WP1 and are used unchanged.

**Checklist:** points 2, 7 and 8 are this change's.

2. No send path bypasses the compliance approval or the token check — and there is now one more gate in front of the transport, added rather than substituted. The compliance gate, the mail-connection gate and the deployment gate are untouched; a test asserts the new one has no override.
7. Suspension revokes existing sessions *and* refuses new links — unchanged, and the new column travels with the session row, so a revoked session takes its elevation with it. Switching two-factor on additionally revokes every other session for that account.
8. No log line carries a token, a body or a key. The audit entries record a method — `totp` or `recovery_code` — and a count. Verified against the real database: no entry for the enrolled account contains the secret or any of its ten recovery codes.

**Uncertain:**

- Recovery from a lost device **and** lost codes is a database change, and the runbook does not spell out the SQL. It is three columns on one row, and somebody doing it at speed would rather read it than derive it. Worth a paragraph in DEPLOYMENT.md next time that file is open.
- The gate asks whether *an* operator is enrolled. There is one operator by design (§2), so the question is well posed today; with two, one enrolled operator would satisfy it for both. If a second operator ever exists, this wants to become per-sender.
- Nothing yet forces enrolment on first sign-in. §2.2 calls it "optional in v1", so this is faithful — but the practical consequence is that the first person to reach production discovers the gate at the moment they try to send, rather than at the moment they sign in. The security page says so plainly, which is the smaller half of the fix.

---

## The "Coming to your portal" tiles are now editable — AC30 closed

The smallest remaining gap, and the one the WP19 merge named as "the next thing worth building". §13.1: *"Configurable by the owner: tiles can be added, renamed, hidden, or switched from 'in development' to live as features ships."* The tiles have been on the investor's portal since WP8; the screen to change them had never existed, so half of AC30 had been unmet the whole time.

**`forbiddenWordsInTileLabel` finally has the surface it was written for.** WP18 built it as a gate ahead of a screen that did not exist yet — the same shape as the WP17 follow-up — and this is that screen. It now **refuses at write time and names the offending word**, which is the right shape given what §13.1 says about this section: *"it is the easiest place in the build to say something unintended."* A silent drop would leave the owner believing it had saved.

WP18's read-time filter stays as the quieter second layer, for anything that reaches the table by some other route. Two layers, one loud and one quiet, and a test asserts both are present.

**Decisions:**

- *Owner only.* §13.1 says "configurable by the owner", and these words appear on the page an investor reads beside their own figures. Where the specification names a role, that is the role.
- *Forty characters.* §13.1 asks for "short labels and no explanation" and "names only". A long label is a sentence, and a sentence in this section is where the trouble starts.
- *Ten tiles maximum.* §13.1 says "a small set". Ten is well past small, and the cap stops the section becoming a list of promises by accumulation rather than by any single bad tile.
- *Hiding is the ordinary way to take one off, and removal is separate.* Hiding keeps the row and is one click to undo. Removal is audited with the label, so the log still says what was there.
- *The standing line is rendered on the editing screen, greyed and not a field.* Whoever is writing a tile can see the sentence it will sit above, and can see that it is not one of the things they can change.
- *A refused label is audited too.* `roadmap_tile.refused`, with the reason and without the label — an audit entry recording the wording somebody tried to publish would put it in the log instead of on the page, which is not an improvement.

**Deviations:** none. No migration — `roadmap_tiles` has been in the schema since WP1.

**Checklist:** points 5 and 8.

5. No investor-facing response reveals another investor. The tiles are global rather than per-investor and remain so; nothing on this screen or in these actions reads an investor record.
8. No log line carries a token, a body or a key. The audit entries record labels, flags and a reason; the refusal entry records the reason and not the refused text.

**Uncertain:**

- Reordering is not built. `sort_order` exists and is set on creation, so tiles appear in the order they were added, and there is no way to move one. §13.1 does not ask for reordering; a pair of arrows would be twenty minutes if it ever matters.
- The word list is still mine, derived from §13.1's prose. It is now enforced against real input rather than sitting ahead of a surface, which is the right time for somebody to read it — it is `FORBIDDEN_IN_TILE_LABEL` in `lib/portal/roadmap.ts` and the screen shows the first six of them in the hint.

---

## AC30 — the same package, built twice, and what was kept

Both sessions read the same PROGRESS.md, found the same half-built criterion, and built it within the same hour. The parallel session's implementation landed first and stands: `actions/roadmap.ts`, the screen, and the source-level tests in `roadmap.test.ts`. This session's — a service layer under `lib/portal/roadmap-tiles.ts`, five thinner actions, twenty-one functional action tests — was deleted rather than merged. Two editing surfaces for one section of one page is not a thing to reconcile; it is a thing to undo.

**What was kept is `scripts/verify-roadmap.ts`, rewritten to cover what the surviving implementation cannot.** Their actions all go through `requireOwner()`, so a script with no session cannot drive them, which is why they wrote no database check. But the *second* layer can be driven: `lib/portal/data.ts` filters the tiles again on the way out, and that filter is the only thing standing between an investor and a row that reached the table by some other route — a seed, a migration, a hand at a database prompt, the build before the gate existed. It runs only for rows that should not exist, which makes it precisely the code that rots without anybody noticing.

So the script writes the rows the gate would have refused — *Returns dashboard*, *Liquidity window*, *Live Q3*, *Ready 2027* — straight past the gate, then loads the portal view an investor is actually served and checks that exactly one of the six planted rows appears. Eighteen checks. It also proves the fixture: each refused label is confirmed to be one the write-time gate would reject, so a filter that quietly stopped working could not pass by rejecting nothing.

**One disagreement between the two implementations, resolved in theirs' favour and recorded here because it is a real choice.** This session's had no delete: hiding kept the row, on the §16 argument that the log should still answer what an investor was shown on a given day. Theirs has a remove, and audits the label with it — the trail survives the row. That is a defensible reading of the same section, it is documented at the function, and the ordinary route off the portal is still hiding. Left as it stands.

**Checklist.** Nothing in this session's surviving contribution changes application behaviour: it is one verification script and its citation. Points 1 through 12 are unaffected by a script that writes fixtures and deletes them again — and it does delete them again, which the last two checks confirm against the seeded tiles.

**Uncertain.**

- *Nothing re-approves the tiles when they change.* §13.1 asks the compliance approver to look at this section along with the email. The email has a hash and an approval that drift breaks; the tiles have neither, so an owner can rename a tile after an approval is recorded and no gate notices. The word list is a floor, not an approval. Whether tile copy should join the template hash is a question for whoever records the next one.
- *Two sessions built the same thing twice, in the same hour, for the second time today.* WP19 collided and so did this. Neither session could see the other's work until it was pushed, and PROGRESS.md — the only coordination surface — is written at the end, which is exactly too late. A claim written **before** the work starts, in its own file, would have cost a minute and saved two hours across the two collisions.

---

## WP15 — Media and video — done. The last deferred package, and the last two uncovered criteria.

WP16 deferred this one with a specific reason, and it was the right reason: *"What it needs is a decision about storage — the natural fits alongside Netlify are Netlify Blobs, S3 or R2 — and then it is a straightforward package."* The decision is made and recorded below. With it, **AC32 and AC33 are the last two of the forty-eight to acquire an automated check**, and `acceptance.test.ts` now asserts that no criterion is uncovered rather than asserting which two are.

**Built.**

- **A `MediaStore` seam, the same shape as WP5's `EmailTransport`.** One interface, one working `FilesystemMediaStore`, and an `ObjectMediaStore` that is selectable and refuses with a message naming what is missing. `MEDIA_STORE` is empty by default and **an unconfigured store is a supported state, not a broken one** — the screens say what to set and everything else in the portal is complete without it.
- **One ingest, and every byte goes through it.** Size, then identity from the file's own leading bytes, then whether that format is accepted for that kind of upload, then the metadata strip, then storage under an unguessable key. `boundary.test.ts` asserts there is exactly one writer and that no upload path calls a store directly.
- **Metadata stripping that goes past the word "EXIF".** JPEG segments, PNG chunks and WebP RIFF chunks are rebuilt from an **allowlist** — a segment is kept only if it is structurally incapable of carrying a sentence. And MP4/QuickTime `moov/udta` is neutralised, which is where an iPhone writes the coordinates a video was shot at.
- **The admin media library** (§13.2) — both roles, name and description, dimensions read from the header, served from this deployment's own domain, every upload and every refusal audited.
- **The personal video** (§13.3) — browser recording and file upload landing on the same route, an operator preview before anybody else sees it, caption and transcript, explicit publish, unpublish, replace and remove.
- **The test send that AC34 has been describing since WP5.** The transport's `TEST` intent existed and nothing in the application ever used it; the pre-flight had an item the operator could only *tick*. There is now a button behind the tick, on that line, offered before it.

**Decisions.**

- *The storage decision is a seam, not a vendor.* WP16 rejected base64-in-Postgres and a writable serverless disk, and both rejections still stand. What was actually blocking was that "where do files go" was hard-coded nowhere and therefore everywhere. An interface with a real filesystem implementation makes it one line of configuration; whoever picks Netlify Blobs, S3 or R2 writes one class and changes one variable.
- *Empty is the default, and the default is a refusal.* A filesystem store needs a disk that survives a restart, and a serverless deployment does not have one. Defaulting to `filesystem` would mean a production deployment silently storing files somewhere they vanish from. Where the specification is silent, the conservative option: refuse, and say exactly what to set.
- *The declared content type is never believed, anywhere.* `inspect` takes it as a parameter and does not read it, with a comment at the place somebody would look, so a later caller cannot pass it in the belief that it is being checked. What a browser declares comes from a file extension, which is a claim by whoever named the file.
- ***SVG is refused outright.*** §13.2 requires media to be served from the application's own domain, which is the origin holding the investor session cookie. An SVG is a document that can contain script. There is no size limit or sanitiser that makes that a good trade for a logo.
- *GIF is refused too, for a quieter reason:* this build cannot confidently strip its comment and application extension blocks, and a format whose metadata cannot be removed fails §13.2's own requirement. Refusing beats shipping a stripper that half works.
- *The ICC colour profile is dropped along with the EXIF.* This is a real cost — a wide-gamut photograph renders slightly flatter — and it is paid deliberately. A profile description is a free-text string, and §13.2's requirement is about what leaves the building rather than about colour fidelity.
- ***The MP4 strip renames the box to `free` and zeroes it rather than deleting it.*** A video whose `moov` precedes its `mdat` addresses its own sample data by absolute file offset; shrinking anything before `mdat` invalidates every one of those offsets and produces a file that no longer plays. A `free` box is defined as skippable, the file length is unchanged, and a test asserts both.
- *WebM is passed through, and that is stated rather than hidden.* The one path that produces it here is the browser recorder, and a `MediaRecorder` stream carries no location, no device serial and no owner name. An uploaded WebM is the case this does not cover and it is under Uncertain.
- ***The image route has no session check, and that is a decision.*** §13.2 says the library is reusable in the email templates, and an email client fetching an image carries no cookie. What makes it safe is stated in four parts in the route itself: nothing in the library belongs to an investor (asserted as an absence — no column, no code path, `boundary.test.ts`); the twenty-four-byte key *is* the capability; the row is the authority on the content type and a row that does not say "image" is not served; and `nosniff` plus `noindex`.
- ***The video route is the opposite, because §13.3 says so:*** authenticated investors only, published only, and the portal's own §4.2/§7 access rule applied on top — so a suspended account loses the video with everything else. The admin preview is the same bytes behind the administrator guard.
- *Every refusal on both video routes is the same 404 as an id that does not exist.* Not a 403. A response distinguishing "there is a video and you may not have it" from "there is no video" answers a question nobody is entitled to ask, and a test asserts neither file contains a 401 or a 403 at all.
- *The owner may watch the video; he may not record, replace, publish or delete one.* §13.3 is written in the second person about one person. He is accountable for what appears beside somebody's investment figures, so he can look; it is David's video, so he cannot change it. Every write in `actions/video.ts` is `requireOperator`, and the upload route applies the same rule with a status instead of a redirect.
- ***A replacement always arrives unpublished, and replacing a published video takes it down.*** The alternative — swapping the bytes under a published record — would put a video in front of investors that the operator had not previewed in place, which is exactly what "he sees it before anyone else does" forbids. The screen says so before he presses anything, and the caption and transcript are carried across so a re-record does not lose text typed out by hand.
- *At most one video.* §13.3 describes "a short personal video" and asks to "replace as many times as he likes" — one video, not a library. It makes "is there one, and is it published" a single question with a single answer.
- *The caption and transcript are rendered as text on the page, never behind a control.* §13.3: *"Some recipients will open this somewhere they cannot play sound."* For those readers the transcript **is** the video, and something you have to find and click is something you do not read.
- ***The test send uses the preview's fake claim token, not a real one.*** Minting a genuine single-use token for a test would issue a working credential against a real investor's record and spend it when David clicked — a send by another name, which is what §11.4 already refuses for the preview. `snapshot.test.ts` asserts the file contains no `issueToken` and no `portalTokens`.
- *The test send is operator-only and writes no snapshot and no send event.* Those record what an investor was sent; a test send is not that, and putting one in a recipient's history would make the record say something untrue.
- *A refused upload is audited with the reason and never the filename.* A filename is free text somebody typed and is not worth the risk in a log.
- *The video's audit entries carry lengths and flags, never the caption or transcript.* A transcript is an email body by another name — and `assertNoSecrets` already refuses the key outright, which a test now proves rather than assumes.

**Deviations.**

- **No migration.** `media_assets` and `operator_videos` have been in the schema since WP1 and are used exactly as declared. `drizzle/` is unchanged.
- Two environment variables added, `MEDIA_STORE` and `MEDIA_DIR`, both documented in `.env.example` and both optional.
- Three pre-existing tests were widened rather than weakened, each with the reason written into it: `links.test.ts` now admits `[videoId]` as a third opaque segment (there is one video and it belongs to nobody in particular, so unlike a certificate id it cannot identify an investor); `snapshot.test.ts` admits `send-test.ts` as a fourth `renderEmail` caller **and gains a test pinning it to the preview's own loader, input builder and link**, so the fourth caller cannot become a fourth document; `acceptance.test.ts`'s uncovered list went from `[32, 33]` to `[]`.
- `scripts/verify-viewport.ts` gained the two new screens.

**Checklist.** Points 1, 2, 5, 8 and 9 are this package's; the rest were re-checked because it added routes.

1. **No monetary value is a JavaScript number.** Nothing in `lib/media` handles money, and a test asserts `parseFloat` and `.toNumber(` appear in none of its modules. The test send renders from `toVariableInput`, which passes the decimal strings through unchanged.
2. **No send path bypasses anything.** The one new send is `intent: 'TEST'`, through `sendOneEmail`, and the gate is unmodified — the exemption it uses is the one §7, §8.2 and §18.1 already carve out, paid for by having to prove the recipient is the operator's own address. `verify:deployment` re-run: "a real invitation is refused off the production deployment" and "a test send to the operator is still allowed here" both pass. A test asserts no media module constructs a transport.
3. **A jurisdiction block still stops one recipient.** Untouched. `verify:register` re-run — 49 checks pass.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** The video is global rather than per-investor and the portal reads it without reference to the account. `boundary.test.ts` asserts no media module imports an investor table or session, that neither new table has a column that could name one, and that the public image route reads exactly one table. `verify:media` runs with two investors present throughout and checks that no media or video row contains either account id.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Strengthened by omission: the test send deliberately does not mint one.
7. **Suspension revokes sessions and refuses new links.** The video follows the portal shut — a suspended account is refused by the same `portalAccess` result the rest of the page uses. `verify:lifecycle` re-run: 39 checks pass.
8. **No log line carries a token, a body or a key.** The caption and transcript never reach the log, the audit helper refuses the key outright, no media module calls `console` at all, and `verify:media` confirms against the real database that no video audit entry contains the transcript or a storage key.
9. **The verification page is still the only indexable route.** All three new routes set `X-Robots-Tag: noindex` themselves, on top of the catch-all in `next.config.ts`. `verify:deployment` re-run — 41 checks pass, including the sitemap listing no portal, admin or api path.
10. A published Q&A entry carries nothing identifying. Untouched; `verify:qa` re-run, 51 checks pass.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value. Untouched, and confirmed above.

**Verified against a real database and a real browser.** `pnpm verify:media` — 31 checks, with two investors present throughout: the sniffed type beating the declared one, the file on disk not containing the location the uploaded file did, the original never reaching the disk at all, an SVG renamed to `.png` refused with nothing written, a video's coordinates gone with its length unchanged, both investors refused an unpublished video and both admitted to a published one, a suspended investor refused either way, a replacement arriving unpublished over a published one with its text carried across and the old file gone, and no audit entry containing the transcript or a storage key. `pnpm verify:viewport` — the two new screens pass 375px and WCAG AA in Chromium, taking the browser run to 125 checks.

**Uncertain.**

- *An uploaded WebM is not stripped.* The browser recorder is the only thing here that makes one and it carries nothing to remove, but a WebM shot elsewhere and uploaded would keep its EBML tags. Refusing uploaded WebM would be the conservative move and would also refuse the format the recorder produces, so the honest position is that this is a gap with a name. EBML tag removal is tractable and is the next thing to write if it matters.
- *The video routes do not support range requests*, so a browser downloads the whole file before playing. Fine for a short personal video, wrong for anything long — and the fix is a real object store with range support behind the seam, not arithmetic in the route.
- *`ObjectMediaStore` refuses rather than working.* That is deliberate and it is also a job somebody still has to do before this deployment can store a file anywhere durable. It is roughly one class.
- *The sixty-four megabyte video limit is a number I chose*, from what a three-minute phone recording weighs. It is also a ceiling on what one request holds in memory, which is the half of the reasoning that would change if this ever moved to a presigned direct upload.
- *`media_assets` is not yet referenced by the email templates.* §13.2 says images should be "re-usable across the portal, the email templates, and §13.1's roadmap tiles"; the library, the address and the absolute-URL builder all exist, and the template editor has no picker. That is a small piece of UI, and until it exists the reuse is a copy-and-paste of the address shown on the library screen.
- *Nothing enforces that an image is dereferenced before it is removed.* Removing an asset deletes the file, and any email already sent that embedded it will show a gap. The screen says so; the application does not stop it.

---

## Document packages — §5's status 3, which had a table and no code

Not a numbered work package. `document_packages` has been in the schema since WP1, §5's timeline has listed *"Documents issued · Operator · Date, document list, download links"* since the specification was written, and §13 has listed *"Documents issued to them, downloadable"* among what an investor sees. None of it existed, for the reason WP16 gave when it deferred WP15: there was nowhere to put a file. WP15's `MediaStore` is that somewhere, and this is the first thing built on top of it.

**Built.**

- **The same ingest, with a third kind.** `UploadKind` gained `document`; the accepted formats, the size limit and the key prefix are now a table keyed by kind rather than a pair of ternaries. There is still one writer, one size check and one identification from the file's own leading bytes.
- **Upload, open, issue, withdraw, remove** — on the investor's row on the Investors screen, grouped by offer, with the state of each document in words.
- **`/portal/document/[documentId]`** — the investor's own download, built in the same shape as the participation certificate route.
- **`/investors/[offerId]/document/[documentId]`** — the operator opening one before he issues it.
- **A documents section on the portal**, rendered only when something has been issued.

**Decisions.**

- ***PDF, and nothing else.*** A `.docx` is a zip that can carry macros and renders differently on every machine that opens it; an investor reading terms should see the page the operator sent. A PDF is also the only plausible format this application can serve inline without handing the browser something it will run.
- ***Uploading and issuing are two acts, and the gap between them is the feature.*** §5 makes "documents issued" a dated step on the investor's timeline. An upload that appeared immediately would stop the operator assembling a package, checking it and then releasing it — and would make the date on the timeline a claim about when a file was saved rather than about when the investor could first read it. Issuing takes an explicit confirmation, for the same reason recording funds does.
- ***A document is stored byte-for-byte, and the metadata is not stripped.*** This is the opposite of the rule for images, and deliberately: a document package is a legal instrument somebody will rely on, altering its bytes would alter the document, and unlike a photograph off a phone these are authored by the operator rather than received from a stranger. There is nothing in one he did not put there himself.
- ***An issued document cannot be deleted.*** The investor may already hold a copy, and §5 says a correction is *"never a silent overwrite"*. Withdrawing is the reversible act — the row stays, `issued_at` goes back to null, and the audit log holds both events. Removal is available only for something that was never issued.
- *Both routes refuse with the same 404 an unknown id produces.* Not a 403, and not a different 404 for "exists but is not yours". A test asserts neither file contains a 401 or a 403 at all.
- *`investorDocuments` joins on the account rather than filtering after the fact.* Another investor's document is never selected, rather than being fetched and discarded. A test reads the function and asserts the join condition is there.
- *Both roles may upload and issue.* §5 names the operator as who sets status 3, and the owner has full access to records (§2). Where the specification names a role for a *record* rather than for somebody's personal setup, the owner is not excluded — this is the opposite call from §13.3's video, and for the stated reason: a subscription agreement is the investor's record, and a video of David is not.
- *The download filename is built from the title with everything but letters, digits, spaces and dashes removed.* A `Content-Disposition` filename is a header and the title is free text somebody typed; a quote or a newline in one is an injection, and there is no case here where the exact characters matter.
- *Every investor download is audited.* §16 wants the trail of what somebody was given and when they took it. The entry records the document id and the title, and never a byte of the file.

**Deviations.** No migration — `document_packages` is used exactly as WP1 declared it. `links.test.ts` widened once more to admit `[documentId]`, with the reasoning written into it: it behaves exactly as `[certificateId]` does, and the route looks the owning account up and compares it against the session.

**Checklist.** Points 5 and 8 are this change's; 1, 2, 3, 4 and 12 are untouched by it and were re-verified because it added routes.

1. No monetary value is a JavaScript number. Nothing here handles money. `documentSizeLabel` formats a byte count, which is not a monetary value and is never used as one.
2. No send path bypasses anything. Nothing in this change sends an email — issuing a document tells nobody, deliberately, and the screen says so. `verify:deployment` re-run: 41 checks pass.
3. A jurisdiction block still stops one recipient. Untouched.
4. The operator still cannot record, amend or void an approval. Untouched.
5. **No investor-facing response reveals another investor.** The list is joined through the requesting account's own offers; the route compares the owning account against the session; a document that is not yours is the same 404 as one that does not exist. `verify:documents` runs with two investors who each hold a document and checks that Alice's list contains exactly hers, that nothing in it mentions Bruno or his account id, and that she is refused his document by id.
6. Claim and sign-in tokens are single-use, hashed and expiring. Untouched.
7. Suspension revokes sessions and refuses new links — and takes the documents with it, while `read_only` and `sunset` deliberately do not, because §7 says an investor must be able to take their records with them. Both are verified against the real database. `verify:lifecycle` re-run: 39 checks pass.
8. **No log line carries a token, a body or a key.** The audit entries record an offer id and a title; a refused upload records the reason and never the filename. A test asserts no metadata object in the module names `bytes`, `stored` or `file.name`.
9. The verification page is still the only indexable route. Both new routes set `noindex` themselves. `verify:deployment` re-run.
10. A published Q&A entry carries nothing identifying. Untouched; `verify:qa` re-run, 51 checks pass.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value. Untouched, and confirmed by `verify:deployment`.

**Verified.** `pnpm verify:documents` — 28 checks against the real database with two investors present throughout. `pnpm verify:viewport` is now 130 checks; the Investors screen carries the new panel and still passes 375px and AA.

**Uncertain.**

- *Issuing a document emails nobody.* That is deliberate — telling an investor is an update or a message, written on purpose — but somebody will expect it to, and the only thing saying otherwise is a sentence on the confirmation. Whether §5's status 3 should trigger a notification is a question for whoever runs the first round.
- *Advancing the timeline to "Documents issued" is still a separate step from issuing a document.* You can do either without the other, which is right — several documents may be issued before the investor is told — but nothing warns an operator whose timeline and document list disagree.
- *There is no versioning.* A corrected document is a withdrawal and a fresh upload, and the two are only connected by the audit log. The participation certificate has real version history (§5.1 asks for it); §5 does not ask for it here, and this is the conservative reading rather than an obviously right one.
- *A document is attached to an offer rather than to an account.* §4.3 means an account outlives a round, so an investor with two offers has two document lists on the operator's screen and one merged list on their portal. That is the honest shape of the data and it is also slightly awkward to look at.

---

## Library images in an email — and why it is an address rather than a variable

§13.2 asks for images *"re-usable across the portal, the email templates, and §13.1's roadmap tiles"*. WP15 built the library and left this half open, listed under Uncertain as "a small piece of UI". It turned out to be a small piece of UI attached to a decision that is not small, so it is recorded here.

**The obvious implementation is a compliance hole.** A `{{header_image}}` variable resolved from a setting would be one line and would let somebody change what every recipient sees **without changing the template hash**. §8.2's approval is a hash over the template source; the approval would still read as current and would no longer cover the document that went out. That is precisely the failure mode the drift check exists to catch, arriving through a door the drift check does not watch.

**So the address goes in the template source.** Changing the image changes the source, changes the hash, and blocks sending until a fresh approval is recorded. The panel on the templates screen says that in as many words, next to each address, because an operator who pastes a logo in and then finds sending blocked should have been told first rather than discovering it at the gate.

The address shown is the absolute one. An email client has no idea where the message came from, so a relative path does not load; §18.1's guard on `APP_URL` is what stops one being issued from the wrong deployment.

**Decisions:** none beyond the above. **Deviations:** none. **Checklist:** point 2 — the compliance gate is unmodified, and this change is the reason it stays sufficient: three source tests assert that no image variable was added to the resolver, that the panel offers an address rather than a placeholder, and that the screen says a fresh approval is required.

**Uncertain:** §11.5 asks the invitation to be *"legible with images blocked"*, and nothing enforces that a template with an image still is. The hint asks for a real `alt` on every one; a pre-flight item that rendered the text part and checked it still carried the whole message would be the enforcement, and does not exist.

---

## The object store — the seam WP15 left with nothing behind it

Not a numbered work package. Every package 0–20 is complete; this is the largest
of the items left under Uncertain, and the only one that stands between this
application and a deployment that can keep a file.

`store.ts` has declared an object store since WP15 and refused to be one. The
refusal was the right thing to ship — a stub that returned success would have
lost an investor's subscription agreement quietly — but it left the filesystem
store as the only working option, and a filesystem store needs a disk that
survives a restart. Serverless hosting does not have one. This is the class the
refusal was standing in for.

**Built.**

- **`lib/media/s3.ts`** — AWS Signature Version 4 and three verbs against any
  S3-compatible endpoint. Signing is pure and takes the clock as a parameter, so
  the canonical request, the string to sign and the finished `Authorization`
  header are all pinned character-for-character in tests.
- **`ObjectMediaStore`** now wraps it, applying the same `isValidStorageKey`
  check the filesystem store applies, and answering `null` for an absent object
  so that the two implementations are indistinguishable to a caller.
- **Five environment variables**, validated at boot: selecting the object store
  with some of them set is a refusal to start.
- **`pnpm verify:object-store`** — 36 checks against a real socket and the real
  database, running the real `ingest`.
- **`DEPLOYMENT.md §1.1`**, and §7 rewritten: it still listed WP15 and two-factor
  as unbuilt, both of which landed days ago.

**Decisions.**

- ***Written by hand, not installed.*** The AWS SDK is tens of megabytes and
  brings a credential-resolution chain that reads instance metadata, shared
  config files and environment variables this application deliberately does not
  use — a second way for a credential to get in, on the path that handles an
  investor's documents. What is actually needed is three verbs and one signature
  algorithm, and the algorithm is forty lines. There is no new dependency.
- ***Path-style addressing, not virtual-host.*** `endpoint/bucket/key`. Virtual
  host style needs a DNS entry and a certificate per bucket and is the one of
  the two that S3, R2, MinIO and Backblaze do *not* all support identically.
- ***Boot-time validation, not upload-time.*** Selecting the object store with
  three of the five variables set used to be the kind of deployment that starts,
  shows a configured store on the Media screen, and refuses the first upload.
  The conventions say the app refuses to start when a required variable is
  missing; this makes "required" conditional on `MEDIA_STORE` and keeps the
  behaviour.
- ***The endpoint must be scheme and host only.*** A trailing path segment would
  silently address a different prefix, and every key stored before somebody
  noticed would be unreadable afterwards. Refused at boot with a message saying
  why.
- ***A 404 is not automatically an absence.*** This is the one that matters. A
  deployment pointed at a bucket that does not exist answers 404 to everything,
  and a client reading every 404 as "not there" would show an empty media
  library and a missing document on every investor's record — a portal that
  looks like it has lost its files rather than one that is misconfigured. The
  body is read for the error code: `NoSuchKey`, or an empty body, is absence;
  `NoSuchBucket` or anything else is an error. Empty is treated as absence
  because some stores answer a 404 with no body at all, and refusing on silence
  would break normal "not there" on those.
- ***Only the error code comes out of an error body, and only letters of it.***
  An S3 `SignatureDoesNotMatch` body quotes the canonical request and the string
  that was signed back at you. That is not the secret, but it is a rendering of a
  request that carried one. The pattern admits `[A-Za-z]{1,64}`, so the worst a
  hostile endpoint can put into an exception somebody prints is a made-up code.
- ***Redirects are refused.*** `redirect: 'error'` on every request. A redirect
  off a signed request goes somewhere the signature was not computed for, and if
  the endpoint is misconfigured that somewhere is a stranger holding the bytes.
- ***Three attempts, on 5xx and on silence only.*** All three verbs are
  idempotent — the same bytes to the same key, and a delete of something absent
  is the state that was wanted — so a retry cannot do half of something twice. A
  4xx is an answer and is not retried.
- ***`get` returns `application/octet-stream` from both stores*** rather than the
  type the object store echoes back. The type is a column on the row, sniffed
  from the file's own leading bytes at ingest; what a store echoes is whatever
  was declared to it, which is the thing ingest exists to distrust.
- *The bucket must be private, and nothing in the code makes an object public.*
  Written into `.env.example` and the runbook, because it is the one part of this
  that the application cannot enforce for itself.

**Deviations.** No migration — no schema change. Nothing outside `lib/media`,
`lib/env.ts` and the two documents was touched; the ingest, the routes, the
screens and the audit calls are unchanged, which is what the seam was for.

**A bug this found in code that was already green.** The parity suite runs both
implementations through the same expectations, and the filesystem store failed
one: `get` and `remove` resolved the key *inside* the `try`, so a malformed key
was swallowed by the same `catch` that turns a missing file into `null`. A caller
asking about a key that could not exist was told "not there" rather than "that is
not a key", and the object store — which refuses — behaved differently for the
same input. Both now resolve before the try. A seam whose two implementations
disagree is not a seam, and no single-implementation test would have caught it.

**Checklist.** Points 8 and 12 are this change's; the rest were re-checked
because it touches the path that stores an investor's documents.

1. **No monetary value is a JavaScript number.** Nothing here handles money; a
   byte count and a retry delay are not monetary values and are never used as
   ones. The existing test asserting `parseFloat` and `.toNumber(` appear in no
   media module now covers `s3.ts` too.
2. **No send path bypasses anything.** Nothing here sends. The existing test
   asserting no media module names `sendOneEmail`, `SmtpTransport` or
   `assertCanSend` covers the new module. `verify:deployment` re-run — 41 checks
   pass.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** The store is keyed
   by an unguessable storage key and knows nothing else; the existing boundary
   test asserting no media module imports an investor table or session now covers
   `s3.ts`. `verify:media` re-run with two investors present — 31 checks pass;
   `verify:documents` re-run — 28 checks pass.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched — the store
   is below the layer that decides who may read.
8. **No log line carries a token, a body or a key.** `s3.ts` contains no
   `console` call at all, and a test asserts it. `describe()` carries the
   endpoint and the bucket and is asserted not to contain either credential. A
   thrown error is asserted to contain no secret, no access key id, no
   `Signature=`, no `AWS4-HMAC` and no URL. An error body reaches the message
   only as an error code matched by `[A-Za-z]{1,64}`, with a test feeding it a
   body containing a `StringToSign` block and asserting none of it survives. The
   signature comparison in the verifier is `timingSafeEqual`.
9. **The verification page is still the only indexable route.** No new route.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. **The app still refuses to send when its base URL is not the production
    value.** Untouched, and `verify:deployment` re-run to confirm — including
    that a real invitation is refused off the production deployment while a test
    send to the operator is still allowed.

**Verified.** `pnpm verify:object-store` — 36 checks, against a server on a real
socket that re-derives every signature from the secret and refuses anything it
cannot reproduce: the stripped file in the bucket and not the uploaded one, the
location string the upload carried absent from the stored bytes, the original
never written at all, a bucket that does not exist raising rather than reading
as an empty library, a wrong secret refused with the code and not the body, two
transient failures retried into one stored object rather than three, and both
stores returning identical bytes, identical content types, identical nulls and
identical refusals for a traversal key — which the object store refuses before a
request leaves the process. `pnpm test` — 1711 tests, 89 files. `verify:media`,
`verify:documents` and `verify:deployment` all re-run green.

**Uncertain.**

- ***No real provider has ever answered this client.*** Every test and every
  check answers from `127.0.0.1`. The signing chain is anchored to AWS's own
  published signing-key vector, so the derivation is theirs rather than merely
  self-consistent, and the canonical request is pinned character-for-character —
  but "correct by construction and pinned" is not "S3 accepted it". The first
  upload against a real bucket is a real test and nobody has run it. This is
  written into `DEPLOYMENT.md §7` and `TEST_ME.md` in those words.
- *There are no range requests, so a video still downloads whole before it
  plays.* The object store makes them possible for the first time — `Range` on a
  GET is a header this client could pass through — and it is still not done. It
  is the next thing to write in this file if a longer video ever matters.
- *Nothing prunes an object whose row is gone.* Removing an asset removes both,
  but a database restored from a backup taken before an upload leaves the object
  behind with nothing naming it. Harmless and invisible, and it is storage
  somebody pays for. A reconciliation script is perhaps thirty lines and does not
  exist.
- *The bucket is not covered by `pnpm backup`.* The runbook now says so plainly.
  Making the backup carry the objects is a real piece of work and arguably the
  wrong one — pointing a new deployment at the same bucket is easier and is what
  §4.3 assumes — but a database restored without its bucket produces rows whose
  files are missing, and only the runbook stops that happening.
- *A key pair is an environment variable rather than an encrypted row.* That
  matches the convention for every other secret this application boots with, and
  it is a different treatment from the SMTP app password and the OpenAI key,
  which are entered through the UI and encrypted at rest. The distinction is
  deliberate — one is set by whoever deploys, the other by whoever signs in — but
  it is a distinction worth knowing about rather than discovering.

---

## Versioning for a corrected document — §5's "never a silent overwrite", made real

Not a numbered work package. The largest of the items left under Uncertain after
the document packages landed, and named as such in CLAIMS.md.

Correcting a document meant withdrawing it and uploading another, and the only
thing connecting the two was the audit log. That is a record of the correction
for whoever reads the log, and nothing at all for the investor holding a copy of
the old one — who is the person §5's rule is for. The participation certificate
has had real version history since WP13 because §5.1 asks for it by name; §5
does not ask for it here in those words, but it does say a correction is *"never
a silent overwrite"*, and a withdrawal followed by an unrelated upload is
exactly a silent overwrite from the investor's side of the glass.

**Built.**

- **Three columns on `document_packages`** — `version`, `superseded_at`, and
  `supersedes_id` pointing at the document a version replaces. Migration
  `0007_strange_multiple_man.sql`. The same shape as
  `participation_certificates`, deliberately.
- **`lib/documents/versions.ts`** — the rules, pure and tested on their own:
  what may be corrected and why not, the next version number, and the walk that
  turns a flat list of rows into chains.
- **`correctDocumentAction`** — uploads a corrected version against an existing
  document. It arrives *not issued*, like every other upload.
- **Issuing a correction supersedes its predecessor**, both statements in one
  transaction.
- **Withdrawing a correction restores its predecessor**, also in one
  transaction.
- **Both screens** — the operator sees the current version, its history, a
  waiting correction, and a form to upload one; the investor sees the current
  version and, when there is one, a plain sentence saying it replaced something
  they were sent, with the earlier versions still openable.
- **`pnpm verify:documents` grew from 28 checks to 48**, covering the whole
  correction lifecycle against the real database with two investors present.

**Decisions.**

- ***A correction is uploaded unissued, and the investor keeps what they have
  until it is issued.*** This is the same gap the original document package was
  built around, applied to the second version. Superseding at upload time would
  take the document off the investor's portal the moment the operator picked a
  file, leaving them with nothing while he checked it.
- ***Superseding happens at the moment of issue, in the same transaction.*** Two
  statements outside one would have a window in which both versions are current
  or neither is — and "which document does this investor hold" is not a question
  that may have two answers, even for a few milliseconds.
- ***A superseded version stays issued and stays downloadable.*** This is §5.1's
  rule for certificates and there is no reason for documents to differ. Hiding
  the old version would not unsend it — the investor may have it on their
  desktop — and an investor who is told "this replaced what you were sent" and
  cannot see what they were sent is being told less than they already know.
- ***Withdrawal is the exact inverse of issuing.*** Issuing a correction did two
  things, so withdrawing it undoes two. Leaving the predecessor superseded would
  move the investor from "the corrected document" to no document at all, which is
  worse than the state before the correction existed. A predecessor withdrawn
  separately in the meantime stays withdrawn — the restore only reverses what
  this issuance did.
- ***A draft cannot be corrected.*** It was never issued, so there is nothing to
  correct and nobody has seen it; Remove and upload again is already there and
  leaves no half-version behind. It also keeps the chain meaningful: every
  version in one was issued at some point.
- ***A superseded version cannot itself be corrected.*** Correct the current one.
  Allowing a branch would make the chain a tree and "which one do they hold" a
  question with two answers again.
- ***One waiting correction at a time.*** Two drafts both claiming to be version
  2 and both pointing at version 1 would make issuing them in either order
  produce a different history. Refused, with a message saying to issue or remove
  the one already there.
- ***A correction inherits its predecessor's offer rather than accepting one.***
  There is no form field that could move a document onto somebody else's record,
  and a test asserts the action reads no `offerId` at all.
- *Version 1 of a document nobody corrected says nothing on screen.* "Version 1"
  on a document with no history is noise; the label appears the moment there is
  a second version, on both.
- *The chain is walked from `supersedes_id` rather than stored in a lineage
  column.* One source of truth, nothing to disagree with itself. The walk carries
  a cycle guard — nothing here can create a cycle, and a walk that trusts data to
  be acyclic is a walk that hangs when it is not.
- *The investor's list is issued-only, so a chain reaching it may be missing its
  earliest links.* `lineagesOf` starts a chain at the first row present rather
  than requiring a root, so a filtered list groups instead of fragmenting. There
  is a test for exactly that.

**Deviations.** One migration, additive: three nullable-or-defaulted columns and
an index. Nothing existing changed shape, and every document already in a
database becomes version 1 with no history, which is what it is.

**Two pre-existing tests widened, each with the reason written into it.**

- `access.test.ts` counted `issuedAt: null` and expected two. It is three now —
  upload, correction, withdrawal — and the third is the *reason* for the change
  rather than a concession to it: a correction arriving already issued would put
  an unchecked file on the investor's portal the instant it was uploaded. The
  count is now pinned by a second assertion that finds it inside
  `correctDocumentAction` specifically, so three ordinary uploads could not
  satisfy it.
- The same test matched `/issuedAt,?\s*\}/` to prove one writer sets a date. It
  now matches twice, because `supersededAt: issuedAt }` ends in the same three
  tokens — a substring collision, not a second writer. The pattern gained a
  leading `[{,]` so it tests the property shorthand it meant to, and an
  assertion pinning `.set({ issuedAt })` inside the issue action was added
  beside it.
- A third assertion — that no audit metadata in `actions/documents.ts` mentions
  `bytes`, `stored` or `file.name` — was **not** touched. A metadata key named
  `restored` tripped it on the substring "stored"; the local variable and the
  key were renamed to `reinstated` instead, so the test stands exactly as it
  was. Renaming the code was the cheaper of the two and the assertion is worth
  more intact.

Four new shape tests were added alongside: that superseding happens only through
issuing, that clearing it happens only through withdrawal, that both are inside
transactions, that the rules live in the tested module rather than inline, and
that a correction cannot take an offer id.

**Checklist.** Point 5 is this change's; the rest were re-checked because it
changes what an investor's portal renders.

1. **No monetary value is a JavaScript number.** A version number is an integer
   count and is never money; `nextVersion` adds one to it and nothing else
   arithmetic happens in this change.
2. **No send path bypasses anything.** Nothing here sends — issuing a
   correction, like issuing anything, emails nobody. `verify:deployment` re-run:
   41 checks pass.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** The version chain is
   built from rows already selected through the requesting account's own offers —
   `investorDocuments` is unchanged and still joins on the account. `lineagesOf`
   is pure and groups only what it is given. `verify:documents` runs the whole
   correction lifecycle with two investors present and checks that Alice's list
   never mentions Bruno or his account id, that Bruno's list is unmoved
   throughout, and that Alice is still refused his document by id.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched, and a
   superseded document follows the same `portalAccess` result as the current one.
   `verify:lifecycle` re-run: 39 checks pass.
8. **No log line carries a token, a body or a key.** The four new audit entries
   record ids, a title and a version number. The metadata assertion in
   `access.test.ts` is unmodified and passes.
9. **The verification page is still the only indexable route.** No new route —
   an earlier version is served by the existing document route, by its own id.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value.
    Untouched, confirmed by `verify:deployment`.

**Verified.** `pnpm verify:documents` — 48 checks against the real database with
two investors throughout: a correction uploaded while the investor still holds
version 1 and cannot see version 2, a second correction refused while one waits,
issuing producing one chain rather than two documents, the superseded version
still downloadable by her with its file still in the store, an already-superseded
version refused for correction, none of it reaching Bruno, and withdrawing the
correction putting her back to version 1 as current. `pnpm test` — 1732 tests, 90
files. `pnpm verify:viewport` — 130 checks, both changed screens still passing
375px and WCAG AA in Chromium.

**Uncertain.**

- *A correction tells the investor nothing.* Issuing version 2 puts it on their
  portal, marked, and emails nobody — consistent with issuing anything else, and
  the operator's confirmation says so. But a *corrected* document is more likely
  to need saying out loud than a first one, and the application does not say it.
  Whether §5's status 3 should notify at all is still the open question the
  document packages left; a correction sharpens it.
- *Nothing warns an operator whose correction contradicts the timeline.* The same
  gap the original packages had, unchanged.
- *There is no diff.* An investor is told version 2 replaced version 1 and can
  open both. What changed between them is in neither the application nor the
  audit log — only in the description field, if somebody types it. Making the
  description mandatory on a correction was the alternative, and forcing a
  sentence tends to produce "corrected" rather than a reason.
- *A correction's file is never removed, and cannot be.* Both versions are
  issued at some point, so neither is eligible for removal, and a chain of five
  corrections is five PDFs in the store forever. That is the conservative answer
  and it is also a bill somebody pays.
- *`lineagesOf` runs in memory over the documents already loaded.* Correct at
  this scale — a handful per offer — and it would be the wrong shape for an
  offer with hundreds. A recursive query is the answer if that ever happens, and
  it is not the shape of this problem.

---

## WebM — closing the one format that claimed to be stripped and was not

Not a numbered work package. A gap WP15 named in its own Uncertain section and
left open, deliberately and with a description of what closing it would take.

`stripMetadata` passed `video/webm` straight through. The reasoning written
beside it was that the only path producing a WebM here is §13.3's in-browser
recorder, and a `MediaRecorder` stream carries no location, no device serial and
no owner name — nothing to remove. That is true of a *recorded* file. It was
never true of an *uploaded* one, and §13.3 asks for both: *"in-browser recording
and file upload"*. A WebM off a phone, a screen recorder or ffmpeg carries a
`WritingApp` naming the software and often the machine it is licensed to, a
`Title`, a `DateUTC`, a track `Name`, and in `Tags` whatever free text somebody's
editing software wrote. All of it went to the store untouched, and the media
screen told the operator the file had been stripped.

**Built.**

- **`stripEbmlMetadata`** — an EBML walk that neutralises the text a Matroska
  container can carry, in place, without changing the length of anything.
- **`webmWithMetadata`** in the fixtures — a WebM shaped like one a recorder
  produces, carrying the same string in five separate places, plus a Cluster of
  frame data so the length assertion means something.
- **Fourteen tests**, and **seven checks in `pnpm verify:media`** against the
  real store.
- **`stripsMetadata` now answers true for every video format**, so the sentence
  the upload screen shows the operator is true of the file he just chose.

**Decisions.**

- ***In place, byte for byte, exactly as the MP4 stripper works.*** Matroska
  addresses its own elements by absolute position — `SeekHead` entries and
  `CueClusterPosition` are byte offsets from the start of the segment — so
  deleting an element shifts every one of them and produces a file that seeks to
  the wrong place or does not play at all. Nothing here changes a length.
- ***Two treatments, decided by whether the format requires the element.***
  Optional master elements — `Tags`, `Attachments`, `Chapters` — are overwritten
  with a `Void` element of exactly the same total size, `Void` being EBML's
  defined "ignore this padding" and the direct equivalent of the `free` box the
  MP4 stripper writes. `MuxingApp` and `WritingApp` are *mandatory* in Matroska,
  and a track's `Name` lives inside a `TrackEntry` that has to stay, so those
  keep their element and have their payload zeroed. An empty string is a valid
  value; a missing mandatory element is not.
- ***An exact-size `Void` is always possible, and that is why this works.*** EBML
  permits a size to be written in more bytes than it strictly needs, so the
  replacement picks a size-field length that makes one id byte, the size field
  and the payload add up to precisely the span being overwritten. Any span of
  two bytes or more can be covered. There is no case that falls back to leaving
  metadata in place.
- ***`DateUTC` is zeroed rather than voided***, which sets it to the format's own
  epoch of 2001-01-01. A fixed wrong date is better than a real one and better
  than a file that fails validation.
- ***The rules are keyed by scope, not by a global list of ids.*** `Title` is
  only acted on inside `Info`, `Name` only inside a `TrackEntry`, and the walk
  descends only where there is a reason to — never into a `Cluster`, which is
  where all the video is and none of the text. A two-byte id that collides with
  something meaningful at another depth cannot be acted on at the wrong level.
- ***An unknown-size element stops the walk rather than being guessed past.***
  Legal for a live-streamed `Segment`, and its children are still walked; what
  is not done is stepping over it to whatever follows, because there is no
  reliable "whatever follows".
- *A malformed or truncated WebM is returned at its original length rather than
  half-processed.* Every parse step that cannot make sense of what it is reading
  returns instead of guessing, which is the same rule the ISO walker follows.
- *`SeekHead` is left alone.* Voiding `Tags` leaves any `SeekHead` entry pointing
  at it addressing a `Void` instead. Every demuxer checks what it finds at a seek
  position and ignores a mismatch, and rewriting `SeekHead` would mean editing a
  structure whose entries are themselves position-dependent. Recorded under
  Uncertain rather than assumed away.

**Deviations.** No migration, no schema change, no new route, no dependency.
`stripsMetadata` changed answer for one format, which is the point.

**One pre-existing test replaced rather than widened.** `strip.test.ts` had a
test named *"passes WebM through unchanged — the browser recorder is the only
thing that makes one"*, which asserted the old behaviour. It is now *"leaves a
WebM with nothing to remove alone"*, asserting the same bytes come back for the
recorder's output — which is still true, and is now true because nothing
*matched* rather than because nothing was *tried*. The old test was correct
about the old behaviour and would have been wrong to keep.

**Checklist.** Point 8 is this change's; the rest were re-checked because it
changes what is written to the store.

1. **No monetary value is a JavaScript number.** Nothing here touches money. The
   existing test asserting `parseFloat` and `.toNumber(` appear in no media
   module still passes.
2. **No send path bypasses anything.** Nothing here sends; the existing test
   asserting no media module names `sendOneEmail`, `SmtpTransport` or
   `assertCanSend` covers the new code.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** `stripEbmlMetadata`
   is pure and takes bytes; it knows nothing about accounts. `verify:media` runs
   with two investors present throughout — 39 checks pass.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched.
8. **No log line carries a token, a body or a key.** The stripper logs nothing —
   the existing assertion that no media module calls `console` at all covers it —
   and the strings it removes never reach a message, a return value or an audit
   entry. What is removed is overwritten, not reported.
9. **The verification page is still the only indexable route.** No new route.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value.
    Untouched.

**Verified.** `pnpm verify:media` — 39 checks, up from 31, seven of them new: an
uploaded WebM accepted, the name and location it carried absent from the file on
disk, the muxing software absent, the track name absent, the tag block absent,
the length identical so seeking still works, and the file still identifiable as a
WebM afterwards. `pnpm test` — 1746 tests, 90 files. `pnpm verify:viewport` — 130
checks still green.

**Uncertain.**

- *A stale `SeekHead` entry may point at a `Void`.* Harmless in every demuxer
  that checks what it finds — which is all of them, because a seek index is
  advisory — but it is a file that is very slightly less tidy than one written
  from scratch. Rewriting `SeekHead` correctly means editing position-dependent
  entries and is a much larger change for no observed benefit.
- *This is tested against a fixture, not against a file from a real recorder.*
  The fixture is built byte by byte in the repository, so what it contains is
  readable rather than opaque — but a WebM out of a real phone will have
  elements this one does not, and the honest position is that the walk has been
  proved correct on a file this codebase wrote. A recorded file dropped into
  `verify:media` would be the stronger test.
- *Only text-bearing elements this build knows about are removed.* The approach
  is a denylist, which is the opposite of the allowlist the PNG and JPEG
  strippers use, and it is the weaker of the two shapes. An allowlist is not
  available here: a WebM is mostly one enormous Cluster of frame data that has
  to survive verbatim, so "keep only what cannot carry a sentence" would mean
  enumerating every element in Matroska. The denylist covers every element a
  recorder or an editor is known to write text into; something exotic could get
  past it.
- *`CodecPrivate` is not touched.* It carries codec initialisation data, not
  authored text, and zeroing it would break playback outright. It is in principle
  a place bytes could hide, and it is deliberately left alone.

---

## Range requests — the video that would not play on an iPhone

Not a numbered work package. Listed under Uncertain since WP15 as a performance
note, and it was not a performance note.

The portal video route answered every request with the whole file, and said why
in a comment: a browser will download all of it and play it, which for a short
personal video is fine, and a hand-written range parser is a place to get an
off-by-one wrong. The second half of that is true. The first half is not, for a
reason nobody had tested against — **Safari opens a video with
`Range: bytes=0-1` and abandons a server that answers 200 with the entire body.**
Not "plays slowly". Does not play. That is every iPhone and every iPad, on a
portal whose §18 requirement is that it works on a phone before it works
anywhere else.

**Built.**

- **`lib/media/ranges.ts`** — a pure `resolveRange`, and the two `Content-Range`
  header builders. Twenty-two tests, including an exhaustive pass over every
  range expressible against a 32-byte file.
- **`lib/media/serve.ts`** — one place that turns a store and a row into a 200,
  a 206 or a 416, used by both video routes.
- **`MediaStore.getRange`** on the interface, with a real implementation on both
  stores: a file handle and a position on the filesystem, a `Range` header and a
  206 on the object store.
- **Fifteen checks in `pnpm verify:deployment`** against the built application
  over real HTTP with a real investor session.

**Decisions.**

- ***The parser is pure, in one module, with the tests against it.*** The old
  comment's worry was correct and the conclusion was wrong: the answer to "this
  arithmetic is easy to get wrong" is one copy of it with forty assertions,
  not a portal that does not work on a phone.
- ***`Accept-Ranges: bytes` goes on every response, including the whole-file
  one.*** That header is how a player discovers it may seek at all; a file
  served without it will not scrub even when every range request would have
  worked.
- ***Only a single range is honoured.*** A multi-range request is answered 200
  with the whole file, which RFC 9110 explicitly permits — a server may always
  ignore `Range`. Building a `multipart/byteranges` body is the part of this
  that genuinely would be a place to get something wrong, and nothing needs it.
- ***Anything unparseable is answered whole rather than guessed at.*** A
  malformed header, a unit that is not `bytes`, a number too large to be an
  exact integer — all 200. Ignoring a `Range` header is always legal; guessing
  at what a broken one meant is how a wrong slice gets served.
- ***A 416 is only reachable after every access check has passed***, so it tells
  somebody already entitled to the whole file how big it is, and tells an
  anonymous request nothing — an anonymous range request is the same 404 as
  anything else, and there is a check for exactly that.
- ***The range is resolved against the recorded `size_bytes` on the row, never
  against a read.*** Fetching the object to find out how big it is, in order to
  return part of it, would be the whole-file read this exists to avoid. A
  boundary test asserts the partial branch never calls `store.get`.
- ***The filesystem store reads with a handle and a position, not `readFile`
  then `slice`.*** The point of a range request is that a sixty-megabyte video
  is not in memory to serve two seconds of it; slicing after a full read would
  keep the correct HTTP behaviour and throw away the reason for it.
- ***The object store refuses a 200 to a ranged GET rather than slicing it.*** A
  store that ignores `Range` answers with the whole object, and a client that
  quietly sliced that would be indistinguishable from one honouring the range —
  until the memory bill arrived. It is an error naming the problem.
- ***`Range` is not part of the S3 signature.*** S3 signs the headers it is told
  to; an unsigned extra header is permitted. Keeping the signed set identical to
  the plain GET's means one canonical request shape to reason about.
- *Only the two video routes changed.* Images are at most five megabytes and are
  displayed rather than seeked; a document is served as an attachment and its
  twenty-megabyte ceiling was chosen so it would not need a range. Both are
  recorded here rather than done.

**Deviations.** `MediaStore` gained a method, which is a breaking change to the
seam — both implementations have it, the interface requires it, and a third
implementation could not silently omit it.

**Checklist.** Points 5 and 9 are this change's; the rest were re-checked
because it changes what two routes send.

1. **No monetary value is a JavaScript number.** A byte offset is not money. The
   existing test asserting `parseFloat` and `.toNumber(` appear in no media
   module covers both new files.
2. **No send path bypasses anything.** Nothing here sends. `verify:deployment`
   re-run — 56 checks, including that a real invitation is refused off the
   production deployment and a test send to the operator is still allowed.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** Every access check
   runs before a byte is read, unchanged and in the same order — `serveMedia` is
   reached only after `mayViewVideo` has said yes, and the existing boundary
   test still pins that the session is read before the store is touched. A range
   request without a session is the same 404 as an id that does not exist, and
   `verify:deployment` checks it over real HTTP.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched — a
   suspended investor is refused before the range is looked at.
8. **No log line carries a token, a body or a key.** Neither new module calls
   `console`; the existing assertion covers them.
9. **The verification page is still the only indexable route.** A 206 and a 416
   carry the same `X-Robots-Tag` and the same `Cache-Control: private, no-store`
   as the 200, from one header table applied to all three — and a boundary test
   asserts that table is spread exactly three times and defined once, so a
   partial response cannot quietly lose them.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value.
    Confirmed by `verify:deployment`.

**Verified.** `pnpm verify:deployment` — 56 checks, up from 41, fifteen of them
new and all against the built application over real HTTP with a real investor
session: the whole file served with `Accept-Ranges`, `bytes=0-1` answered 206
with exactly two bytes and the right `Content-Range`, an open-ended range from
near the end returning exactly the last four bytes and the right ones, a range
past the end answered 416 naming the size, a partial response carrying the same
privacy and indexing headers as a whole one, and an anonymous range request
answered with the same 404 as anything else. `pnpm test` — 1782 tests, 91 files,
including a store-parity suite that runs the same range assertions against both
implementations and an S3 test that stands up a range-ignoring server and
asserts the client refuses it.

**Uncertain.**

- *No actual Safari has been pointed at this.* The behaviour it needs is now
  provably there — a 206, the right bytes, the right `Content-Range`, and
  `Accept-Ranges` on every response — and "provably correct HTTP" is not the
  same claim as "played on an iPhone". That is the test to run on the first
  deployment, and it takes ten seconds.
- *The whole-file response still reads the whole file into memory.* A request
  with no `Range` header, which is what a `<video>` element sends when it is
  downloading rather than seeking, still holds a sixty-megabyte video in one
  buffer. Streaming it needs the store to hand back a `ReadableStream` rather
  than a `Uint8Array`, which is a change to the seam and to both
  implementations, and is the obvious next thing here.
- *Images and documents do not answer ranges.* Deliberate, and both stated
  above, but a scanned twenty-megabyte execution copy of an agreement is right
  at the edge of where that stops being obviously fine.
- *The `Range` header on the object store is unsigned.* Legal, and it means a
  proxy could alter it without invalidating the signature — which would produce
  the wrong bytes, not a security failure, because the response is not trusted
  for anything but its length. Worth knowing about.

---

## Streaming a media response, instead of holding it in memory

Not a numbered work package. The item the range change left behind, and named
under its Uncertain: *"a request with no `Range` header still holds a
sixty-megabyte video in one buffer."*

Ranges fixed the seeking. They did not fix the shape: every response — the whole
file and every partial one — was read into a `Uint8Array` and handed to a
`Response`, so serving one video to one phone on a slow connection pinned sixty
megabytes of heap for the length of the download. Two investors watching at once
was a hundred and twenty.

**Built.**

- **`MediaStore.openStream(key, range?)`** on the interface, with a real
  implementation on both stores — `createReadStream` with a start and an end on
  the filesystem, the `fetch` response body passed straight through on the
  object store.
- **`serveMedia` builds every response from a stream.** A boundary test asserts
  the module contains no `new Uint8Array(`, no `store.get(` and no `getRange(`
  at all.
- **Eleven tests** across the parity suite, including that a streamed range and
  a buffered one return byte-identical answers on both implementations.

**Decisions.**

- ***`get` and `getRange` stay.*** Several callers genuinely want bytes — the
  ingest verification reads a stored file back to compare it against what was
  uploaded — and making them drain a stream to get a `Uint8Array` would be a
  worse interface for the sake of tidiness. `openStream` is for the one case
  where the bytes are going straight to a socket.
- ***Absence is decided before a stream exists.*** The filesystem store stats the
  file first and the object store checks the status before returning the body.
  A stream that failed part way through would already have sent a 200, and after
  the status line has gone there is no way left to say 404.
- ***`Content-Length` now comes from the recorded `size_bytes`***, not from
  counting what was read — a stream has no length until it has been drained, and
  omitting the header would stop a browser showing a progress bar and stop
  Safari seeking. The row is written from the ingest result and is the authority
  on how big the object is. **A store whose file disagreed with its row would
  now send a wrong length**, which is a real trade and is written into the
  module rather than hidden.
- ***No retry on a streamed read.*** A retry means sending the request again, and
  the caller has already been handed a stream — a second attempt would have to
  be spliced into a response that is partly written. Failing to *start* is still
  an error before anything is sent; failing part way ends the stream, which is
  what a truncated download looks like at every layer anyway.
- ***No timeout on a streamed body.*** The buffered reads abort after thirty
  seconds because a request that has not finished by then has failed. A stream
  is the opposite: a sixty-megabyte video on a slow phone connection is
  *supposed* to take minutes, and a timer would cut it off. A stalled connection
  is the socket's problem to notice.
- *A ranged stream still refuses a 200.* Same rule as the buffered ranged read,
  and the same reason — a store that ignores `Range` must not be able to look
  like one that honours it.

**Deviations.** `MediaStore` gained a second method, so the seam has changed
twice in one session. Both implementations have it and the interface requires
it.

**Checklist.** Point 9 is this change's; the rest were re-checked because it
changes how two routes send their bodies.

1. **No monetary value is a JavaScript number.** Nothing here touches money.
2. **No send path bypasses anything.** Nothing here sends. `verify:deployment`
   re-run — 56 checks pass.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** Every access check
   still runs before a byte is read and in the same order; `serveMedia` is
   reached only after `mayViewVideo` has said yes. The existing boundary test
   pinning that the session is read before the store is touched still passes,
   and `verify:deployment` re-checks over real HTTP that an anonymous range
   request is the same 404 as anything else.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched.
8. **No log line carries a token, a body or a key.** Neither changed module
   calls `console`; a stream is not logged, counted or inspected on its way
   through.
9. **The verification page is still the only indexable route.** The 200, the 206
   and the 416 still carry one header table, spread three times and defined
   once, and the test asserting exactly that still passes. A streamed response
   is as private and as unindexed as a buffered one — and `verify:deployment`
   checks the actual headers on both a whole and a partial response.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value.
    Confirmed by `verify:deployment`.

**Verified.** `pnpm verify:deployment` — the same 56 checks, now passing against
streamed responses: the whole file arriving byte-complete, `bytes=0-1` returning
exactly the first two bytes, an open-ended range returning exactly the last four
and the right ones. That those still pass unchanged is the point — the bytes on
the wire did not change, only where they were held on the way. `pnpm test` —
1791 tests, 91 files, including that a streamed range and a buffered range give
byte-identical answers on both stores. `verify:media`, `verify:object-store` and
`verify:documents` all re-run green.

**Uncertain.**

- *`Content-Length` is now the row's claim rather than an observation.* If a
  stored file were ever a different length from its `size_bytes` — a truncated
  upload, a restore that brought a database back without its bucket — the
  response would announce a length it does not deliver, and a browser would hang
  waiting for bytes that are not coming. Nothing produces that state today: the
  size is written from the ingest result in the same call that stores the bytes.
  A length check on read would cost a stat per request and is the obvious guard
  if it ever matters.
- *A stream that fails after the first byte is a truncated download with a 200
  already sent.* True of every streaming server and not fixable at this layer;
  worth knowing because the buffered version could not do it.
- *The image and document routes still buffer.* Five and twenty megabytes
  respectively, both bounded deliberately, and neither is seeked. Consistency
  would say convert them; the ceilings say it does not matter yet.
- *Nothing has been measured.* The reasoning about memory is arithmetic rather
  than a profile. It is fairly obvious arithmetic — a sixty-megabyte buffer is
  sixty megabytes — but no run of this application has been watched to confirm
  the heap actually drops.

---

## `pnpm media:check` — every stored file, against the row that names it

Not a numbered work package. The safer half of the reconciliation item, and the
guard for the trade the streaming change made an hour earlier.

Three tables hold a `storage_key` and a `size_bytes`. Nothing in normal
operation can make them disagree with what is stored — the size is written from
the ingest result in the same call that writes the bytes — but two things
outside normal operation can, and both are quiet:

- **A restore that brought the database back without its bucket.** `pnpm backup`
  covers Postgres; the objects are somebody else's copy. The symptom is a broken
  image and a document that will not download, discovered one at a time, by
  whoever happens to click.
- **A truncated write.** And this one got worse when responses started
  streaming: `Content-Length` now comes from the row, so a short file makes a
  browser wait for bytes that are never coming rather than failing cleanly. That
  was written into the Uncertain list for the streaming change; this is the
  guard it asked for.

**Built.**

- **`MediaStore.stat(key)`** on the seam — `fs.stat` on the filesystem, a `HEAD`
  request on the object store, so checking a sixty-megabyte video costs a round
  trip rather than a download.
- **`S3ObjectClient.headObject`**, and `HEAD` added to the signed method union.
  SigV4 signs it exactly as a GET.
- **`scripts/check-media.ts`**, run as `pnpm media:check`.
- **`DEPLOYMENT.md` §1.1 and §5** — the restore step now names it.

**Decisions.**

- ***It reports and changes nothing.*** Deleting a row whose file is gone, or
  re-uploading, is a decision for a person holding the backup — and both are
  destructive in a way that a check run from a deployment script must not be.
  Exits non-zero so a script can still stop on it.
- ***`stat` is on the seam rather than in the script.*** The answer should be the
  store's, not the filesystem's, so the same command means the same thing on a
  deployment using a bucket. The parity suite runs the same assertions against
  both implementations.
- ***A HEAD, not a ranged GET.*** The obvious no-new-method alternative was to
  ask for one byte past the end and see what came back — which the filesystem
  answers with an empty read and an object store answers with a 416. Two
  implementations disagreeing about the same question is exactly what the seam
  exists to prevent, and the divergence would have been invisible until a
  deployment moved to a bucket.
- ***A HEAD without a usable `Content-Length` is an error, not a size of zero.***
  A store that answers that way is one this check cannot use, and saying so beats
  reporting every object as the wrong size.
- ***The report names a document's title and a video's published state, never a
  caption or a transcript.*** A report is a log, and checklist 8 applies to it.
- *An unconfigured store with rows in the database is a problem, not a clean
  answer.* If nothing is configured and nothing claims to be stored, that is
  fine and it says so. If nothing is configured and forty rows name a file, that
  is a deployment that has lost its store, and it exits non-zero.

**Deviations.** `MediaStore` gained a third method this session. All three are on
the interface and implemented by both stores.

**Checklist.** Point 8 is this change's.

1. **No monetary value is a JavaScript number.** A byte count is not money.
2. **No send path bypasses anything.** Nothing here sends.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** This is a
   command-line script with no route and no session. It reads three tables and
   none of them names an account.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched.
8. **No log line carries a token, a body or a key.** The report prints a
   document title, a video's published state, an id and two byte counts. Never a
   caption, never a transcript, never a storage key, never the endpoint. An
   unreadable object is reported by the client's own message, which already
   refuses to contain a credential, a signature or a URL.
9. **The verification page is still the only indexable route.** No new route.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value.
    Untouched.

**Verified.** Run three ways against the real database and a real store: with
nothing stored (a clean answer, exit zero); with a correct row, a row whose size
is ten bytes too large, and a row whose file was never written — it found both
problems, named each, printed the recorded and actual sizes, changed nothing and
exited non-zero; and clean again afterwards. `pnpm test` — 1799 tests, 91 files,
including four `stat` assertions run against both stores. `verify:media` and
`verify:object-store` re-run green.

**Uncertain.**

- *The other direction is not built.* Finding objects that no row points at
  needs the ability to list a whole bucket, which means `ListObjectsV2`, its
  paginated XML, and a list operation on the seam. It is a real piece of work and
  the harm it addresses is a storage bill rather than a broken portal, so the
  half that matters was built and the half that costs money was not.
- *The check is only as good as the store's answer.* A store that reported a
  stale length after a failed overwrite would pass. Reading the object and
  counting is the only way past that, and it turns a cheap check into a download
  of everything.
- *It does not verify content.* A file that is the right length and the wrong
  file passes. A hash column on the row would fix it, would have to be added to
  three tables and every write path, and would be worth doing if a document
  package were ever served from somewhere less trusted than a private bucket.
- *Nobody runs it automatically.* It is in the runbook at the restore step and
  in `DEPLOYMENT.md` §1.1, and that is a sentence in a document rather than a
  scheduled job. Reminders already need a scheduler (§18); this belongs beside
  them.

---

## Streaming, merged with the parallel session — and the claim rule, restated

*26 July 2026. This section is written by the session that built streaming a
second time. It is the third collision this repository has had, and the first
one caused by the file that exists to prevent them.*

**What happened.** CLAIMS.md carried a row — *Streaming a media response instead
of buffering it*, claimed 00:02 — and said that a row "more than a few hours
old" belongs to a session that is gone. At 00:07 this session read that row as
stale, on the reasoning that these containers are discarded when a session ends
and the claim commit was the last commit on the branch. That reasoning was
wrong. Five minutes is not a few hours; the other session was alive and pushed a
working implementation an hour later, along with `pnpm media:check`. Two
implementations of the same package, again.

**How it was resolved.** The pushed implementation is the one that stands. It
was merged in whole and this session's version discarded, except for two things
grafted onto it and one test file kept:

- ***`openStream` returns a length as well as a stream.*** The merged-in version
  took `Content-Length` from `size_bytes` on the row, and said so honestly under
  its own Uncertain. But the same session had just built `pnpm media:check`,
  whose entire purpose is that the row and the store can disagree — and on the
  day they do, a length from the row promises bytes that never arrive, which is
  a download that hangs rather than one that ends. The length now comes from
  what the store is about to send: the `stat` the filesystem already does to
  decide the file exists, and the `Content-Length` an object store sends
  anyway. Neither costs a round trip. `Content-Range` is built the same way, and
  a partial read that finds nothing at the offset is the route's ordinary 404
  rather than an empty 206.
- ***A response whose length nobody stated is refused.*** `responseLength` reads
  `Content-Length`, falls back to a 206's `Content-Range`, and returns null
  otherwise — on which `openObjectStream` refuses rather than inventing a
  number. `FakeS3` now sends a length on a whole-object GET, because every real
  store does and a fake that omits one lets a client depend on not having it;
  the genuinely length-less case gets its own bare server in the tests.
- ***`streaming.test.ts` — thirty tests about when bytes move, not which bytes
  arrive.*** This is the part of the discarded version worth keeping, because a
  buffered implementation passes every assertion about a body: a spy store
  proves a built `Response` has pulled zero bytes and that reading it pulls all
  of them; a 200 KiB file proves a body arrives in more than one chunk; a
  descriptor count proves nothing leaks when a reader cancels half way, which is
  what a browser seeking away actually does; a truncated file proves the headers
  describe what will arrive; and an S3 server that sends half a body, waits, and
  sends the rest proves the call returned during the wait.

Everything else is the merged-in session's: the no-retry and no-timeout
reasoning on a streamed fetch (which is better than what this session wrote — a
thirty-second abort would cut off a slow sixty-megabyte download), the
`stat`-before-stream existence check, `headObject`, the `stat` seam, and
`pnpm media:check` entire.

**Decisions.**

- ***The pushed work wins by default.*** Not because it is better line by line,
  but because it is what everyone else's tests, scripts and documents already
  refer to. Choosing the unpushed version would mean re-merging every file it
  touched against work that has moved on.
- ***A graft has to earn itself.*** Two things did — one because it is a
  correctness difference on a state the other session had just built a tool to
  detect, the other because it is the only evidence that the property being
  claimed is actually there. The rest of the discarded version, including a
  neater `getRange` and a `collect` helper, was thrown away. Merging by taste
  costs more than it returns.
- ***CLAIMS.md now says what "stale" means in numbers.*** "A few hours" was read
  as "this session is obviously gone"; it now says that a row minutes old is a
  session still running, and to build something else.

**Deviations.** None from the specification. The deviation from process is the
one described above, and it is written down rather than tidied away.

**Checklist.** Points 5 and 9 are this change's; the rest were re-checked
because the merge touches two routes' responses.

1. **No monetary value is a JavaScript number.** A byte offset is not money, and
   the existing assertion that `parseFloat` and `.toNumber(` appear in no media
   module still covers every file here.
2. **No send path bypasses anything.** Nothing here sends. `verify:deployment`
   re-run in full.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** The access checks
   are unchanged and still run before a byte is read. The one new refusal — a
   stored file shorter than its row — is the route's own 404, the same answer as
   an id that does not exist, so a deployment's storage trouble is not something
   an investor can detect. An anonymous range request is still the same 404,
   checked over real HTTP.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched.
8. **No log line carries a token, a body or a key.** Nothing added calls
   `console`, and the new refusal quotes no part of the response it refuses.
9. **The verification page is still the only indexable route.** `BASE_HEADERS`
   is defined once and spread exactly three times; the boundary test that pins
   that count still passes, and a 206 carries the same headers as a 200.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value.
    Confirmed by `verify:deployment`.

**Verified.** `pnpm typecheck`, `pnpm lint`, `pnpm test`. `pnpm verify:media`,
`pnpm verify:object-store`, `pnpm media:check`, `pnpm verify:documents` and
`pnpm verify:deployment` — the last against the built application over real HTTP
with a real investor session, including every range assertion.

**Uncertain.**

- *Nothing has measured the memory.* The tests prove the bytes move lazily and
  that a body arrives in pieces, which is the mechanism; they do not put a
  number on the saving. A deployment with a real sixty-megabyte video and two
  browsers is where that number comes from.
- *A `Response` that is built and never sent now holds a socket or a descriptor
  until it is collected.* Inherent to handing over a stream rather than a
  buffer. The caller here is Next.js, which sends what it is given.
- *Images and documents still buffer,* at five and twenty megabytes against the
  video's sixty. Deliberate, and now recorded in TEST_ME.md as well.
- *Two sessions can still collide.* A file is not a lock. What is different now
  is that the rule has a number in it, and that this is written down where the
  next session will read it before deciding a row is dead.

---

## Listing a store — the objects no row points at

*26 July 2026. Claimed in CLAIMS.md at 00:42, built after the claim was pushed
and unclaimed by anybody else.*

`pnpm media:check` walks every row and asks whether its object is there. It
cannot, by construction, find the opposite: an object that no row names is
invisible to a check that starts from the rows. The accidents that produce those
are the mirror images of the ones it already covers — a database restored from
*before* an upload, a delete that removed the row and failed on the object, a
bucket shared with something else — and the consequence is worse than
untidiness. An orphaned `document_packages` object is an investor's subscription
agreement sitting in a bucket that nothing references and nobody is managing.

**Built.**

- **`MediaStore.list(limit)`** — the reverse read, on the seam rather than in
  the script, so the answer is the store's own and both implementations are held
  to it. It returns `{ objects, truncated }`, and the limit is required.
- **`readdir` behind it on the filesystem**, sorted, skipping directories, and
  answering an absent directory as empty rather than as a failure.
- **`S3ObjectClient.listObjects`** — `ListObjectsV2`, walking continuation
  tokens, capped by the caller's limit.
- **A signer that knows about query strings and bucket-level requests.**
  `buildCanonicalRequest` takes an optional query, `signRequest` takes an
  optional key and an optional query, `canonicalQueryString` and
  `canonicalBucketUri` are exported and pinned by golden tests. With no query
  the canonical request is unchanged to the character, and the existing golden
  tests still pass without amendment.
- **`parseListResult`** — three patterns rather than an XML dependency, dropping
  any entry it cannot read rather than guessing at one.
- **`pnpm media:check` reports orphans**, with the total bytes, and exits
  non-zero. It now also runs when there are no rows at all, which is the case it
  used to call clean and is in fact the case where *everything* stored is an
  orphan.
- **`FakeS3` answers a listing, with real paging** and a settable page cap, and
  re-derives the signature from the query as it arrived.
- **Twenty-six tests**, including a three-page walk that a client ignoring
  continuation tokens would fail and every other test in the file would not.

**Decisions.**

- ***The limit is required, and truncation is reported.*** A listing with a
  default limit is a report that quietly describes part of a bucket as though it
  were all of it. `list(limit)` refuses a limit that is not a positive integer,
  the client asks for one more than it has room for so that `truncated` is known
  without a second round trip, and the script prints what it did not see.
- ***Orphan keys are printed in full, and nothing else's key ever is.*** The
  rest of the script prints record ids and labels, deliberately, because a
  storage key is how an image is addressed and a key in a CI log is a capability
  in a CI log. An orphan is the exception that proves the rule: every route
  looks the record up *first* and serves nothing without one, so a key with no
  row behind it addresses nothing this application will hand over. The only way
  to act on one is to name it to somebody who already holds the bucket
  credentials.
- ***A listing reports keys this application would refuse to write.*** The
  object store deliberately does not validate keys on this one path: refusing to
  report an object because its name is not one we would have chosen is refusing
  to report exactly the object worth reporting.
- ***`IsTruncated` with no `NextContinuationToken` ends the walk.*** Asking again
  without a token fetches the first page a second time, for ever. Stopping
  under-reports; looping takes the process down.
- ***The query is rendered once.*** `signRequest` builds the canonical query
  string and the URL from the same call, because a URL built from one rendering
  and a signature from another works for `list-type=2` and fails the first time
  a continuation token contains a character that encodes differently — which is
  to say on the second page of a large bucket, and never in a test with three
  objects in it. There is a test pinning the URL for a token containing a slash
  and a space.
- ***`send` took an options bag rather than a fifth positional argument.*** The
  alternative was a second copy of the retry loop for the one verb that has a
  query and no key.
- ***Nothing deletes anything.*** The script reports and exits non-zero. Which
  orphan is a lost upload and which is somebody else's file is not a judgement
  this has the information to make.

**Deviations.** `MediaStore` gained a method. Both implementations have it, and
the parity suite holds them to the same answers.

**Checklist.**

1. **No monetary value is a JavaScript number.** A byte count is not money; the
   existing assertion over the media modules still passes.
2. **No send path bypasses anything.** Nothing here sends; `verify:deployment`
   re-run in full.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** Nothing here is
   reachable from a route. `list` is called from one script, run from a terminal
   by somebody holding the database and the bucket credentials.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched.
8. **No log line carries a token, a body or a key.** The one new thing printed
   is an orphan's key, argued above: it names an object no route will serve, to
   a reader who already holds the credentials for the store it is in. No error
   quotes a response body; `refuse` is unchanged and still matches an error code
   out with a strict pattern.
9. **The verification page is still the only indexable route.** No route
   changed.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value.
    Confirmed by `verify:deployment`.

**Verified.** `pnpm typecheck`, `pnpm lint`, `pnpm test` — 1848 tests in 93
files, up from 1822 in 92. `pnpm verify:object-store` — 36 checks.
`pnpm verify:media` — 39. `pnpm verify:documents` — 48.
`pnpm verify:deployment` — 56 against the built application over real HTTP.
`pnpm media:check` run by hand against a directory holding one orphaned storage
key and one stray text file: both reported, with sizes, exit code 1.

**Uncertain.**

- *No real provider has answered a `ListObjectsV2`.* The paging, the tokens and
  the signature are exercised against a signature-checking fake on localhost.
  The likeliest difference is a provider that returns keys URL-encoded when
  `encoding-type=url` is not asked for — none is supposed to — which would show
  up as orphan names containing `%2F` rather than as a wrong count.
- *Five thousand is a ceiling somebody will eventually hit.* It is reported
  rather than silently obeyed, and the number is one constant in one script.
- *A listing is a moment.* An upload that lands between the row walk and the
  store walk is reported as an orphan it is not. The window is seconds, the
  report changes nothing, and a second run clears it — but somebody reading a
  report at the wrong moment could act on it, so it is written here.
- *Nothing runs this on a schedule.* Still true, and still the most obvious next
  thing: `pnpm reminders:run` already needs a scheduler and this belongs beside
  it.

---

## Streaming an image and a document — the two routes the video left behind

*26 July 2026. Claimed at 00:52, built after the claim was pushed.*

Streaming the video was written up with the same sentence twice, under
Decisions and again under Uncertain: *images and documents still buffer, at five
and twenty megabytes against the video's sixty.* The reasoning was that the
ceiling was a third the size for the same work. It was the right call to defer
and the wrong one to keep, for a reason the note itself contained: the twenty is
a **document package**, which is a signed subscription agreement, and the five is
the **image route** — the one an email client hits, which means forty recipients
opening an invitation is forty of those at once rather than one.

**Built.**

- **All three remaining routes read with `openStream`** — the library image, the
  investor's document download, and the operator's copy of the same document.
  No route in `src/app` now holds a stored object in memory.
- **Every `Content-Length` on those routes comes from the store**, as the video's
  does, rather than from the `size_bytes` column beside the key.
- **Two boundary tests.** One walks every route that touches a media store and
  fails if any of them calls `get` or `getRange`; the other fails if a
  `Content-Length` on one of them is built from anything but the store's own
  count. Both exist because a buffered response and a streamed one carry
  identical bytes — no behavioural test can tell them apart, so the shape has to
  be pinned.
- **Eleven new checks in `pnpm verify:deployment`**, over real HTTP against the
  built application: an image served with no session at all (which is what an
  email client is), the length it declares matching the length stored, every
  byte arriving, an unknown key answered 404 rather than an empty 200, an issued
  document downloading for the investor it belongs to as an attachment with the
  right length and a real PDF header, and the same download without a session
  answered with the same 404 as anything else.

**Decisions.**

- ***The routes were not folded into `serveMedia`.*** It exists to answer range
  requests with `Content-Disposition: inline` and `Cache-Control: private,
  no-store`, and neither of the others wants that: an image is `public,
  max-age=31536000, immutable` because its key is unique per upload, and a
  document is an attachment with a filename built from its title. Sharing the
  function would mean parameterising three header sets through one signature to
  save four lines each. The shared thing is `openStream`, which is the part that
  was actually duplicated.
- ***No range support on either.*** A document is served as an attachment and an
  image is displayed rather than seeked, so nothing asks for a range; adding one
  would be three more code paths and three more places for a 206 to be subtly
  wrong. `Accept-Ranges` is not advertised, so a client is told the truth.
- ***`get` and `getRange` stay on the seam.*** The verification scripts use them
  to compare a stored file against what was uploaded, and draining a stream to
  do that would be worse. The comment on the interface now says plainly that no
  route should, and a test enforces it.
- ***The audit entry now means "the download began".*** The investor's route
  audits `document.downloaded` after the object is opened and before the body is
  sent, where it used to audit after the whole file had been read into memory.
  Neither ever meant the investor received it — a socket can break at any point
  in both — so nothing about the trail's meaning is weaker, but it is a
  different moment and it is recorded here rather than left to be discovered.
- ***Absence is still decided before the audit and before the status line.***
  `openStream` returns null for an object that is not there, which is the same
  404 as before. A stream that failed later would already have sent a 200.

**Deviations.** None.

**Checklist.**

1. **No monetary value is a JavaScript number.** Nothing here touches money.
2. **No send path bypasses anything.** Nothing here sends; `verify:deployment`
   re-run, 67 checks including the base-URL guard.
3. **A jurisdiction block still stops one recipient.** Untouched.
4. **The operator still cannot record, amend or void an approval.** Untouched.
5. **No investor-facing response reveals another investor.** Every access check
   on all three routes is unchanged and still runs before a byte is read: the
   investor's document route still answers a document that exists but is not
   theirs with the identical 404 it gives a document that does not exist, and
   `verify:deployment` now checks the anonymous case over real HTTP as well.
6. **Claim and sign-in tokens are single-use, hashed and expiring.** Untouched.
7. **Suspension revokes sessions and refuses new links.** Untouched — a
   suspended investor is refused before the store is asked anything.
8. **No log line carries a token, a body or a key.** The audit entry is
   unchanged in content: document id, offer id and title, never a byte of the
   file.
9. **The verification page is still the only indexable route.** Every header on
   all three responses is unchanged, `X-Robots-Tag` included.
10. A published Q&A entry carries nothing identifying. Untouched.
11. The AI path cannot change a calculated figure. Untouched.
12. The app still refuses to send when its base URL is not the production value.
    Confirmed by `verify:deployment`.

**Verified.** `pnpm typecheck`, `pnpm lint`, `pnpm test` — 1850 tests in 93
files. `pnpm verify:deployment` — 67 checks, up from 56, eleven of them new and
all against the built application over real HTTP. `pnpm verify:media` — 39.
`pnpm verify:object-store` — 36. `pnpm verify:documents` — 48.
`pnpm acceptance` regenerates `ACCEPTANCE.md` unchanged at 48 criteria.

**Uncertain.**

- *A PDF viewer that wants ranges will not get them.* Stated as a decision
  above; the failure mode is a viewer downloading the whole file rather than
  seeking, which is what it did before.
- *The `document.downloaded` audit fires at a slightly earlier moment.* Argued
  above. If somebody ever wants "was it actually delivered", neither the old
  shape nor the new one answers it, and nothing at this layer can.
- *Nothing has measured the memory here either.* Same as the video: the
  mechanism is proved, the saving is not quantified.

---

## Verifying the reconciliation report itself

*26 July 2026. Claimed at 01:02, built after the claim was pushed. A small
package, and the reason it is one is written below.*

`pnpm media:check` is the command the runbook tells somebody to run after a
restore, and it was the only piece of this application with no automated check
behind it. That is not an oversight in the ordinary sense — it is a script, and
a script is the one kind of code that fails quietly: nothing imports it, so
nothing exercises it, and the signal that it has gone wrong is somebody reading
a clean report about a store that is not clean. The orphan half of it, added an
hour earlier, had been verified by running it by hand once. That is evidence
that expires.

**Built.**

- **A section in `pnpm verify:media` that spawns the real command**, in its own
  process, against a directory it owns and rows it made — one record whose file
  is missing, one orphan with a valid storage key, and one file this application
  would never have written.
- **Ten checks over its actual output and exit code**: non-zero when something
  is wrong; the missing record named by its record id and *not* by its storage
  key; both orphans reported; an orphan named in full; a stray file described as
  what it is; the byte total right; the directory unchanged afterwards; and a
  clean store with no records answered zero, in as many words.

**Decisions.**

- ***It spawns the command rather than importing the logic.*** Importing
  `check-media.ts` runs it — it is a script with a `main()` at the bottom — and
  extracting its logic into a module to make it importable would test the
  extraction rather than the thing the runbook names. What is being verified is
  literally `pnpm media:check`, including its exit code, which is what a
  deployment script reads.
- ***It runs after the cleanup, not before.*** The report is about every media
  row in the database, so exact counts are only assertable when the only rows
  present are the ones the check just made. Running it earlier made "1 file is
  MISSING" depend on what else the script had left lying around — which is
  precisely the sort of assertion that passes for a month and then does not.
- ***The check that a storage key is *not* printed is as important as the ones
  that are.*** A missing record is reported by record id; an orphan is reported
  by key. Those are opposite rules for a reason argued in the previous section,
  and now both directions are pinned.
- ***The two failures found while writing it were kept as evidence rather than
  smoothed over.*** The first run reported four failures: two were my arithmetic
  and my regex, and two were real — the clean-store case cannot be asserted
  while other rows exist. The fix was to move the section, not to loosen the
  assertion.

**Deviations.** None.

**Checklist.** Nothing in the application changed; only a verification script.

1–12. No production code was touched. `pnpm typecheck`, `pnpm lint`, `pnpm test`
(1850 tests), `pnpm verify:object-store` (36), `pnpm verify:documents` (48) and
`pnpm media:check` were all re-run green, and `pnpm verify:media` is now 49
checks, up from 39.

**Uncertain.**

- *It spawns `pnpm`, which assumes `pnpm` is on the path of whatever runs the
  verification.* True of `pnpm verify:deployment` already, which spawns a build
  and a server.
- *The report's exact wording is now load-bearing in ten places.* That is the
  cost of asserting on human-readable output. It is the right cost here — the
  output *is* the product — but rewording the report means updating this
  section, and that is deliberate rather than annoying.
- *Still nothing runs any of this on a schedule.* Unchanged, and still the most
  obvious next thing.

## One reminder runner at a time — the hole the schedule opens

Every one of the twenty packages is built, and the item that has appeared under
*Uncertain* at the end of the last several sections is the same one: nothing
runs any of this on a schedule. Putting the reminder job on a timer is a runbook
line, not a package, so it kept being described as the obvious next thing and
kept not being the thing anybody built.

It turns out it could not have been done safely. `runDueReminders` selects the
rows that are due and then loops, sending them one at a time, and nothing marks
a row as taken until `sent_at` is written *after* the send succeeds. Read as a
command a person types, that is fine. Read as a command a scheduler types, there
is a window between the select and the write that is as wide as the whole run,
and an hourly cron plus a run that lasts longer than an hour puts a second run
inside it. Fifty recipients with SMTP retries and backoff behind them is enough
to last an hour. Both runs select the same rows. Both pass the same gates,
because every gate is a question about the recipient rather than about the run.
The investor receives the same securities email twice.

So the schedule is still not installed — that is one cron line and it is now
written out in `DEPLOYMENT.md` §8 — but the thing it would have run is now safe
to run twice at once.

**Built.**

- **`src/lib/reminders/lock.ts`** — a Postgres advisory lock held for the length
  of a run. `pg_try_advisory_lock`, on its own connection, released in a
  `finally`. A run that cannot take it does nothing at all: no queue refresh, no
  reads, no sends, and a `RunSummary` with `ran: false` so a caller can tell
  *nothing ran* apart from *nothing was due*.
- **A `claimed_at` column on `reminder_events`**, taken by a single atomic
  `UPDATE ... WHERE claimed_at IS NULL ... RETURNING`, placed after every gate
  and immediately before the send. Two runs racing there means one of them
  updates no rows and stops without writing anything.
- **The rest of the system taught what an in-flight row is.** A queue refresh no
  longer deletes one, and still counts its slot so nothing plans a second
  reminder on top of it. It counts against the recipient's cap. It cannot be
  cancelled. It reads as `SENDING` on the queue and shows on the page as *Being
  sent*, above the sent ones rather than buried under them.
- **Rescheduling releases a claim**, and nothing else does.
- **The deadline digest moved inside the lock.** §6.6's email to the operator has
  the same check-then-send shape — read the audit log for a previous digest, then
  send — and two runs both reading "none has been sent" both send one. `withRunLock`
  is re-entrant within a process so the script can hold it across both halves of
  the job while `runDueReminders` still takes it for itself for every other caller.
- **`pnpm reminders:lock`** — asks whether a run is in progress and answers
  `BUSY` or `FREE`. An operational question with an operational answer, and also
  the genuinely separate process that `pnpm verify:reminders` uses to prove the
  lock excludes anybody at all.
- **Thirty new unit tests and thirteen new database-backed checks.**
  `pnpm verify:reminders` is now 42 checks and is registered as a script; the
  last dozen are two runs started at the same instant, a second process refused
  while the first holds the lock, and every one of the in-flight rules above.

**Decisions.**

- ***Two defences, not one.*** The lock alone would cover the case that actually
  happens. It does not cover two deployments pointed at one database, or a
  `sendOne` called from a script while the cron job runs, or somebody changing
  `lock.ts` without reading it. The claim alone would cover all of those and
  would still let two runs both refresh the queue and both walk the same list.
  Either alone is *usually* enough, and "usually" is not the standard for the
  only thing in this application that sends with nobody watching.
- ***`pg_try_advisory_lock`, never `pg_advisory_lock`.*** A run that queues
  behind another run is a run that begins sending at an unpredictable time,
  which is the opposite of what a schedule is for. It tries once and leaves.
- ***The lock takes its own connection.*** An advisory lock belongs to a session
  and `db` is a pool of ten, so the statement that takes it and the statement
  that releases it are not guaranteed to reach the same connection — a pooled
  lock is one that may never be released. The alternative, a transaction-scoped
  lock, fixes that and introduces something worse: the whole run inside one
  transaction, where a rollback erases the record of emails that have already
  left the building.
- ***The claim does not expire.*** This is the decision I expect to be argued
  with, so: a claim with a timeout reopens the window it was added to close, and
  the two failures either side of it are not equal. A reminder that never goes
  out is visible on the queue, marked, and recoverable by one deliberate act. A
  securities email delivered twice cannot be recovered at all. Where the spec is
  silent the conservative option wins, and here the conservative option is the
  one that fails towards silence.
- ***Rescheduling is the release valve, and it is the only one.*** No "clear
  claim" button, because a button that says "this run is dead, let somebody else
  send it" is an override on the gate in everything but name. Rescheduling
  already exists, already requires a person to choose a new time, and already
  writes an audit entry with their name on it. The metadata now records whether
  it released a claim.
- ***An in-flight row counts against the cap.*** It has not been sent, but it is
  being sent, and a cap that only notices afterwards can be exceeded by one every
  time two things happen at once.
- ***The blocked second run exits zero.*** It is the safety mechanism working. An
  alert that fires when nothing is wrong is an alert that gets switched off, and
  the runbook says to read the log line rather than the exit code.
- ***The re-entrancy flag is module-private, not a parameter.*** An option would
  be a way for a caller to turn the lock off, and the standing rule is that
  nothing may add an override to this gate. A caller cannot set this; only
  `withRunLock` does, and it clears it in the same `finally` that unlocks.

**Deviations.** None. `CODEX_TASKS.md` has no WP21 — every package is built —
and this is one of the open items the Uncertain notes have been carrying.

**Checklist.**

1. *Money as a `number`?* No. Nothing here touches money; grepped the changed
   files for `parseFloat`, `Number(` and `.toNumber(` and there is nothing.
2. *A send path bypassing compliance or the token check?* No — the claim is
   placed *after* `loadGateContext('REMINDER')` and after the eligibility and
   staleness checks, so it narrows the send path and never widens it. There is a
   test asserting that ordering against the source text.
3. *One recipient or the whole batch?* One. The claim is per row; a lost race
   stops one reminder and the loop continues.
4. *Can an operator record, amend or void an approval?* Untouched.
5. *Does anything reveal another investor?* No investor-facing surface changed.
   The new state and its explanation are on the operator's reminders page.
6. *Tokens single-use, hashed, expiring?* Untouched.
7. *Suspension?* Untouched.
8. *Does any log line contain a token, a body or a key?* No.
   `try-reminder-lock.ts` prints one word. `run-reminders.ts` gained no field,
   and there is a test asserting it never prints `.email`, `.subject`, `.html`
   or `.text`.
9. *Indexable routes?* None added.
10. *Published Q&A?* Untouched.
11. *Can the AI path change a figure?* Untouched.
12. *Base-URL guard?* Untouched, and still inside `sendOneEmail`, which is still
    behind the claim.

`pnpm typecheck`, `pnpm lint`, `pnpm test` (1880, up from 1850) and `pnpm build`
are green. `pnpm verify:reminders` is 42 of 42, `pnpm verify:lifecycle` 39,
`pnpm verify:roadmap` 18, and `pnpm media:check` is clean.

**Uncertain.**

- *The cron line is written and installed nowhere.* This package removed the
  reason not to install it; it did not install it. That is still a deployment
  step and it still needs a machine.
- *The re-entrant flag assumes the nesting is sequential.* It is — the script
  awaits the reminders, then the digest — but two `withRunLock` calls genuinely
  concurrent inside one process would both proceed once the flag is set. Nothing
  does that today and nothing should; if something ever needs to, the flag should
  become a counter with a queue rather than a boolean.
- *A run killed between the claim and the send leaves a row nobody will send.*
  Deliberately, and the runbook says what to do. But nobody has been woken up by
  it yet, and the honest test of "visible and recoverable" is somebody
  encountering it cold rather than me asserting it here.
- *Nothing yet notices that a reminder has been marked "being sent" for six
  hours.* The state is visible if the operator opens the page. It is not visible
  if they do not. A daily check that looks for stuck claims is the obvious next
  thing, and it is the same shape as the media check — a script that reports and
  never acts.

## The things nobody is watching — `pnpm check:health`

The previous section ended by saying that nothing notices a reminder marked
"being sent" for six hours, and that the state is visible if the operator opens
the page and not visible if they do not. That is true of almost everything in
this application, and it is the sentence this section is about.

Every quiet failure here already has a surface. The reminders page says why a row
will not send, evaluated at the moment you look. The dashboard carries the mail
connection and the compliance state permanently. The round page says who has not
answered. Each of those is well built and each of them requires a person to open
it.

The failure that survives all of them is the one where nobody does. A scheduler
that was never installed, or that stopped in March, looks from inside the
application exactly like a quiet week: the queue fills with rows whose dates have
passed and nothing anywhere says that the thing which was supposed to act on them
is not running. There is no page for "is anything running", because the
application cannot see outside itself. An expired app password looks like nobody
has sent anything lately. A run killed between taking a reminder and finishing
with it leaves one row on a page that may not be opened for a fortnight — and
that failure mode was *introduced by the previous section*, deliberately, as the
price of a claim that never expires.

So: one command that asks all of those at once, in a shape a scheduler can run
and a person can read afterwards.

**Built.**

- **`src/lib/health/rules.ts`** — the judgement, and nothing else. It takes facts
  and returns findings, so every rule is testable with no database, no mail
  server and no clock. Seven rules: the scheduled run, stuck claims, the mail
  connection, compliance drift per template, the service mode, the §18.1 base-URL
  guard, and deadlines that have passed.
- **`src/lib/health/report.ts`** — the reads, and no judgement. The split means
  one layer can only be wrong about *what is true* and the other only about *what
  that means*, and the second is where the interesting mistakes are.
- **`pnpm check:health`** — prints the report worst-first, exits non-zero only
  when something needs a person.
- **`pnpm verify:health`** — 21 checks that spawn the real command against a
  database put into each bad state in turn, and read its actual output and exit
  code.
- **46 unit tests** over the rules, and three more cron lines in `DEPLOYMENT.md`
  §8 — the health report daily, `media:check` weekly, alongside the hourly
  reminder job.

**Decisions.**

- ***The primary signal is "when did a run last complete", not "is anything
  overdue".*** Overdue rows are a symptom with several causes; a run that has not
  completed in three hours has one. It also means a dead scheduler is reported as
  a fault *even when nothing is due*, which is the whole point — it will still be
  dead when something is. The two are reported separately, and the overdue
  finding is suppressed when the scheduler is the cause, so a dead cron reads as
  one problem rather than two unrelated ones.
- ***Three hours before a missing run is a fault.*** Two missed hourly runs and
  then some. Long enough that a restart, a slow run or a clock skew raises
  nothing; short enough that a scheduler which died overnight is a fault by
  breakfast.
- ***One hour before an in-flight reminder is stuck.*** A run sends one recipient
  at a time with retries behind each, so a long *run* is normal — but a single
  message taking over an hour is not, and the run that took it is not coming
  back.
- ***A non-active service mode and a non-production `APP_URL` are notes, not
  faults.*** Both are correct behaviour somewhere. A check that goes red because
  the round is in read-only mode is a check that gets ignored, and an ignored
  check is worse than no check. The exit code separates "something needs a
  person" from "something is worth knowing".
- ***Severity depends on what is waiting.*** An unhealthy mail connection with
  nothing due is a note; the same connection with reminders due is a fault. Same
  for an unapproved reminder template. The state has not changed — its
  consequences have.
- ***It never acts.*** No auto-release of a stuck claim, no re-verification of a
  credential. Deciding a stuck reminder is safe to release needs somebody who
  knows what has been happening, and doing it automatically would be the claim
  expiry that the previous section argued against, wearing a different hat.
- ***It names no email address, including the sending account's own.*** The mail
  connection's summary names the Gmail address it authenticated as, which is
  right on the dashboard and wrong here: this is built to be appended to a log
  file by a scheduler, and a log file is the least protected place in a
  deployment. Borrowed text is masked at the boundary rather than paraphrased, so
  the connection's own wording still comes through. It is the operator's own
  address rather than an investor's, so this is caution rather than a breach —
  but the reminder job prints no address for exactly this reason and the thing
  watching it should not be the looser of the two.
- ***`verify:health` hides the real audit entries rather than deleting them.***
  The audit log is append-only. To test "no run has ever completed" against a
  database that has some, the action is renamed for the duration and renamed
  back, and there is a check at the end that every one returned.

**Deviations.** None. This is not a work package — all twenty are built — and it
is the item the last several Uncertain notes have been carrying.

**Checklist.**

1. *Money as a `number`?* No. The report carries counts and no figures, and there
   is a test asserting no amount or percentage appears in any finding. The offer
   inserted by `verify-health.ts` passes its money as strings.
2. *A send path bypassing a gate?* Nothing here sends. There is a source-level
   test asserting `report.ts` and `check-health.ts` contain no `sendOneEmail`,
   no `sendInvitation` and no `nodemailer`.
3. *One recipient or the whole batch?* Not applicable; nothing sends.
4. *Can an operator record an approval?* Untouched — and the compliance finding's
   remedy says explicitly that only the owner can, so it does not send the
   operator at a wall.
5. *Does anything reveal another investor?* No investor-facing surface exists
   here at all. The report is a command, not a route.
6. *Tokens?* Untouched.
7. *Suspension?* Untouched.
8. *Does any log line contain a token, a body or a key?* No, and this is the one
   the package thought hardest about — see the address decision above. Tested
   twice: in the unit tests over every finding, and in `verify:health` against
   the real command's real output.
9. *Indexable routes?* None added. Nothing was added to `src/app` at all.
10. *Published Q&A?* Untouched.
11. *Can the AI path change a figure?* Untouched.
12. *Base-URL guard?* Untouched, and now reported on: the health check says which
    URL is configured and whether it permits sending.

`pnpm typecheck`, `pnpm lint` and `pnpm test` (1926, up from 1880) are green.
`pnpm verify:health` is 21 of 21 and `pnpm verify:reminders` is still 42.

**Uncertain.**

- *Nothing tells anybody the check went red.* It exits non-zero, which is the
  right shape for a scheduler to notice, but wiring that to an email or a phone
  is a decision about who gets woken up and when — and adding a second unattended
  sender to this application is not a decision to make quietly. Where the spec is
  silent the conservative option wins, so for now it writes to a log.
- *It does not know when a backup last ran.* That would be a valuable line in
  this report and `scripts/backup.ts` records nothing to read, so it would need an
  audit entry first. A backup that stopped in March is exactly the shape of
  failure this exists for.
- *The thresholds are hardcoded.* Three hours and one hour are argued for above,
  and they are right for an hourly job. A deployment that ran the job daily would
  want different numbers, and would currently have to edit the source.
- *`media:check` and `verify:*` still are not reported on by anything.* The cron
  lines are written; a `media:check` that starts failing weekly would land in a
  log nobody reads, exactly like the reminder job did before this. Folding its
  result into the health report is the obvious next step and it is small.

## The health report where the operator will see it, and a backup signal

The previous section built `pnpm check:health` and put it under Uncertain that
"nothing tells anybody the check went red". That is the smaller half of the
problem. The larger half is that the report only existed as a command, and the
person who would have to act on almost everything in it — a stopped scheduler, a
stuck reminder, a mail credential that expired — does not have a terminal and
would not be reading a log file if he did.

So the same report, from the same rules, on the screen he already opens.

**Built.**

- **`/health`, "System health"** in the admin navigation, for the owner and the
  operator both. Findings sorted with anything that needs a person at the top,
  then the notes, then what was checked and found fine. Read-only: no form, no
  action, no button. Every finding names the page that fixes the thing.
- **A backup signal.** `pnpm backup` now writes `backup.completed` to the audit
  log on a successful dump, and the report says when the last one was.
- **Eleven source-level tests on the page** — guarded before it reads anything,
  `noindex`, `force-dynamic`, no writes, no sends, no second set of rules — and
  five more on the backup rule.
- **`/health` added to `pnpm verify:viewport`**, which is 135 checks and passes:
  375px, no overflow, 44px tap targets, AA contrast.

**Decisions.**

- ***Both the command and the page, not one of them.*** They answer different
  questions. The command is what notices at three in the morning and exits
  non-zero; the page is what somebody sees at the moment they might do something
  about it. Neither substitutes for the other, and they share every rule, so
  there is no second implementation to drift.
- ***The operator sees it, not only the owner.*** Almost everything on it is the
  operator's to act on. Hiding it from him would be hiding it from the only
  person likely to look.
- ***The page has no buttons, deliberately.*** The obvious next step from "this
  reminder is stuck, reschedule it" is a reschedule button right there. That
  would be a second path into an action with a different set of checks in front
  of it, which is how the two eventually disagree. There is a test pinning it,
  because the rule is much easier to keep than to recover.
- ***`force-dynamic`.*** A cached health page is a page that tells you everything
  is fine because it was, an hour ago.
- ***A missing backup record is never a fault.*** This can only say when `pnpm
  backup` last ran here. A deployment snapshotted by its host is backed up
  perfectly well and has nothing to record, and a report that called that a fault
  would be wrong every day until somebody switched it off. It says what it knows
  and names the limit of it — which is the more conservative option and the more
  useful one.
- ***Two days before a stale backup is mentioned***, and still only as a note. A
  nightly regime gets one missed night in silence.
- ***`pnpm backup` now exits explicitly.*** Recording the dump opens a connection
  pool, which holds the event loop open — the command did its work and then
  appeared to hang, which on a cron is indistinguishable from a backup that never
  finished. Found by running it.

**Deviations.** None.

**Checklist.**

1. *Money as a `number`?* No. The page renders findings, which carry counts and
   no figures, and there is a test asserting no amount or percentage appears.
2. *A send path bypassing a gate?* Nothing sends. Tested at the source level on
   the page and on both health modules.
3. *One recipient or the whole batch?* Not applicable.
4. *Can an operator record an approval?* No, and the compliance finding says so
   in its remedy rather than sending him at a wall.
5. *Does anything reveal another investor?* No investor-facing surface changed.
   `/health` is behind `requireOnboardedAdmin()`, and the findings name reminder
   ids and counts — no name, no address.
6. *Tokens?* Untouched.
7. *Suspension?* Untouched.
8. *Does any log line contain a token, a body or a key?* No. The backup audit
   entry carries the file's base name and its size — not the directory, which is
   a fact about the machine, and not the connection string.
9. *Indexable routes?* `/health` sets `index: false`, and the existing test that
   enumerates every page and asserts exactly two opt into indexing still passes.
10. *Published Q&A?* Untouched.
11. *Can the AI path change a figure?* Untouched.
12. *Base-URL guard?* Untouched, and reported on.

`pnpm typecheck`, `pnpm lint`, `pnpm test` (1942, up from 1926) and `pnpm build`
are green. `pnpm verify:health` is 21 of 21 and `pnpm verify:viewport` is 135 of
135 with the new page in it.

**Uncertain.**

- *Still nothing tells anybody the check went red.* Unchanged, and now with one
  more place it could be noticed from. Wiring the non-zero exit to an email is a
  decision about who gets woken up, and adding a second unattended sender to this
  application is not a decision to make quietly.
- *The page is not linked from the overview.* It is in the navigation, which is
  enough to find but not enough to notice. A single line on the overview saying
  "two things need you" would be the thing that actually catches an eye, and it
  is small.
- *`media:check` still reports into a log of its own.* Folding its result into
  the health report would mean one thing to watch rather than three. It needs the
  media check to become importable rather than a script with a `main()`.
- *`pnpm verify:restore` was re-run after the backup script changed* and is 14 of
  14. Recorded here because "the change is additive so it should be unaffected"
  is exactly the phrase that precedes finding out otherwise.

## Health on the overview — the line that catches an eye

The previous section left this under Uncertain: *the page is not linked from the
overview; it is in the navigation, which is enough to find but not enough to
notice.* That is the whole gap. A health page nobody opens is a log file nobody
reads with better typography.

**Built.**

- **A banner on the admin overview**, shown only when something needs a person,
  naming what it is about and linking to `/health`.
- **A permanent "System health" card** alongside it, so that when the banner is
  silent there is still a way through — and so that "no banner" is never
  ambiguous between nothing wrong and nothing checked.
- **`readUnattendedAlert()`** — two queries, and a strict subset of the same
  rules the full report uses.
- **`overdueFindings` split out of `schedulerFindings`**, because it is the one
  scheduler rule that costs a query per offer.
- **Nine more tests**: four on the subset, five on the page.

**Decisions.**

- ***The banner is silent on a healthy system.*** A banner that says "all is
  well" every day is a banner nobody reads on the day it says otherwise. This is
  the opposite of the rule on the health page itself, which lists what it checked
  and found fine — and deliberately so. There, silence would be ambiguous,
  because looking at the health is why you opened it. Here, the permanent card
  removes the ambiguity and the banner is free to mean something.
- ***It reads two queries, not the whole report.*** `buildHealthReport` reads
  every template, evaluates the eligibility of every queued reminder — a query
  per offer — and loads the round summary. That is the right cost for a page
  somebody opened to look at the health and the wrong cost for the page everybody
  lands on. `UnattendedFacts` is the cheap subset and `HealthFacts` extends it,
  so the same rule functions run on both surfaces and there is nothing to drift.
  There is a test asserting the banner's findings are a strict subset of the
  page's, and another asserting the minimal fact object still satisfies the
  rules.
- ***The subset is the two things nothing else surfaces.*** Not an arbitrary
  cheap half. The mail connection has its own panel on the overview and the
  service mode its own card; repeating them in a banner would be noise. Whether
  the scheduled job is running, and whether a run abandoned a reminder mid-send,
  are surfaced nowhere else in the application at all.
- ***`overdueFindings` is silent when the scheduler is the cause.*** It was
  already, inside `schedulerFindings`; splitting it out made the condition
  explicit and testable, and the test now covers both ways the scheduler can be
  the cause — never run, and run too long ago.

**Deviations.** None.

**Checklist.**

1. *Money as a `number`?* No. The banner carries one count of findings.
2. *A send path bypassing a gate?* Nothing sends.
3. *One recipient or the whole batch?* Not applicable.
4. *Can an operator record an approval?* Untouched.
5. *Does anything reveal another investor?* No. The banner names no recipient —
   tested — and the overview is behind `requireOnboardedAdmin()` as before.
6. *Tokens?* Untouched.
7. *Suspension?* Untouched.
8. *Does any log line contain a token, a body or a key?* Nothing new is logged.
9. *Indexable routes?* No route added. The enumeration test still passes.
10. *Published Q&A?* Untouched.
11. *Can the AI path change a figure?* Untouched.
12. *Base-URL guard?* Untouched.

`pnpm typecheck`, `pnpm lint`, `pnpm test` (1952, up from 1942) and `pnpm build`
are green. `pnpm verify:health` is 21 of 21 and `pnpm verify:viewport` 135 of 135
with the overview's new banner and card measured at 375px.

**Uncertain.**

- *The banner has never been seen in a browser with a fault behind it.* The
  viewport run exercises the healthy branch, because the database it runs against
  is healthy — which means the one rendering that matters most is the one nobody
  has looked at. Its markup is the same `Notice` used elsewhere, so this is
  unlikely rather than unknown, and unlikely is not the same thing.
- *Still nothing tells anybody without somebody looking.* Two surfaces now, both
  requiring a person. The non-zero exit from `pnpm check:health` remains the only
  thing a machine could act on, and nothing acts on it.
- *`media:check` is still a third thing to watch.* Folding it into the report
  would need the media check extracted from its script, and it should come with a
  bound on what it costs — it stats every stored object, which is fine for a
  command and would need thinking about on a page.

## The media check, folded into the health report — three logs become one

The previous three sections each ended with the same line under Uncertain:
*`media:check` is still a third thing to watch.* `pnpm check:health` answers
whether the scheduled job is running, `pnpm backup` records itself so the report
can say when the last dump was, and `pnpm media:check` — the one that asks
whether every stored file is actually there — wrote to a log of its own that
nothing reads. An operator watching two of the three is watching the wrong
number of things.

The note also said what made it awkward, which turned out to be the whole design
question: *it should come with a bound on what it costs — it stats every stored
object, which is fine for a command and would need thinking about on a page.*

**Built.**

- **`src/lib/media/reconcile.ts`** — the comparing, lifted out of the script.
  `collectTrackedFiles()`, `countTrackedFiles()`, and `reconcile(store, rows)`
  returning a `Reconciliation` rather than printing one.
- **`scripts/check-media.ts` is now the printing and the exit code**, and
  nothing else. Every string it emits is unchanged, which the existing
  `pnpm verify:media` assertions hold it to.
- **It writes one line to the audit log when it runs** — `media.checked`, counts
  only — the same shape `pnpm backup` established.
- **`storageFindings`** on the health report, and **`mediaProblemFindings`**
  shared with the overview banner, so a missing file reaches the first screen
  after sign-in.
- **`MEDIA_CHECK_STALE_DAYS = 10`**, against the weekly cron in `DEPLOYMENT.md`
  §8.
- **Twenty-seven unit tests** on the reconciliation and the new rules, and
  **ten more database-backed checks** across `verify:health` (21 → 31) and
  `verify:media` (49 → 54).

**Decisions.**

- ***The report reads a verdict; it never reconciles.*** This is the bound the
  note asked for, and it is a stronger one than a limit or a timeout would have
  been. Reconciling means a `stat` per stored object and a listing of the whole
  bucket — network round trips, unbounded in the number of files, inside a page
  render and inside a report a scheduler runs every morning. So the command
  writes down what it found and the report reads the line: one indexed query,
  fixed cost, no network. The full report adds three `count()` queries to know
  whether there is anything to check at all; the banner does not even pay those.
- ***Which means "nobody has run it" is itself a finding.*** That is the price
  of reading a verdict rather than taking one, and it is paid explicitly: a
  store with no recorded check reports **"No media check has been run against
  this store"** rather than silence. Silence would be indistinguishable from
  clean, which is the exact failure the whole health report exists to close.
  It is ATTENTION rather than WRONG — nothing is known to be wrong; nothing has
  looked.
- ***A run that had no store to check does not count as a run.*** The audit line
  carries `storeConfigured`, and a report reading one written by a deployment
  with `MEDIA_STORE=""` treats it as no check at all. Otherwise switching the
  store off and on again would leave a clean-looking record of a run that
  examined nothing.
- ***No store and no records is OK, not a warning.*** §13.2 is explicit that the
  portal, the invitation and the certificate are all complete with an empty
  media library, and that is the state a fresh install is in. No store *with*
  records is WRONG, because every one of those rows points at a file this
  deployment cannot read.
- ***The audit line carries counts and nothing else.*** No storage key, no
  document title, no record id. The command prints orphan keys to its own
  output deliberately — naming one is the only way to act on it — but the audit
  log is exported to a spreadsheet and read on a screen, and a key there outlives
  the reason for it. A document's title is an investor's document's title. There
  is a test that serialises the record and asserts none of the three appear.
- ***Parsed, not cast.*** The script writes the metadata and the report reads it
  weeks later, which is exactly the gap a shape drifts across. Both ends use
  `mediaCheckRecordSchema`, and a row that does not parse is treated as no row —
  a health page that threw on a malformed audit entry would take down the whole
  report over its least important finding.
- ***The banner gets the problem case only.*** `mediaProblemFindings` takes
  `UnattendedFacts` and one query, so a missing file appears on the overview.
  The "no store configured, and records that need one" case needs the three
  counts to describe properly and stays on the full report — it is a deployment
  configuration change rather than something that happens on a Tuesday, and the
  daily command catches it. The strict-subset test now covers a media fault as
  well as a scheduler one.
- ***`verify:health` hides existing `media.checked` rows for the duration.***
  `pnpm verify:media` spawns the real command several times and each run leaves
  a line, so "nothing has ever checked this store" cannot be arranged by hoping
  there is not one. Same rename-and-restore treatment the completed reminder
  runs already got, and the same assertion afterwards that every hidden row came
  back.

**Deviations.** None.

**Checklist.**

1. *Money as a `number`?* No. Everything added is a count of files or problems.
2. *A send path bypassing a gate?* Nothing added sends.
3. *One recipient or the whole batch?* Not applicable.
4. *Can an operator record an approval?* Untouched.
5. *Does anything reveal another investor?* No. The findings carry counts and no
   title, name or key — tested — and both surfaces are behind
   `requireOnboardedAdmin()` as before. No investor-facing file changed.
6. *Tokens?* Untouched.
7. *Suspension?* Untouched.
8. *Does any log line contain a token, a body or a key?* No. The audit metadata
   is nine numbers and booleans, and `assertNoSecrets` sees them. The report
   prints no storage key, and there is a test asserting the pattern never
   appears in a finding.
9. *Indexable routes?* No route added.
10. *Published Q&A?* Untouched.
11. *Can the AI path change a figure?* Untouched.
12. *Base-URL guard?* Untouched.

`pnpm typecheck`, `pnpm lint`, `pnpm test` (1979, up from 1952) and `pnpm build`
are green. `pnpm verify:health` is 31 of 31, `pnpm verify:media` 54 of 54, and
`pnpm verify:viewport` 135 of 135.

**Uncertain.**

- *Nothing still tells anybody without somebody looking.* Unchanged, and now
  covering one more thing. The non-zero exit from `pnpm check:health` remains
  the only signal a machine could act on, and nothing acts on it. Wiring it to
  an email means adding a second unattended sender to this application, which
  is a decision about who gets woken up rather than a piece of work.
- *A clean media check can be up to a week stale and the report will still call
  it clean.* It says when the run was, so the reader can tell — but "last media
  check 6 days ago, and it was clean" describes a state that may have changed
  the day after. The alternative is reconciling on the page, which is the cost
  this deliberately refused. Sharpening it would mean the check running more
  often, not the report working harder.
- *The overview banner still has no rendering with a fault behind it.* The
  viewport run exercises the healthy branch, because the database it runs
  against is healthy. Unchanged from the previous section, and now one more
  finding could put it there.
- *`countTrackedFiles` counts every row in `document_packages`, superseded
  versions included.* That is right for "how many records name a stored file",
  because a superseded version still has an object behind it — but it means the
  "records added since the last check" clause counts a correction as an
  addition. Harmless, and worth knowing before somebody reads that number as a
  count of documents.

## The banner, rendered with a fault behind it — and the disagreement it found

Two sections have now ended with the same note: *the banner has never been seen
in a browser with a fault behind it. The viewport run exercises the healthy
branch, because the database it runs against is healthy — which means the one
rendering that matters most is the one nobody has looked at. Its markup is the
same `Notice` used elsewhere, so this is unlikely rather than unknown, and
unlikely is not the same thing.*

It was not unlikely. Rendering it found two faults, and the second is the reason
this was worth doing.

**Built.**

- **`pnpm verify:viewport` now renders the fault branch.** Two faults are induced
  in the audit log — the completed reminder runs hidden, and a `media.checked`
  line saying three things were wrong — and the overview and the health page are
  measured at 375px with the banner on screen, exactly as every other screen is.
  Then it is all put back and the overview is loaded again, because *"the banner
  is gone when the fault is"* is the other half of the claim and a banner that
  was always there would have passed every check above it.
- **The banner names what its findings are about**, derived from them.
  `readUnattendedAlert` returns the distinct areas and `describeAreas` turns them
  into a phrase.
- **`storageFindings` no longer loses a recorded problem when the store is
  switched off.**
- **A matrix subset test** — 96 combinations of store configuration, last media
  check, last run and stuck claims — asserting the banner is a strict subset of
  the page in every one.

**What rendering it found.**

1. ***The banner was still describing the two rules it had when it was written.***
   Its sentence was typed into the page: *"the scheduled reminder job, or a
   reminder a run took and never finished sending"*. Adding the media check to
   the subset in the previous section made that silently false — the banner
   would appear because a document was missing and then tell the reader to go and
   look at the reminder job. A hardcoded sentence has nothing to check it
   against, so it is now derived from the findings, and the page test asserts the
   old prose is gone rather than merely that new prose is present.
2. ***The banner and the health page disagreed.*** With no media store configured
   — which is this repository's own default, and the state every developer runs
   in — the banner reported *"the last media check found 3 problems"* and the
   page said *"No media store is configured, and nothing needs one."* The page's
   rule read the configuration first and returned early; the banner's rule read
   the last check's verdict and knew nothing about configuration. The strict
   subset test passed throughout, because its one arrangement of facts had a
   store configured.

**Decisions.**

- ***Switching the store off does not find a missing file.*** `storageFindings`
  now emits `mediaProblemFindings` unconditionally and treats the configuration
  findings as additions to it. The one place it does not add is where the two
  would argue: with no store, no records needing one, and a recorded problem, the
  problem is reported and *"nothing needs one"* is not, because a report that says
  both is a report nobody trusts.
- ***The subset test is a matrix, not an example.*** One arrangement of facts
  proved a property that did not hold. The invariant is over all facts, so the
  test is too — every combination of the four storage states, four media
  verdicts, three run ages and two claim states.
- ***The browser check reads the banner, not the page, for an address.*** The
  overview greets whoever is signed in by their own address when they have no
  name set, which is their own address on their own screen. Scoping the
  assertion to the banner keeps it about the thing that must carry nobody's.
- ***Both faults are induced in the audit log and both are put back.*** Same
  rename-and-restore treatment `verify:health` uses, with the check afterwards
  that nothing is left renamed. The log is append-only; a verification script is
  not an exception to that.

**Deviations.** None.

**Checklist.**

1. *Money as a `number`?* No. Counts of findings.
2. *A send path bypassing a gate?* Nothing added sends.
3. *One recipient or the whole batch?* Not applicable.
4. *Can an operator record an approval?* Untouched.
5. *Does anything reveal another investor?* No, and this is now checked in a
   browser rather than in the source: the rendered banner is asserted to contain
   no email address, no investor name and nothing under the fixture prefix.
6. *Tokens?* Untouched.
7. *Suspension?* Untouched.
8. *Does any log line contain a token, a body or a key?* Nothing new is logged.
9. *Indexable routes?* No route added.
10. *Published Q&A?* Untouched.
11. *Can the AI path change a figure?* Untouched.
12. *Base-URL guard?* Untouched.

`pnpm typecheck`, `pnpm lint`, `pnpm test` (1985, up from 1979) and `pnpm build`
are green. `pnpm verify:viewport` is 155 of 155, up from 135, and
`pnpm verify:health` is 31 of 31.

**Uncertain.**

- *The viewport run needs a Chromium.* This container's is at a build the pinned
  Playwright does not expect, so it was run with `CHROMIUM_PATH` pointing at the
  installed one — an escape hatch the script already had. Nothing was installed
  and nothing was pinned differently; worth knowing before somebody reads a
  failure to launch as a failure of the application.
- *Only two of the three banner rules have been rendered.* The stuck-claim
  finding is on the banner and was not one of the two faults induced, because
  arranging one needs an offer and a reminder row rather than an audit entry. Its
  markup is the same `Notice` with the same wrapping, which is the argument that
  was wrong last time.
- *Nothing still tells anybody without somebody looking.* Unchanged. The
  non-zero exit from `pnpm check:health` remains the only machine-readable
  signal, and nothing acts on it.
