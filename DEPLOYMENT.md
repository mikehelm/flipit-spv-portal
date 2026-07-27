# Deployment and migration runbook

BUILD_SPEC §18 and §20. Written to be followed by one person, in order, on the
day.

Two phases, and **the order matters**:

1. **Testing — `mikehelm.com/SPV`.** The application runs under a path prefix.
2. **Production — `spv.flipit.com`** before a single real invitation goes out.

The reason for the order, in §18's own words: *"Portal links embed the domain,
and every link issued from `mikehelm.com/SPV` breaks the moment the app moves —
leaving investors holding dead links to a securities offer."*

The application enforces this rather than trusting it. `APP_URL` must equal
`PRODUCTION_APP_URL` or a real invitation is refused, by name, with the
deployment given as the reason. A test send to the operator's own address stays
available on both, which is what makes the testing deployment useful at all.

---

## 0. Before anything

- [ ] `pnpm check` passes — typecheck, lint, 2,500+ tests, and a production build.
- [ ] **`pnpm verify:all` passes.** One command, every verification, one at a
      time. Read the summary table at the end rather than the scroll: it names
      each script, what it proves, how long it took and how many checks it ran.

      **A skip is not a pass, and the exit code says so.** If Chromium is not
      installed or `pg_restore` is not on the PATH, the scripts that need them
      are skipped *by name, with the fix printed beside them*, and the command
      still exits non-zero. Do not release on a run that reported skips — four
      of them are the browser-driven ones, and between them they are the only
      proof that every screen works at 375px, that the upload limits refuse what
      they claim to, and that the recorder records.

      It runs them **serially on purpose**: they all seed fixtures into the same
      database and clean up by prefix, so two at once would delete each other's
      rows intermittently. Do not run two verification commands side by side, for
      the same reason.

      It builds **once** if there is no `.next`, for the five scripts that need
      one, and deliberately does not rebuild when one already exists — discarding
      a build somebody was mid-way through examining is not its decision. It says
      which it did.

      `pnpm verify:all media qa` runs only the ones whose names match, which is
      what to use while fixing one of them.

The list below is what `verify:all` runs, and it is kept in step by
`src/lib/verify/verify-all.test.ts` — a script added to `package.json` and not to
the runner fails that test rather than quietly never being run again.

| Command | What it proves | Needs |
| --- | --- | --- |
| `verify:reminders` | the reminder window, the cap and the lock | |
| `verify:rounds` | a round's modes, and that no deadline closes anything on its own | |
| `verify:register` | the interest register's computed order and its isolation | |
| `verify:qa` | the Q&A anonymisation rule, with a second investor present | |
| `verify:updates` | an update reaching a portal, and the notification that follows | |
| `verify:certificate` | the participation certificate, rendered and read back | |
| `verify:acknowledgements` | the acknowledgement wording and what it records | |
| `verify:email-change` | an investor changing their address, both halves of it | |
| `verify:lifecycle` | suspension, closure and read-only sign-in | |
| `verify:export` | the CSV and XLSX exports, and that no secret is in one | |
| `verify:documents` | a document package issued, served and revoked | |
| `verify:roadmap` | the portal roadmap tiles | |
| `verify:2fa` | the second factor, enrolled and demanded | |
| `verify:health` | the health endpoint, present and absent | |
| `verify:media` | ingest, metadata stripping and serving, against a real store | |
| `verify:object-store` | the S3 client against a real socket that verifies signatures | |
| `verify:restore` | a dump restored into a scratch database and read back | `pg_restore` |
| `verify:memory` | what the server holds after a long run | a build |
| `verify:deployment` | every route, link and header under a base path | a build |
| `verify:account-access` | who can reach what, driven in a browser | a build, Chromium |
| `verify:uploads` | every upload limit, from a browser, at its real size | a build, Chromium |
| `verify:recorder` | the video recorder, recording and playing back | a build, Chromium |
| `verify:viewport` | every screen at 375px, in a real browser | a build, Chromium |

`pnpm acceptance` is deliberately **not** in that list. It prints the §22
acceptance table rather than checking anything, and it is worth reading once
before a release on its own.

---

## 1. Environment

Every variable is validated at boot and the application refuses to start if one
is missing or malformed (`src/lib/env.ts`). That is deliberate: a portal that
starts with a half-configured base URL is a portal issuing dead links.

| Variable | Testing | Production |
|---|---|---|
| `BASE_PATH` | `/SPV` | *(empty)* |
| `APP_URL` | `https://mikehelm.com/SPV` | `https://spv.flipit.com` |
| `PRODUCTION_APP_URL` | `https://spv.flipit.com` | `https://spv.flipit.com` |
| `DATABASE_URL` | the testing database | the production database |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` | **a different one** |
| `AUTH_SECRET` | `openssl rand -base64 32` | **a different one** |
| `OWNER_EMAILS` | the two owner addresses | the same |
| `OPERATOR_EMAILS` | the operator address | the same |
| `RESTORE_DATABASE_URL` | unset | unset except during a restore |
| `MEDIA_STORE` | `filesystem` or empty | `object-store` — see §1.1 |
| `HEALTH_TOKEN` | optional | `openssl rand -base64 32` — see §9.1 |

**`ENCRYPTION_KEY` is not portable between the two.** It encrypts the stored
SMTP app password and the OpenAI key. Moving the database without moving the key
leaves rows that decrypt to nothing, and the failure shows up as "no sending
credential is stored" rather than as a key error. Either carry the key across
with the data, or re-enter both secrets after the move. **Re-entering is the
safer of the two** and takes two minutes.

### 1.1 Where uploaded files go

Three settings, and the right one depends on whether the deployment has a disk
that survives a restart.

| `MEDIA_STORE` | What it means |
|---|---|
| *(empty)* | Nowhere. Uploads are refused with a message saying what to set. **This is a supported state** — the portal, the invitation, the certificate and every screen are complete with an empty media library. |
| `filesystem` | A directory named by `MEDIA_DIR`. Correct on a machine you control. **Wrong on anything serverless**, where the disk is gone on the next request. |
| `object-store` | An S3-compatible bucket. The right answer for a serverless or containerised deployment, which is most of them. |

For `object-store`, five variables, and it is all or nothing — the application
**refuses to start** if some are set and others are not, rather than starting,
looking configured, and failing on the first upload.

| Variable | Example |
|---|---|
| `MEDIA_S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` — scheme and host only, no path |
| `MEDIA_S3_REGION` | `auto` for R2, the real region on AWS |
| `MEDIA_S3_BUCKET` | `flipit-spv-media` |
| `MEDIA_S3_ACCESS_KEY_ID` | from the provider |
| `MEDIA_S3_SECRET_ACCESS_KEY` | from the provider |

**The bucket must be private.** Nothing in this application makes an object
public. Every byte an investor reads is served through a route that checks the
session first — a public bucket would put a document package on the open
internet behind nothing but an unguessable name, which is a different security
model from the one the rest of this application uses.

**Scope the key pair to the one bucket**, with put, get and delete and nothing
else. It is never logged, never written to the database and never returned to a
browser.

**The bucket does not travel with `pnpm backup`, and `pnpm media:check` is how
you find out.** The backup covers the database, which holds the rows that *name*
the objects. Moving deployments means
copying the bucket separately, or pointing the new deployment at the same one —
the second is easier and is what §4.3 assumes. A database restored without its
bucket produces rows whose files are missing, which shows up as broken images
and a document that will not download.

`pnpm verify:object-store` exercises the whole path — signing, put, get, delete,
retry, and the refusals — against a signature-checking server on localhost. It
does not talk to a real provider; the first upload after configuring one is
still the moment to watch.

**`pnpm media:check` compares every stored file against the row that names it**,
and it is the command to run after a restore. It reports anything missing or the
wrong size, exits non-zero if there is a problem, and changes nothing. See §5.

It now asks the question backwards as well: it lists the store and reports any
object that no record points at. Those come from the mirror-image accidents — a
database restored from *before* an upload, a delete that removed the row and
failed on the object, a bucket shared with something else — and they matter more
than untidiness, because an orphaned document package is an investor's
subscription agreement sitting in a bucket nothing references. The listing stops
at five thousand objects and says so if it stopped.

---

## 2. Sign-in

There is no Google OAuth in this build and therefore no callback URL to update.

§18 and §20 both mention Google OAuth callbacks, and §2.2 does not: sign-in for
the owner and the operator is an email address and a password held in this
application's own database. That decision was taken in WP2 and is recorded in
PROGRESS.md — no Google Cloud project, no OAuth client, no consent screen, and
no third party between the owner and his own application.

**Gmail is still involved, for sending only.** §8.1's SMTP app password. That is
a credential entered in operator onboarding, not an OAuth grant, and it does not
carry a callback URL. It does not need to change when the domain does.

What still applies from §18's Gmail paragraph: **the privacy policy has to be
hosted on the application's own domain**, and it is — `/privacy`, public,
indexable, and reading no database. It moves with the application, so the URL to
give Google is `https://spv.flipit.com/privacy` after the migration and
`https://mikehelm.com/SPV/privacy` before it.

---

## 3. Standing up the testing deployment

1. Point `mikehelm.com/SPV` at the application. `BASE_PATH=/SPV`.
2. `pnpm db:migrate`.
3. `pnpm db:seed`. It prints a one-time setup link per account. **Each works
   once and is not recoverable** — open one, choose a password, and it signs you
   straight back out on purpose.
4. Open `https://mikehelm.com/SPV/verify` in a browser with no session. It
   should render and it should be indexable; everything else should be
   `noindex`. `pnpm verify:deployment` checks this, but look at it once.
5. Confirm the application refuses to send. Under `/SPV`, `APP_URL` is not
   `PRODUCTION_APP_URL` and the review screen should say so in a sentence naming
   the deployment.
6. Operator onboarding, steps 1 to 6, including connecting the sending Gmail
   account with an app password. **App passwords require 2-Step Verification on
   that account first.**
7. Test sends to the operator's own address only. The application refuses any
   other address for a test send, so this is not a matter of care.

**Do not import the real recipient list here** unless you intend to export and
re-import it. Nothing forbids it; it is simply work done twice.

---

## 4. The migration to `spv.flipit.com`

Do this **before the first real invitation**, not after.

### 4.1 Beforehand

- [ ] `pnpm backup` on the testing database. Keep the file somewhere that is not
      the server.
- [ ] Note anything that will have to be re-entered: the SMTP app password and
      the OpenAI key, unless `ENCRYPTION_KEY` is coming across too.
- [ ] Confirm no real invitation has been sent from the testing deployment.
      `/audit`, filtered to `send.*`. Every row should be a test send to the
      operator.

### 4.2 DNS

- [ ] Add `spv.flipit.com` as a subdomain of `flipit.com`. §18: adding a
      subdomain does not touch the existing site.
- [ ] Point it at the production deployment.
- [ ] Wait for it to resolve, and for the certificate to issue. Do not continue
      until `https://spv.flipit.com` serves the application over TLS — a portal
      link issued before the certificate exists is a link that fails on a
      security warning, which is the worst possible first impression for a
      securities invitation.

### 4.3 Configuration

- [ ] `BASE_PATH` empty.
- [ ] `APP_URL=https://spv.flipit.com`.
- [ ] `PRODUCTION_APP_URL=https://spv.flipit.com` — the two now match, which is
      what unlocks sending.
- [ ] `DATABASE_URL` pointing at the production database.
- [ ] Fresh `ENCRYPTION_KEY` and `AUTH_SECRET`, unless carrying them across.

### 4.4 Data

- [ ] `pnpm db:migrate` against the production database.
- [ ] If carrying data across: `pnpm backup restore <file>` with
      `RESTORE_DATABASE_URL` set to the production database. **Restore refuses
      to write to `DATABASE_URL`** and refuses if the two are the same, because
      restoring an old backup over a live database is the one mistake here that
      cannot be undone.
- [ ] If starting clean: `pnpm db:seed`, then import the recipient list.

### 4.5 Afterwards

- [ ] Sign in at `https://spv.flipit.com/signin`. Fresh setup links if the
      secrets changed.
- [ ] Re-enter the SMTP app password if `ENCRYPTION_KEY` changed. **Check it
      says "connected" on the dashboard** — the mail-connection gate refuses to
      send otherwise, which is the behaviour you want and not a good way to
      discover the problem.
- [ ] Re-enter the OpenAI key if it was in use. Import works without it.
- [ ] Give Google the new privacy-policy URL: `https://spv.flipit.com/privacy`.
- [ ] Verify domain ownership in Google Search Console for `spv.flipit.com`.
- [ ] Open `https://spv.flipit.com/verify` signed out. It names the exact
      sending address and the exact link domain, and **the link domain it names
      must now be `spv.flipit.com`**. If it still says `mikehelm.com`,
      `PRODUCTION_APP_URL` did not change and sending is about to be refused.
- [ ] Send yourself a test invitation and open every link in it on a phone.
- [ ] `pnpm verify:viewport` against the production build.
- [ ] **The pre-flight checklist (§19), all twelve items**, on the review
      screen. Sending is not available until it is complete.

### 4.6 The old deployment

- [ ] Take `mikehelm.com/SPV` down, or leave it serving a page that says the
      portal has moved. **Do not leave it serving the application.** Two live
      copies of a securities portal is one too many, and a stale link that still
      works is worse than one that does not: it shows an investor a record that
      is no longer being updated.

---

## 5. Backup and restore

```bash
pnpm backup                          # → backups/spv-<timestamp>.dump
pnpm backup restore <file>           # → RESTORE_DATABASE_URL, never DATABASE_URL
pnpm verify:restore                  # dump, restore into a scratch db, compare
```

**The custom format, not plain SQL.** `pg_restore` can be pointed at a different
database name, can restore selectively, and refuses a truncated file outright —
where `psql < file.sql` will replay half of it and leave a database that looks
restored and is missing the last third of the audit log.

**Restore reads `RESTORE_DATABASE_URL` and refuses if it equals `DATABASE_URL`.**
The runbook for the day a restore is needed will be read by somebody who is
already having a bad morning.

**A backup nobody has restored is a file, not a backup.** `pnpm verify:restore`
does the whole round trip and then reads the figures back out — not row counts,
figures. A restore that returns `4750.50` as `4750.5` has lost nothing a row
count would notice and everything that matters about a securities record. It
also checks that the tables, indexes and unique constraints came back, because a
restore that dropped the unique index on an investor's address passes every
row-level check and fails on the first duplicate.

**Cadence.** Daily while the round is open, and immediately before any
migration, any restore, and any move to `disabled`. §7 already refuses to move
the service to `disabled` without a completed export in the preceding seven
days; that is an export of investor data for the investors' sake, and it is not
a backup. Do both.

**After any restore, run `pnpm media:check`.** The dump holds the rows that name
every image, video and document; it does not hold the files. The check compares
the two in both directions — every record has its file, and every file has its
record — and reports anything missing, the wrong size, or stored with nothing
pointing at it. It changes nothing and exits non-zero if there is a problem, so
it belongs in the same script as the restore rather than in somebody's memory.

A restore from a dump taken *before* an upload is the case that produces
orphans: the objects are still in the bucket and the rows that named them are
gone. Nothing will serve them — every route looks the record up first — so they
are not a leak through this application. They are data nobody is managing, and
deleting one is a decision for a person holding the backup.

**Where to keep them.** Not on the same host. A dump contains every investor's
name, address and figures — it is the most sensitive single artefact this
system produces and it is not encrypted at rest by `pg_dump`.

---

## 6. What is refused, and what that looks like

Worth knowing before you meet one at speed.

| What you see | Why | What to do |
|---|---|---|
| "not the production deployment" | `APP_URL` ≠ `PRODUCTION_APP_URL` | Finish the migration. Test sends still work. |
| "No sending credential is stored" | No app password, or `ENCRYPTION_KEY` changed under it | Re-enter it in onboarding step 3. |
| "verification has gone stale" | Last mail check over 12 hours ago | Re-test the connection. |
| "the service mode is not ACTIVE" | §7 | Settings → service mode. |
| Approval refused for the operator | §8.2 — owner only, always | The owner records it. Logged either way. |
| One recipient blocked, batch fine | §8.3 jurisdiction gate | Working as intended. Unblocking needs a recorded reference. |
| Export required before `disabled` | §7 | Run the export, or record an override reason. Logged. |

---

## 7. Not built, and what it would need

- **A real object store, actually talked to.** The adapter is built, signed and
  tested (§1.1), but every test of it answers from a server on localhost. AWS,
  R2 and MinIO have not been on the other end of it. Configure one, upload one
  image, and watch it — that is the whole outstanding step, and it is minutes
  rather than work.
- **The scheduler itself, installed on the deployment.** Reminders run from
  `pnpm reminders:run`, which needs something to run it. §8 below is what to
  install; it is a single cron line and it has not been added to any machine yet.

---

## 8. The schedule

Two entries. `pnpm reminders:run` sends the reminders that are due and, on a
deadline date, the §6.6 digest to the operator. `pnpm check:health` watches it,
and everything else that can go quietly wrong.

**`pnpm verify:all` is deliberately not one of them**, and the reason is worth
stating so that nobody adds it later without meaning to. Every one of those
scripts *writes to the database* — it seeds fixtures, drives them and deletes
them by prefix — and several bind a fixed port and start a second copy of the
application. On a production host, on a schedule, that is a job creating and
destroying investor-shaped rows in the live database beside real ones, unattended,
in the middle of the night. It is a release gate run by a person on a machine
they are looking at, and §0 is where it belongs.

```cron
# Reminders and the deadline digest. Hourly, on the hour.
0 * * * * cd /srv/spv && /usr/bin/pnpm reminders:run >> /var/log/spv/reminders.log 2>&1

# The things nobody is watching. Daily. Exits non-zero when something needs a person.
15 8 * * * cd /srv/spv && /usr/bin/pnpm check:health >> /var/log/spv/health.log 2>&1

# Every stored file against the row that names it, and back again. Weekly.
30 8 * * 1 cd /srv/spv && /usr/bin/pnpm media:check >> /var/log/spv/media.log 2>&1
```

Hourly rather than daily, and it does not matter if a run is missed. Reminders
are planned to a specific hour and a run that catches one a few hours late still
sends it; a run that misses it by two days finds it stale and skips it rather
than sending a nudge about a deadline that has since moved closer.

**Two runs at once is expected, and safe.** It only takes a run that lasts longer
than an hour — fifty recipients with SMTP retries behind them will do it — and
then the next hourly run starts while the first is still going. The whole job
runs inside a Postgres advisory lock: the second run does nothing, writes a line
saying so, and exits zero. Behind the lock, each reminder is taken by an atomic
claim before it is sent, so even two runs that somehow both got past the lock
cannot send the same message twice. `src/lib/reminders/lock.ts` is the argument
for having both.

Because a blocked second run exits zero, **do not** alert on the exit code alone
expecting it to mean "nothing was sent". Read the log line.

### When a reminder sits on the queue marked "Being sent"

That means a run took it and has not finished. Usually the run is still going and
it resolves within the minute. If it does not:

```
pnpm reminders:lock      # BUSY = a run is genuinely in progress. FREE = it is not.
```

`FREE` with a row still marked as being sent means a run was killed between
taking the reminder and finishing with it. The claim does not expire on a timer —
deliberately, because a claim that timed out would reopen the double-send window
it exists to close — so the row waits for a person. **Reschedule it** from the
reminders page: that releases the claim, records who did it, and puts the
reminder back in the queue. Nothing else clears it.

Whether the email actually went out before the run died is a question for the
Gmail Sent folder, not for this application, which is why releasing it is a
deliberate act rather than an automatic one.

### Proving it still works

```
pnpm verify:reminders
```

Forty-two checks against a real Postgres, including two runs started at the same
instant and a genuinely separate process trying to take the lock while this one
holds it. Run it after any change to the reminder path.

---

## 9. The health report

```
pnpm check:health
```

Every quiet failure in this application already has a surface that shows it, and
every one of those surfaces needs somebody to open it. This is for the case where
nobody does. It asks, in one pass:

- **Is the scheduled job running at all?** Read from the audit log — when a run
  last got to the end. This is the finding the report exists for, because nothing
  else anywhere answers it. A scheduler that was never installed, or that stopped
  in March, looks from inside the application exactly like a quiet week.
- **Is a reminder stuck?** Taken by a run that never finished. See the previous
  section for what to do about one.
- **Is the mail connection healthy, and is anything waiting on it?**
- **Is each template still approved, and has it drifted?**
- **What is the service mode, and does `APP_URL` still permit real sends?**
- **Have deadlines passed with people still to answer?**
- **Do the stored files still match the records that name them — and has
  anything looked?** Read from the line `pnpm media:check` writes when it runs,
  never by reconciling: reconciling stats every stored object over the network,
  which is the right cost for a weekly command and the wrong one for a report a
  scheduler runs every morning and a page somebody waits on. The consequence is
  that a media check nobody runs is itself a finding, because a check that never
  runs looks from every page here exactly like one that keeps coming back clean.

**Exit codes.** Zero when everything is as it should be *or* when the only
findings are decisions somebody made — a non-active service mode, a testing
deployment correctly refusing to send. One when something needs a person. That
split is deliberate: a check that goes red because the round is in read-only mode
is a check that gets ignored.

**It changes nothing**, ever. Releasing a stuck reminder or replacing a
credential needs somebody who knows what has been happening.

**It names no email address**, including the sending account's own, which the
mail connection's summary does name. This report is appended to a log file by a
scheduler, and a log file is the least protected place in a deployment.

### 9.1 The same report, to a machine that is not this machine

```
GET https://spv.flipit.com/api/health
     x-health-token: <HEALTH_TOKEN>
```

Set `HEALTH_TOKEN` to something from `openssl rand -base64 32`, point an uptime
monitor at that URL with that header, and the monitor pages somebody. **This is
the only signal in the system that survives the machine stopping.** `pnpm
check:health` runs on the box it is watching: if that box is down, or the
scheduler was never installed, or the container was never restarted after a
failed deploy, the command produces nothing at all — and nothing is exactly what
a healthy quiet morning also produces. An outside poller can tell those apart.

- **200** — nothing needs a person. Also 200 for the findings that are decisions
  somebody made, for the same reason the command exits 0 on them: a monitor that
  goes red for a deliberate read-only week is a monitor that gets muted, and a
  muted monitor is worse than none, because somebody believes it is watching.
- **503** — something needs a person, or the report itself could not be built.
  The body's `status` says which: `wrong` is a judgement made after looking,
  `unavailable` means nothing could be looked at.
- **404, with an empty body** — no token, the wrong token, or `HEALTH_TOKEN`
  unset. All three are the same response byte for byte. A deployment that has
  not turned this on does not have this endpoint.

The body carries a status word, a timestamp, four counts and the *areas* that
are not fine — `Reminders`, `Mail`, `Compliance`, and the rest of the fixed
handful. No headline, no detail, no remedy, no id, no address. It ends up in a
monitoring service's alert history and on somebody's lock screen, which is a
looser place than a session-protected page, so it is sized to that. To find out
*what* is wrong, open **System health** in the application.

**Nothing here sends.** A push would mean a second unattended sender in an
application where the reminder job is deliberately the only one. A monitor
already knows how to page a person, and it is somebody else's infrastructure
staying up.

**Under a path prefix the address is `https://host/SPV/api/health`.** A monitor
pointed at the unprefixed one polls a 404 forever and shows a green tick over a
dead application. `pnpm verify:deployment` asks both, against a running server,
for exactly this reason.

The header is a header and not a query parameter, because a query string is
written to every access log between the monitor and here.

### The same report, in the application

**System health** in the admin navigation renders exactly the same findings from
exactly the same rules, for the owner and the operator both. The command is what
notices at three in the morning; the page is what the operator sees when he opens
the application, which is the only moment at which anybody is going to act on it.

The page is read-only. Every finding names the page that fixes the thing, and
none of them does it for you.

**Backups.** `pnpm backup` now writes a line to the audit log when a dump
succeeds, and the report says when the last one was. It can only ever speak for
that command: a deployment whose backups are the host's volume snapshots has
nothing to record here, and the report says so rather than calling it a fault.

**Stored files.** `pnpm media:check` writes a line the same way — counts only, no
storage key, no title — and the report reads the most recent one. So the three
commands in §8 have become one thing to watch: whatever the weekly reconciliation
found turns up in the daily health report, and in the operator's System health
page, without anybody remembering to read a third log.

### Proving the memory claim, rather than arguing it

```
pnpm build && pnpm verify:memory
```

Every media route was changed from reading an object into one array to opening a
stream, on the argument that a sixty-megabyte video otherwise sits in the
server's heap for as long as a phone on a slow connection takes to pull it down.
This measures it: a 96 MB object, served through the real route from the real
built server, with the server's resident set sampled out of `/proc` while the
bytes move.

Streaming grows the server by about **2 MB** for one download and about **1 MB**
for four at once. The same route made to buffer grows it by **95 MB** and
**379 MB** — the two numbers are two orders of magnitude apart, which is why the
bound is a generous quarter of the object rather than something tight enough to
be noisy.

It needs a build, it writes its fixture into its own temporary store directory,
and it removes both. On a platform without `/proc` it says the measurement was
skipped rather than passing.

```
pnpm verify:health
```

Thirty-one checks that spawn the real command against a database put into each
bad state in turn — no run ever completed, a scheduler that stopped, a reminder
abandoned mid-send, a media check that found missing files and one that has never
run — and read its actual output and exit code. It puts the
database back afterwards, including the audit entries it hides while it works.

---

## 12. An investor asks to be removed

> This is the runbook `OPEN_DECISIONS.md` item 12 asked for. It exists because
> the alternative was somebody typing `DELETE` against a live Postgres holding
> every investor's figures, improvised, at the moment somebody had asked for
> something they were entitled to. Nothing here is urgent — read it once,
> calmly, before it is ever needed.

`/privacy` tells an investor they can ask what is held about them, ask for it to
be corrected, ask for a copy, or ask for it to be deleted, and that a person will
deal with it rather than a form. All four are things a person does. Three of them
are ordinary work. This section is about the fourth.

### 12.1 What "erased" means here, and what it does not

**It is pseudonymisation, not deletion.** The rows stay and every direct
identifier and every free-text field a human typed is overwritten. What is left
is a transaction record with no person in it.

That is a deliberate choice and not a shortcut:

- A `DELETE FROM investor_accounts` cascades into `offers`, which `portal_tokens`,
  `conversation_messages`, `rounds` and `recipients` then reference with **no**
  `onDelete`. The schema refuses it, and it should — an offer is a securities
  record and somebody's money went through it.
- The four amounts, the two percentages, the stages and the dates are what
  `/privacy`'s own *"subject only to anything that has to be retained to meet a
  legal or regulatory obligation"* is about.

**One line decides every column:** *free text a human typed goes; structured
fields — enums, figures, timestamps, hashes, foreign keys — stay.* The whole map
is in `src/lib/erasure/plan.ts`, one entry per table, each with a sentence saying
why. A test fails on the commit that adds a table nobody has an opinion about, so
that file cannot go stale the way this document once did.

**One thing is genuinely destroyed and cannot be recovered:** the stored bytes of
any document package and of any certificate PDF. There is no pseudonymising a
signed subscription agreement.

### 12.2 Doing it

1. **Get the request in writing** and satisfy yourself it is from the person
   whose record it is. The application cannot help with this and does not try.
   An erasure carried out on somebody else's say-so is the failure mode that
   matters here, and it is entirely outside the software.
2. **Sign in as the owner.** David cannot do this and cannot preview it either.
   Suspending and closing are his and both are reversible; this one is not.
3. Open **`/investors`**, find their card, and expand **"Erase their personal
   data"**.
4. **Read the list before you type anything.** It is counted from the database at
   the moment the page loaded: how many messages, how many documents, how many
   stored files will be destroyed. If the numbers surprise you, stop and find out
   why before proceeding.
5. Type **their email address** exactly as shown, tick the box, and press
   **Erase this record**.
6. The banner tells you the pseudonym the record now carries. **Write it down**
   alongside the request — it is how you will find the record again if you are
   ever asked to prove the erasure happened.

The account is archived, every session ends and every unspent link is revoked in
the same transaction. Nothing is emailed to anybody: telling them it is done is
a message you write.

### 12.3 What survives, and how to answer for it

If you are asked what is still held:

| Still there | Gone |
| --- | --- |
| The four amounts, the percentages, the stages, the dates | The name and the email address, replaced by a pseudonym |
| The fact that an email was sent, and which template | The subject and both bodies of every email as sent |
| That a document existed, its version and its size | Its title, its description and the file itself |
| The Q&A answer, and that a question was asked | The question, in both its original and published forms; the entry is unpublished |
| The commitment, the payment instruction, the receipt and its amount | Their notes, and the bank reference |
| Every audit event: who, what, when | The address on the rows the investor themselves wrote |
| The country on the recipient row | The imported name, address, internal notes and sender overrides |

The pseudonymised address is under **`.invalid`**, which RFC 2606 reserves and no
mail server anywhere will deliver to. That is deliberate: an erased account
cannot be written to by accident.

### 12.4 The three things this does not do

**These are the reasons to read this section before you need it.**

1. **The name is not swept out of audit metadata.** The *address* is — it is an
   exact, unambiguous token, so it is substituted everywhere it appears. A name
   is not: "David" or "Lee" inside a JSON string is a word, and a blind
   replacement across every metadata object would corrupt rows belonging to
   other people. In practice the application does not write investor names into
   metadata. **If you want certainty, ask for the audit export and search it.**
2. **A file whose *name* is a person is not covered.** `import_jobs.filename` is
   kept — it is a filename and a row count, not investor data. If an operator
   ever saves a spreadsheet as `Fred Bloggs allocation.xlsx`, that survives, and
   this is the one place to check by eye.
3. **`ai_proposals.raw_proposal` is kept**, and whether it can hold a cell value
   depends on `aiHeadersOnly` in settings. With it on — the default and the
   conservative setting — only column headers ever reach the model and there is
   nothing to find. **With it off, check that table by hand.**

### 12.5 If it refuses

- *"no media store is configured"* — the investor holds stored files and the
  bytes cannot be destroyed. Nothing was changed. Set `MEDIA_STORE` (§1), confirm
  with `pnpm media:check`, and try again. An erasure that leaves the documents
  behind is not an erasure, which is why this refuses rather than doing most of
  the job.
- *"a stored file could not be destroyed"* — the store was reached and said no.
  Nothing was changed. This is a store problem: check credentials and the bucket
  policy, then try again.
- *"already been erased"* — it is done. Running it again would produce exactly
  what is already there, so it refuses rather than writing a second audit row
  suggesting it happened twice.
- *"the address you typed does not match"* — you are on the wrong card, or the
  address has been changed since the page loaded. Reload and read it again.

### 12.6 Proving it happened

```
pnpm verify:erasure
```

A hundred and nineteen checks against a real database, with a **second investor
present throughout** — every check on the erased one is paired with the same
check on the other, because an erasure that quietly took a neighbour's
conversation with it would pass every unit test in the repository.

It also stands up a real filesystem store, gives a third investor a real file,
erases them and confirms the bytes are gone; and takes the store away from a
fourth to confirm the refusal changes nothing at all. It cleans up after itself,
including the temporary store directory. It is part of `pnpm verify:all`.

For a specific past erasure, the audit log holds an `investor_account.erased`
row: who ran it, when, how many offers and stored files were affected, and the
pseudonym. That row is what you show somebody who asks.

### 12.7 The question that is still open

**Whether pseudonymisation satisfies an erasure request is a matter for advice,
not for this document.** Under UK and EU data-protection law pseudonymised data
is still personal data. What is built here is the most that can be done while
keeping a coherent securities record, and keeping that record is what `/privacy`'s
retention clause is for — but whether that clause covers what has been kept is
the formation agents' question.

Two specific calls to put to them, both taken conservatively and both reversible:

- The **country** on a recipient row is kept. It is structured, and it is the
  compliance record for why that person could lawfully be sent to.
- The **answer** half of a published Q&A entry is kept while the question is
  redacted and the entry unpublished. It is David's writing and other investors
  have already read it; erasing one person's data should not silently edit what
  everybody else was told.
