# Running a build session on demand

The overnight schedule is off. This file is how you start a build session
yourself, from any device, whenever you want one.

**There is no token in this file, and there must never be one.** `.gitignore`
excludes `.env`; it does not and cannot protect a token typed into a document.
Keep the GitHub token in your password manager and paste it in at the moment you
start a session.

---

## How to start one

Open the Claude desktop app, start a new Cowork task, and paste the block below.
Replace `PASTE_TOKEN_HERE` with the fine-grained GitHub token — the one scoped to
`mikehelm/flipit-spv-portal` with Contents read/write and nothing else.

That is the whole procedure. The session restores itself from GitHub, works
through as much as it can, pushes after every package, and stops.

---

## The prompt

```
Continue the in-progress build of the Flipit SPV Investor Portal for Michael
Helm. Work autonomously and do not ask questions.

FIRST — CHECK NOBODY ELSE IS ALREADY DOING THIS

  export GH_TOKEN='PASTE_TOKEN_HERE'
  cd ~ && git clone "https://x-access-token:${GH_TOKEN}@github.com/mikehelm/flipit-spv-portal.git" spv
  cd spv
  git log -1 --format='%cr'

If the newest commit is less than 30 minutes old, another build session may be
running right now. Two sessions on this repository collide: they duplicate work
and conflict in PROGRESS.md. Say so and stop. Do not build.

Otherwise, finish the setup, and never echo the token into any output, log,
file, or commit:

  git remote set-url origin "https://github.com/mikehelm/flipit-spv-portal.git"
  git config --local credential.helper "store --file=$HOME/.gitcreds"
  printf "https://x-access-token:%s@github.com\n" "$GH_TOKEN" > $HOME/.gitcreds && chmod 600 $HOME/.gitcreds

RESTORE THE ENVIRONMENT

  pnpm install
  Start PostgreSQL. Postgres 16 is at /usr/lib/postgresql/16/bin and cannot run
  as root — create a postgres user, initdb into a directory owned by it, start
  it on port 5433, create a database named spv.
  cp .env.example .env and fill in: DATABASE_URL for that Postgres,
  APP_URL=http://localhost:3000, PRODUCTION_APP_URL=https://spv.flipit.com, and
  generate ENCRYPTION_KEY and AUTH_SECRET with `openssl rand -base64 32`.
  pnpm db:migrate && pnpm db:seed

If the clone failed, the token has been revoked. Say so and stop — do not
thrash.

THEN BUILD

Read the end of PROGRESS.md to find what the last session finished and what it
left open. Every one of CODEX_TASKS.md's twenty work packages is complete; the
work now is the open items each session's audit records at the end of its
PROGRESS.md entry, under "Uncertain". Take the next one. Work through as many as
you can.

After each package:
1. `pnpm typecheck`, `pnpm lint` and `pnpm test` must all pass.
2. Self-review against the twelve-point checklist at the end of CODEX_TASKS.md.
3. Append a section to PROGRESS.md: Built / Decisions / Deviations / Checklist /
   Uncertain.
4. Update TEST_ME.md so it describes the current state for a non-technical
   reader.
5. git add -A && git commit && git push origin main

PUSH AFTER EVERY PACKAGE. The container is discarded when the session ends. A
package that is not pushed did not happen. Never commit .env or any credential —
.gitignore already excludes .env, do not weaken it.

RULES THAT DO NOT BEND
- Never send email to any real address. Only the operator's own, and only in an
  explicit test mode.
- Never weaken or add an override to the compliance gate or the mail-connection
  gate.
- Never a JavaScript number for money or a percentage, anywhere.
- A jurisdiction block stops one recipient, never the whole batch.
- The operator can never record, amend or void a compliance approval.
- No investor-facing page, response or error may reveal that another investor
  exists.
- Never log a credential, an email body, or an API key.
- No bulk send. Sending is one recipient at a time, by design.
- Where the specification is silent, choose the more conservative option and
  record it under Decisions.

STACK
Next.js 16 App Router, TypeScript strict, Tailwind v4, Drizzle ORM with
postgres-js (NOT Prisma — its engine host is unreachable here), Auth.js, Zod,
decimal.js, Vitest, pnpm. Sign-in for owner and operator is email and password
(argon2), NOT Google OAuth. api.openai.com is unreachable, so the AI import is
built against mocked tests.

FINISH WITH
A short report: which packages you completed, what is now testable, anything
blocked and what it needs. If nothing is left to build, say so plainly rather
than inventing work — the remaining items are things only Michael and David can
do, and they are listed in DEPLOYMENT.md and OPEN_DECISIONS.md.
```

---

## What is actually left

The code is complete against `BUILD_SPEC.md` — all twenty work packages, all
forty-eight acceptance criteria. What remains splits in two.

**Things a build session can still do.** Each session's PROGRESS.md entry ends
with an "Uncertain" list naming what it left open. That list is the work queue.
When it stops producing anything worth building, the build is done.

**Things no build session can do**, because they need a person:

1. Connect the Gmail app password. Nothing sends until this exists.
2. Record the compliance approval — the approved wording and the cleared
   jurisdiction list. No approval, no send, by design.
3. Deploy it. `DEPLOYMENT.md` is the runbook.
4. Set the three cron lines in `DEPLOYMENT.md` §8 so reminders and health checks
   actually run.
5. Point media storage at a real S3-compatible bucket.
6. Answer what is still open in `OPEN_DECISIONS.md`.

---

## If you want it on a schedule again

Ask Claude to re-enable the scheduled task, and give it a window rather than
every hour — a build session takes 20 to 40 minutes, so hourly means overlapping
containers doing the same work twice. Something like *"every two hours between
midnight and 8am"* is a schedule; every hour is a collision.

Ask for the run to switch itself off when there is nothing left, too. A session
that reads PROGRESS.md and finds no open items can disable its own scheduled
task, which is the only reliable way for this to end on its own.
