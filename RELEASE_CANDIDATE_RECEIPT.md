# Canonical release candidate receipt

Prepared 27 July 2026 at 15:07 UTC+07.

## Candidate

- Working copy: `/Users/otto/Documents/spv-canonical-release-20260727`
- Branch: `codex/canonical-release-20260727`
- GitHub base: `d8275f14071013195b3335d6f1c7e6b62ae479d8`
- The candidate is the commit containing this receipt on that branch.
- No merge or deployment is part of this release-candidate package.

The candidate starts from the current GitHub history, including the investor-email
provenance additions, and reconciles the verified non-curl preview and the protected
public checkout. Newer equivalent route and guard implementations supersede earlier
public-checkout drafts. The protected checkout's What Next instructions are retained
as `AGENTS.md`.

## Preserved rollback sources

Neither source was edited while this candidate was assembled.

| Source | HEAD | Status hash | Tracked-diff hash | Untracked-manifest hash |
| --- | --- | --- | --- | --- |
| `/Users/otto/Documents/spv` | `9449034427e2dfc84d38bcb8b155e6f6c0fab7cf` | `3aa3faee09efe4869560d8dcc82386e0d3790dc4229142bf8047c3b5968019f7` | `915faacb07961f6eee0dd684f9636f10d9b81961992712e2b772c063d615cc92` | `4ddc36d0b14413f5bbe6b99cce27c739a22b59639f017e6a1d3aa40b1db14e22` |
| `/Users/otto/Documents/spv-reconciled-20260727-0301` | `bd467daf76b759766b40624198d245cbdf2977f3` | `66785ad40aba9ee10445c0419a8763bf98e38ce91f236659ff3dee5a9569cf17` | `d46b039a1a5bb65af33fe53d00e31638685aac27172160cbde02c627b3987268` | `ed1cdb32e0fcdf77a757a7f941b770ccfb7d9954821fbfe9c109c745faae0e18` |

The status hashes are SHA-256 fingerprints of NUL-delimited `git status
--porcelain=v1`; the tracked-diff hashes fingerprint `git diff --binary`; the
untracked-manifest hashes fingerprint the NUL-delimited untracked file list.

If the candidate is rejected before adoption, no product rollback is required:
leave this branch unused. If it is adopted later and must be undone, revert its
release commit; do not reset or clean either protected source.

## Included

- Current GitHub additions, including the exact canonical template fingerprint and
  internal email provenance record.
- Access-request workflow and its owner/operator review boundary.
- Owner-managed SMTP configuration with write-only encrypted storage and no send in
  the connection test.
- Reusable setup links until a password is successfully saved.
- Three-character minimum password, matched confirmation, change-password flow and
  optional reminder sentence.
- Known-address preservation on failed sign-in, with an optional stored reminder.
- John Doe private preview and the owner/operator mode switch.
- Navigation, first-name account presentation, testing footer, development CSP
  compatibility, database migrations and verification coverage.

## Deliberately excluded

The physical curl Package 1+2+3+6 files and `src/components/account-curl-menu.tsx`
remain under the active Opus claim. Package 1 passed its narrow 694 checks but still
awaits Mike's visual acceptance. None of those claimed files is in this candidate.
Account controls use a plain accessible account bar until the animation package is
accepted separately.

## Verification

- `pnpm install --frozen-lockfile --offline`
- `pnpm check`: typecheck, lint, 2,478 unit tests and production build passed.
- 23 named database, browser, deployment, restore and policy verifiers passed:
  1,320 checks in total.
- `pnpm acceptance` regenerated the 48-criterion acceptance account without a diff.
- `verify:recorder` passed 107/107 with full Chromium. The environment's headless
  shell did not expose the camera-arm behavior; no product exception was added.
- `verify:deployment` passed 103/103 with a disposable filesystem media store.
- `verify:memory` could not measure RSS because macOS has no `/proc`; it reported a
  platform skip rather than inventing a result.

All database/browser verification used disposable local state and fake test
credentials. No real email was sent and no production service was contacted.

## Email integrity

`EMAIL_TEMPLATE.txt` is 3,249 bytes with SHA-256
`f1491501cdf2c8a2e00309fd53a14a6d3dbc3f9f884bf7eaf8a4084f5ff65554`,
matching the required canonical fingerprint.

`SOURCE_RECEIPT.md` records the original email as Gmail plaintext rendering.
For this release audit, the connected Gmail search found no matching message even
after four read-only searches by sender, recipient, subject and date. Therefore the
fresh Gmail-versus-repository character comparison remains unverified. No text was
altered or reconstructed to hide that uncertainty.
