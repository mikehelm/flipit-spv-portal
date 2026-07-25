# Continuous Build Prompt

Paste the block below to start. Paste the **Resume prompt** at the end if the session dies or you come back to a stopped agent.

---

## Start prompt

```
Read BUILD_SPEC.md in full, then CODEX_TASKS.md in full. You are building the
Flipit SPV Investor Portal.

WORK CONTINUOUSLY. Build WP0 through WP20 in order, one after another, without
stopping to ask for approval between packages. Do not ask "shall I continue?" —
the answer is always yes. Do not summarise and wait. Finish a package, log it,
start the next one. Keep going until WP20 is done or a hard stop below is hit.

I am not watching. I will check in occasionally and read what you have left me.

AFTER EACH WORK PACKAGE, in this order:

1. Run `pnpm typecheck`, `pnpm lint` and `pnpm test`. All three must pass. If
   they do not, fix them before moving on. A package with failing checks is not
   finished and does not get logged as done.

2. Self-review against the twelve-point checklist at the end of CODEX_TASKS.md.
   Write down honestly which points you checked and what you found. If you find
   a violation, fix it now, not later.

3. Append to PROGRESS.md — create it if it does not exist. One section per
   package, newest at the bottom:

   ## WP<n> — <name> — <status>
   Built: what now exists, in plain language.
   Decisions: anything the spec left open and how you resolved it, and why.
   Deviations: anything you did differently from CODEX_TASKS.md, and why.
   Checklist: which of the twelve points you verified and the result.
   Uncertain: anything you are not confident about. Be honest here — this is
   the most useful section in the file.

4. Update TEST_ME.md — overwrite it each time so it always describes the
   current state. This is written for a non-technical reader. It must contain:
   - One command to get the app running from a cold start.
   - A numbered list of things that can be clicked and tried right now, in the
     order they should be tried, with what should happen at each step.
   - What is deliberately not built yet, so nothing looks broken when it is
     simply absent.
   - Anything that needs a real credential or a decision from me before it can
     be tested at all.

5. Commit with the message `WP<n>: <name>`.

Then begin the next package immediately.

HARD STOPS — stop and write to BLOCKED.md, then continue with the next package
that does not depend on the blocked one. Do not sit idle waiting, and do not
guess your way past any of these:

- Anything that would send email to a real address that is not the operator's
  own. There is no exception, in any environment, for any reason.
- Anything that would weaken, bypass, or add an override to the compliance gate
  or the mail-connection gate.
- Any change to how money or percentages are calculated, stored, or rounded.
- Any destructive migration against data that is not seed data.
- Anything that spends money, buys a domain, or provisions a paid service.
- Any credential you do not have. Record exactly what is needed and move on.

RULES THAT DO NOT BEND:

- The spec wins over the task file. Where the spec is silent, choose the more
  conservative option and record it under Decisions.
- Never a JavaScript `number` for money or a percentage, anywhere in the path
  from spreadsheet to screen.
- A jurisdiction block stops one recipient, never the batch.
- The operator can never record, amend, or void a compliance approval.
- No investor-facing page, response, or error may reveal that another investor
  exists.
- No credential, email body, or API key in any log line.
- No bulk send. Sending is one recipient at a time, by design.

If you genuinely cannot proceed on any remaining package, write a final
PROGRESS.md entry explaining precisely what you need from me, and stop. That is
the only acceptable reason to stop before WP20.

Begin with WP0 now.
```

---

## Resume prompt

```
Read PROGRESS.md and BLOCKED.md to find where the build got to. Then re-read
BUILD_SPEC.md and CODEX_TASKS.md.

Verify the last completed package still passes `pnpm typecheck`, `pnpm lint` and
`pnpm test` before trusting it. If it does not, fix that first.

Then continue from the next unfinished package under the same rules as before:
work continuously through to WP20, never stop for approval, log to PROGRESS.md
and refresh TEST_ME.md after each package, commit per package, and observe the
hard stops. Begin now.
```

---

## What to check when you look in

Three files, in this order:

**`TEST_ME.md`** — what you can click right now, and how. This is the one to open first.

**`PROGRESS.md`** — read the **Uncertain** and **Deviations** sections. Skip the rest unless something looks wrong. Those two sections are where a problem will show up first.

**`BLOCKED.md`** — anything waiting on you. Usually a credential or a decision.

## When to worry

Ask for a closer look if you see any of these in PROGRESS.md:

- A decision recorded about how money is calculated, rounded, or stored.
- Any mention of making the compliance gate more flexible, adding an override, or a "temporary" bypass.
- A note that a test was skipped, disabled, or marked as manual.
- A jurisdiction check described as operating on the batch rather than per recipient.
- Anything about sending that was made faster, bulk, or automatic.

None of these are necessarily wrong. All of them are worth a second pair of eyes.
