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
| Verifying the reconciliation report itself | 26 Jul session D | 2026-07-26 01:02 | `scripts/verify-media.ts` |

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

The largest left are running these checks on a schedule rather than from the
runbook, and the open question — sharpened by corrections — of whether issuing a
document should notify the investor at all. Neither is a package.
