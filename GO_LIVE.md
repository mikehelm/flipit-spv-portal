# Going live — what Michael does, then what David does

The software is finished. Nothing on this list is a coding job.

Read the two critical-path items first, because everything else can happen in
any order around them and these two cannot:

1. **David gets the compliance approval** and Michael records it. Until that
   exists the application refuses to send anything, by design. This is the one
   with a lead time — it involves other people — so start it today.
2. **David generates a Gmail app password.** Two minutes, but nothing sends
   without it either.

Everything else is setup you can do while waiting on those.

---

# PART ONE — Michael

## Step 1 · Put the application on a server

You need somewhere to run it and a PostgreSQL database. Roughly USD 20–50 a
month, as agreed.

**Test deployment first: `mikehelm.com/SPV`.** This is deliberate. The
application refuses to send real invitations from any address that is not the
production one, so you can set everything up and try everything without any risk
of a message reaching a real investor.

Set these environment variables:

```
DATABASE_URL        your PostgreSQL connection string
BASE_PATH           /SPV
APP_URL             https://mikehelm.com/SPV
PRODUCTION_APP_URL  https://spv.flipit.com
ENCRYPTION_KEY      run: openssl rand -base64 32
AUTH_SECRET         run: openssl rand -base64 32   (a different one)
OWNER_EMAILS        mike@flipthepage.com,mike@flipit.com
OPERATOR_EMAILS     serenedavid@gmail.com
```

`.env.example` in the repository explains every one of them, including the
optional ones.

**Keep `ENCRYPTION_KEY` somewhere safe.** It encrypts the Gmail app password and
the OpenAI key. Lose it and those have to be re-entered.

**Done when:** the site loads.

---

## Step 2 · Create the accounts

Run these two commands on the server:

```
pnpm db:migrate
pnpm db:seed
```

The second one prints **three one-time links** — one for each of your two owner
addresses, one for David.

**Each link works once and cannot be recovered.** If you lose one, run
`pnpm setup-link` to mint another.

**Done when:** you have the three links.

---

## Step 3 · Set your own password

Open one of your links. It signs you in and immediately asks you to choose a
password — and that is the only page you can reach until you do.

Choosing one signs you straight back out. That is on purpose: the link travelled
through a terminal, so the session it created is exactly the session that should
not outlive the real password.

Sign back in at `/SPV/signin`.

**Done when:** you are signed in as owner.

---

## Step 4 · Send David his link

Send it to `serenedavid@gmail.com` by whatever means you normally use. Tell him
to do Part Two below, and tell him **step D1 first** — the app password — because
it has to exist before his setup can finish.

**Done when:** David has his link.

---

## Step 5 · Fill in Settings

Sign in as owner and open **Settings**. Fill in:

- **Sender name** — how David's name should appear on investment
  correspondence.
- **Sender email** — `serenedavid@gmail.com`.
- **Service contact address** — the fallback. This is the address shown to an
  investor once the portal has closed and David's own address has stopped being
  read. **You need to decide whose this is** (see Decisions below). Something
  like `records@flipit.com`.
- **Decimal places** for money and percentages.

**Done when:** the System health page stops reporting a missing contact route.

---

## Step 6 · Choose where uploaded files go

Only needed if you want images, documents or David's video.

Set `MEDIA_STORE=filesystem` with a `MEDIA_DIR` if your server has a disk that
survives a restart. If it does not — most modern hosting does not — set
`MEDIA_STORE=object-store` and point it at a Cloudflare R2 or Amazon S3 bucket.
The five variables are listed in `.env.example`.

**The bucket must be private.** Nothing in the application makes a file public.

**Done when:** you can upload an image on the Media page. Or skip it entirely —
an empty media library is a supported state and the portal works without one.

---

## Step 7 · Set the three scheduled jobs

On the server, add these three cron lines:

```
# Reminders and the deadline digest. Hourly.
0 * * * * cd /srv/spv && /usr/bin/pnpm reminders:run >> /var/log/spv/reminders.log 2>&1

# The things nobody is watching. Daily.
15 8 * * * cd /srv/spv && /usr/bin/pnpm check:health >> /var/log/spv/health.log 2>&1

# Every stored file against its record, and back again. Weekly.
30 8 * * 1 cd /srv/spv && /usr/bin/pnpm media:check >> /var/log/spv/media.log 2>&1
```

Adjust the path to wherever the application lives.

Without the first line, **reminders never send**. Everything else keeps working.

**Done when:** `/var/log/spv/reminders.log` has a line in it after the next hour.

---

## Step 8 · Record the compliance approval — THE GATE

**Nothing sends until this exists.** You cannot skip it, there is no override,
and the operator cannot do it for you. Wait for David's step D4.

When he has the approval, sign in as owner, open **Compliance**, and record:

- The approver's name, role and firm
- The date, and a reference for the evidence — the letter or email
- **The list of countries cleared**, as two-letter codes. Anyone whose country
  is not on this list is blocked individually; everyone else still sends.
- Any conditions the approver noted

The screen then hashes the exact email template. **If a single character of that
template changes afterwards, sending stops until you record a new approval.**
That is intended — it means nobody can quietly edit an approved solicitation.

**Done when:** the Compliance banner on the main screen turns green.

---

## Step 9 · Enter the acknowledgement wording

Open **Acknowledgements**. This is where the approver's wording goes — the tick
boxes an investor confirms before recording an interest.

It starts empty on purpose. Add one box per sentence the approver gave you.

Wording that reads as an undertaking — *subscribe*, *binding*, *irrevocable*,
*undertake*, *contract*, *guarantee* — is refused, and it names the word. A tick
box may never do the work the subscription documents are supposed to do.

**Done when:** the boxes appear on an investor's portal. Skip it if your
approver did not ask for any.

---

## Step 10 · Import the recipient list

Open **Import** and upload the spreadsheet. Columns can be in any order, named
anything, with mixed date formats — the screen shows you exactly how it read
every column and asks you to confirm before anything is imported.

Every recipient needs a **jurisdiction** — the two-letter country code. It is
required, because it is what the compliance gate checks.

**Done when:** the Recipients screen lists everybody with the right figures.

---

## Step 11 · Check the numbers

On the **Recipients** screen, check the four money totals at the top against
your own spreadsheet: proposed, committed, accepted, received.

Open two or three individual records and check the amount, the SPV percentage
and the indirect Flipit percentage against what you expect.

**Done when:** the totals reconcile. If they do not, stop — do not proceed on the
assumption it will sort itself out.

---

## Step 12 · Move to `spv.flipit.com` — BEFORE the first real invitation

**Do this before David sends anything, not after.**

Every portal link an investor receives has the domain baked into it. A link
issued from `mikehelm.com/SPV` dies the moment you move, leaving an investor
holding a dead link to a securities offer.

`DEPLOYMENT.md` §4 is the runbook. In short:

1. Point DNS for `spv.flipit.com` at the application.
2. Change `APP_URL` to `https://spv.flipit.com` and `BASE_PATH` to empty.
3. Move the database, or point the new deployment at the same one.
4. Sign in and confirm the review screen no longer says sending is refused.
5. Turn off the old deployment so nobody uses it by accident.

**Done when:** the review screen no longer refuses to send. That refusal
disappearing *is* the confirmation you are on production.

---

## Step 13 · Hand over to David

Tell him the round is ready. He does Part Two, steps D5 onward.

Your remaining job is oversight: you can see everything, export everything, and
you are the only one who can record or amend the compliance approval.

---

# PART TWO — David

## Step D1 · Gmail app password — DO THIS FIRST

Sign in to `serenedavid@gmail.com`.

1. Turn on **2-Step Verification** if it is not already on
   (Google Account → Security). App passwords do not exist without it.
2. Go to Google Account → Security → **App passwords**.
3. Create one. Name it "Flipit SPV".
4. Copy the 16-character password. **Keep it until step D3** — Google shows it
   once.

This is not the Google verification process. No review, no waiting period, no
demo video. It is a two-minute job.

**Done when:** you have the 16 characters.

---

## Step D2 · Set your password

Open the one-time link Michael sent you. It signs you in and asks you to choose a
password straight away. Choosing one signs you back out — that is deliberate.

Sign back in with your new password.

**Done when:** you are signed in.

---

## Step D3 · Complete onboarding

The application walks you through six steps and remembers where you got to, so
you can stop and come back.

1. **Your display name**, exactly as it should appear on investment
   correspondence.
2. **How investors reach you** — phone, WhatsApp, or email only. WhatsApp puts a
   tappable link in every investor's portal. Email-only removes the phone line
   from the email entirely rather than leaving it blank.
3. **Connect the Gmail account** — paste the app password from D1. Press **Test
   connection**: it signs in without sending anything, so you know it works
   before it matters.
4. **The video** — record one now, upload one later, or skip. Entirely your
   call. It is ten minutes with a phone and it is the highest-impact optional
   thing on this list.
5. **Questions and answers** — how it works, in two sentences, and you can add
   your own starter entries so the section is not empty when the first investor
   looks.
6. **A test invitation to yourself.** The application requires this before it
   will let you send to anyone else, and it refuses to send a test to any
   address but your own — so this is not a matter of being careful.

**Done when:** the test invitation arrives in your inbox and appears in your
Gmail Sent folder. Read it as an investor would.

---

## Step D4 · Get the compliance approval — THE GATE

**This is the item everything else waits on. Start it before anything else on
this list is finished.**

Go to the BVI/HK formation agents — or whoever is right — and ask them a
specific question. Setting up the SPV is not the same as approving the wording of
a solicitation sent to named individuals in their own countries.

Ask for, in writing:

1. **Confirmation they have read the actual investor email**, not a description
   of it. You can send them the preview from the Templates screen — it renders
   the real thing.
2. **The list of countries you may send to.** Known so far: Australia, England,
   France, Thailand and others to confirm. UK financial-promotion rules and
   Australian small-scale offer thresholds are the usual ones to check.
3. **The wording for the acknowledgement tick boxes**, if they want any.
4. **Any conditions** they want attached.

**On the US recipient:** the application blocks them by default and explains
why on screen. An offering made entirely outside the United States is generally
structured to rely on that fact, and adding one US person changes the analysis
for the whole offering — not just for that person. The recommendation is to send
to everyone else and hold that one pending specific advice. One conversation, one
person delayed; the alternative is unwinding an offer already made.

**Done when:** you have it in writing and Michael has recorded it (his step 8).

---

## Step D5 · Walk the pre-flight checklist

Open **Recipients**. Two things are permanently on screen: whether compliance is
approved, and whether the mail connection is healthy. Both must be green.

Press **Pre-flight**. It checks every recipient before anything sends — that
every variable in the email resolves for every person, that nobody's jurisdiction
is missing, that the template still matches the approved version.

Fix whatever it finds. It is much better to find it here.

**Done when:** pre-flight passes.

---

## Step D6 · Send, one person at a time

There is no "send all" button anywhere in this application, in the interface or
underneath it. That is a design decision, not an omission.

For each recipient:

1. Open their record and press **Preview**. It shows their real figures, not a
   sample.
2. Press **Send**, and confirm.
3. Move to the next.

A recipient whose country is not on the approved list is blocked on their own,
with the reason on screen. **Everyone else still sends.** A block never stops
the batch.

**Done when:** everyone you intend to invite has been sent to.

---

## Step D7 · Run the round

From here it is day-to-day:

- **Questions** arrive in your queue and you are emailed. Your answer is private
  to the person who asked unless you tick the box to publish it — and a
  published question shows no name, no initials and no identifying date. You can
  rewrite the wording before publishing; the original stays on the private
  record.
- **Reminders** go out automatically at 7 days and 2 days before each deadline,
  to non-responders only, capped at two per person. You can see the queue and
  cancel or reschedule anything on it.
- **Advance each investor** along the eight-step timeline as things happen.
- **Record funds received** when money arrives. It asks for the amount twice, on
  purpose. This generates their participation certificate.
- **Extend a deadline**, for everyone or for one person, whenever you need to.

**Nothing closes by itself.** A deadline passing takes nothing away from anybody
— the investor can still respond, and their record is untouched.

---

## Step D8 · Close the round

When you are ready, open **The round** and press the close button.

The application will remind you when deadlines pass. It will never close the
round for you.

---

# Decisions still needed

Short list. None of these block the setup steps, but items 1 and 2 block sending.

| # | Decision | Who |
|---|---|---|
| 1 | The list of countries cleared to send to | David → approver |
| 2 | The US recipient — advice, or hold them | David → approver |
| 3 | The acknowledgement wording, if any | David → approver |
| 4 | The fallback contact address, for when the portal has closed and David's address is no longer read | Michael |
| 5 | Privacy policy wording — not required any more, but worth having given the data held. Can be drafted here | Michael |
| 6 | Does David want to record the video | David |
| 7 | Should the shared Q&A be visible during the raise, or held until the round closes? Currently visible | Michael |
| 8 | Confirm the spelling of "David Serene" — it goes on investment correspondence | Michael |
| 9 | Eyeball the brand colours against the live flipit.com | Michael |

---

# If something goes wrong

**"It refuses to send."** Good — that is the design. The screen always says
which of the reasons it is: no compliance approval, the template changed since
approval, no mail credential, the mail connection has not been verified
recently, the service is not in active mode, or you are not on the production
deployment. It never says "something went wrong".

**"An investor cannot get in."** Their link works once. Send them to
`/portal/signin` and they can request a fresh one. If their account is suspended,
requesting a link is accepted silently and no link is issued — that is
deliberate, so nobody outside can tell one account's state from another's.

**"Is anything actually running?"** Open **System health**. It reports the
scheduled jobs, the mail connection, storage, and anything else that can go
quietly wrong. `pnpm check:health` does the same from the command line and exits
non-zero when something needs a person.

**Everything else** is in `TEST_ME.md`, written for a non-technical reader, and
`DEPLOYMENT.md`, written for whoever is on the server.
