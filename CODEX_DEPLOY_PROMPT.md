# Prompt for Codex — deploy the Flipit SPV portal

Paste everything inside the fenced block below into Codex.

**Fill in the four values at the top first.** Leave the rest exactly as it is —
in particular the "Rules that do not bend" and "Where you stop" sections, which
are there because this application sends solicitations to real people about a
real securities offering.

**What this gets you:** a working, running, secured deployment with the database,
the scheduled jobs and the backups in place, and the three one-time setup links
in hand. It stops before anything can reach an investor.

**What it cannot do**, because both need accounts it does not have:

- David's Gmail app password — his account, his 2-Step Verification.
- The compliance approval — a human being reading the email and saying yes.

---

```
Deploy a finished Next.js application to a server, end to end. It is a private
investor portal for a securities raise. It is complete and tested — you are not
writing features, you are standing it up and making it stay up.

FILL THESE IN BEFORE STARTING
  GITHUB TOKEN:   <fine-grained token for mikehelm/flipit-spv-portal, Contents read/write>
  SERVER:         <IP or "create one" — a small VPS, 2GB RAM is plenty>
  SSH ACCESS:     <key path or how to log in>
  TEST DOMAIN:    mikehelm.com/SPV

RULES THAT DO NOT BEND

These are not preferences. Breaking any of them is worse than not finishing.

1. DO NOT SEND ANY EMAIL. Not a test, not to yourself, not to check something
   works. The application refuses to send from a non-production URL and you are
   deploying to the test URL — leave that refusal in place. It is a feature.
2. DO NOT TOUCH the compliance gate, the mail-connection gate, or the base-URL
   guard. Not to "unblock" anything, not temporarily. If something is blocked,
   that is the application working. Report it, do not route around it.
3. DO NOT SET PRODUCTION_APP_URL to the same value as APP_URL. That single
   change is what would allow real invitations to be sent from a test
   deployment, and every portal link issued from there would die on migration.
4. DO NOT COMMIT .env or any credential. .gitignore already excludes .env — do
   not weaken it. Do not echo the GitHub token into any log, file or commit.
5. DO NOT MODIFY application code. If something does not build or does not run,
   report it. Do not fix it by changing behaviour.
6. DO NOT import any real recipient data. Do not create any investor account.
7. If any step fails twice, stop and report. Do not improvise around a failure
   in an application that handles other people's money.

STEP 1 — THE SERVER

A small VPS, Ubuntu 24.04. Hetzner, DigitalOcean or Vultr — the cheapest tier is
enough; this serves under 50 people. If one already exists at the address above,
use it.

Then, before anything else:
  - A non-root user with sudo. Do not run the application as root.
  - SSH key auth only. Disable password authentication.
  - ufw: allow 22, 80, 443. Deny everything else. Enable it.
  - unattended-upgrades for security patches.

Install: Node.js 22 LTS, pnpm, PostgreSQL 16, nginx, certbot, git.

STEP 2 — THE DATABASE

PostgreSQL on this same machine. Do not use a hosted database service — the
whole point of this arrangement is that the database costs nothing because it
lives on the server that is already running.

  - A database named spv and a user that owns it, with a long random password.
  - Local connections only. Do not open 5432 to the internet. Check
    postgresql.conf and pg_hba.conf and confirm it.

STEP 3 — THE APPLICATION

Clone https://github.com/mikehelm/flipit-spv-portal using the token, into
/srv/spv owned by the application user. Then immediately take the token back out
of the repository:

  git remote set-url origin "https://github.com/mikehelm/flipit-spv-portal.git"

(.git/config is committed. A token left in it would be published.)

  pnpm install
  pnpm build

STEP 4 — CONFIGURATION

Create /srv/spv/.env, owned by the application user, chmod 600:

  DATABASE_URL        postgresql://<user>:<password>@127.0.0.1:5432/spv
  BASE_PATH           /SPV
  APP_URL             https://mikehelm.com/SPV
  PRODUCTION_APP_URL  https://spv.flipit.com
  ENCRYPTION_KEY      openssl rand -base64 32
  AUTH_SECRET         openssl rand -base64 32   (generate separately — a different value)
  OWNER_EMAILS        mike@flipthepage.com,mike@flipit.com
  OPERATOR_EMAILS     serenedavid@gmail.com
  MEDIA_STORE         filesystem
  MEDIA_DIR           /srv/spv-media
  HEALTH_TOKEN        openssl rand -base64 32

.env.example in the repository documents every variable. Read it — the comments
explain why several of these exist and what breaks without them.

Create /srv/spv-media, owned by the application user.

APP_URL and PRODUCTION_APP_URL are deliberately different. Do not make them
match. See rule 3.

STEP 5 — DATABASE SETUP

  pnpm db:migrate
  pnpm db:seed

The seed prints THREE ONE-TIME SETUP LINKS — two for the owner, one for the
operator. Each works once and cannot be recovered.

Capture all three verbatim and put them in your final report. Do not open them.
Do not write them to a file on the server. If you lose them, `pnpm setup-link`
mints new ones.

STEP 6 — KEEP IT RUNNING

A systemd service running `pnpm start` as the application user, with
Restart=always, EnvironmentFile=/srv/spv/.env, and the working directory
/srv/spv. Enable it so it survives a reboot.

nginx in front, proxying to the application, with certbot for HTTPS and
automatic renewal. The application is served under the path /SPV — check that
BASE_PATH and the nginx location block agree, because a mismatch here produces
a site where every asset 404s.

STEP 7 — THE SCHEDULED JOBS

Three cron entries as the application user. Without the first one, reminders
never send, which is a specified feature silently not working.

  0 * * * * cd /srv/spv && /usr/bin/pnpm reminders:run >> /var/log/spv/reminders.log 2>&1
  15 8 * * * cd /srv/spv && /usr/bin/pnpm check:health >> /var/log/spv/health.log 2>&1
  30 8 * * 1 cd /srv/spv && /usr/bin/pnpm media:check >> /var/log/spv/media.log 2>&1

Create /var/log/spv, owned by the application user, and set up logrotate.

Adjust the pnpm path to whatever `which pnpm` reports for that user — cron has
almost no PATH and this is the commonest reason these silently never run.

STEP 8 — BACKUPS

  pnpm backup            writes a backup
  pnpm verify:restore    proves one actually restores

Run both. `verify:restore` is the one that matters: a backup nobody has restored
is a hope, not a backup.

Then add a nightly cron entry for `pnpm backup`, and copy the backups somewhere
off this machine — a second location, however modest. A backup on the same disk
as the database is not a backup.

STEP 9 — CHECK IT

Run these and report the output of each:

  pnpm verify:deployment    checks the deployment is correctly configured
  pnpm check:health         exits non-zero when something needs a person

Then, in a browser:

  a. https://mikehelm.com/SPV/verify loads with no sign-in and is indexable.
     This is the anti-phishing page and it is the ONLY page that should be
     indexable. Everything else must carry noindex — verify:deployment checks
     this, but look at one other page's headers yourself and confirm.
  b. https://mikehelm.com/SPV/signin loads.
  c. A page that does not exist returns a clean 404, not a stack trace.
  d. robots.txt and sitemap.xml contain no portal or admin paths.

WHERE YOU STOP

Stop after step 9. Do not:
  - open any setup link or create any password
  - complete operator onboarding
  - connect any email account
  - import any data
  - send anything
  - migrate to spv.flipit.com

Those steps belong to Michael and David and are documented in GO_LIVE.md in the
repository. Two of them depend on things you cannot obtain: a Gmail app password
from David's own account, and a compliance approval, which is a person reading
the investor email and confirming in writing that it may be sent to named
individuals in their particular countries. Nothing sends until that exists, and
that is by design.

REPORT

  1. The server: provider, address, spec, monthly cost.
  2. THE THREE SETUP LINKS, verbatim. Michael needs these and they work once.
  3. Where ENCRYPTION_KEY and AUTH_SECRET can be found. Say plainly that
     ENCRYPTION_KEY must be kept safe — it encrypts the stored Gmail app
     password and OpenAI key, and losing it means re-entering both.
  4. Output of verify:deployment and check:health.
  5. Confirmation that the application refuses to send, and the exact sentence
     it gives. This is the correct state on a test deployment. Quote it.
  6. Confirmation that backup ran and verify:restore passed.
  7. Anything you could not do, or had to decide. Do not smooth over a failure.
```

---

## After Codex reports back

You will have a running deployment and three one-time links. From there:

- Open one link, choose a password — `GO_LIVE.md` step 3.
- Send David his — step 4.
- Fill in Settings — step 5.

The two long-lead items should already be in flight by then: David's Gmail app
password (two minutes) and the compliance approval (a conversation with other
people). Start the second one today; everything else waits on it.

The move to `spv.flipit.com` — `GO_LIVE.md` step 12 — happens **before the first
real invitation**, never after. Portal links embed the domain they were issued
from, and a link issued from the test deployment dies the moment you move.
