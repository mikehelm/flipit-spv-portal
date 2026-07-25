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
