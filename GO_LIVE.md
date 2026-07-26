# Going live

The software is finished. Nothing below is a coding job.

**Cost: $0.** It runs on your Mac — the page and the database both — with
Cloudflare putting your own domain in front of it. No server to rent.
(Alternatives, and when you'd move off the Mac, are in `HOSTING.md`.)

---

## Start these two today

Everything else waits on them, and both involve other people.

| | Who | How long |
|---|---|---|
| **Get the compliance approval** | David → the formation agents | Days. Start now. |
| **Generate a Gmail app password** | David | Two minutes. |

---

# Michael — 13 steps

### 1. Set it up on your Mac

**Hand `CODEX_DEPLOY_PROMPT.md` to Codex.** It installs everything, starts the
database, gets the app running, sets up the Cloudflare tunnel, adds the
scheduled jobs and the backups, and reboots the Mac to prove it all comes back.

Full manual steps, if you'd rather do it yourself: `MAC_SETUP.md`.

Two things you'll be asked for along the way:

- **The GitHub token**, when it clones the repository
- **Which domain** — it shows you ten options from the domains you own and waits
  for you to pick

**Keep `ENCRYPTION_KEY` safe** when it reports back. It encrypts the Gmail
password and OpenAI key.

✅ Your domain loads the site — check it on your phone on mobile data, not the
house wifi.

### 2. Take the three links

Codex reports **three one-time setup links** — two for you, one for David. Each
works once and can't be recovered.

✅ You have all three. (Lost one? `pnpm setup-link`.)

### 3. Set your password

Open one of your links. It signs you in, asks for a password, then signs you
back out — deliberately. Sign back in at your domain, `/signin`.

✅ Signed in as owner.

### 4. Send David his link

Send it to `serenedavid@gmail.com`. Tell him to start with **D1** (the app
password) and **D4** (the approval) — those two have lead times.

### 5. Fill in Settings

- Sender name and email (`serenedavid@gmail.com`)
- **Fallback contact address** — shown to investors after the portal closes.
  You need to decide whose. Something like `records@flipit.com`.
- Decimal places for money

✅ System health stops flagging a missing contact route.

### 6. Check the scheduled jobs are really running

Codex set these up. Confirm the first one actually fired — without it,
**reminders never send**, which is a feature silently not working.

```bash
cat /tmp/spv-reminders.log
```

✅ There's a line in it from within the last hour.

### 7. Check backups land off the Mac

Codex ran `pnpm backup` and `pnpm verify:restore`. Confirm the backup folder is
syncing somewhere else — iCloud, Dropbox, an external drive.

**A backup on the same disk as the database is not a backup.** This is the one
place running on your own machine raises the stakes.

✅ You can see a backup file somewhere that isn't this Mac.

### 8. Record the compliance approval ← THE GATE

**Nothing sends until this exists.** No override. Only you can do it — not
David. Wait for his step D4.

Open **Compliance** and record: the approver's name, role and firm; the date and
a reference for the letter; **the list of countries cleared** (two-letter codes);
any conditions.

The screen then locks the email template to that approval. Change one character
of it afterwards and sending stops until you record a new one.

✅ The Compliance banner turns green.

### 9. Acknowledgement wording

Open **Acknowledgements**. Add whatever tick-box wording the approver gave you,
one box per sentence. Starts empty on purpose. Skip if they didn't ask for any.

✅ The boxes appear on an investor's portal.

### 10. Import the recipient list

Open **Import**, upload the spreadsheet. Columns can be in any order with any
names — the screen shows you how it read each one and asks you to confirm.

Every recipient needs a **country code**. It's what the compliance gate checks.

✅ Recipients lists everybody with the right figures.

### 11. Check the numbers

On **Recipients**, check the four totals — proposed, committed, accepted,
received — against your own spreadsheet. Open two or three records and check the
amounts and percentages.

✅ The totals reconcile. If they don't, stop.

### 12. Turn sending on ← the last thing, not the first

Until now `APP_URL` in `.env` has been `http://localhost:3000` while
`PRODUCTION_APP_URL` is your real domain. Because they differ, **the app refuses
to send anything at all.** That's the safety catch, and it's been on the whole
time.

When the approval is recorded and pre-flight passes:

1. Change `APP_URL` to match `PRODUCTION_APP_URL`
2. Restart the app

✅ The review screen stops saying sending is refused. That's the confirmation.

**Don't do this early.** It's the one line standing between a test setup and
real securities invitations going to real people.

### 13. Hand over to David

He does D5 onward. You keep oversight — you can see and export everything, and
you're the only one who can touch the compliance approval.

---

# David — 8 steps

### D1. Gmail app password ← do this first

In `serenedavid@gmail.com`:

1. Google Account → Security → turn on **2-Step Verification**
2. Security → **App passwords** → create one, name it "Flipit SPV"
3. Copy the 16 characters — Google shows them once

This isn't the Google verification process. No review, no waiting.

✅ You have the 16 characters.

### D2. Set your password

Open Michael's link. Choose a password. It signs you back out — deliberate. Sign
back in.

### D3. Onboarding — 6 steps

The app walks you through and remembers where you got to.

1. **Your display name**, as it should appear on investment correspondence
2. **How investors reach you** — phone, WhatsApp, or email only. WhatsApp puts a
   tappable link in every portal.
3. **Connect Gmail** — paste the app password. Press **Test connection**: it
   signs in without sending anything.
4. **Video** — record now, upload later, or skip. Your call. Ten minutes with a
   phone, and the highest-impact optional thing here.
5. **Q&A** — how it works, and add starter entries so it isn't empty
6. **Test invitation to yourself** — required before you can send to anyone else.
   The app refuses to send a test to any address but your own.

✅ The test email arrives and shows in your Gmail Sent folder. Read it as an
investor would.

### D4. Get the compliance approval ← THE GATE

**Start this before anything else here is finished.**

Setting up the SPV isn't the same as approving the wording of a solicitation
sent to named people in their own countries. Ask the formation agents — in
writing — for:

1. **Confirmation they've read the actual investor email.** Send them the
   preview from the Templates screen; it renders the real thing.
2. **The list of countries you may send to.** So far: Australia, England,
   France, Thailand, others to confirm.
3. **Tick-box wording**, if they want any
4. **Any conditions**

**The US recipient:** the app blocks them by default. An offering made entirely
outside the US is generally structured to rely on that fact, and one US person
changes the analysis for the whole offering. Recommendation: send to everyone
else, hold that one pending advice.

✅ You have it in writing and Michael has recorded it.

### D5. Pre-flight

Open **Recipients**. Compliance and mail connection are always on screen — both
must be green. Press **Pre-flight**. It checks every recipient before anything
sends. Fix what it finds.

✅ Pre-flight passes.

### D6. Send, one at a time

There's no "send all" button anywhere. By design.

For each person: **Preview** (their real figures) → **Send** → confirm → next.

Someone whose country isn't approved is blocked on their own, with the reason on
screen. **Everyone else still sends.**

✅ Everyone you meant to invite has been sent to.

### D7. Run the round

- **Questions** arrive in your queue. Answers are private unless you tick
  publish — and published ones show no name or date.
- **Reminders** go automatically at 7 and 2 days before each deadline, to
  non-responders only, max 2 each. You can cancel any of them.
- **Advance** each investor along the timeline as things happen.
- **Record funds received** — asks for the amount twice, on purpose. Generates
  their certificate.
- **Extend a deadline** any time, for one person or everyone.

**Nothing closes by itself.** A deadline passing takes nothing away from anybody.

### D8. Close the round

**The round** → close. The app reminds you when deadlines pass. It never closes
for you.

---

# Decisions needed

| # | Decision | Who |
|---|---|---|
| 1 | Countries cleared to send to | David → approver |
| 2 | The US recipient — advice, or hold | David → approver |
| 3 | Tick-box wording, if any | David → approver |
| 4 | Fallback contact address for after the portal closes | Michael |
| 5 | Privacy policy wording — optional now, worth having | Michael |
| 6 | Does David record a video | David |
| 7 | Q&A visible during the raise, or held until close? Currently visible | Michael |
| 8 | Confirm "David Serene" is spelled right — it goes on correspondence | Michael |
| 9 | Eyeball brand colours against the live flipit.com | Michael |

---

# If something goes wrong

**"It refuses to send."** That's the design. The screen always names the reason:
no approval, template changed since approval, no mail credential, connection not
verified recently, service not active, or not on production. It never says
"something went wrong".

**"An investor can't get in."** Links work once. Send them to `/portal/signin`
for a fresh one.

**"Is anything running?"** Open **System health**. Or `pnpm check:health` — it
exits non-zero when something needs a person.

**Everything else:** `TEST_ME.md` (plain English, what to try),
`MAC_SETUP.md` (the manual version of step 1), `HOSTING.md` (what it costs and
when you'd move off the Mac), `DEPLOYMENT.md` (if it ever goes on a server).
