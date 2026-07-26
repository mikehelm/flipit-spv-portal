# Going live

The software is finished. Nothing below is a coding job.

**Cost: about $5/month.** One small server running the app, the database and the
scheduled jobs together. The database is free — it lives on that same server.
(Why, and the alternatives, are in `HOSTING.md`.)

---

## Start these two today

Everything else waits on them, and both involve other people.

| | Who | How long |
|---|---|---|
| **Get the compliance approval** | David → the formation agents | Days. Start now. |
| **Generate a Gmail app password** | David | Two minutes. |

---

# Michael — 13 steps

### 1. Get it on a server

Rent a small VPS. Install Node 22, pnpm, PostgreSQL 16, nginx.

Set up at **`mikehelm.com/SPV`** first. The app physically refuses to send from
any address that isn't the production one, so you can set everything up and try
everything with no risk of reaching a real investor.

Environment variables:

```
DATABASE_URL        your Postgres connection string
BASE_PATH           /SPV
APP_URL             https://mikehelm.com/SPV
PRODUCTION_APP_URL  https://spv.flipit.com
ENCRYPTION_KEY      openssl rand -base64 32
AUTH_SECRET         openssl rand -base64 32   ← a different one
OWNER_EMAILS        mike@flipthepage.com,mike@flipit.com
OPERATOR_EMAILS     serenedavid@gmail.com
```

**Keep `ENCRYPTION_KEY` safe.** It encrypts the Gmail password and OpenAI key.

*Or hand `CODEX_DEPLOY_PROMPT.md` to Codex and it does steps 1 and 2 for you.*

✅ The site loads.

### 2. Create the accounts

```
pnpm db:migrate
pnpm db:seed
```

Prints **three one-time links** — two for you, one for David.

✅ You have the three links. (Lost one? `pnpm setup-link`.)

### 3. Set your password

Open one of your links. It signs you in, asks for a password, then signs you
back out — deliberately. Sign back in at `/SPV/signin`.

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

### 6. File storage *(optional)*

Only if you want images, documents or David's video. Set
`MEDIA_STORE=filesystem` and `MEDIA_DIR` to a folder on the server.

✅ You can upload an image on the Media page. Or skip — the portal works without.

### 7. Three cron jobs

```
0  *  * * *  cd /srv/spv && pnpm reminders:run  >> /var/log/spv/reminders.log 2>&1
15 8  * * *  cd /srv/spv && pnpm check:health   >> /var/log/spv/health.log    2>&1
30 8  * * 1  cd /srv/spv && pnpm media:check    >> /var/log/spv/media.log     2>&1
```

**Without the first line, reminders never send.**

✅ A line appears in `reminders.log` after the next hour.

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

### 12. Move to `spv.flipit.com` ← BEFORE the first invitation

Portal links have the domain baked in. Move after sending and every investor's
link dies.

1. Point DNS at the app
2. `APP_URL` → `https://spv.flipit.com`, `BASE_PATH` → empty
3. Move the database, or point the new deployment at the same one
4. Turn off the old deployment

Full runbook: `DEPLOYMENT.md` §4.

✅ The review screen stops saying sending is refused. That's the confirmation.

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
`DEPLOYMENT.md` (for whoever's on the server), `HOSTING.md` (what it costs).
