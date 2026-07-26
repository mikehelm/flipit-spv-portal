# What this actually costs to run

Short version: **the database is free either way.** The `USD 20–50/month` figure
in `OPEN_DECISIONS.md` was written before the build and was a guess. The real
floor is about **five dollars a month**, and it is not the database.

---

## Why the database is not the cost

For 40 people — probably fewer — the entire database is a few megabytes. Not a
few gigabytes. A few megabytes. Every free tier on the market covers that by
three orders of magnitude, and so does the smallest server you can rent.

The thing that costs money is having the **application running all the time**,
and that is not optional:

- An investor signs in whenever they open their email, which might be 2am.
- The reminder job runs hourly. If nothing is running, nobody gets chased.
- The portal is meant to outlive the raise as David's working surface.

Once you have something running all the time, PostgreSQL runs on the same box
for nothing. `apt install postgresql`, one command. It is the same software the
paid services sell you.

---

## The two options

### Option A — one small server. About $5/month, all in.

A basic VPS — Hetzner, DigitalOcean, Vultr, whoever — running the application,
PostgreSQL and the three cron jobs together.

- **Database cost: zero.** It is on the same machine.
- **Everything works**: hourly reminders, a real disk for uploaded files and
  David's video, backups with `pg_dump`.
- **Nobody else holds the data.** For an application holding named investors'
  personal details and financial positions, that is worth something on its own.
- **Nothing pauses, expires or gets deleted** because you did not log in for a
  fortnight.

This is the recommendation. Five dollars against the size of this raise is not a
decision worth optimising.

### Option B — genuinely $0, with caveats you should know

Free Postgres tiers do exist and would technically work:

| | Free storage | The catch |
|---|---|---|
| **Neon** | 0.5 GB, 100 compute-hours/month | Scales to zero when idle; the first request after a quiet spell is slow. Fine here. |
| **Supabase** | 500 MB | **Pauses after ~1 week of inactivity** and needs manual restoration. |
| **Aiven** | 5 GB | Single node, no failover, limited connections. |

Storage is a non-issue — you need maybe 20 MB.

**The Supabase pause is a real problem for this specific application**, and it is
worth understanding why. A portal for a closed raise is quiet by design: David
sends invitations, people respond over two weeks, and then it sits. Sitting
quietly is exactly the state that gets a free project paused. An investor coming
back three weeks later to download their certificate would find nothing there.

Neon does not have that failure mode — it wakes on the next request — so if you
want the $0 route, Neon is the one.

**But you still need somewhere to run the application**, and free application
hosting is where this gets awkward:

- Serverless hosts have **no persistent disk**, so David's video and any
  uploaded images need an object store — Cloudflare R2's free tier covers it,
  but it is another account and another set of keys.
- Free serverless tiers generally **do not run an hourly cron**. Without it,
  reminders never send. That is a specified feature quietly not working.
- Several free application tiers are **non-commercial only**. A securities
  offering is not a hobby project.

So Option B is $0 for the database and awkward for everything else. Option A is
$5 and everything works.

---

## What about SQLite?

Reasonable question, and I had it audited properly rather than guessing. Two
findings, and the second is the one that settles it.

**First: it would not save any money.** SQLite is a file on a disk. It needs a
machine with a disk that survives a restart — which is Option A, which is
exactly the setup where PostgreSQL is already free. The hosted SQLite services
(Turso) are hosted services with free tiers, the same shape as Neon. There is no
configuration in which SQLite is cheaper than "Postgres on the box you are
already paying for".

**Second: the money columns.** This is the part that matters.

Every monetary value and every percentage in this application is stored as a
Postgres `numeric` and read back as a **string**, never a number. It goes into
`decimal.js` and comes out as a string, and nothing in between is ever a
JavaScript number. That is not an implementation detail — it is the foundational
rule of the whole financial layer, it is written into the schema's own
documentation, and there is a test that fails if anyone breaks it. It is the
reason an investor's figure cannot drift by a cent.

**SQLite has no decimal type at all.** It has integers, floats, and text. And
outside of `STRICT` tables it does not enforce types, so a float that leaks into
a money column is stored without complaint and read back subtly wrong. Postgres
would have refused it. Every failure mode there is silent, lands in a figure an
investor is looking at, and is found by the investor.

It is portable — a text column with a custom codec — but it means rebuilding the
one piece of this application that was most carefully built, to save nothing.

**Third, smaller but real:** the reminder job takes a Postgres advisory lock so
that two overlapping runs cannot send the same person the same reminder twice.
SQLite has no equivalent. The honest replacement on a hosted SQLite service is a
lease with an expiry, which reintroduces exactly the duplicate-send window the
current design closes. Duplicate emails to investors about a securities offer is
the single failure this application was most carefully built to prevent.

**The audit's estimate:** 35–40 files edited, all 11 migrations regenerated, one
to three weeks, and the highest-risk item is the money columns. To save $0.

---

## Recommendation

**One small VPS, about $5/month, Postgres on the same box.**

- Database cost: zero
- Nothing pauses, expires, or is deleted
- Reminders actually run
- A real disk, so no object-store account needed
- Nobody else is holding your investors' data
- `pg_dump` backups, and `pnpm verify:restore` proves a backup actually restores

If you want it at literal zero, **Neon's free tier plus a host that can run an
hourly cron** is the path — but budget an hour of fiddling and check the
application host's terms allow commercial use.

What I would not do is spend a week porting away from Postgres to save nothing,
on the one part of the code where a silent error shows up in somebody's money.
