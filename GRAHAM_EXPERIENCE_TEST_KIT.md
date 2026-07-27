# Graham experience-test mode

Frozen 2026-07-27 14:48 UTC for Mike's request that Graham can rehearse
David's complete review experience and switch to an investor view without
saving product changes or sending email.

## Frozen baseline

- Repository: `/Users/otto/Documents/spv-canonical-release-20260727`
- Branch: `codex/three-view-switcher`
- Git HEAD: `b88fa36bddd4a3972ba55a9fbd6b57b0ac9bb567`
- Dirty baseline: clean
- Staged baseline: empty
- Live release before adoption:
  `/Users/otto/Documents/spv-releases/20260727-made-with-mike-7d3ee2f`
- `AGENTS.md`:
  `b70cc1b4cb30d847e94699c883f59fe1d40b052814f9487ca9ee94a56754084c`
- `CLAIMS.md`:
  `8907687a289fc44eac44a3042b78800935c9e68b0a4654b3ce89037fb2807a64`
- `HANDOFF_MAC.md`:
  `98ca7e239ec09b28ee9976b31074aaa2fd27322933e3ca0bc3d0964536b9effd`
- Canonical invitation `EMAIL_TEMPLATE.txt`:
  `f1491501cdf2c8a2e00309fd53a14a6d3dbc3f9f884bf7eaf8a4084f5ff65554`
- `BUILD_SPEC.md`:
  `305e2d296b2f5e2f8bf4a5248f45f23d6581143d11dee99eab1ed96d43f3966d`

## Required behavior

1. Graham remains a `VIEWER`; do not grant operator or owner authority.
2. A viewer may open the private email-review workspace, inspect the complete
   original/current comparison, use selection tools, and ask the document AI.
3. A viewer may type a proposed change and rehearse submitting it, but the
   proposal stays in React memory for the current browser tab. It must not call
   the proposal server action, write the database, alter the template, enter
   Mike's review queue, or send email.
4. The AI question/answer is not stored. Existing counts-only usage and
   metadata-only audit records remain allowed; question and answer text remain
   absent.
5. A viewer may open the existing synthetic investor preview. Every investor
   mutation remains disabled and no investor session or database row is
   created.
6. The interface must state clearly that this is a test mode and nothing typed
   as a proposal is saved.

## Writable files

- `GRAHAM_EXPERIENCE_TEST_KIT.md`
- `src/app/(admin)/admin/email-review/page.tsx`
- `src/app/(admin)/layout.tsx`
- `src/app/portal/page.tsx`
- `src/components/admin/admin-nav.tsx`
- `src/components/email-review-workspace.tsx`
- `src/components/portal-preview-switch.tsx`
- `src/actions/email-review.ts`
- `src/lib/email-review/data.ts`
- `src/lib/email-review/boundary.test.ts`
- `src/lib/portal/demo-preview.test.ts`
- `PROGRESS.md`
- `CLAIMS.md` only to remove this package's claim when complete

Everything else is read-only unless a focused test proves that one additional
file is essential and the file map is amended before editing.

## Protected boundaries

- Do not modify `EMAIL_TEMPLATE.txt`, `EMAIL_PROVENANCE.md`,
  `David_Serene_Original_Email_2026-07-25.txt`, `SOURCE_RECEIPT.md`, migrations,
  schemas, credentials, allowlists, production environment values, investor
  records, invitation tokens, or sending configuration.
- Do not change owner/operator mutation guards.
- Do not weaken `requireAdmin`, `requireOwner`, email-transport gates, preview
  mutation gates, CSP, authentication throttling, or audit secrecy.
- Do not create a real Graham investor offer from synthetic figures.
- Do not deploy or generate a new setup link without the production and
  credential approvals required by the governing instructions.

## Verification

- Focused email-review boundary and AI tests.
- Focused demo-preview and authorization tests.
- TypeScript.
- Production build if the focused checks pass.
- Source/diff review confirming viewer proposal forms cannot reach the
  persistence action and investor preview mutations remain disabled.

## Completion receipt

Report the exact commit, tests run, remaining lint or environment caveats,
whether deployment and setup-link creation remain approval-gated, and the
rollback release that remains available.
