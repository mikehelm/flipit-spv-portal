# What you can try right now

Rewritten after every work package, so it always describes the current state.

**Current state: every work package, 0 to 20, is complete.** WP15 — the image library and the personal video — was the last one outstanding and is now built, which also means **all forty-eight of the specification's acceptance criteria have an automated check behind them**. Two-factor sign-in, the last release gate, is built too. You can sign in, import a spreadsheet of recipients, see the email each one would receive with their real figures, record a compliance approval, walk the pre-flight checklist, send an invitation to one person at a time, follow the link in that invitation into the investor's own private portal, ask and answer questions — privately to one person, or published to everyone with the asker removed — keep a register of interest that can turn into a real offer, publish updates to everyone, to a subset, or to one person, queue automatic reminders for people who have not answered, walk an investor along the eight-step timeline, record that their funds arrived, and hand them a participation certificate as a PDF. Sending a real email needs a Gmail app password, which nobody has connected yet — everything up to that point works.

You can also upload brand images that are stripped of their embedded location and camera data before they are stored; David can record a short personal video in the browser or upload one from his phone, watch it in place, and publish it to the portal when he is ready; and you can put a subscription agreement or any other PDF on an investor's record, check it, and issue it to their portal.

**Since then, seven more pieces have landed**, all of them things the build had written down as unfinished rather than new ideas. Files can now be stored in a real cloud bucket instead of only on a disk, which is what a live deployment needs. A document you have already issued can be **corrected** — the new version replaces the old on the investor's portal, and the old one stays visible and marked as replaced, so a correction is never a silent swap. Uploaded videos now have their metadata stripped like everything else. David's video **plays on an iPhone**, which it did not before. Videos, images and documents are all sent as a stream rather than being held whole in memory, which is what lets several people open the same file at once without the server minding — and that is now measured rather than argued: `pnpm verify:memory` downloads a 96 MB file through the real server and watches how much memory it uses. Streaming costs about 2 MB. The same route made to hold the file in memory costs 95 MB, and 379 MB when four people download at once. And `pnpm media:check` tells you whether every stored file is actually there and the size its record says — and, the other way round, whether anything is sitting in storage that no record points at. It is the command to run after restoring a backup, and it changes nothing: it reports, and leaves every decision to you — and its verdict now turns up in the health report and on the **System health** page, so what used to be three logs to remember is one screen to glance at.

**Most recently, five more.** All five are the same kind of thing, and it is worth saying what kind, because it is the least visible sort of defect there is: a setting that was written down, checked, and then read by nobody. The health report can now be **polled from outside**, so an uptime service raises you when the machine itself has stopped — which nothing inside it could ever do. A locked-out investor now sees **an address**, where the notice used to say "please contact David" and give them no way to. The **closing date**, the **payment reference** and the **value date** now reach the screens that promised them. Four of the seven **filters** on the Recipients screen had no box to tick and are now on the screen. And the four **switches** in the database that were supposed to turn portal sections on and off were connected to nothing; they are connected now. Each has its own section below.

The last two packages are the ones that check everything else and then put it somewhere real: a table saying, for each of the forty-eight things the specification requires, which test proves it — and a runbook for the day it goes live. **ACCEPTANCE.md** and **DEPLOYMENT.md** are those two documents, and the plain-English version of each is further down, under "The forty-eight things this was meant to do" and "Putting it somewhere real".

---

## Starting it from cold

You need PostgreSQL running, and Node with pnpm.

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Before `db:migrate`, open `.env` and fill in two secrets. Run this twice and paste one value into each:

```bash
openssl rand -base64 32
```

One goes in `ENCRYPTION_KEY`, the other in `AUTH_SECRET`. `DATABASE_URL` needs to point at your database.

Then open **http://localhost:3000**.

---

## Signing in for the first time

There is no password in any file, and no way to set one from a settings screen you would have to be signed in to reach. Instead, `pnpm db:seed` prints a one-time link for each account:

```
  mike@flipit.com (owner)
  http://localhost:3000/api/auth/setup?token=…
```

Open one. It signs you in and immediately asks you to choose a password — and that is the only page you can reach until you do. Choosing one signs you straight back out, on purpose: the link you arrived on has travelled through a terminal and possibly a chat window, so the session it created is exactly the session that should not outlive the real password.

Sign back in at `/signin` with the password you chose.

> **This did not work until now, and it is worth knowing why.** Opening the setup link used to send the browser round in a circle: it arrived at the password page, the password page bounced it straight back, and the browser gave up after twenty tries with "too many redirects". It affected every account, yours included, and it stood in front of the only route by which a password ever enters this system.
>
> Nothing caught it because the two halves of the mistake were in different files and each was right on its own. It was found by starting the application and opening the link, which nothing had done. There is now a check that opens it in a real browser whenever you ask, and a test that walks the same journey for every kind of account and every state one can be in:
>
> ```bash
> pnpm build && pnpm verify:account-access
> ```
>
> Forty-two checks, about a minute. It puts your password back exactly as it was, and it sends no email.

You can also change your password whenever you like — **Admin → Password**, which is now a link in the navigation rather than somewhere you could only arrive by accident.

**Things worth trying, because they are meant to fail:**

- Open the same setup link a second time. It works once.
- Sign in with an address that is not one of the three allowlisted ones. It fails with the same sentence, after the same delay, as a wrong password. There is no "no account with that address" anywhere.
- Get the password wrong ten times. Sign-in from there pauses for fifteen minutes, and restarting the server does not clear it.
- Change your password. Every other session ends immediately.

If you need another link later:

```bash
pnpm setup-link serenedavid@gmail.com
```

---

## Giving somebody read-only access

There is a third role. It sees every investor by name, all four amounts, the documents, the conversation and the status history — and it can change none of it. It cannot send, approve, advance, answer, publish, import, export, configure or invite, and it cannot open the audit log or the register's order.

Granting it is two steps, and it used to be one step that did nothing:

```bash
# 1. in .env
VIEWER_EMAILS="somebody@example.com"

# 2. and then, because the account itself has to exist
pnpm db:seed
```

The seed prints a setup link for the new account exactly as it does for yours. Send it to them however you would send anything else.

> **The second step is new.** `.env.example` has always described this as a one-line grant. It was not: the seed created accounts for the owner and operator lists only, so an address added to the viewer list resolved to the role, passed every check, and was then refused at sign-in with the same sentence as a wrong password — because there was no account behind it. The role was finished in every other respect and nobody could use it.

**Worth trying, once somebody is on it:**

- Sign in as them. Every screen carries a line saying the access is read-only and that the sign-in is recorded.
- Type `/compliance` or `/audit` into the address bar. You get a page that says plainly that the area is not yours, and one line goes into the audit log. **That page used to spin for ever and write a log line on every bounce** — one click could have written thousands.
- Open **Two-factor** and **Password**. Both are theirs, and both were closed to them until now. An account that can see everyone's financial position ought to be able to put a second factor in front of it.
- Type `/import`. The page appears with the wizard replaced by a refusal — and the refusal no longer tells somebody who is signed in to sign in.

**Take it away** by removing the address from `VIEWER_EMAILS` and restarting. The role is re-read from the file on every single request, so access stops at once and does not wait for anybody to remember a database row.

---

## Importing a list of recipients

Sign in as the operator, go to **Import**, and upload a CSV or Excel file. `SAMPLE_IMPORT.csv` in this repository is a starting point, but the interesting test is a deliberately awkward file — rename the columns, shuffle their order, add columns nobody asked for, mix `10/08/2026` and `2026-08-10`, and put `5%` and `0.05` in the same column.

The import proposes a mapping and then stops and asks you to confirm every column before anything is written. Where a column is genuinely ambiguous — is `5` five percent, or five hundredths? — it asks you outright rather than guessing.

If an OpenAI key is configured, the model helps propose the mapping. It only ever proposes which column means what. Every figure is computed by the application from the raw cell text, and there is a test that maps the same file twice — once with the model's help, once from a dropdown — and asserts the resulting numbers are byte-for-byte identical.

Two kinds of problem are kept apart, on purpose:

- **File-level errors** stop the whole import. A column that cannot be read is one of these.
- **Per-recipient blocks** stop one person. A recipient in a country the compliance approval does not cover is one of these, and everybody else in the file imports normally.

---

## Seeing the email

Go to **Email templates**, then preview any recipient. That is the real email, with their real amount, their real percentages and their real deadline — not a mock-up with placeholder text.

The portal link in a preview is deliberately fake. A preview is a read, and reads do not issue credentials.

Try removing the default sender phone number in settings while the contact method is set to "phone". The preview fails loudly and names the variable and the recipient, rather than sending an email with a blank line where a phone number should be.

---

## Recording a compliance approval

Sign in as the **owner** — this is owner-only, and the operator cannot do it at all. Go to **Compliance** and record an approval: who signed it off, when, what evidence there is, and which countries it covers.

Then try these:

- Sign in as the operator and go to `/compliance`. You are refused, and the attempt is written to the audit log.
- Change one character of the email template. Sending is disabled until the approval is recorded again, and the screen shows you exactly what changed.
- Approve Australia only, then import somebody in the United States. They are blocked individually, with a full explanation, and everybody else still sends.

---

## The pre-flight checklist, and sending

Go to **Review and send**. You will see every recipient in the round, the four money totals, and the twelve-item checklist from the specification.

Eight of the twelve are worked out by the application and have nothing to click. There is no tick, no override and no "proceed anyway" for a mail server that is not connected or an approval that does not exist. The other four are things only a person can know — that you read the recipient file, that you looked at the test email you sent yourself — and you confirm those, with your name and the time recorded against each one.

Two of the four have a floor underneath them. Tick "all percentages and amounts validated" on a file where an amount is actually missing and it refuses: an attestation can confirm your judgement, but it cannot assert something that is not true.

Once pre-flight is complete, each recipient gets their own Send button. To send, you type that recipient's email address. A checkbox confirms that you clicked; typing the address confirms which person you meant.

**What you cannot do, by design:** send to everybody at once. There is no "select all", no bulk action, and no function anywhere in the code that takes a list of recipients.

Sending a real email needs a Gmail app password, connected from settings. Until one is connected, a send fails with a specific message naming the missing credential — never a generic failure.

---

## What the AI costs you

The settings page shows what the column-mapping AI has cost this month, beside the monthly cap. Twenty real mapping calls come to about a penny, so you are unlikely ever to see the number move much.

Going over the cap **warns and does not stop anything** — an import that refused because a twenty-dollar ceiling was reached would block you over a rounding error. The panel turns amber at 80% of the cap and red above it, and the figure is labelled an estimate, because it is calculated from published per-token prices rather than from an invoice.

Set the cap to zero and there is no cap at all.

---

## The two things that are always on screen

Compliance approval state and mail connection health sit at the top of the review screen and do not move. They are the two things that silently break a send, so they are not buried in settings.

---

## The investor's side

The link in an invitation goes to `/portal/claim/…`. Opening it is what verifies the mailbox — there is no button to press and no password to choose. The account moves from "invited" to "active", and the investor lands on their own record: their amount, their two percentages, their deadline, and the eight-step timeline showing where things stand.

**Things worth trying:**

- Open the same claim link twice. It works once.
- Make up a link and open it. It fails with exactly the same page as an expired one, a spent one, and one belonging to somebody who has been suspended. There is no wording anywhere that confirms an address exists.
- At `/portal/signin`, ask for a link with an address that has a record. **The email now actually arrives** — it did not until recently, which meant every investor whose session lapsed was told a link was on its way and got nothing. It carries the link, how long it lasts, and a line saying that if they did not ask for it they can safely ignore it. No name, no amount, no mention of the offer: a sign-in email lands in a mailbox that may be the reason the person is signing in again, and it is the message an attacker would most like to trigger for somebody else's address.
- Then ask with an address that has no record. The answer is the same sentence both times — **and takes the same time**. That second part matters more than it sounds: the form is public and nobody has to be signed in to use it, so if a known address came back faster than an unknown one, anyone could work out who is on the list by timing it.
- Suspend an investor, from **Investors** (see below). Their session dies on their very next click, their unused links stop working, and asking for a new one is accepted politely and produces nothing.
- Close an investor's account. By default they can still sign back in and read their own record — an investor who has sent money should not lose the record of it.
- Look at a timeline step that has not been reached. It says "Not yet reached. There is nothing for you to do at this stage." and shows no amount, no date and no blank where one would go.

**What an investor cannot see, by design:** that any other investor exists. No count, no total raised, no position in any queue, and no wording that hints at any of it. The code that loads their page is bound to their own account and never loads anybody else's data at all.

---

## Investors — access, suspension and closure

Sign in as the operator and open **Investors**. Every account is here: their status, how many offers they hold, whether their mailbox has been verified, when they last signed in, and the whole history of status changes with the reason recorded against each one.

**The number worth looking at is on every row:** how many live sessions and unspent links that person holds *right now*. Suspending somebody ends all of them in the same instant the status is written, and it is better to see what that means before you press the button than after.

To change somebody's status you give three things: where they are going, a reason of at least ten characters, and the word — `SUSPEND`, `CLOSE`, `ARCHIVE` — typed out. The reason goes on that investor's own record with your name and the time. The typed word is there because a click on the wrong row looks exactly like a click on the right one.

**Things worth trying:**

- **Suspend somebody who is signed in.** Their next click takes them to a notice, not their record. Their unspent links stop working. Asking for a new link is accepted with the same polite sentence as always and produces nothing at all.
- **Then check another investor.** Untouched — still signed in, links still good. Suspension is about one person.
- **Try it without a reason.** Refused, and nothing changes — not the status, not the sessions, not the links.
- **Try to archive as the operator.** Refused. Archiving is the owner's, and the attempt is logged.
- **Restore them to active.** It works — a suspension is reversible. But it does not un-revoke anything: they sign back in the ordinary way. Reversing a decision does not resurrect the credentials that decision killed.
- **Close an account.** Same revocation, but by default they can still sign back in and read their own record. That default is on the owner's settings page.

**Nothing on this screen emails anybody.** There is a checkbox recording whether you have told the investor, and it is recorded either way — but telling them is an update or an email you write deliberately. The application does not send on a status change.

If you would rather see this exercised against a real database than click through it, run `pnpm verify:lifecycle`. It sets up two investors with two sessions and two links each, checks thirty things, and cleans up after itself.

---

## Questions and answers

This is the new part. Sign in as an investor (follow a claim link), scroll to **Questions and answers**, and ask something. You get one plain sentence back: *"Thank you — your question has been sent to David. He'll reply by email, and the answer will appear here too."* No promised timeframe, because the app cannot keep one.

Then sign in as the operator and go to **Questions**. The question is there, with who asked, their amount, their percentages, their deadline, their stage and their account status — so you answer with context rather than blind.

**Three separate presses, on purpose.** Save the answer. Publish it. Send the reply email. Nothing about ticking one causes another:

- **Saving** stores the answer. Nobody is emailed. It is not on the shared page.
- **Publishing** puts an anonymised version on the shared page that every investor sees. The checkbox is unticked every time you open the form.
- **Sending the reply** is a button underneath the rendered email. You see the exact message first. It does not exist until you press it.

**The anonymity is worth testing properly.** Ask a question, as an investor, that gives you away:

> As we discussed on Tuesday, I'd want to put in more than the 5% you offered me.

Now go to answer it and tick the publish box. Two things happen. First, the form shows the original and a blank box side by side — you have to rewrite it, because the app will not publish an investor's own words on the strength of you having meant to check them. Second, as you type the rewrite, anything that could identify the person is listed underneath: the percentage, the day of the week, the reference to a private conversation. Where it finds something, publishing needs a tick confirming you have read the wording as a stranger would.

Publish it, then look at the shared section as a *different* investor. You will find the rewritten question and the answer, and: no name, no initials, no email, no exact date — the date is a month and a year — and nothing of the original wording. The original is still on the private record and in the audit log, unchanged.

**Other things worth trying:**

- Take an entry down again. It leaves the shared page, and the app tells you plainly that unpublishing does not un-see it. The removal is logged.
- Pin an entry. It sorts to the top for everybody, labelled "Start here".
- Write a question-and-answer pair yourself, under **Write an entry yourself**. There is no asker behind it, so there is nobody to anonymise — that is how the section looks useful on day one rather than empty.
- Try to send a reply on an entry you wrote yourself. It refuses, and says why: there is nobody to reply to.
- Ask a follow-up on a thread you have already had an answer to. It joins the same thread and puts it back at the top of the queue.
- Turn off **"Shared Q&A visible during the raise"** in owner settings. The shared section disappears for investors and private answers carry on exactly as before. Anything you publish while it is off is stored and appears the moment the round closes — nothing is lost and nothing needs republishing.
- Suspend an investor and look at their portal. The question box, the shared section and their own thread all go together.

**With no mail connection configured**, the notification email to David cannot go out. The question is still recorded, and the queue shows in red that the notification failed and why, with a button to try again. What the investor sees does not change — whether the mail server is connected is not their business.

---

## An investor's record, and their certificate

From **Review and send**, open **Their record** beside anybody. You get all four amounts shown as four amounts — proposed, committed, accepted, received — the eight-step timeline, and the controls that move it along.

**Things worth trying:**

- Try to skip a step. Refused, with the name of the step that actually comes next. The timeline is what the investor reads to know where they stand, and it should never claim something happened that nobody recorded.
- Try to reach "funds received" with the ordinary advance button. Refused, and told to use the proper form.
- Move a step backwards. It asks for a reason and will not take a short one. The original step is kept — corrections are recorded as corrections, never as silent overwrites, and the history at the bottom of the page shows both.

**Recording funds received** is deliberately the most awkward thing in the application, because it is a financial assertion the investor will rely on. You type the amount, type it again, and tick a confirmation. Get any of those wrong and nothing at all is written — not a partial record, not a stage change, nothing.

Type `$5,000` in one box and `5000.00` in the other and it accepts them: they are the same amount, compared as decimals rather than as text. Type `5000` and `500` and it refuses. Give a value date in the future, or leave the payment reference blank, and it refuses.

**The certificate appears the moment funds are recorded.** Sign in as that investor and it is on their portal with a Download PDF button. It carries their name, the SPV, the amount, the value date, both percentages, the payment reference and the date of issue, signed off by David in his role — and a footer saying plainly that it is not a share certificate and not a title document.

Now go back and correct the amount. A second certificate is issued and **the first one is kept**, marked superseded on both the operator's page and the investor's. Download the old one: it still states the *original* figures, not the corrected ones. That is the point of retaining it.

The PDF is written by the application itself rather than by a headless browser, so there is nothing to install and nothing that can fail on a deploy. It opens in any reader.

---

## Reminders

This is the only thing in the application that sends without somebody pressing send at that moment, so it is worth poking at properly. Open **Reminders**.

The schedule defaults to seven days and two days before each recipient's own deadline, with a hard cap of two per person. Below it is the queue: every planned reminder with its date, who it is for, and — when it will not go — the reason, worked out at the moment you are looking rather than when the row was written.

**Things worth trying, because the answer should be "nothing happens":**

- Record a response for somebody. Their reminders vanish from the queue. Anyone who has answered is never chased, and it is checked again in the second before sending, so an investor who answers on Monday morning is not chased on Monday afternoon by a row written last week.
- Set the schedule to `21, 14, 7, 2` and leave the cap at 2. You get two reminders, not four — and they are the two furthest from the deadline, so the last chance to respond survives.
- Set the cap to 0. Nothing is planned at all.
- Cancel a queued reminder, then press **Rebuild the queue**. It stays cancelled. Cancelling is an instruction from you and the application does not argue with it.
- Try to move a reminder into the past, or to a date after the recipient's deadline. Both refused, with a sentence explaining why.
- Set the service mode to read-only in settings. Every queued reminder shows "Will not send" with the reason, and a run sends nothing — but nothing is deleted either, so if you switch back to active before the deadline they are still there.
- Untick "Send reminders for this round". Same: everything holds, nothing is lost.
- Look at somebody who was never sent an invitation, or who is blocked, or who is suspended. None of them is ever queued.

**What a reminder says:** the deadline and the portal link. No amount, no percentage, no offer terms at all. Those live in the portal, which is where the investor should be looking.

**Its own compliance approval.** The reminder is a separate template with its own hash and its own approval, and it does not send under the invitation's. If you have approved the invitation but not the reminder, the page says so and every send is refused with that reason.

**There is no send button on this page.** Reminders go out from a scheduled job:

```bash
pnpm reminders:run
```

Run it and it prints what it considered, sent, skipped, blocked and failed — counts and reasons, never an address or a message. With no Gmail app password and no reminder approval recorded, everything is refused, which is the correct behaviour and worth seeing once.

### Two runs at once

Once that job is on a timer, sooner or later two of them overlap. It only takes a run that lasts longer than the gap between runs — fifty recipients, each retried a couple of times by a slow mail server, is enough. Both runs then look at the same queue, both reach the same conclusion about the same person, and without something stopping them both send. The investor gets the same email twice, from a securities offer, and it cannot be taken back.

Try it. Open two terminals and start it in both at the same moment:

```bash
pnpm reminders:run
```

One of them does the work. The other prints a sentence saying another run is already in progress and that it sent nothing, and stops. That is the intended behaviour, not a failure — it exits normally, so do not wire an alarm to it.

There are two separate things stopping the duplicate, on purpose, because a single defence that is usually enough is not the standard for the one thing here that sends with nobody watching. The first is a lock on the database that only one run can hold. The second is that each reminder is *taken* by the run that is about to send it, in a single step that cannot half-happen, so even two runs that somehow both got past the lock cannot both take the same one.

A reminder that has been taken shows on the queue as **Being sent**, and while it is in that state nothing else will touch it — you cannot cancel it, and rebuilding the queue leaves it alone.

**If a run is killed part way through**, a reminder can be left sitting in that state for good. That is deliberate: the alternative is a timer that eventually decides the run must be dead and lets somebody else send it, which is precisely how the same message goes out twice. So it waits for you. Ask whether a run is actually going:

```bash
pnpm reminders:lock
```

`BUSY` means one is, and it will sort itself out. `FREE` means no run is behind that row. In that case **reschedule** the reminder from the page — that releases it, puts it back in the queue with your name on the record, and is the only thing that does. Whether the email went out before the run died is a question for the Sent folder in Gmail, which is exactly why this asks you rather than guessing.

To see all of it proved at once, against a real database and with a genuinely separate second process trying to muscle in:

```bash
pnpm verify:reminders
```

Forty-two checks, and the last dozen are this.

---

## Is anything actually running?

Every page in this application shows you what is wrong when you open it. The reminders page says why a row will not send; the dashboard carries the mail connection and the compliance state; the round page says who has not answered. All of that needs somebody to open it.

The failure worth worrying about is the one where nobody does. A scheduled job that was never installed, or that stopped in March, looks from inside the application exactly like a quiet week — the queue sits there full of dates in the past and nothing anywhere says that the thing meant to act on them is not running. An expired mail password looks like nobody has sent anything lately.

So there is one command that asks all of those questions at once:

```bash
pnpm check:health
```

Run it now. On a fresh setup it tells you the mail connection is not configured, neither template is approved, and this deployment is not the one allowed to send real invitations — and it says that none of those is a fault, because each is somebody's decision or a correct refusal. It finishes normally.

It goes red for a short list of things that genuinely need you: no reminder run has ever completed, the last one was hours ago, a reminder has been stuck mid-send, or a credential has expired with reminders due. Each one comes with the sentence saying what to do about it.

**It changes nothing.** It is a question asked of the system, and it never acts on the answer — deciding a stuck reminder is safe to release, or that a password should be replaced, needs somebody who knows what has been happening.

**It names no email address**, not even the account mail goes out from, because it is designed to be run by a timer and appended to a log file, and a log file on a server is the least protected place there is.

**And it will come and find you.** On the overview — the first screen after you sign in — there is a card linking to System health, and above it, *only when something actually needs you*, a line saying so — and it tells you roughly what the trouble is about, worked out from what is actually wrong rather than from a sentence somebody typed once. On a healthy system that line is not there at all. That is deliberate: a banner that says "everything is fine" every morning is a banner nobody reads on the morning it says otherwise. The card is always there, so a missing banner never leaves you wondering whether anything looked.

**And it is a page, too.** Open **System health** in the menu. It is the same report, worked out fresh every time you load it, sorted so anything that needs you is at the top — and it is the version that matters, because you are far more likely to open this application than a terminal. Nothing on it is a button. Every line tells you which page fixes the thing and leaves the decision with you.

Worth noticing on a fresh setup: it lists what it checked *and found fine* rather than showing you an empty page. A page that goes blank when all is well looks exactly like a page that failed to look.

**Backups get a line too.** Run `pnpm backup` and reload the page — it now says when the last one was. It can only speak for that command, so if your backups come from somewhere else (a snapshot of the whole server, say), it will keep saying it has no record, and it says so in those words rather than pretending that is a problem.

**And so do your stored files.** There was a second command, `pnpm media:check`, that goes through every image, video and document and checks the file is really there and really the right size — and then the same question backwards, listing what is stored and reporting anything nothing points at. It printed to its own log, which meant you had three things to watch instead of one.

It now writes down what it found, and the health report reads it. So on a fresh setup the health page says **no media check has been run against this store** — which is not the same thing as saying everything is fine, and that distinction is the whole point. Run:

```bash
pnpm media:check
```

then reload the page. It now says when the check ran and that it came back clean. If it ever finds a file missing, that turns up here as something that needs you, in the daily report and on the page, without your having to remember to read a third log.

Two things it deliberately does *not* do. It does not go and check the files itself when you load the page — checking means asking the storage for every file one at a time, which is fine once a week from a command and wrong on a page you are waiting for. And it never names a file, an image or a document title in the report; it carries counts only, because this report is written to a log.

To see it proved against a database deliberately put into each bad state — no run ever recorded, a scheduler that stopped, a reminder abandoned half sent, a media check that found missing files, and a store nothing has ever looked at:

```bash
pnpm verify:health
```

Thirty-one checks, and it puts everything back afterwards.

### The one that works when the machine has stopped

There is a gap in everything above, and it is worth being plain about it. That command runs on the same machine as the application. If that machine is down, if the container never came back after a deploy, if the timer was never installed in the first place — the command produces nothing. And nothing is exactly what a perfectly quiet, perfectly healthy morning also produces. Nobody can tell those two apart from inside.

So the same report is now also answerable over the web, at an address something outside can ask:

```
GET  https://your-deployment/api/health
     x-health-token: <the secret you set>
```

Put a long random value in `HEALTH_TOKEN` (`openssl rand -base64 32` gives you one), then sign up for any uptime monitoring service — there are free ones — and point it at that address with that header. From then on:

- **Everything fine** — it answers normally and the monitor shows green.
- **Something needs you** — it answers with a failure code, and the monitor texts or emails *you*. Not the application: the monitoring service. That distinction matters, and it is the next paragraph.
- **The whole thing is down** — the monitor gets no answer at all and raises you the same way. This is the case nothing else in the system can see.

**The application still sends nothing.** Reminders to investors remain the only thing here that ever sends an email without somebody pressing a button, and that stays true. The alert comes from the monitoring service, on its own machine, which is the entire reason it survives this one stopping.

**What it says is deliberately thin.** A status word, when it looked, four counts, and the *areas* that are not fine — "Reminders", "Mail", "Compliance". No names, no addresses, no amounts, no sentences. That reply ends up in a monitoring company's alert history and on your phone's lock screen, which is a much looser place than a page you have to sign in to see. To find out what is actually wrong, open **System health** in the application, which is where the detail has always been.

**Without the secret, the address does not exist.** Wrong secret, no secret, or a deployment where you never set one — all three get the same empty "not found" that any made-up address gets. Nobody scanning the internet learns that this endpoint is here, let alone anything about the round.

**One thing to get right.** While the application is served under `mikehelm.com/SPV`, the address to monitor is `mikehelm.com/SPV/api/health` — with the `/SPV`. Pointed at the address without it, a monitor sits happily on a "not found" forever and shows you a green tick over a dead application. `pnpm verify:deployment` now checks both, against a real running server, for exactly that reason.

**It also goes red when it deliberately cannot answer.** If the database is unreachable the reply says so in those words — "unavailable" rather than "wrong" — because "wrong" is a judgement made after looking at something, and claiming it when nothing could be looked at is the one kind of lie this whole report exists to prevent.

---

## If somebody cannot get in

Suspend an investor's account, or switch the service to sunset or disabled, and they see a short notice instead of their record. Those notices used to end "please contact David" — with no address anywhere on the page. Somebody locked out of the one page that ever named him was being told to write to a person they had no way to reach.

They now carry the address itself, and which address depends on what has happened:

- **The account is suspended or concluded, and the portal is still running.** They get the sending address — David's — with the service contact address underneath it, introduced as the one to try if nobody comes back. That second line is the answer to the question the build notes had been carrying for weeks: *what if David is unavailable?*
- **The portal itself is closing or closed.** They get the service contact address **only**. This is the whole reason that second setting exists: once the portal closes, David's address stops being read, and offering an address nobody reads is worse than offering none.
- **Read-only** carries no contact line at all. The record is right there on the screen; there is nothing to rescue.

Both addresses are in **Settings**. The sending address is the one invitations go out from; the service contact address is the field below it.

**It never invents one.** If neither is set, the notice says nothing rather than pointing at a route that is not one — and the health report tells you, in those words. Try it: clear both, run `pnpm check:health`, and there is a new line under **Contact route**. In sunset or disabled it goes red, because then the notice is the only thing an investor has.

To see it all proved against a real database — suspended, closing, and with both addresses cleared — run:

```bash
pnpm verify:lifecycle
```

Fifty checks, and it puts your settings back exactly as they were.

---

## Three things you can now see that were being recorded and thrown away

**The closing date.** Put the service into sunset and the portal used to say "this portal will close soon" — while the settings screen had refused to let you enter sunset at all without a closing date, on the grounds that investors are told when it closes. They were not. It now says *"This portal will close on 30 September 2026. Please download any documents or correspondence you wish to keep before that date."* With no date set it goes back to the older sentence rather than showing a gap.

**The value date and the payment reference.** Record funds received and step 7 of an investor's timeline used to say *"We confirm receipt of USD 5,000."* — dropping the value date and the reference you had just typed, and which you are required to type: the form refuses a blank reference because it goes on the certificate. Those two are the things an investor checks against their own bank statement, which is the whole use of that line. It now reads *"We confirm receipt of USD 4,950.00 on 2026-07-26. Reference: FLIPIT-0007-B."*

Related, and worth knowing: the currency on that line used to be the word "USD" written into the code rather than the currency you entered. It is now yours.

**When payment instructions went out.** Step 6 said "Payment instructions were sent to you." It now says when. If you correct and re-issue, it shows the later date — the one they should be working from.

*How* instructions were delivered — by email, by phone, in person — is still not captured anywhere. That needs a field on your side and is not built.

---

## A way to reach David from inside the portal

At onboarding, David chooses how investors should reach him — phone, WhatsApp,
or email only. That choice was being stored and never shown. The only contact
details anywhere in the application appeared on the notice pages for suspended
and closed accounts, which is to say they appeared exactly when the portal had
stopped being useful. An investor with a live invitation in front of them had
nowhere to go.

Sign in as an investor and scroll to the bottom, under the paragraph explaining
what the portal is and is not. There is now a short section headed **If you have
a question**, carrying whichever route David chose:

- **WhatsApp** — a tappable `wa.me` link, opening WhatsApp with his number.
- **Phone** — a tappable number.
- **Email only** — the address the invitation came from.

Things worth knowing:

- **It points at the questions section first**, and offers the direct route as
  the alternative. A question asked in the portal reaches David *and* stays on
  the investor's record, which is usually where it should be.
- **A number that could not actually be dialled falls back to the email
  address.** A phone link that does nothing is worse than an address, because it
  looks like it worked.
- **With nothing configured, the section is absent** rather than showing a route
  that is not one.
- **There is a warning underneath**: we will never ask for payment details, or
  send a change of bank details, by message or by phone. A private message
  channel is exactly where that request would arrive, and this is the only place
  in the portal that opens one.
- **No name.** The route makes it unnecessary, and a hard-coded first name goes
  wrong quietly on the day somebody else is answering.

---

## The checkboxes an investor ticks

The specification asks for acknowledgement checkboxes on the portal, and asks
for them to be **configurable — so that wording your compliance approver signs
off can be applied without a developer touching the code.** There was no such
thing: the response form had three radio buttons and a comment box.

Sign in as the owner and open **Acknowledgements**. It starts empty, on purpose
— seeding it with plausible-sounding wording would put unapproved words on a
securities offer page looking exactly like approved ones. Add your approver's
wording, one box at a time, and mark each as required or optional.

Now sign in as an investor. Under the response form there is a new section,
**Before you record an interest**, with your boxes in it. Try to record an
interest without ticking a required one: the response is refused and nothing is
saved.

Things worth trying:

- **Say "I am not interested" without ticking anything.** It works. So does
  asking a question. The boxes are required only for recording an *interest* —
  making somebody tick boxes before they may decline turns them into a toll on
  saying no, and an investor who will not tick them would just say nothing
  instead. Silence and a decline are not the same thing.
- **Try to add wording that says "I agree to subscribe".** It is refused, and it
  names the word. Same for *binding*, *irrevocable*, *undertake*, *contract*,
  *guarantee*. A checkbox that reads as an undertaking is a subscription
  agreement in disguise, and the specification is explicit that a tick is never
  that — so wording that would make it one is refused at the settings screen,
  which is the only place it could get in.
- **Read the grey line beneath the boxes.** It says ticking is not a
  subscription, not a commitment, and not a binding agreement. You cannot edit
  it, switch it off, or remove it by archiving every box. The owner screen shows
  it too, marked as fixed.
- **Tick a box, then go back to the owner screen and change that box's
  wording.** The investor's record still carries the words *as they were shown
  when they ticked* — and says which revision. Editing approved wording never
  rewrites what somebody already agreed to. This is the single most important
  thing in this feature and there is a database test that proves it.
- **Archive a box.** It disappears from the portal. Everything ticked under it
  stays on the record. There is no delete.

**Only the owner can touch any of this** — not the operator. The wording is part
of what a compliance approver cleared, and the same rule that stops the operator
recording an approval stops them editing the words behind it.

**What is not there yet:** there is no screen showing you what an investor
ticked. It is all recorded, with the wording and the timestamp, and nothing
displays it. That is the next thing to build here.

---

## Changing the address on a record

An investor's only way back into the portal is a link emailed to the address on
their record. Until now there was no way to move that address — so a mailbox
that stopped working was a record that could not be reached, and the export
column meant to report a changed address was always empty.

Sign in as an investor and scroll to **Your contact address**. It shows the
address everything is sent to. Enter a different one and press **Send a
confirmation link**.

**Nothing happens yet, and that is the feature.** The record still shows the old
address, with a line underneath saying what you asked for and that it is waiting
on the link. The change happens when that link is opened in the new mailbox —
which is the only proof there is that the new address actually reaches you.

Things worth trying, because they are meant to behave oddly:

- **Type an address that belongs to another investor.** You get the same message
  as a successful request, word for word. No link is sent, nothing is written,
  and the other person hears nothing. If it said "that address is taken", anyone
  with an account could type addresses one at a time and work out who else was
  invited into the round.
- **Ask twice.** The first link stops working. There is never more than one live
  way to move an address.
- **Open the same link twice.** It works once.
- **Open a link an hour later.** It has expired.
- **Confirm, then look at where you were signed in.** You are signed out
  everywhere, and any older sign-in link in the old mailbox has stopped working.
  This is deliberate — the usual reason to move an address in a hurry is that
  the old mailbox is not yours any more, and the links sitting in it are exactly
  what somebody holding it would use. The form says so before you start.
- **Check the old mailbox after confirming.** It gets a message saying the
  address was changed and to say so straight away if that was not them. It does
  not say what the new address is, and it has no "undo" button — undoing it is a
  conversation with a person, on purpose. A button in an email is a key, and
  this is exactly the email that gets sent when a mailbox may be in the wrong
  hands.

Then open **Export** and look at the **updated contact email** column. It was
hard-coded empty in every export ever produced. It now carries the new address
for anybody who has confirmed a change, and stays empty for everybody else. The
**email** column still shows the address they were originally invited at — those
are two different facts and the spreadsheet asks for both.

**What is not there yet:** you cannot see or reverse a change from any screen.
The audit log records that one happened, deliberately without recording the
addresses, and putting it right today means somebody with database access.

---

## The four filters you could not reach

The **Recipients** screen has always been able to filter by account status, by where somebody is on the timeline, by how they answered, and by deadline. It has been able to since the day it was built. There was simply no box on the screen for any of them — they worked only if you typed the right thing into the address bar, which nobody does.

All four are now on the screen, next to the three that were already there. Filter to everyone who has not answered yet, or everyone whose deadline is inside the next week, or everyone sitting at "documents issued". There is a **Clear** link once any filter is on, so a filtered list can always be got out of.

Two small things worth noticing: the email-status box used to offer you the word "DRAFT", which is a database word — it now says "Not sent". And a blocked recipient is still never hidden from the list by a filter; a block stops a send, it does not erase the person.

---

## The switches that were not connected to anything

There has always been a table in the database with four switches in it — the register of interest, David's video, the questions section, and the tiles at the bottom of the portal. They were there so a section could be turned off without rebuilding and redeploying the whole application. None of them was connected to anything. Turning one off did nothing at all, which is worse than not having the switch, because you would believe it had worked.

They are connected now, and they behave in two different ways on purpose:

- **The video and the tiles** are ours — the same for everybody, with nothing of any investor's in them. Switch one off and the section is simply gone.
- **The register and the questions** hold things investors have written. Switch one off and the section *stays on their screen* with everything they have already said and everything you have answered — it just stops accepting anything new. Turning a section off must never take away somebody's own record.

Nothing an investor is entitled to — their offer, their timeline, their documents, their certificate — can be switched off by any of these. That is deliberate and there is a test holding it shut.

A switch that is off shows up on the **System health** page, as something worth knowing rather than something wrong. That matters because these are changed directly in the database, and six months later nobody remembers why the register will not accept a join.

---

## Updates

Sign in as the operator and open **Updates**. Write one, choose who it goes to, and save it as a draft. Nothing has reached anybody: no portal shows it, no email exists, and the recipient list is empty because the audience is only worked out at the moment you publish.

Publish it and it appears on each recipient's portal, newest first, with the date.

**Then try to change it.** You cannot. A published update is immutable — the refusal says so and tells you what to do instead, which is publish a correction as a new update. You cannot delete it either; the only thing you can do is withdraw it, and that asks for a reason, removes it from every portal, and keeps the row, the reason and the record of who received it. The investor simply stops seeing it — there is no "this was withdrawn" notice on their page, because that would be a second announcement about the thing you just took down.

**The targeting is the part worth testing.** Publish one update to a single named investor and one to "invited accounts only". Then sign in as two different investors and compare. Each sees exactly what was addressed to them and nothing else — not the other update, not its text, not a hint that it exists. That is not a filter on the page; each investor's feed is built from their own delivery rows, so there is nothing to filter.

Suspended and archived accounts can never be addressed, even if you tick their status in the filter. Neither can reach the portal, so a notice addressed to them would be a record of a message nobody could read. If a filter matches nobody at all, publishing is refused rather than succeeding quietly.

**The notification email.** The Updates page shows it in full, because it is the same for everybody: one sentence saying an update is waiting, a link to the portal, and a line explaining that the update itself is deliberately not in the email. No title, no name, no amounts, no percentages. It cannot carry any of them — the function that builds it takes two links and nothing else.

**Publishing does not send it.** Once published, each recipient gets their own Send button. There is no button anywhere that emails everybody at once, here or anywhere else in the application. Without a Gmail app password connected, each attempt fails with a specific message naming the missing credential, and the recipient is not marked as notified.

---

## Register of interest

On the investor's side it sits under the questions. The four paragraphs are the ones from the specification, word for word — a test reads them out of `BUILD_SPEC.md` and compares, so the screen cannot quietly drift into promising something. The most important sentence is the one that says joining does not create a position: *"Joining the register does not itself create a position; completing your current participation does."*

Add your name, optionally with a rough figure. You will see a confirmation, the figure repeated back labelled as indicative, and a button to remove yourself. Remove it and add it again — both work, both immediately.

**What an investor never sees, by design:** where they are in the order, how many people are on the register, or that anyone else is on it at all. The code that builds their view has three fields — whether they are on it, their own indicative figure, and whether it can currently be changed — and there is nowhere for a position to go.

Now sign in as the operator and open **Register**. This is the only screen in the whole application that shows an order, and it is computed the way §5.2.2 says:

1. People whose **funds have arrived**, earliest value date first.
2. Then people who have **agreed a commitment** but not settled, by commitment date.
3. Then everybody else, by the date they put their name down.

Someone who joined in January and has done nothing since sits below someone who joined last week and has already paid. That is the point.

**Things worth trying:**

- Move somebody up. It asks for a reason and will not accept a short one. The reason then sits beside their name, along with where the computation alone would have put them.
- Remove the override. They drop straight back into computed order.
- **Add somebody who has never been in the system** — a name and an address is enough. An account is created for them in the "invited" state, which cannot be signed into; they get in the ordinary way, by claiming an invitation, if one is ever issued.
- **Issue an offer to somebody on the register.** This is the test that matters. Record a compliance approval covering Great Britain only, then issue one offer to a GB address and one to a US address. The GB one becomes an ordinary draft and appears in Review and send with everybody else. The US one is *also created* — and blocked individually, with the reason naming the country — while the GB one stays perfectly sendable. Nothing about the register shortcuts any gate; a freed allocation is a new offer, not a continuation of an old one.
- Type a country code that does not exist. Nothing is created at all.
- Give a deadline in the past. Refused.
- Remove somebody's name and then try to issue to them. Refused, because they are not on the register any more.

Issuing an offer does not send anything and does not take anybody off the register. The offer sits in Review and send as a draft and goes out one recipient at a time behind the pre-flight checklist, like every other offer.

---

## On a phone, and with a keyboard

**This is the part to test on an actual phone**, because it is how most people will see it. Everything below has been checked automatically at 375 pixels — the width of the smaller iPhones — but a machine cannot tell you whether it *feels* right.

Open your own portal link on your phone and look for:

- **Nothing needing to be scrolled sideways.** No figure should ever sit off the edge of the screen. If you find one, that is a bug and worth reporting exactly where.
- **Every button and link big enough to hit with a thumb** without aiming.
- **Text you can read without squinting**, including the small grey labels above the four figures. Those labels were too faint until this package and have been brightened.
- **Pinch-to-zoom working.** It is deliberately not disabled.

With a keyboard, on a computer:

- Press **Tab** the moment a page loads. The first thing to appear is a *Skip to content* link that jumps past the navigation. Press Enter on it.
- Keep pressing Tab. Every button, link and box you land on should have a visible orange outline around it. If something takes focus invisibly, that is a bug.
- You should be able to fill in and submit any form without touching the mouse.

If you use "reduce motion" in your system settings, the application respects it. There is very little movement to begin with — that is on purpose, and the page-curl mark beside the FLIPIT wording does not move at all.

**The credit in the footer.** A quiet "Made by Make with Mike" sits at the bottom of the admin side and the investor portal. In **Settings** you can switch it off for either one independently, and optionally make it a link. It never appears in an invitation email or on a participation certificate, and there is no setting that would put it on either — those are formal documents about somebody's money.

**Coming to your portal.** The tiles near the bottom of an investor's portal now carry the line the specification asks for: *Features shown are in development, are indicative only, and form no part of the investment being offered.* It cannot be switched off.

If you want the machine's version of all this:

```bash
pnpm build
pnpm verify:viewport
```

That starts the application, opens a real browser at phone size, signs itself in as both an administrator and an investor, and walks twenty-one screens measuring every one — a hundred and four checks. It needs a database and takes about a minute.

## The forty-eight things this was meant to do

The specification ends with a list of forty-eight things that have to be true before this is finished. **`ACCEPTANCE.md` in this repository is that list, with the test that proves each one beside it.**

It is worth opening even if you never run a test, because it is the honest account of where the build actually is:

- **All 48 have an automated check.** Some are ordinary tests; some need a real database, because a rule like "and in nobody else's portal" means nothing until there are two investors; one needs a real browser at phone size.
- **The last two to get one** were the image library and the personal video, which were waiting on a decision about where to store a file. That decision is made and they are built.
- **One carries a written note** explaining what is and is not covered: the application can prove it offered you a test email and sent you one, and cannot prove you opened it and looked.

The document is generated from the tests rather than written alongside them, so it cannot quietly go out of date. A test reads the specification itself and fails if the wording here drifts from the wording there.

Six of the forty-eight were checked only indirectly — the neighbouring behaviour was tested, but the statement itself was not — and each now has a test of its own. That the preview is byte-for-byte the email that gets sent. That an investor's link carries a token and nothing about them, in any encoding. That the three statements ending "and it is written to the audit log" are true of the log and not just of the screen.

**Two faults found while filling those gaps**, both in the audit log, both now fixed:

- The reminder queue recorded who changed it only when a person did. The scheduled run — the one that creates and deletes queued reminders overnight, with nobody watching — recorded nothing at all. Unattended changes are precisely the ones most in need of a trail; they are now recorded against "system".
- The guard that keeps secrets out of the audit log read only the top level of an entry, and missed the name the settings screen actually uses for the OpenAI key. It now reads every level. It still reads *names* and never *values* — a sign-in legitimately records that the method was a password, and a check that cries wolf is a check somebody eventually switches off.

## Putting it somewhere real

**`DEPLOYMENT.md` in this repository is the runbook.** It is written to be followed by one person, in order, on the day: what to set, what to check, what to re-enter, and what each refusal means when you meet one.

The short version. It runs in two places, in this order:

1. **Testing, at `mikehelm.com/SPV`** — under a folder rather than at its own address.
2. **Production, at `spv.flipit.com`** — before a single real invitation goes out.

The order is not a preference. **Every portal link contains the address it was issued from**, so a link created at the testing address stops working the moment the application moves, leaving somebody holding a dead link to an investment offer. The application refuses to send a real invitation until it is at the production address, and says so plainly. Test messages to your own address keep working in both places.

Three things you can check yourself:

```bash
pnpm verify:deployment   # runs it under the folder and checks every link
pnpm verify:restore      # backs up, restores into a spare database, compares
pnpm backup              # writes a backup file
```

**The restore is the one worth caring about.** A backup nobody has restored is just a file. That command does the whole round trip and then reads the figures back out — a figure that came back as 4750.5 instead of 4750.50 would be caught, and a row count would never notice.

**A privacy policy now lives at `/privacy`.** It is public, needs no sign-in, and has to exist before Google will approve the account that sends the invitations. It describes what is held and what is not, and if you are trying to work out whether a message is genuine it points you at the verification page rather than trying to answer.

**One thing found while doing this, worth knowing:** the verification page — the one an investor is meant to be able to find — was being hidden from search engines by a mistake in the configuration, and had been for several packages. It is fixed, and there is now a check that asks a running copy of the application rather than reading the configuration file, because reading the file is what missed it.

## Documents

Every investor's row on **Investors** now has a *Documents* section — the subscription agreement, the SPV instrument, whatever else goes on their record.

**The order is enforced and it is the point.** Upload a PDF and it arrives **not issued**. You can open it; the investor cannot see it and cannot reach it. Open it, check it is the right file for the right person, tick the confirmation, and issue it. Only then does it appear on their portal.

**Things worth trying:**

- **Upload a Word document, or a JPEG renamed to `.pdf`.** Refused. The format is read from the file's own opening bytes, and a `.docx` is a zip archive that can carry macros and renders differently on every machine — an investor reading terms should see the page you sent.
- **Sign in as one investor and try the other's document address.** The same "not found" you get for a document that has never existed. Not a "you are not allowed" — that would tell you the document is real.
- **Try to delete a document you have already issued.** Refused, with the reason: they may already hold a copy. Withdraw it first — which is recorded — and then it can be removed.
- **Withdraw an issued document.** It leaves their portal and the row stays, so the log still says it was issued and that you took it back.
- **Put the portal into read-only or sunset** and check an investor can still download. That is deliberate: §7 says an investor must be able to take their records with them when a round is over. **Suspend** them and it goes, along with everything else.

Unlike an uploaded image, a document is stored **exactly as you uploaded it** — no metadata is removed. It is a legal instrument somebody will rely on, altering its bytes would alter the document, and you wrote it, so there is nothing in it you did not put there.

**Issuing a document emails nobody.** Telling an investor is an update or a message, written on purpose. And advancing their timeline to *Documents issued* is a separate step, so you can issue several before you tell them.

### Correcting a document you have already issued

This is new. Until now the only way to fix a document was to withdraw it and upload another, and nothing connected the two except a line in the log — which is a record for you, and nothing at all for the investor holding the old copy.

On any issued document there is now a **Correct this document** panel. Upload the fixed PDF and it becomes **version 2**, waiting, not issued — exactly like any other upload. Nothing has changed on the investor's portal yet: they still have version 1, and they will keep it until you issue the correction.

**Things worth trying:**

- **Upload a correction and then look at the investor's portal.** Unchanged. They still have version 1, and version 2 is nowhere on it.
- **Issue the correction.** Now their portal shows the new version, and underneath it a plain sentence saying it replaced something they were sent — with the earlier version still openable. That is deliberate: they may already have version 1 saved on their desktop, and hiding it would not unsend it. They should be able to see what they were given and that it changed.
- **Try to upload a second correction while one is waiting.** Refused, with the reason: issue the one you have or remove it first.
- **Try to correct an earlier version.** Refused — correct the current one, which is the one they hold.
- **Try to correct a document you have not issued yet.** Refused, and it points you at *Remove it* instead. Nobody has seen it, so there is nothing to correct.
- **Withdraw a correction after issuing it.** They go back to holding version 1, and version 1 stops being marked as replaced. Withdrawal undoes exactly what issuing did.

**What it does not do:** it does not tell the investor. Issuing a correction emails nobody, the same as issuing anything else — so if a figure was wrong, send them a message or an update as well. And it does not say *what* changed between the versions. The description field is the only place that can, and only if you type it.

---

## The media library

**Admin → Media**, open to both you and David. Logos, an email header, a headshot, product screenshots.

Before you choose a file, the screen tells you what is about to happen to it — which is the point, because what happens is not obvious:

**Try uploading a photograph taken on a phone.** It is stored with its embedded metadata removed: the coordinates it was taken at, the camera, the date, the owner's name if the camera wrote one. That happens *before* anything is written to disk, so the original never exists on this machine at all. The screen tells you how many bytes it removed.

**Try renaming a `.svg` to `.png` and uploading it.** Refused, by name, with the reason: an SVG is a document that can contain script, and this application serves images from the same address that holds the investor's session. There is no version of that trade that is worth a logo.

**Try a GIF.** Also refused, for a quieter reason — this build cannot reliably strip the comment blocks a GIF can carry, and an image whose metadata cannot be removed does not go on the portal.

**Try a `.jpg` that is actually a PDF.** Refused. The format is read from the file's own opening bytes, never from its name.

Every image and every video is stripped before it is stored — that now includes an uploaded WebM, which used to be the one exception. Upload a video recorded on a phone or exported from editing software and the software's name, the file's title, the date, the track name and any tags it carried are all gone from the stored file, while the file itself is byte-for-byte the same length, so it still plays and still seeks. A PDF is the only thing stored exactly as you gave it, and that is deliberate.

Every image is served from this application's own address, at a long random URL — nothing is ever loaded from somewhere else, and finding one address tells you nothing about any other.

**Using one in the invitation email.** The **Email templates** screen lists every library image with the exact address to paste into the template. It is a copy-and-paste rather than a button on purpose: putting an image in the template changes the template, which changes the hash the compliance approval covers, so **sending is blocked until a fresh approval is recorded**. That is the right behaviour — an approval has to cover the document that actually goes out, images included — and the screen warns you before you do it rather than after.

**One thing to know before you start:** by default there is nowhere to put a file, and the screen says so plainly rather than failing. Everything else in the portal works perfectly with an empty library. There are two ways to give it somewhere, and which one is right depends on where this is running.

**On your own machine**, set `MEDIA_STORE="filesystem"` and `MEDIA_DIR` in `.env` to a folder, and restart. Files go in that folder.

**On a real deployment**, set `MEDIA_STORE="object-store"` and point it at a private storage bucket — Amazon S3, Cloudflare R2, Backblaze, or anything that speaks the same language. This is new, and it is the piece that was missing: most modern hosting has no permanent disk, so a file written to one is gone by the next page load. A bucket is somewhere files actually stay. `DEPLOYMENT.md §1.1` lists the five settings.

Two details worth knowing about it. **The bucket must be private** — nothing here ever makes a file public, and every image or document an investor sees is handed to them by this application after it has checked who they are. And **if you set only some of the five settings, the application refuses to start**, rather than starting, looking fine, and failing the first time somebody uploads something.

**The honest caveat:** the bucket code has been tested hard, but only against a stand-in server running on the same machine. Nobody has yet pointed it at a real Amazon or Cloudflare bucket. When somebody does, upload one image and check it appears — that is the whole test, and it is the last unproven step in this part of the system.

---

## David's personal video

**Admin → Video.** Entirely optional. If David never records one, the portal shows no gap where it would have been — there is no placeholder, no empty player, nothing.

Two ways in, and they land in exactly the same place:

- **Record it here.** Turn the camera on, record, watch it back, and either use it or record it again. Nothing leaves the page until you press "Use this one".
- **Upload one from a phone.** Same checks, same place. If it is an MP4 or a QuickTime file, the location it was shot at is removed before it is stored.

**The order matters and it is enforced.** A newly uploaded video is not published. Until David presses publish, no investor can reach it — not by guessing the address, not by any link, not at all. Try it: copy the address of the preview player while the video is unpublished, open it in a private window, and you get the same "not found" you would get for a video that does not exist. Not a "you are not allowed" — the same nothing.

Then publish it and try again from an investor's portal. It plays.

**Things worth trying:**

- **Replace a published video.** It takes the published one down and the new one arrives unpublished, so you watch it in place before anyone else does. The screen warns you before you upload. Your caption and transcript are carried across.
- **Sign in as the owner rather than the operator.** You can watch the video. You cannot record, replace, publish or delete one — it is David's, and the buttons refuse you rather than hiding.
- **Suspend an investor's account** and try their portal. The video goes with everything else.
- **Leave the caption and transcript empty.** The screen tells you that anyone who cannot play sound gets nothing at all from the video. Fill them in and they appear on the portal as text, in full, not hidden behind a control somebody has to find.

**Seeking, and why it is worth a mention.** A published video now answers a browser that asks for part of it rather than always sending the whole thing. That sounds like a nicety and is not: Safari opens every video by asking for the first two bytes, and gives up entirely on a server that replies with the whole file instead. Before this, David's video did not play on an iPhone at all. Now it plays, and the scrub bar works. If you have an iPhone to hand, that is the ten-second test worth running on the first real deployment.

**And the video is now sent as it is read, rather than read and then sent.** Until today the server loaded the whole video into its memory before sending a single byte of it. That worked, and it cost the size of the video — sixty megabytes, say — for every person watching at that moment. It now reads and sends in step, so ten people watching at once costs roughly what one person costs. There is nothing to click and nothing looks different: the video plays exactly as it did. The way to see it is to watch the server's memory while several browsers play the same video, and it is the sort of thing that only ever shows up on the day the round is going well.

---

## Sending yourself the whole thing

On **Review and send**, on the checklist line that asks whether a test email was sent, there is now a button that sends one. Pick a recipient and it renders their real figures into the real designed email and sends it **to your own address and nowhere else** — the send gate refuses a test addressed anywhere but there, so this cannot reach a real person even by accident.

The portal link in it deliberately does not work. It is the right shape, the right length and the right address, and it opens the "this link is not valid" page. A test that minted a working link would be issuing a real credential against a real investor's record and spending it when you clicked.

This is the thing to do before any real invitation goes out: open it on your phone, the way they will.

---

## The tiles at the bottom of the portal

**Admin → Portal tiles**, owner only. The short names under &ldquo;Coming to your portal&rdquo; on an investor&rsquo;s page. Add one, rename one, hide one, or mark one as shipped.

**Try to add a tile called &ldquo;Guaranteed returns&rdquo;, or &ldquo;Live in 2027&rdquo;, or &ldquo;Reporting &mdash; coming soon&rdquo;.** All three are refused, and the refusal names the word it objected to. This section sits on a securities offer page, so it is kept to tooling and communication &mdash; nothing that reads as a promise of returns, a valuation, liquidity, or a date.

The line beneath the tiles &mdash; *Features shown are in development, are indicative only, and form no part of the investment being offered* &mdash; is shown on the editing screen so you can see what your names will sit above. It cannot be edited or switched off.

There is a second check underneath that one, and `pnpm verify:roadmap` is what exercises it: a tile that gets into the database by some other route — an old seed, somebody at a database prompt — is still dropped before it reaches an investor. The command plants four labels the form would have refused and then reads the portal an investor is actually served, to be sure none of them arrives.

## Two-factor

**Admin → Two-factor.** A code from an authenticator app on top of your password. Any standard app works — Google Authenticator, 1Password, Authy, Bitwarden.

Every account has it, read-only ones included. Nothing is blocked for a read-only account by leaving it off — they never send — but their session is sight of every investor's name and every amount, and a password on its own is one stolen thing away from someone else having all of it.

The specification makes this **mandatory before real invitations go out**, so it is not a preference: the application refuses to send a real invitation from the production address until the operator's account has it switched on. Test messages to your own address are unaffected, so you can rehearse everything before turning it on.

Worth trying, because these are all meant to work:

- Switch it on. You get ten recovery codes, **shown once**. Each works once. Save them somewhere that is not the same phone.
- Sign out and back in. After your password you are asked for a code, and until you give one you can reach nothing — try typing an admin address into the browser and see.
- Use a recovery code instead of your phone. It works, and then it does not work a second time.
- Get the code wrong repeatedly. It throttles exactly as the password does.
- Turn it off. It asks for your password, not a code — a code proves you are holding the phone, and someone who has walked off with your open laptop is holding that too.

**If you lose the phone and the codes**, there is deliberately no button. It is a change made directly in the database, on purpose.

## What is not built yet

- **A screen showing what an investor acknowledged.** The ticks are recorded with the exact wording and the time (see "The checkboxes an investor ticks"), and nothing puts them on a screen or in the export.
- **A screen for reversing a contact-address change.** An investor can now move the address on their record (see "Changing the address on a record"), and you can see in the audit log that one happened — but there is no operator screen showing what it was or putting it back.
- **A note saying what changed in a correction.** A corrected document is versioned and both versions stay readable, but nothing records what was different — only the description, if somebody writes one.
- **An email when a document is issued or corrected.** Deliberate, but somebody will expect it. Send a message or an update alongside.
- **A real storage bucket, actually connected.** The code to use one is now written and tested (see "The media library"), but only against a stand-in on the same machine. Pointing it at a real Amazon or Cloudflare bucket and uploading one image is the last step, and it is minutes rather than work.
- **Anything that deletes a stray file for you.** `pnpm media:check` now finds them — it checks that every record has its file *and* that every stored file has a record — but it only ever reports. Deciding that a file nothing points at is safe to delete is a judgement it does not have the information to make, so it leaves that to you.
- **The timers themselves.** The reminder job is finished and is now safe to run on one (see "Two runs at once"), the health report is finished and knows how to say when the reminder job has stopped, and nothing on any machine is running either of them yet. Three cron lines, written out in `DEPLOYMENT.md` §8, ready to paste.
- **Anything that tells you a check went red without you looking.** `pnpm check:health` exits non-zero when something needs you, which is the right shape for a scheduler to notice — but wiring that to an email or a phone is a decision about who gets woken up, and nobody has made it.

## The round, and closing it

Open **The round**. It shows where things stand: how many were invited, how many answered, how many did not, how many asked for more time, and the four money totals against the aggregate raise.

**The thing to test here is that nothing happens by itself.** Set somebody's deadline to a date in the past and reload. Nothing closes. The round is still open, their offer is untouched, and they can still respond from their portal — a deadline passing is not an event that takes anything away from anybody.

What it does do is queue an email to David: a summary of who answered and who did not, the totals, and a sentence saying plainly that it is his call — close the round now, extend for everyone, extend for named people, or do nothing. It says "if you do nothing, the round stays open" in those words, and it chases again a week later. No investor is ever told a deadline has passed.

**Extending:**

- Give one person longer. Their portal shows the new date at once. Their original deadline is remembered, so they show up under "asked for more time" from then on.
- Extend for everyone. Only people who have not responded move — somebody who already answered keeps the date they were given, because otherwise their portal would disagree with the email in their inbox.
- Try to bring a deadline forward, or to a date in the past. Both refused.

**Closing** is owner-only and takes two ticks if anybody still has time left: one confirming you mean to close, and a second acknowledging how many people that cuts short. Miss either and nothing closes. Close it and responses stop — but nobody's account closes, nothing is deleted, and investors can still read their own records.

Closed by mistake? The owner can reopen it with a recorded reason. A mis-click at the end of a raise should not be permanent.

Nobody is emailed when you extend or close. Telling investors is an update, written by you.

---

## The verification page

Open `/verify` without signing in. This is the one page in the whole application that is meant to be public and indexed, and §15.1 explains why: an unexpected email asking about an investment, with a link, from an address you may never have seen, is indistinguishable from a scam — because that is what a scam looks like. So there has to be somewhere to check.

It names Michael and David, the exact address invitations come from, the exact domain every legitimate link uses, what the email will and will not ever ask for, a standing warning that payment details are never changed by email, and how to verify by another route entirely.

It is linked from the invitation footer, the portal, the portal sign-in page, the dead-link page and the front door — and it works if you simply type the address, which is the point.

**Everything else is invisible to search engines.** Visit `/robots.txt` and `/sitemap.xml`: the sitemap has exactly one entry, and robots.txt disallows everything except the verification page. Every other page also carries a `noindex` tag, and every response — including a downloaded certificate PDF, which no meta tag could ever reach — carries a `noindex` header.

---

## Export and the audit log

Sign in as the **owner** and open **Audit log**. Everything the application has done is in here — including everything it refused. A blocked send with its reason is more use after the fact than a successful one, so both are recorded.

Filter by actor, by entity, by action, or by a date range. Try filtering the action to `export.completed`, or the entity to `compliance_approval`, and you will see the trail of decisions rather than a wall of noise.

Nothing on that page edits or deletes an entry, and there is no function anywhere in the application that could.

**Two exports, from the same page:**

- **Recipients**, as CSV or Excel, per round. It carries all four amounts as four separate columns — proposed, committed, accepted, received — with the jurisdiction, the send status and timestamps, the account status and its full history, the timeline and its history including any corrections and their reasons, the response and when it was made, every question the investor asked, every reply, and the internal notes. Open it in Excel: the decimals are exactly what is recorded, not rounded and not reformatted into currency.
- **The audit log**, as CSV or Excel, and this one is the owner's alone. Sign in as the operator and the link is not there — and the download refuses even if you type the address.

Two things worth trying:

- Put `=1+1` in a recipient's internal notes and export to Excel. It comes out neutralised rather than as a live formula. A spreadsheet that runs whatever was typed into a text box is a well-known way to attack the person who opens it.
- Run a recipient export, then go to settings and try to set the service mode to **disabled**. It now lets you, because §7 requires a completed export within seven days — and the export you just ran is what satisfies it. Before you exported, it would have demanded a written reason.

---

## Things worth knowing

- The `ENCRYPTION_KEY` and `AUTH_SECRET` in your local `.env` are throwaway development values. Generate fresh ones for anything real.
- No email is ever sent to anyone but the operator's own address during development.
- The application refuses to send real invitations unless its configured base URL is the production one. Every portal link embeds the domain it was issued from, and a link issued from a testing deployment dies the moment the application moves.
- Uploaded images and video are stored on disk only if you set `MEDIA_STORE` in `.env`. With it unset, the two upload screens say so and everything else works.
- The colours are taken from the FLIPIT demo file, which is a faithful copy of the live site but not the source of truth. Somebody should check them against flipit.com before launch.
- The invitation email and the participation certificate are light-coloured documents rather than dark ones, and that is deliberate: an email has to be readable in every mail programme, and a certificate has to print.
