# Flipit Investor Outreach Portal

**Version 6.0 · 2026-07-25** — build in progress.

The application lives in `app/`. This folder holds the specification it is built from.

## Files

| File | What it is |
|---|---|
| `BUILD_SPEC.md` | The specification. The source of truth for what gets built. |
| `OPEN_DECISIONS.md` | What's settled, what's still open. The two-minute read. |
| `EMAIL_TEMPLATE.txt` | The invitation email. |
| `PORTAL_COPY.md` | Investor-facing wording. |
| `IMPORT_SCHEMA.json` | Upload field definitions and validation rules. |
| `SAMPLE_IMPORT.csv` | Sample recipient file. |
| `CODEX_TASKS.md` | The implementation plan — 21 work packages in build order, with a definition of done for each. |
| `LOOP_PROMPT.md` | The continuous-build prompt. Paste it and let the agent run through all 21 packages without stopping. |

## Where it runs

- **Testing:** `mikehelm.com/SPV`
- **Production:** `spv.flipit.com` — the move happens before any real invitation is sent, because portal links embed the domain.

## The two gates

Nothing sends without a current compliance approval, and editing the email template voids that approval until it is re-recorded. Nothing sends without a working mail connection. Both are enforced in code — see `BUILD_SPEC.md` §8.

Mail goes out over Gmail SMTP using an app password rather than the Gmail API, which removes the Google verification wait entirely.
