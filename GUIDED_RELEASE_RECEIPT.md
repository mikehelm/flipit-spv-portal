# Guided Review Release Receipt

## Phase 1 — Approved Start checkpoint

- Recorded: 2026-07-28
- Baseline HEAD: `67d8f8d72535161bb74371ae7361e1c71e5b6a14`
- Branch: `codex/three-view-switcher`
- Pre-checkpoint status digest: `e18ebe519a3fef2568024eefe4c0eebcf92ecee630d65973fc790261755bb00b`
- Visual acceptance: Mike said “I love it” after reviewing the role-aware Start preview.
- Sending, deployment, credentials, roles and data: unchanged by this phase.

Approved product hashes:

| File | SHA-256 |
| --- | --- |
| `src/app/(admin)/admin/page.tsx` | `97a97f197c01a21f27647923c98a61148b98fa4248544adf44f55ea5c61043ae` |
| `src/app/(admin)/admin/page.test.ts` | `eed4cee87248467756e96a2350682c2ceb1661a6dd1a63c9c6fb572a1d170c2c` |
| `src/components/admin/guided-start.tsx` | `cc7a1874f6ef0e161e8b19fa733d2e3f1ceccaffe48d11a2ee9ad0e6e2b71294` |
| `src/components/admin/admin-nav.tsx` | `289133239e653f6067b3d11a90a5bda5dccf9e4775806590d9a3e054d2e4b8dd` |

Verification:

- `git diff --check` — passed.
- Focused ESLint on the four Start files — passed.
- `pnpm vitest run 'src/app/(admin)/admin/page.test.ts'` — 15/15 passed.
- `pnpm typecheck` — passed.
- `pnpm build` with the running review environment — passed.
- `CLAIMS.md` — no active row before checkpointing.

Rollback:

- The checkpoint commit recorded below contains only the four approved Start files.
- The pre-Start release remains `67d8f8d72535161bb74371ae7361e1c71e5b6a14`.

Checkpoint commit: `22eb17ce0072a5ace129e0a4aebeba797fbe6b5e`

## Phase 2 — Shared guided status foundation

- Base/claim commit: `3f0cabc`
- Scope stayed inside the four claimed files.
- Extracted one exported `Needs you / Waiting / Ready / Complete` vocabulary,
  tones, icons, status component and path item into
  `src/components/admin/guided.tsx`.
- The approved Start now imports that foundation with no visual or behavior
  change.
- Added a focused invariant test. The existing onboarding-only
  `Done / Now / Later` vocabulary is temporarily allowlisted and may not grow;
  Phase 3 removes it.
- Focused ESLint — passed.
- Focused tests — 17/17 passed.
- Typecheck — passed.
- Diff validation — passed.

Phase 2 commit: `b399671f883a3b41696f47f279c7361a221325b2`

## Phase 3 — Guided David onboarding

- Base claim: `0746367`
- Scope stayed inside the claimed onboarding page, focused page test, and
  guidance helper/test.
- David sees one personal `Needs you` action in canonical order while saved
  answers remain quietly reopenable.
- Shared SMTP is shown separately as `Waiting` with Mike named in prose; no
  configure, test, disconnect, credential, role or guard control moved to
  David.
- Finish setup requires the existing `canComplete`, live mail `HEALTHY`, and
  not already complete. This is a stricter presentation gate; the protected
  action/store semantics are unchanged.
- Focused lint, 22 focused tests, typecheck and diff validation passed.

Phase 3 commit: pending
