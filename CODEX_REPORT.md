# Codex report — WP13, WP14, WP17

## Built

### WP13 — Participation certificate

- Added Zod-validated certificate inputs using exact decimal strings.
- Added self-contained, print-ready A4 HTML using the FLIPIT palette and
  Helvetica.
- Included every required figure, operator name/role sign-off, version, and
  issue date.
- Made the not-a-share-certificate/title-document footer mandatory.
- Added one injectable HTML-to-PDF seam that returns a non-empty PDF buffer.
- Added pure correction/version-history logic that retains prior versions and
  marks the superseded record.

### WP14 — Anti-phishing verification

- Added a mobile-first, unauthenticated `/verify` page with calm, specific
  verification guidance.
- Names Michael Helm and David Serene and explains their roles.
- Reads the invitation sender from `VERIFICATION_SENDER_EMAIL`, falling back to
  the configured operator allowlist, and reads the legitimate domain from
  `PRODUCTION_APP_URL`.
- States what invitations will and will not request.
- Includes the prominent standing warning that payment details never change by
  email and must be verified by voice before a transfer.
- Deliberately overrides the root noindex metadata only for `/verify`.
- Added and tested an allow-`/verify`, disallow-everything-else robots policy.

### WP17 — Export

- Added pure CSV and XLSX generators for full denormalised recipient records.
- Keeps proposed, committed, accepted, and received amounts in separate exact
  string columns.
- Includes offer details, send state/timestamps, account state/history,
  timeline state/history, response state/history, questions, replies, updated
  contact email, and internal notes.
- Keeps ISO timestamps unambiguous, money/percentages as text, and long
  references as text.
- Neutralises cells beginning with `=`, `+`, `-`, or `@`.
- Produces valid header-only CSV/XLSX files for empty result sets.
- Added separate CSV/XLSX audit exports with an owner-only Zod boundary.

## Conservative decisions

- Decimal data accepts only plain non-negative decimal strings; scientific
  notation and JavaScript numbers are rejected.
- Export data preserves the supplied decimal string exactly instead of
  reformatting or rounding it.
- Structured histories and message collections are JSON strings in individual
  cells so the full record stays in one recipient row without losing event
  timestamps or reasons.
- Formula-risk values receive Excel's leading apostrophe text marker in both
  CSV and XLSX.
- The verification page tells a worried recipient to use contact details they
  already possess, not a phone number or contact link supplied by the page.
- No certificate is converted by an unapproved runtime dependency. The only
  seam accepts the project's later approved HTML-to-PDF renderer.

## Verification

- Scoped tests: **12 passed, 0 failed**.
- Scoped ESLint: **0 errors, 0 warnings**.
- Full ESLint: **0 errors, 8 pre-existing warnings** outside the assigned
  paths.
- Full Vitest: **384 passed, 3 pre-existing failures** in
  `src/lib/email/render.test.ts`, all concerning missing `sender_phone`
  pre-flight behavior outside the assigned paths.
- Full TypeScript check: one pre-existing error in
  `src/lib/email/transport/smtp.ts:89` (`SmtpClientOptions` is not assignable to
  Nodemailer's expected transport options), outside the assigned paths.
- `git diff --check`: clean.
- Static scan of the new feature paths found no `Number()`, `parseFloat()`,
  `parseInt()`, or `.toNumber()` conversion.

## Not completed because the required files are forbidden

See `CODEX_NOTES.md` for the root `/robots.txt`, existing invitation/portal
links, database/storage workflow wiring, authenticated export routes, and
configuration-documentation seams.

## Uncertainty

- Next's permitted nested `src/app/verify/robots.ts` is not a replacement for
  the standard root `/robots.txt`; the root helper call remains required.
- PDF visual output depends on the eventual approved HTML-to-PDF renderer. The
  supplied HTML is deterministic and print-ready, but no renderer dependency
  exists in the current dependency tree.
