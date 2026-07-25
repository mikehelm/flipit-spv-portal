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

- [ ] `pnpm check` passes — typecheck, lint, 1,300+ tests, and a production build.
- [ ] `pnpm verify:deployment` passes. It builds under `/SPV`, serves it, and
      asks a running server whether every link, cookie path and indexing header
      is right. **The configuration and the served response have disagreed
      before**; this is the check that noticed.
- [ ] `pnpm verify:restore` passes. It dumps, restores into a scratch database
      and reads the figures back out.
- [ ] The database verification scripts pass: `verify-qa`, `verify-register`,
      `verify-updates`, `verify-reminders`, `verify-rounds`, `verify-export`,
      `verify-certificate`, `verify-lifecycle`.

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

**`ENCRYPTION_KEY` is not portable between the two.** It encrypts the stored
SMTP app password and the OpenAI key. Moving the database without moving the key
leaves rows that decrypt to nothing, and the failure shows up as "no sending
credential is stored" rather than as a key error. Either carry the key across
with the data, or re-enter both secrets after the move. **Re-entering is the
safer of the two** and takes two minutes.

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

- **Images and video (§13.2, §13.3).** WP15, deferred: no blob store has been
  chosen. Netlify Blobs, S3 or R2 all fit. Nothing else depends on it.
- **Two-factor sign-in.** §2 makes it mandatory before the production deployment
  sends anything real, so it is a **release gate rather than an optional
  extra**. The database is ready; there is no code behind it. This blocks the
  first real send, not the migration.
- **A managed queue.** Reminders run from `pnpm reminders:run`, which needs a
  scheduler. Anything that can run a command on a cadence will do; §18 suggests
  a managed queue and at this scale a scheduled task is enough.
