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

If a row is more than a few hours old, assume the session behind it is gone.
Take the work, and say so in PROGRESS.md.

## Claimed

| Package | Session | Claimed at (UTC) | Files it expects to touch |
| --- | --- | --- | --- |
| *(nothing claimed — the table is empty and that is the normal state)* | | | |

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

**Streaming a media response is done too** — as of 26 July the video is sent as
it is read rather than read and then sent, on both stores. The row claiming it
was written at 00:02 by a session that was discarded before it started; a later
session took the work under the stale-row rule above and said so in PROGRESS.md.
Images and documents still buffer, deliberately and on the record.

The largest left are a reconciliation pass for objects whose rows are gone, and
the open question — sharpened by corrections — of whether issuing a document
should notify the investor at all.
