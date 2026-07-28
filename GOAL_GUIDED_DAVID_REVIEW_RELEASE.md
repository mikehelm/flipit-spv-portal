# GOAL: Finish the Guided Flipit Review Experience
goal_profile: full
execution_mode: run
presence_mode: attended
validation_mode: normal
generated_at: 2026-07-28T08:48:23Z
baseline_head: 67d8f8d72535161bb74371ae7361e1c71e5b6a14
dirty_paths: 4 approved Start paths plus this Goal file
canonical_revision: approved Start working tree based on 67d8f8d
freshness_rule: Re-run only affected readiness checks when HEAD, the five declared dirty paths, a claim, a protected source document, a role guard, or deployment configuration changes materially.
lane_count: 2
max_lanes: 2
state_writer: OTTO primary coordinator
automation_initial_state: disabled

## Mission

Turn the approved role-aware Start into a coherent review release: guide David through setup and email review, let Graham safely rehearse the experience, fix only meaningful acceptance defects, and deploy one immutable candidate with investor email sending demonstrably locked.

Enabling work is limited to checkpointing the approved Start, establishing one shared guided-language module, exact claims, receipts, and rollback. Planning, claims, reviews, worker launches, and green tests are not completion.

## Situation Card

- [verified] The canonical checkout is `/Users/otto/Documents/spv-canonical-release-20260727`, branch `codex/three-view-switcher`, HEAD `67d8f8d72535161bb74371ae7361e1c71e5b6a14`.
- [verified] The approved Start touches exactly four product paths: `src/app/(admin)/admin/page.tsx`, its test, `src/components/admin/admin-nav.tsx`, and new `src/components/admin/guided-start.tsx`.
- [verified] Focused lint, production build, diff validation, and 15 Start tests passed before Goal generation.
- [verified] `CLAIMS.md` has no active row and requires one exact claim-only commit and push before new implementation.
- [verified] `AGENTS.md` hash is `b70cc1b4cb30d847e94699c883f59fe1d40b052814f9487ca9ee94a56754084c`; `HANDOFF_MAC.md` is `98ca7e239ec09b28ee9976b31074aaa2fd27322933e3ca0bc3d0964536b9effd`; `GRAHAM_EXPERIENCE_TEST_KIT.md` is `d1cb80192da310aefc49164f543ec3d7b0a79b9ba6f417e2153109c4a4900058`.
- [verified] Guided status vocabulary is private inside `guided-start.tsx`; onboarding currently uses a competing vocabulary.
- [verified] Graham’s AI questions call OpenAI and permit counts-only usage plus metadata-only audit rows; proposal text remains browser-only.
- [verified] AI is configured as `gpt-5.6-sol`, but no successful bounded live call has been recorded.
- [verified] health compares deployment URLs differently from the normalized send guard, so its lock message can disagree.
- [verified] scheduled reminder, health, media, and backup jobs currently run from `/Users/otto/Documents/spv`, not the immutable release.
- [verified] no public build-hash value was found; deployed identity currently requires local service/path evidence.
- [reported] Mike approved the guided Start and wants Fast subagents, safe multitasking, and an Opus quality gate.
- [unknown] spreadsheet duplicate identity, jurisdictions, and response deadline remain unresolved. Show them as unresolved and do not send real invitations.
- [unknown] production health and deployed identity must be checked at release time rather than inferred.

## Boundaries

- Preserve unrelated dirty, staged, and untracked work byte-for-byte. Never reset, stash, clean, broadly stage, overwrite, or delete it.
- Before new product edits, save the approved-Start patch/hashes, run its focused gate, create a rollback checkpoint containing only the four Start paths, then follow the `CLAIMS.md` one-line claim-and-push rule.
- Use Fast service while Mike is present. At most two workers may run, and only on proved-disjoint maps.
- OTTO alone adopts, stages, commits, changes canonical state, deploys, and rolls back.
- Server guards remain authoritative. UI hiding never grants access.
- Do not change credentials, roles, schema, source email text, legal/compliance rules, proposal promotion, or transport without a separately approved protected decision.
- AI remains visibly advisory and attributable. Approved wording, user edits, unverified reasoning, and AI suggestions stay distinct.
- Never expose investor rows, message bodies, prompts, keys, SMTP secrets, or setup tokens in logs or receipts.
- Unknown spreadsheet facts remain visibly unresolved; no guessed identity, jurisdiction, deadline, money, percentage, or formula.
- Review deployment keeps normalized `APP_URL` and `PRODUCTION_APP_URL` unequal. “Locked” means no email can reach an investor; TEST-intent mail to the operator is a separate real SMTP path and is not exercised by this Goal.

## Context and Evidence Budget

max_tool_calls: 12 per lane before escalation
max_files: 15 per lane
max_lines_per_large_file: 200, except the owned email-review workspace may be read completely
budget_exception: release verification spans backup/restore, immutable release, scheduler paths, three roles, AI, media, reminders, and rollback

## Execution

### Phase 1: Freeze the approved Start
owner: OTTO
kind: enabling
reversibility: reversible-with-receipt
undo: restore the saved patch against `67d8f8d` or return only the four Start paths to the checkpoint
receipt: `GUIDED_RELEASE_RECEIPT.md`

- Recheck hashes, exact dirty inventory, claims, and ownership.
- Record the NUL-safe status, patch, hashes, focused checks, and preview.
- Run typecheck, focused lint/test, production build, and the approved visual spot check.
- Commit only the four Start paths as the rollback checkpoint; push no unrelated file.

Pass: the approved Start is independently recoverable.

### Phase 2: Make guided language a shared invariant
owner: Fast subagent A, adopted by OTTO
kind: outcome
reversibility: reversible-with-receipt
undo: revert only the adopted shared-guidance commit
receipt: `GUIDED_RELEASE_RECEIPT.md`

Writable map:
- new `src/components/admin/guided.tsx`
- `src/components/admin/guided-start.tsx`
- `src/app/(admin)/admin/page.test.ts`
- new `src/components/admin/guided.test.ts`

Export the approved four statuses, tones, icons, status component, and path item once. Keep `Waiting` as the status and identify Mike’s dependency in prose. Update the Start test and add one focused guard against competing admin status vocabulary.

Pass: later pages import one shared vocabulary instead of copying it.

### Phase 3: Guide David’s setup
owner: Fast subagent A
kind: outcome
reversibility: reversible-with-receipt
undo: revert only the adopted setup commit
receipt: `GUIDED_RELEASE_RECEIPT.md`

Writable map:
- `src/app/(admin)/admin/onboarding/page.tsx`
- new `src/components/admin/guided-onboarding.tsx`
- new `src/app/(admin)/admin/onboarding/page.test.ts`

Read-only: shared guided module, onboarding actions/store/guards, all mail configuration and transport.

Show one current action; collapse completed work; summarize later work; map `Done / Now / Later` to the shared four statuses. Sending-account work is `Waiting` with prose naming Mike and a safe email-review continuation. Preserve stored-progress derivation and existing actions.

Pass: David sees one honest action in fresh, partial, waiting, resumed, regressed, and complete states.

### Phase 4: Guide the email review
owner: Fast subagent B
kind: outcome
reversibility: reversible-with-receipt
undo: revert only the adopted email-review commit
receipt: `GUIDED_RELEASE_RECEIPT.md`

Writable map:
- `src/app/(admin)/admin/email-review/page.tsx`
- `src/components/email-review-workspace.tsx`
- `src/components/email-review/view-switch.tsx`
- new `src/app/(admin)/admin/email-review/page.test.ts`

Read-only: shared guided module, source documents/hashes, review data/document, proposals, AI, policy, compliance, and guards.

Use the existing view switch and inspector—not a third navigation system—to orient `Compare → Inspect → Ask → Propose/Review`. Keep the selected clause visible while tools open. Preserve white Paper default, Technical option, marking toggle, unverified reasons, and browser-only practice proposals.

Pass: David can understand one change, inspect its evidence, ask a question, and propose an edit without losing context.

Phases 3 and 4 may run together only after Phase 2 is frozen read-only and their claims prove no overlap.

### Phase 5: Reconcile and prove AI readiness
owner: OTTO with Opus reviewer
kind: enabling
reversibility: reversible
undo: reject out-of-map diffs; no adoption
receipt: `GUIDED_RELEASE_RECEIPT.md`

- Verify base hashes, maps, receipts, and protected-file integrity.
- Adopt only clarity improvements that preserve boundaries.
- Make one non-sensitive bounded AI call and verify the configured model, visible label, response, and cost accounting.
- If the model is unsupported, unpriced, or exceeds the approved spend boundary, stop the AI lane and ask Mike before changing it.
- Before Graham tests AI, add a separately claimed viewer session/question cap without storing question or answer text.

Pass: the combined candidate is attributable, AI truth is known, and viewer cost is bounded.

### Phase 6: Graham’s read-only acceptance
owner: Graham with OTTO observing
kind: outcome
reversibility: reversible
undo: reload the browser-only proposal state; retain only permitted counts/audit metadata
receipt: `GUIDED_RELEASE_RECEIPT.md`

Graham:
1. Understands the three Start tasks.
2. Compares emails and inspects a marked change.
3. Asks one capped selected-clause AI question.
4. Rehearses a proposal; reload proves the proposal disappears and never reaches Mike or David.
5. Opens John Doe, Investors, and Round read-only views.
6. Attempts direct mutations and receives clear server refusal without loops.

Record confusion, dead ends, accessibility, 375×812/desktop behavior, and console/network errors.

Pass: no proposal, promotion, canonical business row, invitation, reminder, or external mail is created; only documented counts-only usage and metadata-only audit records may persist.

### Phase 7: Fix blockers and release
owner: OTTO, with one Fast worker only for an exact claimed fix
kind: outcome
reversibility: reversible-with-receipt
undo: revert the exact fix or repoint the service to the preserved prior immutable release
receipt: `GUIDED_RELEASE_RECEIPT.md`

- Fix only safety or comprehension/navigation blockers; defer polish.
- Correct health deployment status to use the same normalized truth as the send guard.
- Freeze the candidate; run focused affected checks, role/guard/send-lock tests, AI, media/reminder, production build, backup, and disposable restore. Run the full suite only if focused evidence reveals wider coupling.
- Create a new immutable release. Never mutate the prior release.
- Repoint or pause every scheduled SPV job still targeting the stale checkout; record command path and environment hash without secrets.
- Deploy with normalized URLs unequal and verify sign-in, three Starts, David review, AI, media/reminders, and refusal of an investor send. Do not perform any SMTP test.
- Prove deployed identity locally from service `WorkingDirectory`, running process cwd, release directory, and candidate hashes. Do not claim a public hash endpoint.
- Exercise rollback, then return to the candidate only after proof passes.

Pass: the exact review candidate is live, investor sending is locked across app and schedulers, and rollback is tested.

## Readiness Gate

For each phase record risk, map, evidence, mechanical pass, failure path, and deferrability. Fail closed on hash/claim drift, protected edits, role widening, source drift, migration, external send, URL equality, unbounded viewer AI, or scheduler mismatch. Quarantine one blocked lane and continue only disjoint work.

## Concurrency and Ownership

disjoint_file_maps: Phase 3 onboarding and Phase 4 email review after shared Phase 2 is frozen
disjoint_state_namespaces: workers write no runtime state; Graham proposal stays browser-only
state_writer: OTTO primary coordinator

- Each worker gets base SHA, exact claim/map, hashes, protected list, checks, provider/spend boundary, and stop rule.
- Reject files outside the claim. A blocked lane preserves work and does not stop a disjoint lane.
- Review/testing may multitask; shared foundations, adoption, commits, deployment, and rollback serialize.

## Verification and Receipts

- Order: hashes/diff → typecheck/lint → focused role tests → disposable state → browser acceptance → one frozen production build/release gate.
- Cover OWNER, OPERATOR, VIEWER; Needs you, Waiting, Ready, Complete; stale/reopened dependencies; allowed and directly denied actions.
- One `GUIDED_RELEASE_RECEIPT.md` records commands, time, result, candidate, environment class, owner, accepted findings, scheduler paths, and rollback without secrets or personal content.
- What Next receives RUN/DONE, one current recommendation, and a viewable revision for each material phase.

## Blocker Behavior

receipt: `GUIDED_RELEASE_RECEIPT.md`

- Preserve work and record the exact prerequisite.
- After one safe health retry, use authorized local Opus; pre-job route failure does not consume an attempt. Poll healthy work instead of duplicating it.
- Ask Mike only for changed legal wording, spreadsheet identity/jurisdiction/deadline, credential/provider/spend, migration, security weakening, or enabling real sending.
- Unresolved spreadsheet decisions and real sending do not block the review release.

## Protected Decisions and Defaults

- Default: review release only; investor sending locked.
- Default: no schema, role, credential, legal wording, source-document, or canonical recipient change.
- Default: defer nonblocking polish and show spreadsheet unknowns without inventing quarantine behavior.
- Ask before migrations, credentials/providers/spend, real mail, legal reclassification, or production data mutation.

## Stop Conditions

- Success: every Definition of Done item has current product evidence and the durable receipt.
- Stop on external mail, secret/PII exposure, role escalation, migration, source drift, unsafe rollback, claim/map conflict, or protected decision.
- Stop broad testing/rereading when it no longer changes confidence; record the uncertainty.

## Definition of Done

- Approved Start and prior immutable release remain recoverable.
- Mike, David, and Graham each see one truthful role-appropriate starting action.
- Setup and email review import one enforced four-status language; Mike-owned work is `Waiting` with clear prose.
- Original/current text, evidence, unverified reasons, AI answers, and proposals stay distinct.
- AI succeeds on a supported, displayed, cost-accounted model or is explicitly blocked pending Mike’s protected choice; viewer usage is capped.
- Graham completes the truthful read-only walkthrough; only permitted counts/audit metadata persists.
- Spreadsheet decisions remain visibly unresolved and no recipient facts are guessed.
- Focused checks and frozen production build pass with no blocking CSP, console, network, accessibility, or viewport fault.
- Service path/process/release hashes prove the immutable review candidate is live.
- App configuration and every scheduled job demonstrably prevent email reaching an investor.
- Backup/restore and rollback are tested and retain the prior immutable release.

## Post-run Learning

Compare forecast with actual blockers, timing, test value, Graham confusion, and Opus findings. Propose generalized improvements only; do not change skills or policy without Mike’s approval.
