# Handoff — finishing the deployment on Mike's Mac

Prepared from the repository. **Not executed** — this session runs in Anthropic's
cloud and has no path to `/Users/otto/Documents/spv`. Every command below is
ready to run; nothing in here claims to have been verified on the machine.

Give this file to Claude running **on the Mac**, or work through it yourself.

**Nothing here commits anything.** The uncommitted `pnpm-workspace.yaml`
build-script approval is untouched by every step below.

---

# PART 0 — Two findings to read before you touch anything

These came out of reading the repository, and both would have produced a
confusing outage later.

## Finding 1 — after a reboot, the portal will NOT come back

This defeats task 8 as written, and it is silent.

`cloudflared` is a **LaunchDaemon** in `/Library/LaunchDaemons`. It starts at
boot, before anyone logs in. Correct.

But the two things behind it are **LaunchAgents**:

- PostgreSQL, if installed with `brew services start postgresql@16` (no sudo)
- The app, per task 2 — `~/Library/LaunchAgents/com.flipit.spv.plist`

**A LaunchAgent starts at login, not at boot.** So if the Mac reboots — power
cut, overnight update — and sits at the login screen, cloudflared comes up,
answers on `spv.flipit.ltd`, and proxies to nothing. Investors get an error page
from a hostname that looks alive. That is worse than a clean outage.

**Verify which you have:**

```bash
ls -la ~/Library/LaunchAgents/ | grep -i postgres
ls -la /Library/LaunchDaemons/ | grep -i postgres
```

`~/Library/LaunchAgents` → login-only. `/Library/LaunchDaemons` → boot. 

**Two ways to fix it. Pick one:**

**(a) Automatic login** — System Settings → Users & Groups → Automatic login →
`otto`. Simplest, and it means the Mac's FileVault disk is unlocked
unattended. On a machine holding investor data that is a real trade-off, and
worth a moment's thought rather than a shrug.

**(b) Run both as LaunchDaemons with `UserName`** — starts at boot, no login, no
auto-login. More correct, slightly more work. For Postgres:

```bash
brew services stop postgresql@16
sudo brew services start postgresql@16     # installs into /Library/LaunchDaemons
```

And for the app, use the LaunchDaemon variant in Part 3 rather than the
LaunchAgent.

**Whichever you choose, task 8's reboot test is the only thing that proves it.**
Do the reboot with the Mac locked at the login screen and check the site from
your phone *before* logging back in. That is the actual test.

## Finding 2 — `pnpm verify:deployment` will break the live site

`scripts/verify-deployment.ts` line 59: `const BASE_PATH = '/SPV'`.

The script runs `next build` with `BASE_PATH=/SPV` **into the same `.next`
directory the live app is serving from**. Your `.env` has `BASE_PATH` empty.

So running it leaves `.next` built for `/SPV`, and every asset on
`https://spv.flipit.ltd` 404s until you rebuild. The script does not put it back.

**Run it, then always:**

```bash
pnpm build
launchctl kickstart -k gui/$(id -u)/com.flipit.spv    # or the daemon equivalent
```

Better: run `verify:deployment` **before** task 2, while the app is still being
started by hand. Then nothing is live to break.

**On the hostname mismatch you asked about (task 9):** there is none, and this is
the useful part of the answer. Line 248 hard-codes
`PRODUCTION_APP_URL: 'https://spv.flipit.com'` as a *fixture* — a value
guaranteed not to equal the test origin, so the script can prove the send guard
refuses. It never reads your `.env` and never touches `spv.flipit.ltd`. The
script will pass, and the `.com` in its output is expected, not a fault.

Same for the test suite: `src/test/setup.ts` sets its own `spv.flipit.com` env,
so `pnpm test` is unaffected by your real domain.

**Genuinely stale `.com` references are documentation only** — 11 files:
`.env.example`, `BUILD_SPEC.md`, `CODEX_DEPLOY_PROMPT.md`, `CODEX_TASKS.md`,
`DEPLOYMENT.md`, `HOSTING.md`, `MAC_SETUP.md`, `OPEN_DECISIONS.md`,
`RUN_BUILD.md`, `SPEC_README.md`, `TEST_ME.md`. Cosmetic, no runtime effect. Say
the word and I'll correct them in one commit — I have not, per your instruction.

---

# PART 1 — The launchd blocker

**One deliberate repair.** The installer wrote a plist with no subcommand, so
`cloudflared` starts, finds a tunnel configured, prints the "use cloudflared
tunnel run" hint, and exits 1. `KeepAlive` then restarts it, which is the loop
you are seeing.

### Step 1.1 — Look first

```bash
sudo plutil -p /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
cat /etc/cloudflared/config.yml
```

Expected: `ProgramArguments` is a single string, `/opt/homebrew/bin/cloudflared`.

`config.yml` should contain `tunnel: f0c3ce0c-…`, a `credentials-file:` pointing
at `/etc/cloudflared/f0c3ce0c-….json`, and an `ingress:` block ending in a
catch-all `- service: http_status:404`. If the credentials path in the file does
not match where the JSON actually is, fix that too — it is the other way this
fails.

### Step 1.2 — Stop the flapping daemon and any foreground tunnel

```bash
sudo launchctl bootout system/com.cloudflare.cloudflared 2>/dev/null || true
pkill -f "cloudflared tunnel" || true
```

`https://spv.flipit.ltd` should now return 530. That is the expected state
between here and step 1.5 — it confirms nothing else is serving it.

### Step 1.3 — Write the plist

Mike runs this; it needs sudo.

```bash
sudo tee /Library/LaunchDaemons/com.cloudflare.cloudflared.plist >/dev/null <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cloudflare.cloudflared</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>/etc/cloudflared/config.yml</string>
    <string>--no-autoupdate</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/Library/Logs/com.cloudflare.cloudflared.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Library/Logs/com.cloudflare.cloudflared.err.log</string>
</dict>
</plist>
PLIST

sudo chown root:wheel /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo chmod 644 /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

Three things that matter and are easy to get wrong:

- **`644`, not `600`.** launchd refuses a plist it considers wrongly permissioned
  and the failure is opaque. The plist holds no secret — the credentials JSON
  does, and that stays `600`.
- **`--no-autoupdate`.** Without it cloudflared restarts itself to update, on its
  own schedule, in the middle of whatever is happening.
- **`ThrottleInterval 10`.** If it does fail, it backs off instead of spinning.

### Step 1.4 — Validate before loading

```bash
sudo plutil -lint /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
```

Must say `OK`. If it does not, the heredoc did not land cleanly — fix that before
loading, not after.

### Step 1.5 — Load it

```bash
sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
sudo launchctl enable system/com.cloudflare.cloudflared
```

### Step 1.6 — Evidence

```bash
sleep 15
sudo launchctl print system/com.cloudflare.cloudflared | grep -E "state|pid|last exit"
tail -20 /Library/Logs/com.cloudflare.cloudflared.err.log
curl -s -o /dev/null -w "%{http_code}\n" https://spv.flipit.ltd/verify
```

**Pass:** `state = running`, a real `pid`, `last exit code = 0` or absent, log
shows `Registered tunnel connection` (usually four), and `curl` returns `200`.

**Still failing?** Stop. The log line names it. The two likely causes are a
`credentials-file:` path in `config.yml` that does not match the JSON's actual
location, and the JSON being unreadable by root. Report the log line rather than
trying a third variation.

---

# PART 2 — `www.flipit.ltd` → `https://flipit.com`

Cloudflare dashboard, zone `flipit.ltd`.

1. Confirm a DNS record exists for `www` — an `A` record to `192.0.2.1` (the
   documentation-reserved address) **proxied**, orange cloud on. It never
   receives traffic; it exists so the rule has something to attach to.
2. **Rules → Redirect Rules → Create rule**
   - Name: `www to flipit.com`
   - When: **Custom filter expression** —
     `(http.host eq "www.flipit.ltd")`
   - Then: **Dynamic** redirect, `concat("https://flipit.com", http.request.uri.path)`
   - Status: **301**
   - Preserve query string: **on**
3. Deploy.

**Use `http.host eq "www.flipit.ltd"`, never `contains "flipit.ltd"`.** A
`contains` match would catch `spv.flipit.ltd` and redirect the portal to the
marketing site. That is the one way this task can break the deployment.

**Evidence:**

```bash
curl -sI https://www.flipit.ltd        | head -3   # expect 301 → https://flipit.com
curl -s -o /dev/null -w "%{http_code}\n" https://spv.flipit.ltd/verify   # must still be 200
```

Check the second one. Every time.

---

# PART 3 — Keep the app running

## 3a. LaunchAgent (starts at login)

```bash
cat > ~/Library/LaunchAgents/com.flipit.spv.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.flipit.spv</string>
  <key>WorkingDirectory</key>
  <string>/Users/otto/Documents/spv</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/pnpm</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/tmp/spv.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/spv-error.log</string>
</dict>
</plist>
PLIST

plutil -lint ~/Library/LaunchAgents/com.flipit.spv.plist
launchctl bootout gui/$(id -u)/com.flipit.spv 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flipit.spv.plist
```

The explicit `PATH` matters — launchd gives a process almost none, and `pnpm`
shelling out to `node` is exactly where that bites.

Kill any hand-started `pnpm start` first, or port 3000 is taken and this flaps.

## 3b. LaunchDaemon variant (starts at boot, no login) — see Finding 1

Same content, but write it to
`/Library/LaunchDaemons/com.flipit.spv.plist`, add:

```xml
  <key>UserName</key>
  <string>otto</string>
```

then `sudo chown root:wheel`, `sudo chmod 644`, and
`sudo launchctl bootstrap system /Library/LaunchDaemons/com.flipit.spv.plist`.

Logs to `/tmp` are fine either way.

## Evidence

```bash
launchctl print gui/$(id -u)/com.flipit.spv | grep -E "state|pid"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
tail -5 /tmp/spv-error.log
```

---

# PART 4 — Sleep

No System Settings needed — `pmset` does it, and it is auditable afterwards.

```bash
sudo pmset -c sleep 0        # never system-sleep on mains power
sudo pmset -c disksleep 0    # never spin the disk down
sudo pmset -c womp 1         # wake on network access
```

Display sleep is deliberately left alone — the screen going dark does not stop
the machine serving.

**Evidence:**

```bash
pmset -g custom
```

Under `AC Power`, `sleep` and `disksleep` must both read `0`.

**Laptop caveat, and it is not small:** `-c` is mains power only. On battery it
will still sleep, and closing the lid sleeps it regardless unless it is on mains
with an external display. If this is a laptop, treat "always on" as "always on,
plugged in, lid open or docked" and say so out loud rather than assuming.

---

# PART 5 — Scheduled jobs

**Preserving what is there.** Never `crontab -e` blind on a machine whose crontab
you have not read.

```bash
crontab -l > /tmp/crontab.backup 2>/dev/null || true
cat /tmp/crontab.backup
which pnpm      # confirm /opt/homebrew/bin/pnpm before continuing
```

Then append without touching existing lines:

```bash
{ crontab -l 2>/dev/null; cat <<'CRON'

# Flipit SPV portal
0  *  * * *  cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm reminders:run >> /tmp/spv-reminders.log 2>&1
15 8  * * *  cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm check:health  >> /tmp/spv-health.log    2>&1
30 8  * * 1  cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm media:check   >> /tmp/spv-media.log     2>&1
45 2  * * *  cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm backup        >> /tmp/spv-backup.log    2>&1
CRON
} | crontab -

crontab -l
```

Diff that against `/tmp/crontab.backup` and confirm only additions.

**macOS will need Full Disk Access for cron**, or these fail silently reading
`.env`: System Settings → Privacy & Security → Full Disk Access → `+` →
Cmd-Shift-G → `/usr/sbin/cron`. Mike does this one.

**Evidence — do not skip, a cron line that never runs is the classic silent
failure:**

```bash
# after the next hour
cat /tmp/spv-reminders.log

# or force one now
cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm reminders:run
```

Expect a line saying it ran and sent nothing. **It cannot send** — no compliance
approval, no mail credential, and `APP_URL` ≠ `PRODUCTION_APP_URL`. Three
independent gates. Running it is safe.

---

# PART 6 — Backups

```bash
cd /Users/otto/Documents/spv
pnpm backup
pnpm verify:restore
```

Report both outputs verbatim. `verify:restore` is the one that counts — a backup
nobody has restored is a hope.

**Then the question for Mike, which nobody can answer for him:**

> Where should backups sync off this Mac — **iCloud Drive**, **Dropbox**, or an
> **external drive**?

A backup on the same disk as the database is not a backup. This is the single
place where running on your own machine raises the stakes, and it is unresolved
until you answer.

*(A note worth having: the dump contains every investor's name, address and
financial position. Whichever destination you pick, it is now holding that. An
external drive keeps it off third-party infrastructure entirely; iCloud and
Dropbox are encrypted at rest but are somebody else's servers. Not a blocker —
just a thing to choose deliberately rather than by default.)*

---

# PART 7 — Reboot test

**With Mike's confirmation.** Run Part 8's monitor first so there is a baseline.

```bash
sudo shutdown -r now
```

**After it comes back — and this is the important part — check from your phone
BEFORE logging in**, while the Mac sits at the login screen. That is the state a
3am reboot leaves it in, and it is the state Finding 1 is about.

Then, once logged in:

```bash
pg_isready -h localhost                                                  # database
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000           # app
sudo launchctl print system/com.cloudflare.cloudflared | grep -E "state|pid"
curl -s -o /dev/null -w "%{http_code}\n" https://spv.flipit.ltd/verify   # end to end
crontab -l | grep -c spv                                                 # expect 4
```

**Pass:** phone works at the login screen *and* all five above are healthy.

If the phone check failed at the login screen but everything works after login,
Finding 1 is confirmed — go back and apply fix (a) or (b).

---

# PART 8 — Outage monitoring

Writes one line per run naming *which layer* failed. Not app code — an ops
script outside the repository, so nothing here is committed.

```bash
mkdir -p ~/bin && cat > ~/bin/spv-monitor.sh <<'SCRIPT'
#!/bin/bash
# Which layer is broken. One line per run.
# app | database | tunnel | internet | dns | ok

HOST="spv.flipit.ltd"
LOCAL="http://localhost:3000"
LOG="/tmp/spv-monitor.log"
stamp() { date "+%Y-%m-%dT%H:%M:%S%z"; }
say() { echo "$(stamp) $1 $2" >> "$LOG"; }

# Layer 1 — is this machine on the internet at all?
if ! curl -s --max-time 8 -o /dev/null https://1.1.1.1; then
  say INTERNET "no route out — nothing below this is diagnosable"
  exit 1
fi

# Layer 2 — does the name still resolve?
if ! dig +short +time=5 "$HOST" | grep -q .; then
  say DNS "$HOST does not resolve"
  exit 1
fi

# Layer 3 — database
if ! pg_isready -h localhost -q; then
  say DATABASE "postgres not accepting connections"
  exit 1
fi

# Layer 4 — the app itself, bypassing Cloudflare entirely
LOCAL_CODE=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" "$LOCAL")
if [ "$LOCAL_CODE" != "200" ]; then
  say APP "localhost:3000 returned $LOCAL_CODE — database is up, app is not"
  exit 1
fi

# Layer 5 — the tunnel. App is proven healthy, so a failure here is Cloudflare's
# side of the rope. 530 is specifically "Cloudflare cannot reach the origin".
PUB_CODE=$(curl -s --max-time 15 -o /dev/null -w "%{http_code}" "https://$HOST/verify")
if [ "$PUB_CODE" != "200" ]; then
  if [ "$PUB_CODE" = "530" ] || [ "$PUB_CODE" = "502" ] || [ "$PUB_CODE" = "521" ]; then
    say TUNNEL "app healthy, public returned $PUB_CODE — cloudflared is down"
  else
    say TUNNEL "public returned $PUB_CODE while app is healthy"
  fi
  exit 1
fi

# Optional, and never required. Reported, never acted on.
TS="absent"
if command -v tailscale >/dev/null 2>&1; then
  tailscale status >/dev/null 2>&1 && TS="up" || TS="down"
fi

say OK "app=200 public=200 tailscale=$TS"
exit 0
SCRIPT

chmod +x ~/bin/spv-monitor.sh
~/bin/spv-monitor.sh; cat /tmp/spv-monitor.log
```

Then every five minutes:

```bash
{ crontab -l 2>/dev/null; echo '*/5 * * * * /Users/otto/bin/spv-monitor.sh'; } | crontab -
```

**The ordering is the whole design.** Each layer is only checked once the one
beneath it is proven healthy, so the line you get names the actual fault instead
of the first symptom. A dead router would otherwise look like a dead tunnel.

**Tailscale is observed and never depended on.** The script reports its state and
no branch requires it. It has no part in serving the portal.

**Evidence:**

```bash
tail -5 /tmp/spv-monitor.log     # expect: OK app=200 public=200

# prove it detects a real fault
launchctl bootout gui/$(id -u)/com.flipit.spv
sleep 3 && ~/bin/spv-monitor.sh; tail -1 /tmp/spv-monitor.log   # expect APP
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flipit.spv.plist
sleep 10 && ~/bin/spv-monitor.sh; tail -1 /tmp/spv-monitor.log  # expect OK
```

A monitor that has never seen a failure has not been tested.

**What it does not do:** tell anybody. It writes a log. Wiring it to a phone is a
decision about who gets woken at 3am, and nobody has made it. Cheapest real
answer: point a free uptime service (UptimeRobot, Better Stack) at
`https://spv.flipit.ltd/verify` from *outside* the house. That one survives your
Mac and your router being the thing that is broken — which this script, running
on the Mac, cannot.

---

# PART 9 — Graham's access. Do not build yet.

You are right that `OPERATOR` is wrong, and it is worse than it looks.

`OPERATOR` can advance an investor's status, record funds received, answer and
publish questions, extend deadlines, close the round — and **send invitations**.
It is the most operationally powerful role in the application. It is not a
read-heavy role with some editing; it is the role that acts.

## Why this is a real feature and not a config change

- `src/db/schema.ts:41` — `pgEnum('role', ['OWNER', 'OPERATOR'])`. A third value
  is a migration.
- **38 files** call `requireOwner`, `requireOperator` or `requireAdmin`.
- **`requireAdmin()` is the landmine.** It means "signed in with a privileged
  role" — today that is only owner or operator. Add `VIEWER` to the enum and
  **every `requireAdmin()` call site silently admits Graham**, including
  mutating ones. The role would not fail closed; it would fail *open*, quietly,
  across the whole admin surface.

So the work is not "add a role". It is: add the enum value, audit all 38 call
sites, split `requireAdmin` into read and write variants, and write tests that
fail if a viewer ever reaches a mutation. Then a separate invite path. Doable and
well-scoped — but it is a feature with a security surface, and you have not
authorized it. **Nothing has been built.**

## The question I need answered before anything is designed

You said "see everything but not make changes". Which of these does Graham get?

| | Includes |
|---|---|
| **A — Summary only** | Totals, counts, round progress. **No investor names, no individual amounts.** |
| **B — Full read** | Every investor by name, all four amounts each, documents, the Q&A thread, status history. |
| **C — Full read + audit log** | B, plus every action anybody has taken, including blocked sends and their reasons. |

**They are materially different**, and the difference is not technical. B and C
give a third party the identity and financial position of every named individual
in a private securities round. Those people consented to Flipit holding that, not
to an additional named reader. Depending on where they live, adding one may be a
data-protection question rather than a preference — and §15 of the spec treats
that list as confidential throughout.

**A** is genuinely low-risk and covers most of what an outside pair of eyes
usually wants.

**C** is the right answer if Graham's job is oversight of *you and David* rather
than of the investors.

Tell me which, and whether Graham should be able to export. Then I will scope it
properly, with the `requireAdmin` split and the tests, and you can approve or
not.

**Graham's account does not exist and no invite has been created.**

---

# Final state

**Unchanged and safe:**

- `APP_URL` = `http://localhost:3000`, `PRODUCTION_APP_URL` =
  `https://spv.flipit.ltd`. They differ, so **sending is refused at the guard**.
- No email sent, no send attempted.
- No compliance, mail-connection or base-URL guard touched.
- No investor account, no imported data.
- No application code modified.
- Nothing committed. `pnpm-workspace.yaml` untouched.
- No secret printed anywhere in this file.
- Tailscale: not used, not required, observed only.

**Turning sending on is one line, and it is the last thing you ever do:** set
`APP_URL` equal to `PRODUCTION_APP_URL` and restart — after the compliance
approval is recorded and pre-flight passes. Not before.
