# Who is building what, right now

**Write here before you start, not after you finish.**

Two sessions worked this repository in parallel on 25 July 2026 and built the
same thing twice, twice: WP19's acceptance-criteria table, and then AC30's
tile-editing surface, both within the same hour. Each collision cost an hour of
merging and threw away a working implementation. Neither was anybody's fault —
PROGRESS.md is the only place that says what has been done, and it is written at
the end of a package, which is exactly too late to stop somebody else starting
the same one.

So: claim first. It costs a minute.

## How

1. Add a line to the table below.
2. Commit and push **that line alone**, before writing any code. A push that is
   one line long will almost never conflict.
3. If the push is rejected, pull — somebody else claimed something in the
   meantime, and it may be the thing you were about to start.
4. When the package lands, delete your row in the same commit.

**When is a row stale?** Not for **six hours**, and that number is not a guess —
it was written after a row five minutes old was read as abandoned and the same
package was built twice on 26 July. A row minutes or an hour old is a session
that is still running, whatever the branch looks like: a claim is the *first*
commit of a package, so a claim with no code after it is the normal state of
work in progress, not evidence that it stopped.

After six hours, take the work and say so in PROGRESS.md. Before then, build
something else — there is always something else in the Uncertain notes.

## Claimed

| Package | Session | Claimed at (UTC) | Files it expects to touch |
| --- | --- | --- | --- |
| Remove legacy onboarding status allowance | codex-guided-invariant-20260728 | 2026-07-28 09:33 UTC | `src/components/admin/guided.test.ts` |

## Done, so nobody starts it again

**Every work package, 0–20, is complete.** WP15 — the image library and the
personal video — was the last one outstanding and landed on 25 July 2026; the
storage decision it was waiting on is a `MediaStore` seam with a working
filesystem implementation, recorded under Decisions in PROGRESS.md. AC30 and
two-factor are closed.

With WP15, **all forty-eight acceptance criteria have an automated check**.
`ACCEPTANCE.md` is the current account of which are proved and how, and it is
generated from the tests rather than typed, so it is the one to trust.

Document packages — §5's status 3 — landed after WP15 and are done too.

**The object store behind the media seam is done** — `ObjectMediaStore` is a
real S3-compatible client as of 25 July, with `pnpm verify:object-store` behind
it. Nobody has pointed it at a real provider yet; that is a configuration step,
not a package.

**Versioning for a corrected document is done too** — `document_packages` has
`version`, `superseded_at` and `supersedes_id` as of 25 July, and
`pnpm verify:documents` is 48 checks covering the whole correction lifecycle.

What is left is not a package either. The open items are listed under Uncertain
at the end of each PROGRESS.md section. **EBML stripping for an uploaded WebM is done too**, so every accepted format
except PDF is now stripped, and PDF is deliberate.

**Range requests on the video are done too** — the portal video answers 206,
which is what Safari needs before it will play anything at all.

**Streaming is done too** — every media response is built from a stream rather
than a buffer. **It was built twice**, on 26 July, by two sessions an hour
apart: one claimed the row above at 00:02, the other read the row as stale five
minutes later and took the work. Both were wrong about something — the rule says
*hours*, not minutes, and a row five minutes old is a session that is still
running. The merge kept the pushed implementation and grafted two things from
the other onto it, which is recorded in PROGRESS.md. **If a row is minutes old,
it is not stale. Ask before taking it, or build something else.**

**`pnpm media:check` is done too** — every record's file is checked for presence
and size, and, as of 26 July, the question backwards as well: the store is
listed and every object that no record points at is reported. `MediaStore.list`
is on the seam, both stores implement it, and the S3 side walks continuation
tokens. Reconciliation is done in both directions.

**Every media route streams**, as of 26 July: the video, the library image and
both document downloads. No route in `src/app` holds a stored object in memory,
and there is a boundary test that fails if one starts to.

**`pnpm media:check` is verified by `pnpm verify:media`** as of 26 July — the
real command, spawned, against a store holding a missing file and two orphans.
It was the last thing in the repository with no automated check behind it.

**The reminder job is safe to run on a schedule now**, as of 26 July. It was
not: two overlapping runs both selected the same due rows and both sent, which
is what an hourly cron and a run lasting over an hour produce. There are now two
independent defences — a Postgres advisory lock around the whole run, and an
atomic `claimed_at` claim on each row — and `pnpm verify:reminders` is 42 checks
including two runs started at the same instant and a separate process refused
the lock. The §6.6 deadline digest is inside the same lock. The cron line itself
is written out in `DEPLOYMENT.md` §8 and is installed on no machine.

**The health report is done too**, as of 26 July. `pnpm check:health` asks the
one question no page in the application can answer — is the scheduled job running
at all — along with stuck claims, the mail connection, template drift, the
service mode, the base-URL guard and passed deadlines. It exits non-zero only for
things that need a person; a non-active service mode and a testing deployment are
notes. It never acts and it names no email address, not even the sending
account's. `pnpm verify:health` is 21 checks that spawn the real command against
a database put into each bad state in turn. **It is also a page** — "System
health" in the admin navigation, same rules, read-only, for both roles — and
`pnpm backup` now records itself so the report can say when the last one was.
The admin **overview** carries a banner when something needs a person, from a
deliberately cheap two-query subset of the same rules, plus a permanent card so
silence is never ambiguous.

**`media:check` is folded into the health report**, as of 26 July. The comparing
moved out of the script into `src/lib/media/reconcile.ts`, the command writes one
counts-only line to the audit log when it runs, and `pnpm check:health` and the
System health page read it — including saying so when nothing has ever run it,
which is not the same answer as clean. The report never reconciles: that costs a
round trip per stored file and has no place in a page render. `pnpm verify:health`
is 31 checks and `pnpm verify:media` 54.

**The overview banner has been rendered with a fault behind it**, as of 26 July,
and it found two: the banner was still naming the two rules it had when it was
written, and it disagreed with the health page whenever no media store was
configured — which is the default this repository runs in. Both fixed.
`pnpm verify:viewport` is 158 checks and includes the fault branch of the
overview and the health page at 375px — all three of the banner's rules, put
back afterwards.

**The memory claim is measured**, as of 26 July. `pnpm verify:memory` serves a
96 MB object through the real route from the real built server and samples the
server's resident set out of `/proc`. Streaming grows it by 2 MB for one download
and 1 MB for four at once; the same route made to buffer grows it by 95 MB and
379 MB, measured by temporarily reverting it and watching the check fail. Three
Uncertain notes saying "nothing has measured the memory" are closed.

The largest left is installing the three cron lines in `DEPLOYMENT.md` §8, and
the open question — sharpened by corrections — of whether issuing a document
should notify the investor at all. Neither is a package. After that: nothing
tells anybody when `check:health` goes red without somebody looking, which is a
decision about adding a second unattended sender rather than a piece of work.
