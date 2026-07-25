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

**Built:** email-and-password sign-in for the two administrators, and the operator onboarding flow behind it. Argon2id at OWASP's current parameters, a twelve-character minimum checked against a common-password list, no composition rules. Progressive delay by address and by IP — 0, 0, 250ms, 500ms, 1s, 2s, 4s, 8s — then a fifteen-minute lock after ten failures. Server-side sessions as rows, twelve-hour expiry, revocable individually or all at once. Single-use expiring operator invites. The five-step operator onboarding from §2.1, resumable because progress is derived from stored facts rather than from wizard state. An owner settings page holding the OpenAI key, write-only and encrypted, never redisplayed.

First run works as §2.2 describes: the seed creates the allowlisted accounts with no password and prints a one-time expiring setup link for each. Redeeming a link establishes a session that can reach exactly one page — "choose a password" — and choosing one ends every session including that one. A password never appears in an environment variable, a configuration file, an audit entry or a log line.

Verified end to end against the running application, not only in unit tests: the link redeems once and refuses the second time; a session holding no password is redirected away from `/admin`, `/admin/settings` and `/admin/onboarding`; the correct password signs in; setting a password deletes every existing session row; the stored value is an argon2id verifier; and a wrong password, an unknown address and an allowlisted account that has never chosen a password all fail identically.

**Decisions:**

- *Sign-in looks every attempted address up, including one that is not on the allowlist.* Skipping the lookup for an address that cannot sign in anyway saves a query and changes no outcome, which is what made the earlier version look reasonable. It also made the storage layer observable: when the store failed, an allowlisted address answered "unavailable" and every other address answered "not accepted". Two different answers keyed exactly on allowlist membership, readable from the sign-in form by anyone who tried it. The lookup now runs for everybody and the allowlist is applied to the result. There is a test that fails if this is undone.
- *The operator invitation now links to the redemption route rather than to the accept page.* The accept page requires an admin session, and the invited operator has no way to have one — the only routes to a session are a password they have not chosen and a setup link nobody has minted for them. As issued, the invitation could not be accepted by its recipient at all. The token alone is now sufficient, which is what a single-use hashed invite is for, and the password gate catches them immediately afterwards.
- *Setting a first password ends every session, not just changing one.* §2.2 only requires it for a change. A setup link is a bearer token that has travelled through a console and possibly a chat window, so the session it created is precisely the one that should not outlive the moment a real credential exists.
- *Sign-in throttling moved from process memory into a `sign_in_attempts` table.* An in-memory lock lifts itself whenever anything restarts, and restarting is not a difficulty an attacker has to overcome — a deploy or a crash loop does it for them. A fifteen-minute lock that a redeploy clears is not a fifteen-minute lock.
- *An account with a session but no password can reach the password page and nothing else.* Server actions cannot redirect the way pages can, so the import authorization resolver returns "not signed in" for that state rather than redirecting. Failing closed in an action and redirecting in a page is the same rule expressed twice.

**Deviations:**

- **A second migration was needed.** WP1 froze the data model before §2.2 was added, so `users` had no password column and the database-backed credential store refused every lookup — password sign-in could not work at all, and the refusal was the enumeration leak described above. Migration `0001` adds `password_hash`, `password_set_at`, `password_changed_at`, the TOTP columns and `sign_in_attempts`. The columns the previous package listed as needed are exactly the columns added.
- *TOTP two-factor is not built.* §2.2 marks it optional for v1 and the task file repeats that. The columns exist so it can be added without another migration, but there is no code behind them. This is an absence, not a partial implementation, and it is the one WP2 item deliberately left undone.
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
