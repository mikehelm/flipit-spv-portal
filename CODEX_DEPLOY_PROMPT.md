# Prompt for Codex — set it up on Michael's Mac

Paste everything inside the fenced block into Codex.

**Nothing to fill in.** It runs on this Mac, uses the domains already in the
Cloudflare account, and pauses once to let Michael pick one.

**Two things it cannot do**, because both need accounts it doesn't have:

- David's Gmail app password — his account, his 2-Step Verification
- The compliance approval — a person reading the email and saying yes in writing

---

```
Set up a finished Next.js application on this Mac and put it on the internet
behind a Cloudflare Tunnel. It is a private investor portal for a securities
raise. It is complete and tested — you are not writing features, you are
installing it and making it stay up.

There is no server to rent. This Mac serves the page and holds the database.

RULES THAT DO NOT BEND

Breaking any of these is worse than not finishing.

1. DO NOT SEND ANY EMAIL. Not a test, not to yourself, not to prove something
   works. The application refuses to send while APP_URL and PRODUCTION_APP_URL
   differ. You will set them to differ. LEAVE THEM THAT WAY. That refusal is
   the safety catch and Michael turns it off himself when he is ready.
2. DO NOT SET APP_URL EQUAL TO PRODUCTION_APP_URL. This is the single most
   important line in this prompt. Making them match is what allows real
   invitations to be sent, and doing it before the compliance approval exists
   would send a securities solicitation to real people prematurely.
3. DO NOT TOUCH the compliance gate, the mail-connection gate, or the base-URL
   guard in the code. Not to "unblock" anything, not temporarily. If something
   is blocked, that is the application working correctly. Report it.
4. DO NOT MODIFY application code. If it does not build or run, report it. Do
   not fix it by changing behaviour.
5. DO NOT COMMIT anything, and do not put any credential in a file inside the
   repository. .gitignore already excludes .env — do not weaken it.
6. DO NOT REGISTER a domain or buy anything. Use only what is already in the
   Cloudflare account.
7. DO NOT import any data or create any investor account.
8. If a step fails twice, stop and report. Do not improvise around a failure in
   an application that handles other people's money.

STEP 1 — INSTALL

  brew install postgresql@16 node pnpm cloudflared
  brew services start postgresql@16
  createdb spv

Node must be 22 or later. Check with `node -v`.

STEP 2 — GET THE CODE

  cd ~/Documents
  git clone https://github.com/mikehelm/flipit-spv-portal.git spv
  cd spv
  pnpm install

Ask Michael for the GitHub token when the clone asks for credentials. The
repository is private. Do not write the token into any file in the repository —
after cloning, run:

  git remote set-url origin "https://github.com/mikehelm/flipit-spv-portal.git"

(.git/config is committed. A token left in it would be published.)

STEP 3 — CONFIGURE

Copy .env.example to .env, then fill it in. Read the comments in that file —
they explain what each variable does and what breaks without it.

  DATABASE_URL        postgresql://localhost:5432/spv
  BASE_PATH           (leave empty)
  APP_URL             http://localhost:3000
  PRODUCTION_APP_URL  (leave empty for now — set in step 7)
  ENCRYPTION_KEY      openssl rand -base64 32
  AUTH_SECRET         openssl rand -base64 32   ← generate separately, a different value
  OWNER_EMAILS        mike@flipthepage.com,mike@flipit.com
  OPERATOR_EMAILS     serenedavid@gmail.com
  MEDIA_STORE         filesystem
  MEDIA_DIR           .media

APP_URL stays as localhost. See rule 2.

STEP 4 — START IT

  pnpm db:migrate
  pnpm db:seed
  pnpm build
  pnpm start

The seed prints THREE ONE-TIME SETUP LINKS — two for the owner, one for the
operator. Each works once and cannot be recovered.

Capture all three verbatim for your final report. DO NOT OPEN THEM. Do not save
them to a file. If they are lost, `pnpm setup-link` mints new ones.

Confirm http://localhost:3000 loads in a browser.

STEP 5 — CLOUDFLARE: FIND OUT WHAT MICHAEL OWNS

Log in to Michael's Cloudflare account — ask him to sign in if a browser session
is needed. List every zone (domain) on the account.

Also check whether he owns domains that are NOT yet on Cloudflare. If a likely
one is missing, say so — adding a domain to Cloudflare is free and takes a
nameserver change at the registrar.

STEP 6 — PROPOSE TEN, AND STOP

Give Michael TEN candidate hostnames drawn from the domains he actually owns,
ranked best first, each with one line on why. Then STOP AND WAIT for him to
choose. Do not pick one yourself.

What makes a good one here, in order of importance:

  a. It matches what the investor expects to see. They are being invited into a
     Flipit SPV, so a flipit.com subdomain reads as genuine and anything else
     reads as odd. This outranks everything below.
  b. It is short and typeable. This hostname is printed on the anti-phishing
     page and investors are told to TYPE it rather than click, so length and
     ambiguity are real costs.
  c. It is unambiguous read aloud over a phone. No hyphens, no numbers, nothing
     that could be spelt two ways.
  d. It sounds like a private records portal, not a marketing site or a
     sign-up page.
  e. It is not already in use for anything else on that domain.

Note in your list that "spv.flipit.com" is the value written into the project's
existing documentation, so choosing it means no other file needs changing.
Michael is free to choose differently — say what else would need updating if he
does.

STEP 7 — TUNNEL, once Michael has chosen

  cloudflared tunnel login
  cloudflared tunnel create spv
  cloudflared tunnel route dns spv <the hostname he chose>

Create ~/.cloudflared/config.yml:

  tunnel: spv
  credentials-file: /Users/<his-user>/.cloudflared/<tunnel-id>.json
  ingress:
    - hostname: <the hostname he chose>
      service: http://localhost:3000
    - service: http_status:404

Install it as a background service so it survives a reboot:

  sudo cloudflared service install

Then set PRODUCTION_APP_URL in .env to https://<the hostname he chose>.

LEAVE APP_URL as http://localhost:3000. See rule 2. The application will now
correctly refuse to send anything, which is the state Michael wants until the
compliance approval exists.

Confirm https://<the hostname> loads from outside — check it on a phone on
mobile data, not on the house wifi.

STEP 8 — KEEP IT RUNNING

Stop the Mac sleeping: System Settings → Displays → Advanced → "Prevent
automatic sleeping when the display is off". If it is a laptop, set Energy Saver
for plugged-in operation too. Report what you changed.

Create ~/Library/LaunchAgents/com.flipit.spv.plist so the app starts on login
and restarts if it crashes — Label com.flipit.spv, WorkingDirectory the repo
path, ProgramArguments the full path to pnpm plus "start", RunAtLoad true,
KeepAlive true, logs to /tmp/spv.log and /tmp/spv-error.log. Then:

  launchctl load ~/Library/LaunchAgents/com.flipit.spv.plist

Reboot the Mac and confirm both the app and the tunnel come back on their own.
Do not skip the reboot — an arrangement that has never survived one is an
arrangement nobody has tested.

STEP 9 — SCHEDULED JOBS

crontab -e, with the full path from `which pnpm` (cron has almost no PATH, and
this is the commonest reason these silently never run):

  0  *  * * *  cd ~/Documents/spv && <pnpm> reminders:run  >> /tmp/spv-reminders.log 2>&1
  15 8  * * *  cd ~/Documents/spv && <pnpm> check:health   >> /tmp/spv-health.log    2>&1
  30 8  * * 1  cd ~/Documents/spv && <pnpm> media:check    >> /tmp/spv-media.log     2>&1

Without the first line, reminders never send.

macOS may need Full Disk Access for cron: System Settings → Privacy & Security →
Full Disk Access → add /usr/sbin/cron. Do it, and say you did.

STEP 10 — BACKUPS

  pnpm backup
  pnpm verify:restore

Run both and report the output. verify:restore is the one that matters — a
backup nobody has restored is a hope, not a backup.

Add a nightly `pnpm backup` to cron. Then set the backup folder to sync OFF this
Mac — iCloud Drive, Dropbox, or an external drive. Ask Michael which he wants. A
backup on the same disk as the database is not a backup.

STEP 11 — CHECK IT

Run and report the output of each:

  pnpm verify:deployment
  pnpm check:health

Then in a browser, against the public hostname:

  a. /verify loads with no sign-in. This is the anti-phishing page and it is the
     ONLY page that should be indexable. Confirm it is.
  b. Any other page carries noindex. Check the headers on one yourself.
  c. /signin loads.
  d. A URL that does not exist returns a clean 404, not a stack trace.
  e. robots.txt and sitemap.xml contain no portal or admin paths.

WHERE YOU STOP

Stop after step 11. Do not:
  - open any setup link or choose any password
  - complete operator onboarding
  - connect any email account
  - import any data
  - send anything
  - change APP_URL

Those belong to Michael and David and are set out in GO_LIVE.md in the
repository. Two of them depend on things you cannot get: a Gmail app password
from David's own account, and a compliance approval — a person reading the
investor email and confirming in writing that it may be sent to named
individuals in their particular countries. Nothing sends until that exists, by
design.

REPORT

  1. THE THREE SETUP LINKS, verbatim. Michael needs them and they work once.
  2. The hostname now serving the portal, and confirmation it loads from
     outside the house.
  3. Where ENCRYPTION_KEY and AUTH_SECRET are. State plainly that ENCRYPTION_KEY
     must be kept safe — it encrypts the stored Gmail app password and OpenAI
     key, and losing it means re-entering both.
  4. Output of verify:deployment and check:health.
  5. The exact sentence the application gives when asked to send. It should
     refuse because APP_URL is not PRODUCTION_APP_URL. Quote it. This is the
     correct state.
  6. Confirmation that backup ran, verify:restore passed, and where backups go.
  7. Confirmation that the app and tunnel both survived a reboot.
  8. What you changed in System Settings.
  9. Anything you could not do, or had to decide. Do not smooth over a failure.
```

---

## After Codex reports back

You'll have it running on your own domain, with three one-time links in hand.
Carry on at `GO_LIVE.md` **step 3**.

The two long-lead items should already be moving: David's Gmail app password
(two minutes) and the compliance approval (a conversation with other people).
Start the second today — everything else waits on it.

**The last thing you do, not the first:** when the approval is recorded and
pre-flight passes, change `APP_URL` in `.env` to match `PRODUCTION_APP_URL` and
restart. That one line is what turns sending on.
