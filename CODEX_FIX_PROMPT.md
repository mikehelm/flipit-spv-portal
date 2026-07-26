# Prompt for Codex — fix the Mac deployment

Paste everything in the fenced block into Codex on Mike's Mac.

Nothing to fill in. It picks up from the current machine state and does not
restart anything.

---

```
Finish and repair a deployment already in progress on this Mac. Work from the
current machine state. Do NOT start over and do NOT re-run setup that has
already succeeded.

The application is a private investor portal for a securities raise. It is
finished and tested. You are fixing how it runs, not what it does.

  Repository:  /Users/otto/Documents/spv
  Branch:      main
  Domain:      spv.flipit.ltd
  Tunnel ID:   f0c3ce0c-7ba8-4703-b668-afade3b78b41

RULES THAT DO NOT BEND

1. NEVER send email. Not a test, not to yourself, not to prove something works.
2. NEVER set APP_URL equal to PRODUCTION_APP_URL. APP_URL stays
   http://localhost:3000. That inequality is the safety catch that stops real
   securities invitations going out, and Mike turns it off himself, later.
3. Do not modify, bypass or "temporarily disable" the compliance gate, the
   mail-connection gate or the base-URL guard.
4. Do not modify application code. Report problems; do not fix them by changing
   behaviour.
5. Do not commit anything. There is an uncommitted change to
   pnpm-workspace.yaml (a build-script approval) — preserve it exactly.
6. Do not print, echo or paste any secret. Not ENCRYPTION_KEY, not AUTH_SECRET,
   not tunnel credentials. Refer to them by name only.
7. Do not create investor accounts or import any data.
8. Ask Mike to type any sudo password himself. Do not attempt to supply one.
9. No purchases, no domain registration, no paid services.
10. Do not use or require Tailscale for the portal. If present, report its state
    and nothing more.
11. IF THE SAME STEP FAILS TWICE, STOP AND REPORT THE EXACT ERROR. Do not try a
    third variation. This has already burned two attempts.

ALREADY DONE — do not redo

PostgreSQL 16 running. Node, pnpm, cloudflared installed. Database spv migrated
and seeded. pnpm install and pnpm build passed. App runs on localhost:3000. .env
exists mode 600. .media exists mode 700. Cloudflare zone flipit.ltd active.
Named tunnel "spv" created, DNS for spv.flipit.ltd exists, credentials and
/etc/cloudflared/config.yml both root-owned mode 600. Three one-time setup links
were captured and NOT opened — leave them that way.

═══════════════════════════════════════════════════════════════
TASK 1 — THE BLOCKER. One deliberate repair.
═══════════════════════════════════════════════════════════════

The Cloudflare installer wrote /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
with ProgramArguments containing only /opt/homebrew/bin/cloudflared and no
subcommand. So cloudflared starts, sees a tunnel configured, prints "use
cloudflared tunnel run", and exits 1. KeepAlive restarts it. That is the loop.

1.1  Inspect, do not guess:

     sudo plutil -p /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
     cat /etc/cloudflared/config.yml

     Confirm config.yml's credentials-file: path matches where the JSON actually
     is. A mismatch there is the other way this fails.

1.2  Stop the flapping daemon and any foreground tunnel:

     sudo launchctl bootout system/com.cloudflare.cloudflared 2>/dev/null || true
     pkill -f "cloudflared tunnel" || true

     spv.flipit.ltd should now return 530. That is expected until 1.5.

1.3  Write the plist (Mike types the sudo password):

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

     644, NOT 600. launchd refuses a plist it considers wrongly permissioned and
     the failure message does not say so. The plist holds no secret; the
     credentials JSON does, and that stays 600.

1.4  sudo plutil -lint /Library/LaunchDaemons/com.cloudflare.cloudflared.plist

     Must print OK. If not, the file did not land cleanly. Fix before loading.

1.5  sudo launchctl bootstrap system /Library/LaunchDaemons/com.cloudflare.cloudflared.plist
     sudo launchctl enable system/com.cloudflare.cloudflared

1.6  Evidence — paste all of it:

     sleep 15
     sudo launchctl print system/com.cloudflare.cloudflared | grep -E "state|pid|last exit"
     tail -20 /Library/Logs/com.cloudflare.cloudflared.err.log
     curl -s -o /dev/null -w "%{http_code}\n" https://spv.flipit.ltd/verify

     PASS = state running, a real pid, last exit 0 or absent, log shows
     "Registered tunnel connection", curl returns 200.

     If it still fails: STOP. Paste the log line. Do not try a third variation.

═══════════════════════════════════════════════════════════════
TASK 2 — Run this BEFORE task 3. It breaks the build if run after.
═══════════════════════════════════════════════════════════════

scripts/verify-deployment.ts line 59 sets BASE_PATH='/SPV' and runs next build
into the same .next directory the live app serves from. Mike's .env has
BASE_PATH empty. Running it leaves .next built for /SPV and every asset 404s.

     cd /Users/otto/Documents/spv
     pnpm verify:deployment
     pnpm check:health
     pnpm build          # MANDATORY — puts .next back

Report the exact output of the first two.

NOTE: that script hard-codes PRODUCTION_APP_URL: 'https://spv.flipit.com' at
line 248. That is a deliberate fixture — a value guaranteed to differ from the
test origin so the script can prove the send guard refuses. It is NOT a
misconfiguration and must not be "corrected".

═══════════════════════════════════════════════════════════════
TASK 3 — Keep the app running, and survive a reboot
═══════════════════════════════════════════════════════════════

FIRST, determine whether a reboot will actually restore service:

     ls -la ~/Library/LaunchAgents/ | grep -i postgres
     ls -la /Library/LaunchDaemons/ | grep -i postgres

~/Library/LaunchAgents = starts at LOGIN only. /Library/LaunchDaemons = at BOOT.

This matters and is currently wrong. cloudflared is a LaunchDaemon and starts at
boot. If Postgres and the app are LaunchAgents, then after an unattended reboot
the Mac sits at the login screen with cloudflared up and answering, proxying to
nothing. Investors get an error from a hostname that looks alive.

Report which you found, then ask Mike to choose:

  (a) Automatic login for user otto — simplest, but leaves the disk unlocked
      unattended on a machine holding investor data.
  (b) Run both as LaunchDaemons with UserName otto — starts at boot, no login,
      no auto-login. More correct. For Postgres:
          brew services stop postgresql@16
          sudo brew services start postgresql@16

Then create the app service. LaunchAgent version:

cat > ~/Library/LaunchAgents/com.flipit.spv.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.flipit.spv</string>
  <key>WorkingDirectory</key><string>/Users/otto/Documents/spv</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/pnpm</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/tmp/spv.log</string>
  <key>StandardErrorPath</key><string>/tmp/spv-error.log</string>
</dict>
</plist>
PLIST

     plutil -lint ~/Library/LaunchAgents/com.flipit.spv.plist
     pkill -f "next start" || true      # free port 3000 first, or it flaps
     launchctl bootout gui/$(id -u)/com.flipit.spv 2>/dev/null || true
     launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flipit.spv.plist

If Mike chose (b), write the same content to
/Library/LaunchDaemons/com.flipit.spv.plist, add <key>UserName</key>
<string>otto</string>, chown root:wheel, chmod 644, and bootstrap into system.

The explicit PATH is not optional — launchd gives a process almost none, and
pnpm shelling out to node is exactly where that bites.

Evidence:
     launchctl print gui/$(id -u)/com.flipit.spv | grep -E "state|pid"
     curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
     tail -5 /tmp/spv-error.log

═══════════════════════════════════════════════════════════════
TASK 4 — www.flipit.ltd → https://flipit.com
═══════════════════════════════════════════════════════════════

Cloudflare dashboard, zone flipit.ltd.

  1. Ensure a DNS record for www exists: A record to 192.0.2.1, PROXIED (orange
     cloud). It never receives traffic; it exists so a rule can attach.
  2. Rules → Redirect Rules → Create:
       When:  custom filter expression   (http.host eq "www.flipit.ltd")
       Then:  Dynamic → concat("https://flipit.com", http.request.uri.path)
       Status: 301,  Preserve query string: on
  3. Deploy.

USE eq, NEVER contains. A "contains flipit.ltd" match would catch
spv.flipit.ltd and redirect the investor portal to the marketing site.

Evidence — BOTH lines, every time:
     curl -sI https://www.flipit.ltd | head -3
     curl -s -o /dev/null -w "%{http_code}\n" https://spv.flipit.ltd/verify

═══════════════════════════════════════════════════════════════
TASK 5 — Sleep
═══════════════════════════════════════════════════════════════

     sudo pmset -c sleep 0
     sudo pmset -c disksleep 0
     sudo pmset -c womp 1
     pmset -g custom

Under AC Power, sleep and disksleep must both read 0. Display sleep is
deliberately left alone.

If this is a laptop, say so plainly in the report: -c is mains power only, and
closing the lid sleeps it regardless unless docked.

═══════════════════════════════════════════════════════════════
TASK 6 — Scheduled jobs, preserving what exists
═══════════════════════════════════════════════════════════════

     crontab -l > /tmp/crontab.backup 2>/dev/null || true
     cat /tmp/crontab.backup
     which pnpm        # confirm the path before continuing

{ crontab -l 2>/dev/null; cat <<'CRON'

# Flipit SPV portal
0  *  * * *  cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm reminders:run >> /tmp/spv-reminders.log 2>&1
15 8  * * *  cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm check:health  >> /tmp/spv-health.log    2>&1
30 8  * * 1  cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm media:check   >> /tmp/spv-media.log     2>&1
45 2  * * *  cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm backup        >> /tmp/spv-backup.log    2>&1
CRON
} | crontab -

     crontab -l          # diff against /tmp/crontab.backup, additions only

Ask Mike to grant Full Disk Access to /usr/sbin/cron: System Settings → Privacy
& Security → Full Disk Access → + → Cmd-Shift-G → /usr/sbin/cron. Without it
these fail silently reading .env.

Prove one runs. This is safe — three independent gates stop it sending:
     cd /Users/otto/Documents/spv && /opt/homebrew/bin/pnpm reminders:run

Expect a line saying it ran and sent nothing.

═══════════════════════════════════════════════════════════════
TASK 7 — Backups
═══════════════════════════════════════════════════════════════

     cd /Users/otto/Documents/spv
     pnpm backup
     pnpm verify:restore

Report both outputs verbatim. verify:restore is the one that counts.

Then ASK MIKE: where should backups sync off this Mac — iCloud Drive, Dropbox,
or an external drive? Tell him the dump contains every investor's name and
financial position, so the destination is a deliberate choice. Configure
whichever he picks. Do not choose for him.

═══════════════════════════════════════════════════════════════
TASK 8 — Outage monitor
═══════════════════════════════════════════════════════════════

Create ~/bin/spv-monitor.sh. It must test layers in this order and stop at the
first failure, so the log names the actual fault rather than the first symptom:

  1. internet      curl https://1.1.1.1
  2. dns           dig +short spv.flipit.ltd
  3. database      pg_isready -h localhost
  4. app           curl http://localhost:3000        (bypasses Cloudflare)
  5. tunnel        curl https://spv.flipit.ltd/verify
                   530/502/521 with the app healthy = cloudflared is down

Append one line per run to /tmp/spv-monitor.log with a timestamp and a single
word: INTERNET, DNS, DATABASE, APP, TUNNEL or OK.

Report Tailscale state if the binary exists, and let no branch depend on it.

     chmod +x ~/bin/spv-monitor.sh
     { crontab -l 2>/dev/null; echo '*/5 * * * * /Users/otto/bin/spv-monitor.sh'; } | crontab -

PROVE it detects a fault, do not just prove it says OK:
     launchctl bootout gui/$(id -u)/com.flipit.spv
     sleep 3 && ~/bin/spv-monitor.sh && tail -1 /tmp/spv-monitor.log   # expect APP
     launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flipit.spv.plist
     sleep 10 && ~/bin/spv-monitor.sh && tail -1 /tmp/spv-monitor.log  # expect OK

Also tell Mike: this monitor runs on the Mac, so it cannot report that the Mac
is down. Recommend a free external checker (UptimeRobot, Better Stack) pointed
at https://spv.flipit.ltd/verify.

═══════════════════════════════════════════════════════════════
TASK 9 — Reboot, with Mike's confirmation
═══════════════════════════════════════════════════════════════

     sudo shutdown -r now

CRITICAL: when it comes back, have Mike check https://spv.flipit.ltd/verify
from his PHONE ON MOBILE DATA while the Mac is still at the LOGIN SCREEN,
before logging in. That is the state a 3am reboot leaves it in and it is the
only test that proves task 3 worked.

Then after login:
     pg_isready -h localhost
     curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
     sudo launchctl print system/com.cloudflare.cloudflared | grep -E "state|pid"
     curl -s -o /dev/null -w "%{http_code}\n" https://spv.flipit.ltd/verify
     crontab -l | grep -c spv        # expect 5

If the phone check failed at the login screen but everything works after login,
task 3 is not done. Go back and apply option (a) or (b).

═══════════════════════════════════════════════════════════════
DO NOT DO
═══════════════════════════════════════════════════════════════

  - open any setup link, or create any password
  - complete operator onboarding
  - connect any email account
  - send anything
  - import data or create an investor account
  - change APP_URL
  - create an account for grahambrain@gmail.com. The app has only OWNER and
    OPERATOR. OPERATOR can send invitations and mutate records — it is the
    wrong role and adding him to it would be a security incident, not a
    shortcut. A read-only role does not exist yet.

═══════════════════════════════════════════════════════════════
REPORT — paste verbatim, no claims without output
═══════════════════════════════════════════════════════════════

  1. Task 1: launchctl print output, err.log tail, and the curl status code.
  2. The ProgramArguments the plist had BEFORE you changed it, and after.
  3. Contents of /etc/cloudflared/config.yml with the credentials-file path
     shown but its contents NOT opened.
  4. Whether Postgres was a LaunchAgent or a LaunchDaemon, and which option
     Mike chose.
  5. Task 2: full output of verify:deployment and check:health, and
     confirmation that pnpm build was re-run after.
  6. Task 4: both curl outputs.
  7. pmset -g custom, AC Power section. State whether this is a laptop.
  8. crontab -l, and confirmation nothing pre-existing was removed.
  9. Task 7: both outputs, and which backup destination Mike chose.
 10. Task 8: the three monitor log lines from the fault test.
 11. Task 9: whether the phone worked AT THE LOGIN SCREEN, and all five checks.
 12. Confirmation that APP_URL is still http://localhost:3000 and that
     PRODUCTION_APP_URL is still https://spv.flipit.ltd — i.e. that sending is
     still refused.
 13. Confirmation that git status shows only the pnpm-workspace.yaml change and
     that nothing was committed.
 14. Anything you could not do, or had to decide. Do not smooth over a failure.

No secret values anywhere in the report.
```

---

## What to send back to me

Paste Codex's whole report. The parts I most need if anything is still broken:

- `sudo plutil -p /Library/LaunchDaemons/com.cloudflare.cloudflared.plist`
- `tail -30 /Library/Logs/com.cloudflare.cloudflared.err.log`
- `cat /etc/cloudflared/config.yml`
- `sudo launchctl print system/com.cloudflare.cloudflared`

Those four tell me almost everything. Never paste the credentials JSON — it is a
secret and I do not need it.
