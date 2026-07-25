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
| Object store behind the media seam | 25 Jul session C | 2026-07-25 23:10 | `src/lib/media/store.ts`, a new `src/lib/media/s3.ts`, `src/lib/env.ts`, `.env.example`, `scripts/verify-object-store.ts` |

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

What is left is not a package. The open items are listed under Uncertain at the
end of each PROGRESS.md section; the largest are an object-store adapter behind
the media seam, a picker for library images in the email template editor, and
versioning for a corrected document.
