# Codex integration notes

The three packages were implemented only inside the paths assigned in the
brief. The following wiring requires files outside those paths and was
therefore deliberately not added:

- A standard root `/robots.txt` route requires `src/app/robots.ts`. The
  allow-only-`/verify` policy is implemented and tested in
  `src/lib/verify/robots.ts`, with the permitted nested metadata route at
  `src/app/verify/robots.ts`, but the root route still needs to call the same
  helper.
- Linking `/verify` from the invitation footer and authenticated portal
  requires edits to the existing email and portal packages.
- Generating, storing, superseding, and downloading certificates when an offer
  reaches `FUNDS_RECEIVED` requires workflow/database/storage route wiring. The
  pure renderer, version-history behavior, and HTML-to-PDF adapter seam are
  ready in `src/lib/certificate`.
- Exposing recipient and owner-only audit downloads requires authenticated
  admin routes/actions and database queries. The pure, Zod-validated CSV/XLSX
  generators are ready in `src/lib/export`.
- If the deployment uses the dedicated optional
  `VERIFICATION_SENDER_EMAIL` setting rather than its existing
  `OPERATOR_EMAILS` configuration, that variable should be documented in
  `.env.example`.

The dependency install is currently rejected by the repository's configured
minimum-release-age policy because `@emnapi/runtime@1.11.3` is too new. No
lockfile, policy, dependency, or package configuration was changed to bypass
that gate.
