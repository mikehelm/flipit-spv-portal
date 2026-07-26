# Running it on your Mac

Yes, this works. Cost: **$0**.

The one thing that makes it work — and makes moving it later free — is putting
the real domain in front of it from day one. Investors' links point at
`spv.flipit.com`, not at your Mac. Where that domain lands is something you can
change in five minutes, any time, without breaking a single link anyone is
holding.

---

## Setup

### 1. Install what's needed

```bash
brew install postgresql@16 node pnpm cloudflared
brew services start postgresql@16
createdb spv
```

### 2. Get the code

```bash
cd ~/Documents
git clone https://github.com/mikehelm/flipit-spv-portal.git spv
cd spv
pnpm install
```

### 3. Configure

Copy `.env.example` to `.env` and fill in:

```
DATABASE_URL        postgresql://localhost:5432/spv
BASE_PATH           
APP_URL             https://spv.flipit.com
PRODUCTION_APP_URL  https://spv.flipit.com
ENCRYPTION_KEY      run: openssl rand -base64 32
AUTH_SECRET         run: openssl rand -base64 32   ← a different one
OWNER_EMAILS        mike@flipthepage.com,mike@flipit.com
OPERATOR_EMAILS     serenedavid@gmail.com
MEDIA_STORE         filesystem
MEDIA_DIR           .media
```

**While you're setting up and testing, set `APP_URL` to
`http://localhost:3000`.** That makes the two values differ, and the app refuses
to send anything at all — which is what you want until the compliance approval
exists. Make them match only when you're genuinely ready to send.

### 4. Start it

```bash
pnpm db:migrate
pnpm db:seed        # prints your three one-time setup links
pnpm build
pnpm start
```

Open http://localhost:3000. That's the whole application, running on your Mac.

### 5. Put it on the internet

This is the step that matters. Cloudflare Tunnel — free, no port forwarding, no
static IP, works behind any router, and gives you real HTTPS.

```bash
cloudflared tunnel login          # opens a browser, pick flipit.com
cloudflared tunnel create spv
cloudflared tunnel route dns spv spv.flipit.com
```

Then create `~/.cloudflared/config.yml`:

```yaml
tunnel: spv
credentials-file: /Users/YOUR_NAME/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: spv.flipit.com
    service: http://localhost:3000
  - service: http_status:404
```

Run it as a background service so it survives reboots:

```bash
sudo cloudflared service install
```

`spv.flipit.com` now reaches your Mac. Nothing is exposed except that one
hostname on that one port, and your home IP is never published.

### 6. Keep it running

**Stop the Mac sleeping.** System Settings → Displays → Advanced → *Prevent
automatic sleeping when the display is off*. On a laptop, also plug it in and set
Energy Saver accordingly.

**Restart the app automatically.** Create
`~/Library/LaunchAgents/com.flipit.spv.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.flipit.spv</string>
  <key>WorkingDirectory</key><string>/Users/YOUR_NAME/Documents/spv</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/pnpm</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/spv.log</string>
  <key>StandardErrorPath</key><string>/tmp/spv-error.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.flipit.spv.plist
```

Now it starts on login and restarts if it crashes.

### 7. The scheduled jobs

`crontab -e`, then:

```
0  *  * * *  cd ~/Documents/spv && /opt/homebrew/bin/pnpm reminders:run  >> /tmp/spv-reminders.log 2>&1
15 8  * * *  cd ~/Documents/spv && /opt/homebrew/bin/pnpm check:health   >> /tmp/spv-health.log    2>&1
30 8  * * 1  cd ~/Documents/spv && /opt/homebrew/bin/pnpm media:check    >> /tmp/spv-media.log     2>&1
```

macOS may ask for Full Disk Access for cron — System Settings → Privacy &
Security → Full Disk Access → add `/usr/sbin/cron`.

### 8. Backups

```bash
pnpm backup            # writes one
pnpm verify:restore    # proves one actually restores
```

Add a nightly `pnpm backup` to cron and put the folder somewhere that syncs off
the machine — iCloud, Dropbox, an external drive. **A backup on the same disk as
the database is not a backup**, and this is the one thing where being on your own
Mac genuinely raises the stakes.

---

## What to know

**The good:**

- $0
- Investor data never leaves your machine — for a portal holding named people's
  personal and financial details, that is worth something
- Fast, and you can see everything happening
- Cloudflare sits in front, so your home IP is never published

**The honest risks**, all of which only matter during the two-to-four weeks when
investors hold live links:

- **The Mac sleeps, reboots, or goes out of the house.** An investor clicking
  their invitation link and hitting a browser error is the worst possible first
  impression for a private securities offer. It reads as a scam.
- **Your home internet goes down.** Same effect, and not in your control.
- **A missed cron run** means someone doesn't get reminded. Not dangerous — the
  app skips stale reminders rather than sending them late — but it's a feature
  quietly not working.

None of these is fatal. All of them are more likely than on a server that does
nothing else.

---

## What I'd actually do

**Run it on your Mac for everything up to sending.** Setup, David's onboarding,
the test invitation, importing the list, checking the numbers, the compliance
approval going in. That's most of the work and none of it depends on uptime.

**Then decide, when you can see it.** If it has been solid for a fortnight, send
from the Mac. If it has been flaky, move it — and moving is genuinely cheap:

```bash
pnpm backup                    # on the Mac
# on the server: clone, pnpm install, restore the dump, set .env
cloudflared tunnel route dns   # repoint spv.flipit.com
```

About thirty minutes, and **not a single investor link breaks**, because they all
point at `spv.flipit.com` and that never changed.

That's the real answer to "we could move it someday if it mattered" — set the
domain up properly now and someday costs you half an hour. Don't decide today.
