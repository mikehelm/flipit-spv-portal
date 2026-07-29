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

Go to **Email templates**, then preview any recipient. That is the real email, with their real amount, their real percentages and their real deadline — not a mock-up with placeholder text, and now shown with its real design as well. (Until the sending name and address are set you will get a card explaining what is missing instead, which is correct — nothing renders an email with a gap in it.)

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

## Erasing somebody, when they ask to be

**This is new, and it is the one thing on the investors screen that cannot be undone.**

The privacy policy tells every investor they can ask for their record to be removed, and that a person will deal with it rather than a form. That was true, and it was also the problem: there was no way to do it in the application at all, so *a person dealing with it* meant somebody typing `DELETE` at a database prompt, working it out as they went, at the moment somebody had asked for something they were entitled to. That is now a procedure instead.

**It is not deletion, and the screen says so.** The rows stay. What is overwritten is every name, every email address, and every line of free text anybody typed — messages, notes, the question they asked, the reference on their bank transfer, the personalised copy of every email that went to them. What is left is the money: the four amounts, the percentages, the stages and the dates, sitting there with nobody attached to them. An offer is a record of a securities transaction and destroying it is not something anybody should be able to do from a web page.

The one thing that really is destroyed is **the files**: a signed subscription agreement cannot be pseudonymised, so the stored bytes are deleted and do not come back.

**Sign in as the owner** — David cannot do this, and cannot even see it — open **Investors**, find somebody, and expand **Erase their personal data**.

**Things worth trying:**

- **Just open it and read.** Before anything is pressed, it lists what is actually there: *3 conversation messages redacted, 1 email as sent, 1 bank reference, 2 audit rows relabelled — none removed.* Those numbers are counted from the database when the page loads, not guessed. If they surprise you, that is the moment to stop.
- **Type the wrong address.** Refused, nothing changes, and the attempt is written to the audit log — because typing the wrong address means you were about to erase the wrong person.
- **Leave the box unticked.** Refused.
- **Do it.** The section then says what the record is now held under — something like *Erased investor 4f2a9c1b7e03* — and it stays there every time you come back, so there is nothing to catch before it vanishes. Write it down with the request anyway: it is the name to quote if anybody asks you to show this happened.
- **Then look at the same account.** The name is the pseudonym, the address ends in `@erased.invalid` — an address no mail server anywhere will deliver to, which is the point — and the account is archived with every session ended and every link revoked.
- **Then look at their offer.** The amounts are exactly as they were. Nothing about the money moved.
- **Then look at another investor.** Untouched. Their messages, their questions, their published Q&A entry, their sessions. This is the thing most worth checking, and there is a whole verification about it.
- **Then look at the audit log.** Every event that investor ever generated is still there, in order, with its timestamps — carrying the pseudonym instead of their address. Nothing was removed. There is one new row, `investor_account.erased`, with your name on it.
- **Try it again on the same person.** Refused: *"That account has already been erased."* It does not write a second row suggesting it happened twice.
- **Sign in as David and look at the same card.** The section is not there. Not greyed out — absent.

**If it refuses to start**, the likely reason is that the investor holds uploaded documents and `MEDIA_STORE` is not configured, so the files cannot be destroyed. It stops before touching the database rather than doing most of the job, and says so. **That refusal has now been seen on a real screen**, rather than only proved in the code underneath it: the card lists everything that is there and then, where the form and the button would be, shows a notice naming `MEDIA_STORE`. There is no button to press and no greyed-out one either. A form that appeared when the files could not be destroyed would be the worst thing that could go wrong on this screen.

`pnpm verify:erasure` does the whole thing against a real database with **two** investors present and checks a hundred and nineteen things, half of them being that the second investor is exactly as they were, and `pnpm verify:account-access` now drives the screen itself in a real browser — signing in, reading the counts, typing the wrong address, typing the right one, and checking the section is not there at all when David is signed in. `DEPLOYMENT.md §12` is the written procedure, including three things this does *not* reach — worth reading once, calmly, before it is ever needed.

**All sixteen of those count lines are now checked**, and the way they are checked is worth a paragraph, because it catches a mistake no ordinary test can see. The list is sixteen hand-written pairs of a sentence and a thing to count, and the way it goes wrong is not a crash — it is a *swap*: the number of documents drawn against the word "certificates". Every number on the screen is then a real number, and every sentence is true of something. It is simply true of the wrong thing, and on a test investor holding one of everything it looks perfect.

So the investor that browser check erases now holds **one** row of one kind, **two** of another, and so on up to sixteen — every count different — and the screen is read for all sixteen sentences with their own numbers beside them. Swap any two labels and two numbers move. That was confirmed by doing it on purpose: two labels were swapped, the run failed and named both, and they were put back.

**There are now two investors on that page while it is checked, and that is not decoration.** The counts for every card are worked out in one go for the whole page — a change made so a page with forty investors on it does not run seven hundred database queries — and the way a thing like that goes wrong is by putting one person's totals on another person's card. Every number is still real; it is on the wrong row. On a form whose whole job is *is this the right person*, that is worse than a wrong number: it is a card arguing for the wrong decision.

So the check now erases one investor with a second sitting next to them, every one of the second investor's sixteen counts different from the first, and reads both cards. It was confirmed by breaking it: the roll-up was deliberately changed to credit one investor's messages to everybody, and the run failed naming the second investor's line and the number it had wrongly acquired. Afterwards the second card is read again — same sixteen numbers, nothing of the erased investor on it, not their name, their address or their pseudonym.

**With both investors' forms on screen at once, one more thing is now checked, and it is the one that would matter most.** What a person reads is the name and the counts. What the server acts on is a hidden field carrying the account's identifier. Those two are produced side by side and nothing had ever asked whether they agree, because there had never been two forms on the page to disagree. A hidden field carrying the wrong identifier means somebody reads the right name, types the right address, and erases somebody else — and typing the address correctly would not save them, because the address is compared against whichever account the hidden field named.

So both forms are now read: two different identifiers, each one belonging to the person named on that card. And then the same question asked from the outside — the first investor's address typed into the second investor's form, which is refused, because that form is not theirs. Confirmed by breaking it: the identifier was deliberately corrupted, and three checks failed at once.

**And it is now checked on a phone-sized screen too.** This section is the one part of the investors screen that opens rather than being there, and that turned out to be a blind spot: `pnpm verify:viewport` measures every screen at 375px, and it had never seen the inside of this one, because a closed panel is not laid out. So a sixteen-line list, a warning, a text box, a tickbox and a red button had never been measured on a phone at all. They are now — expanded, with the same sixteen-row investor behind them, in both the state that offers the form and the state that refuses. Nothing scrolls sideways, nothing spills out of its box, and every button is still big enough for a thumb.

**And the files themselves are now really deleted, by pressing the button, and watched while it happens.** This is the newest piece and it is the one that had been missing longest. Everything above is about *records* — names overwritten, messages blanked, an audit log kept. Underneath there are also **files**: the signed subscription agreements and certificate PDFs an investor's record points at. Deleting a file is the only thing in this whole application that genuinely cannot be undone, and until now nothing had ever done it by pressing the button on the screen. One check deleted a single file by calling the code directly, without a browser. The browser check deleted nothing at all, because to make the form appear it first took the files away by hand.

So there is now a check that does the real thing. It sets up a working file store, puts **thirty-four real files** in it — seven belonging to the investor about to be erased, twenty-seven belonging to somebody else — and then drives the screen. It reads the card and confirms the form is offered with the line *"7 stored files destroyed outright"* on it, which is the warning a person is meant to see and which no screen had ever drawn. It types the wrong address, gets refused, and then **counts the files again** — because a refusal that says *"Nothing was changed"* over seven deleted agreements would be about the worst thing this screen could do. Then it types the right address, and afterwards: all seven of that investor's files are gone from the store, and all twenty-seven of the other investor's are still there with their contents unchanged, checked one by one. The store itself is asked, separately, whether anything was left behind — because a file whose record was tidied up but whose contents survive is exactly what an ordinary check cannot see.

**Every one of those was confirmed by breaking it on purpose**, four different ways: stopping the deletion, crediting the files to the wrong investor, blocking the form, and disabling the address confirmation. Each break produced the failure it should have, including the plainest sentence in the whole run — *"7 were destroyed by a refusal"*. Two faults in the checking itself were found and fixed on the way: it used to crash rather than report when a refusal went wrong, and once it accused the application of a fault that was really a leftover message on the screen. `pnpm verify:erasure-bytes` is the command; it is twenty-four checks and it cleans up after itself.

**One small thing you may notice on the screen.** After you type the right address and press the button, the previous refusal message stays visible for the moment the deletion takes. It is not wrong — it is the last thing that finished, and it is replaced as soon as the server answers — but it is worth knowing, because on this particular screen a refusal message sitting there while something irreversible runs is easy to misread.

**And what happens when the file storage says no.** Files are deleted one at a time, before anything in the database changes. If the storage refuses one of them — a permissions problem, a policy on the bucket — the erasure stops there and **nothing in the database is touched**: the name, the address, the documents and the status are all exactly as they were, and the screen says so. That is now checked against a real storage service over a real network connection, with one file deliberately locked so it cannot be deleted.

Two things follow that are worth knowing rather than discovering. **Files reached before the refusal are already gone**, and their records still list them — an erasure cannot be all-or-nothing across two separate systems, and the safe direction is deleting the files first. And **it is safe to simply run it again** once the storage problem is fixed: the second run finishes the job and does not trip over the files that already went. That was checked by locking a file, watching the erasure refuse, unlocking it, and running it again. `DEPLOYMENT.md §12.5` says the same thing in the runbook.

### The sentence that was not true, and the record that was not kept

Read the paragraph above again, and then read what the screen used to say when that happened:

> *"A stored file could not be destroyed, so the erasure stopped before touching the database. **Nothing was changed.**"*

That last sentence was true of the database and false of the storage. Files reached before the refusal were destroyed and are not recoverable, and the person who pressed the button was told nothing had happened. **On the one action in this application that cannot be undone, the message was wrong in the direction of reassurance** — and nothing anywhere recorded it, so a week later there was no way to find out that an investor's record was sitting half-erased.

Three things are different now.

- **The message says what actually happened.** *"1 stored file was destroyed and cannot be recovered, and then the store refused on another — so the erasure stopped there. The database was NOT changed: the record still names every file, including the one that is gone."* It then tells you the remedy, which is unchanged: fix whatever the storage is refusing over, and run it again.
- **It is written down.** An erasure now writes a line to the audit log **before** it destroys anything, and a second line saying how it ended. You will see `investor_account.erase_began` followed by either `investor_account.erased` or `investor_account.erase_incomplete` — and the incomplete one records how many files went and how many are left.
- **The health report keeps telling you.** A half-finished erasure appears on **Admin → System health**, and on the banner at the top of the overview, as a fault: *"1 erasure stopped part way through and destroyed files the record still names."* It says which account, what to do, and it clears itself the moment you run the erasure again. There is a check for that too — a rule that keeps complaining after you have done what it asked is one you learn to ignore.

### And the reason none of that could happen on a disk

Everything above describes what happens when the storage refuses to delete a file. On a cloud bucket it could happen. **On a local disk it could not, because the application was not listening.**

The code that deletes a file from disk was one instruction wrapped in "if that fails, carry on" — written for the one case where carrying on is right: the file was already gone, which is the state you wanted anyway. But it carried on for *every* failure. A disk mounted read-only, a permission the application does not have, a folder where a file should be: each of them came back silently, and the application counted the file as destroyed.

So on a disk-backed deployment, an erasure would have told the owner *"1 stored file was destroyed and cannot be recovered"* about a file still sitting there. And the image library made a promise in writing — *"the bytes are removed first; if that fails the row stays"* — that could never come true, because nothing ever failed.

It listens now. *Not there* is still fine and still silent; anything else stops what it was doing and says which kind of failure it was. Three screens changed with it:

- **Deleting an image** that will not delete keeps the library entry and says so, rather than removing the entry and leaving the file behind where nothing will ever find or delete it.
- **Deleting a document** does the same. That one matters more: a document row deleted over a PDF that is still stored is an investor's subscription agreement sitting somewhere with nothing in the application able to reach it again.
- **Replacing David's video** refuses if the old one cannot be deleted, rather than replacing the record and leaving two videos in storage.

And `pnpm media:check` now tells two problems apart that it used to merge. *Missing* means the record is there and the file is not. *Unreadable* means the file may well be there and the storage would not answer — a different problem with a different fix. Until now every refusal was filed as "missing", which reads as *the file is gone* about a file that is present.

**The other half of this is the one nobody can press a button to cause.** If the application is restarted, killed or redeployed in the middle of an erasure, there is no message at all, because nothing is there to write one. That is what the *first* line is for: an erasure that recorded a beginning and no ending is now itself a fault on the health report, saying in as many words that the process did not survive the attempt and that the record may be in any state — including, and this is the one that matters, erased in the database with the investor still signed in, because sessions are revoked after the record is written.

**One more thing changed with it.** The files were being deleted in whatever order the database happened to return them, so an erasure that stopped half way destroyed a different set each time and the failure could not be reproduced. They are deleted in a fixed order now.

You can watch the whole sequence: `pnpm verify:erasure` is **160 checks** against a real database and a real storage service — it locks a file, watches exactly one of three get destroyed, reads both audit rows, confirms the health report raises it, unlocks the file, runs the erasure again and confirms the fault clears.

**And the one thing none of that could see, which the application now asks about directly.** If the storage bucket has *versioning* switched on — a feature Amazon, Cloudflare and Backblaze all offer, and which some setup templates switch on for you — then deleting a file writes a note saying "deleted" and quietly keeps the file. The storage tells the application the file is gone. Every check described above passes. And every file is still sitting there, recoverable by anyone with access to the storage console: an investor who asked to be erased would not have been.

Nothing that *uses* the storage can tell the difference, so the application stopped trying and simply asks the bucket. **`pnpm media:check` now prints one of three lines every time it runs:**

- *"Deletes are permanent on this store"* — versioning is off. This is the state to be in.
- *"DELETES ARE NOT PERMANENT ON THIS STORE"* — versioning is on, or was on and is suspended. The command fails, and the health report says so in as many words. Suspended is not safe either: it stops *new* copies being kept and keeps every copy already made.
- *"…is NOT KNOWN"* — the bucket would not answer. Some providers do not offer the question, and some access keys are allowed to read and write files but not to ask about the bucket's settings. **This is not treated as "fine"** — it asks you to check in the provider's console yourself — but it does not fail the command, because otherwise a provider that cannot answer would fail it for ever.

**And there is a second question, because switching versioning off does not undo it.** Turning it off stops the storage keeping *new* copies. Every copy it already made stays exactly where it is. So a bucket that had versioning on for a fortnight and has it off today reports *"deletes are permanent"* — perfectly true from now on — while still holding a copy of everything deleted during that fortnight. That is the state somebody reaches by reading the warning, ticking the box, and stopping. `pnpm media:check` therefore also asks the storage how many copies it is holding, and says so:

- *"And it holds nothing behind a delete marker"* — clean. This is the line to want.
- *"It is STILL HOLDING 6 superseded versions and 6 delete markers"* — copies of files this application asked the storage to destroy. This fails the command and shows in the health report **whatever the versioning setting now says**, which is the whole point of asking it separately.
- Nothing at all — the storage cannot say, which is the permanent answer for an ordinary disk. It is never reported as zero.

The fix is to expire those copies: a lifecycle rule that removes non-current versions immediately is the usual way, or delete them in the provider's console. Then run the command again and it will say so.

Whether this matters was not taken on trust. The check works against a storage service that behaves exactly like a versioned bucket: it accepts the delete, reports the file gone, leaves it out of every listing — and still has the bytes afterwards, which the check then goes and finds. That is the whole danger, demonstrated rather than described — and then versioning is switched off in the middle of the check, the status goes clean, and the copy is still found sitting there. It is also written into `DEPLOYMENT.md §1` and the configuration file's own notes, because it is a box somebody ticks once and nothing else will ever complain about.

None of this applies if your files are on an ordinary disk rather than in a bucket. There, a delete is a delete.

**One thing to raise with the formation agents.** Under UK and EU data-protection law, pseudonymised data is still personal data. What is built here is the most that can be done while keeping a coherent record of a securities transaction, and keeping that record is exactly what the privacy policy's *"subject only to anything that has to be retained"* is for. Whether that covers what has been kept is a question for advice, not for the build. It is written up in `OPEN_DECISIONS.md` item 12 with the two specific calls to put to them.

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

```bash
pnpm build && pnpm verify:viewport
```

332 checks across every screen, admin and investor, in a real browser. If your machine has a Chromium that Playwright did not install, put its path in `CHROMIUM_PATH` and it will use that rather than asking you to download another.

The run also now *uses* the camera, rather than only reading the header that permits it. Two lines in the security policy were written the awkward way on purpose — the camera is allowed for this site rather than blocked outright, because blocking it would break the video recorder with no error message anywhere — and until now the evidence for that was somebody having read the file. The run asks the browser for a camera and plays back a recording, and both were checked by deliberately breaking the policy, rebuilding, and confirming the run went red before putting it back.

> **Two things were added to that run and both found something immediately.** The password page and the refusal page had never been measured at all, and the refusal page turned out to have the two smallest tap targets in the application — 20 pixels where 44 is the minimum. And the run now *listens to the browser console*, which nothing had ever done: the security policy added last week was checked by reading the headers it sends, which proves a header is sent and proves nothing about what it blocks. It was blocking something on the Updates screen. Nothing was visibly broken — the page worked, the tests passed — but every visit filed a violation into a console nobody was reading, and standing noise like that is what a real problem hides behind. Fixed at the cause, and the run now fails if it comes back.

### The hole in the security policy, now closed

There has been a known weak spot in that policy since the day it was written, recorded in the file itself rather than glossed over. It is worth explaining, because it is the difference between a policy that sounds thorough and one that does something.

A web page can be attacked by getting it to run a script that was never meant to be there — smuggled in through a name, a question an investor typed, or a cell in a spreadsheet somebody imported. The policy blocked a great deal: no fonts from elsewhere, no images from elsewhere, no talking to any other server, no framing the page inside somebody else's. But it still permitted a script written *directly into the page* to run. So a smuggled script could not phone home — and it did not need to. Everything worth stealing was already on the page it was standing in: an investor's claim link, their figures.

**That is now closed.** Every page is served with a one-time password of its own, freshly generated for that single response and thrown away. Scripts that belong to the application carry it. Anything else does not run at all.

You cannot see this and there is nothing to click. What you can do is watch the check that proves it, which does the attack on purpose:

```bash
pnpm build && pnpm verify:viewport
```

Look for the section headed *The nonce, proved by injecting what it refuses*. It writes a script into a live page three times: once with no password, once with the wrong one, once with the right one. The first two must not run. The third must — because a policy that blocks *everything* would leave every page in the application dead, and looking correct while being dead is exactly the failure this had to be tested for. It also checks the password is genuinely different on the next page load, since one that never changes could simply be copied.

**A second hole, in the same policy, closed the same way.** The rules also used to allow styling to be written straight into a page — a smaller problem than a script, but not nothing: a rule that covers a figure with a block of colour is styling, and this is an application whose job is to state amounts. That is now closed too, and the run has a section headed *The style policy, proved by injecting what it refuses* which does the same thing to it.

> **The first version of that check was wrong on every screen, which is worth saying.** It flagged an invisible element Next.js adds for screen readers, on all thirty-one pages, and looked like a real finding. It was not: the browser rule covers styling written into the page's text, and this one is set afterwards by the page's own code, which no such rule inspects. Nothing was broken and nothing needed fixing. The check was corrected to look at what the rule actually covers — and a test was added that deliberately asserts the exempt case still works, so that the next person to see it does not spend an afternoon on it.

### The portal is now the most locked-down page in the application, which it was not

The rules above are a list of what a page is allowed to load — images from here, video from here, and so on. Until now there was **one list, used for every page**, and something worth knowing had crept into it: two administration screens need one unusual permission each, and because there was only one list, the investor's own portal was being given both of them. Plus two more that nothing in the application has ever used.

Counted properly, four of the permissions on that list were being handed to every page:

- **Images from a data URL** — genuinely needed by *one* screen: the two-factor setup page, which draws its QR code that way.
- **Video from browser memory** — genuinely needed by *one* screen: David's recorder, which plays your recording back before uploading it.
- **Fonts from a data URL** — needed by nothing. It was there for a font nobody ever added.
- **Background code loaded from browser memory** — needed by nothing. The note beside it said the recorder *may* need it. It does not, and that is now proved rather than assumed: the whole recorder — camera on, record, play back, upload — runs its 107 checks with the permission removed and reports no complaint from the browser.

The last of those four is the one worth removing. Three of them are about pictures and fonts. That one is about **running code**, which is the thing this whole policy exists to prevent, and it had been granted to every page in the application on the strength of a guess.

**Now each page gets only what it needs.** The two-factor page gets its QR permission. The recorder gets its video permission. Everything else — and in particular every page an investor ever sees — gets neither, and none of the other two at all.

**And one of the checks meant to protect the QR code turned out to be checking nothing.** The two-factor screen is one of thirty-two the automated run visits, watching for the browser refusing anything. It had always passed. But the QR code only appears while you are *part way through* setting two-factor up, and the run signs in as an account that is not — so the screen it was inspecting had no QR code on it. There was nothing to refuse.

That was harmless while every page had the permission. It is not harmless now that one page does, because a QR code that will not draw is a step nobody can complete. So the run now starts the setup for real, looks at the page, and asks the browser whether the image actually *decoded*. Then it puts the account back as it found it.

**Then the check was deliberately broken to make sure it works.** With the permission removed and the application rebuilt, the run says exactly what it should: *the image did not decode*, and *the browser refused it*. Put back, and it passes again. That is worth more than a check that has only ever been seen passing — this is the third time in a row that something reported green turned out to be looking at the wrong thing, and the pattern is now being actively hunted rather than waited for.

> **And under a sub-path.** Because these permissions now depend on *which page* you are on, and the application will eventually be served at `mikehelm.com/SPV` rather than its own domain, there was an obvious way to get this wrong: check for the address `/admin/video` and miss `/SPV/admin/video`. That would give the recorder the wrong rules on the only deployment anyone can actually reach, while every check on a plain domain passed. It has been written to survive the prefix, and `pnpm verify:deployment` — which stands the application up under `/SPV` and asks a live server — now confirms all three cases there: the recorder gets its permission, the two-factor page gets its own and not the recorder's, and a portal page gets neither. This exact trap has now been sprung twice in this project and nearly a third time.

> **And this found a real fault, on a part of the site nobody had been able to test until now.** The application will eventually be served under a sub-path — `mikehelm.com/SPV` rather than a domain of its own — and there is a separate run, `pnpm verify:deployment`, that stands it up that way and asks a live server questions. It now checks the security headers, and it reported that the **front page had no security policy at all** under a sub-path. Not a weak one — none. Every equivalent check on a plain domain passed, which is why nothing had caught it: the rule that decides which addresses the policy applies to has a quirk where an address with nothing after the prefix falls through the gap. One line fixed it. The same trap had been sprung once before in this project, in a different file, and was found the same way — by asking a running server rather than by reading the code.

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

That starts the application, opens a real browser at phone size, signs itself in as both an administrator and an investor, and walks every screen measuring each one — 332 checks. It needs a database and takes a few minutes.

## Two screens that had been checked empty, and a real fault behind them

There is a run that opens every screen in the application on a phone-sized window and measures it — no sideways scrolling, nothing off the edge, every button big enough for a thumb, every piece of text readable against its background. It has been reported green for weeks.

**It had been measuring two of them with nothing on them.** The questions screen said *"Nothing is waiting"*. The register screen said *"Nobody is on the register"*. Both were checked, both passed, and in both cases the thing that was not being drawn is **a table** — a list of questions with names and dates, and a register with an amount in every row. A table of figures is the widest thing this application puts on a page and by far the likeliest to push it sideways on a phone. So the two screens most at risk were the two whose layout had never actually been looked at.

**And a third was worse.** The import screen is four steps, and only the first one is reachable by opening the page — the rest appear after you choose a file and press a button. The run only ever saw step 1: a heading and a file picker. **Step 3 is the review table** — every recipient, with their amount, both percentages, their deadline and their jurisdiction, and totals underneath. It is the widest thing in the whole application, and nothing had ever measured it on a phone.

All three are now populated and measured. The run went from 332 checks to 357.

**It immediately found a real fault.** On the column-mapping step of the import — the screen where you tell the application which spreadsheet column is which — the eight dropdowns were **36 pixels tall**. The standard, which every other control in the application meets and which this run enforces everywhere else, is 44. They were too small to tap comfortably, on the screen where you are matching up a file of real people's money, and it had been that way since the wizard was written. Nothing had caught it because nothing had ever got to that step.

Both dropdowns are now the right size. That fault could not have been found by reading the code — it needed a real browser, at that width, on a step that only exists after two clicks and a real file.

> **One more thing worth saying, because it is the third time.** Three checks in a row have now turned out to be green for the wrong reason: one that waited for a page to look right instead of waiting for the thing to be true, one that was reading a hidden copy of the page instead of the page, and now two that were measuring empty screens. None of them was broken in a way anybody would notice; all three were reporting success about something they were not looking at. This is now being hunted deliberately rather than stumbled over, and the question being asked of each check is a blunt one: *would this still pass if the thing it names were simply not there?*

---

## The import, all the way to the end — and a button that was grey

The section above added a check on the import wizard's **review table** — the wide screen listing every recipient with their amount, both percentages, their deadline and their jurisdiction. It stopped there, deliberately, because the next button creates real records and nobody wanted a layout check writing investor rows.

That button has now been pressed, and pressing it found that **the review table had never actually worked.**

**What was wrong.** The test file used an SPV percentage of `41.666667`. The application works out the indirect Flipit percentage by multiplying that by 0.30, which gives **12.5000001** — one decimal place more than it can store. So it refused the whole file, exactly as it is supposed to. What was on the screen at that moment was not the review table at all. It was the *error* version of it: a box saying one row stops this file, a table with one recipient in it instead of two, and a **greyed-out button** reading "Import 1 recipient(s)".

The check passed anyway, for three small reasons at once: it waited for the button to *appear* and never asked whether it could be *pressed*; the pattern it matched would accept a "1" as readily as a "2"; and the name it looked for was in the file, so it was on the screen either way.

That is the fourth check in four rounds to be green for the wrong reason, and this one was written by the round that was fixing the third. There is no comfortable way to say that, so it is said plainly.

**What now happens instead.** The file uses a percentage that divides — and the run asks, in order: was the file accepted; are **both** people on the table; does the button offer **two**; **is the button switched on**; is one row marked *Blocked* and the other *Ready*; does the override warning name both figures; and is a total larger than the stated raise a *warning* rather than a refusal, which is what the specification asks for.

**And then it presses it.** The final screen — the one that tells you what the import did — had never been drawn at phone size by anything. It is now drawn with every part of its sentence present at once: one account created, one existing account reused, one offer ready, one held. Underneath the sentence, thirteen further checks read the actual records: two recipients, **two** accounts and not three (an address that already has an account keeps it), the US recipient held with the reason recorded, **the other one imported and ready beside them**, the amounts stored to the cent, the supplied percentage stored exactly as written and marked as supplied, **nothing emailed to either of them**, and **no sign-in link issued to either of them**.

That middle one is the rule that matters most and had never been seen on a screen: **a held country stops one person and not the batch.** It was proved in the code and in a database test. It had never been proved by putting a file with a held recipient in it through the actual wizard and looking at what came out.

The run went from 357 checks to **391**, and it now clears up after itself properly — the previous version left a stray record behind on every single run.

> **The one open question this raised.** The refusal above is arguably too strict. The spreadsheet can supply the Flipit percentage directly — that column exists precisely for a split that will not divide — and when it does, the calculated figure is thrown away. But it is calculated and rejected *first*, so the file is still refused, and the message asks you to change the SPV percentage, which is a real number that ends up in an investment document. Nothing has been changed: it is written up in `OPEN_DECISIONS.md` as a question for you, with the arithmetic. It will only ever be met by a file with an awkward three-way split in it.

---

## Six checks that existed and could not be run

A tidy-up, and a surprising one. There are twenty-six checking commands in this project — `pnpm verify:viewport`, `pnpm verify:health`, and so on. **Six of them had no command.**

The files were there. The checks were there. But nothing in the project listed them, so `pnpm run` did not show them, and the only place they were mentioned was a line of notes inside each file. Between them they hold **259 checks against a real database**, covering:

- the shared questions page, with a second investor present the whole time, proving one investor's thread never contains another's;
- the register of interest, proving nobody on it can see their own position or anyone else's;
- an update sent to some people, proving it reaches only them;
- the participation certificate, from issue to reissue;
- the rule that a deadline passing closes nothing and inaction closes nothing;
- the export's decimal places.

They were not broken. Every one was run and every one passed. They were simply invisible — and earlier notes in this project cite one of them by a command that did not exist.

All six now have a command: `pnpm verify:qa`, `pnpm verify:register`, `pnpm verify:updates`, `pnpm verify:certificate`, `pnpm verify:rounds` and `pnpm verify:export`. And the test suite now fails if a seventh one is ever added without one, so this cannot quietly happen again.

---

## What you see when it actually breaks

Every application needs a page for the moment something goes wrong at its end. This one has had a proper, branded one for months — and **nothing had ever made it appear.** It had been checked by reading it, which tells you what it would say and nothing about what it does.

It has now been made to appear, by breaking the application for real.

**How, without breaking anything you care about.** A second copy of the application is started alongside the first, pointed at a database that does not exist. Nothing is created, nothing is deleted, and the real database is not so much as read. Then a page that needs the database is opened on a phone-sized screen, and what a person would see is measured: does it say what it is meant to say, is it laid out properly, is the "Try again" button big enough to press, and — the important one — **does it accidentally tell the reader anything about the fault.**

**It found two things.**

**The first is good news wrapped in a correction.** The page is written to show no detail at all — no error message, no technical code. That is true of what is *drawn*. It turns out the response still carries one number, an internal error reference, tucked away in data the browser uses rather than in anything a person sees. It cannot be removed; the framework puts it there. Nothing else is there: no error message, no database name, no file paths, no table names, no email addresses, nothing that says what went wrong. That is now checked against the *whole* response rather than against the visible page, which is a distinction this project has been bitten by before, and the note in the file has been corrected to say what is actually true.

**The second is worth knowing before launch.** A page like this one can only appear once the browser has run its scripts. Somebody with JavaScript turned off gets a **blank page** under the error, rather than the branded apology. That is how the framework works rather than a mistake here, but nobody had ever looked, and now it is written down.

**And one genuinely reassuring thing came out of it.** With the database completely gone, **the public pages still work** — the front page, the privacy policy, the sign-in page, and most importantly the **invitation-verification page**. That is the page somebody visits when they are asking "is this email real?", and it is exactly the page you would least want to be down during a problem. It does not touch the database at all, and that is now checked rather than assumed.

---

## The other import screen — the one you see when the file is wrong

A footnote to the section above it, and an honest one. Fixing the import test file so that it would actually import left the **refusal** screen — the one you get when your spreadsheet has a problem in it — measured by nothing at all. It had only ever been looked at by accident.

It is now looked at on purpose, and the thing being checked is that you can tell the two kinds of problem apart at a glance:

- **A problem with the file** stops everything, including the rows that were fine. A spreadsheet with a bad address in it is not a spreadsheet to send investment offers from.
- **A held country** stops that one person and leaves everyone else alone.

Those two land on the same screen and mean very different things. The run now checks that the refusal screen says the whole file is stopped and does *not* use the word held; that it names the exact number that is wrong and what to change; that the import button is switched off; that it does not quietly offer to import just the surviving rows; and that nothing was created by any of it.

**The whole phone-sized run had reached 441 checks at this point.**

---

## And the same breakage, on an investor's own page

The section above broke the application and looked at what an *administrator* sees. The more important question is what an **investor** sees, because there is one rule in this project that matters more than any other: nothing an investor is ever shown may reveal that any other investor exists.

That rule has been checked on every ordinary page for months. It had never been checked on an **error**, for the simple reason that nobody had ever produced one.

Now it has been. With the database gone, an investor's portal is opened and the whole response is read — not just what is drawn on screen, but everything sent to the browser. It is checked for: any person's name, any email address, any money figure, any count of anybody ("3 investors", "2 offers"), and any hint of what actually went wrong. None of it is there.

Two other things are checked on that same screen, and both are promises the page has always made and nobody had tested under real failure:

- it says **"nothing has been sent anywhere"** — which is the sentence somebody reads when they are wondering whether their money just moved;
- it does **not** bounce them to a sign-in form asking who they are, which would be an alarming thing to meet when a page has just failed.

**And one last screen, which turns out not to exist.** There is a second, deeper error page in the application, meant for the case where even the outer shell of the page fails. Nothing had ever made it appear — and looking into why, it turns out **nothing can**. The outer shell of this application reads nothing at all: no database, no settings, no cookies. It is just the page frame. So it cannot fail, and the deeper error page can never be reached.

It has been left in place — it costs nothing, and the day it is ever needed is the day nothing else is working. But the note inside it, which used to describe a way of reaching it that does not actually work, has been corrected. And there is now a test that fails the moment somebody makes the outer shell read something, because that would quietly change which of the two error pages a broken application shows you.

---

## The email preview — and something you will want to know before you send

**This is the one to read.**

There is a screen that shows you the exact email one particular person will receive, with their real name and their real figures in it. It is the last thing you look at before pressing send on an invitation about somebody's money. **Nothing had ever opened it.**

It has now been opened, driven and measured — and the one real problem it turned up has since been fixed.

### What it does

- **The email is drawn in a locked box.** An email is untrusted content by its nature, so this page puts it in a sealed frame that is meant to be unable to touch the page around it. That was written down and believed; it has now been *proved in a real browser*. The frame genuinely cannot reach the admin page it sits on.
- **Looking does not create anything.** Opening a preview issues no sign-in link and no access of any kind — checked by counting before and after. The link shown in the preview is deliberately a dead one.
- **It shows nobody else.** A second investor was deliberately put into the database while the preview was open, with a distinctive name, address and amount, and none of the three appeared anywhere in what the browser received — not on the page, and not in the email itself.
- **And what you will actually see today** is not the email at all — it is a card saying *"this email cannot be sent yet"* and naming exactly what is missing, which right now is the sending name and address. That is correct behaviour: nothing renders an email with a gap in it. That screen had also never been looked at, and now is.

### The problem it found — now fixed

**You could not see what your email actually looked like.**

A designed HTML email carries all of its styling inline — that is the only kind of styling email programs respect, and this invitation has sixty-nine separate pieces of it. The security rules this application applies to its own pages were also applying *inside* the preview frame, and those rules refuse inline styling. So the preview stripped every one of them out: the text was right, the figures were right, and **the picture was wrong**. You saw a plain, unstyled document; your recipient would have seen the designed one.

**The quick fix was refused and the proper one built.** Relaxing the styling rule would have relaxed it on every page in the application, including the ones holding investors' figures, to make one preview look right. Instead the email is now delivered into that frame from **its own private address**, which carries a rule of its own: it may style itself, and it may do nothing else at all — no scripts, no images, no forms, no connections of any kind — and it can only be displayed inside this application and nowhere else. Every other page is unchanged, and no rule anywhere was loosened.

**So the preview now shows you the designed email**, and the card above it is true of the appearance as well as of the words.

Three things worth knowing about that private address, all of them checked in a real browser:

- **It needs your sign-in.** Asked for without one, it returns nothing at all — the same nothing you get for an address that does not exist, so it cannot be used to find out which investors are real.
- **It is never stored.** Somebody's correspondence is not cached, not kept, and not indexable.
- **Looking is recorded.** Opening a preview writes to the audit log, and so does fetching the email body itself. Two entries, because two things were read — and the second one is what makes a direct look at somebody's correspondence visible rather than silent.

**The phone-sized run is now 532 checks**, up from 497 — and the check that used to record this defect is gone, replaced by twelve that prove it is gone.

---

## One thing to read before anything is sent

There is a document in this project called `OPEN_DECISIONS.md` — the list of things only you and David can answer. It was written before the build started, the build then ran for two days underneath it, and **nobody had ever checked whether it was still true.**

It has now been read against the code, statement by statement. **Five of them were wrong.** The document is now version 7, and each item is marked either *verified* (somebody read the code and it says this) or *corrected* (it did not).

Two of the corrections change what you would actually do:

**There is no list of approved countries in the application.** The old note read as though it knew about Australia, England, France and Thailand. It knows nothing. The list is typed in by you when you record the compliance approval, it ships empty, and **until it is entered nothing sends to anyone** — not one recipient, not to test. It also takes country *codes*, not names: `AU, GB, FR, TH`, with the US left off. It refuses a name rather than guessing which country you meant, which on a securities offer is the right instinct.

**The privacy policy was already written.** The note asked for it to be drafted. It has been, and it is live at `/privacy` — about 490 words, eight sections, finished. What is left is for you to read it, because it makes promises on your behalf. Which brings us to the one new item.

### The new item, and it is the important one

The privacy policy tells an investor they can **ask for their record to be deleted, and it will be**. It says a person will handle it rather than a form — which is honest, because a person can.

**But nobody has written down how.** There is no delete-an-investor function in the application, by any role, deliberately: a closed account keeps every row and turns read-only, which is the right default for a record of a securities transaction. So today, honouring that request means somebody typing a deletion straight into the live database, improvised, at the moment an investor has asked for something they are entitled to.

Three ways out, in the document, and the cheapest is a written procedure rather than a feature — which rows, in what order, what the audit log has to keep. Building an erasure feature is the durable answer and it is real work. Narrowing the wording is the option to be slow about, because what it currently says is the ordinary expectation under UK and EU data-protection law.

**Nothing is blocked on this.** But the page saying it goes live before the first invitation does, so it is worth an answer before then.

### And the document now has a test

The reason it drifted is that nothing was holding it to anything, while every check in the codebase was being held to *"would this still pass if the thing it names were absent?"*

Seven of its statements are now pinned by a test. If somebody builds an investor-deletion feature, the test fails and says *update item 12*. If somebody narrows the privacy wording, the test fails and says the same. If the approved-country list stops shipping empty, or the old hosting domain comes back into the code, or published questions stop being visible during the round — each fails and names the item to go and fix.

It was watched failing before it was trusted: a deletion and an old domain were temporarily added, the run reported exactly those two failures, and they were removed.

---

## One command that checks everything

There are twenty-three separate verification programs in this project. Between them they drive a real web browser, a real database, a real file store, a real backup restore and two full copies of the application — and they check things no ordinary test can reach: that every screen works on a phone, that the upload limits refuse what they say they refuse, that the video recorder records.

**Nothing ran them.** They existed, each had to be started by hand and by name, and nobody was doing it. A check nobody runs stops working without anybody finding out.

There is now one command:

```
pnpm verify:all
```

It runs all twenty-three, one at a time, and prints a table at the end: each one, what it proves, how long it took and how many checks it made. On this machine that is **1,556 individual checks in about five minutes**, and it currently passes completely.

Three things about it are worth knowing.

**If it cannot run one of them, it says so and refuses to call the run a success.** Some need a browser installed; one needs the PostgreSQL command-line tools. If those are missing, the affected programs are named, the fix is printed next to them, and the command still reports failure. A run that quietly skipped a third of the checks and printed a green total would be worse than no command at all — this is the one you would run before going live.

**It runs them one at a time on purpose.** They all put test records into the same database and clean up afterwards, so two at once would delete each other's work. For the same reason, do not run two of these side by side.

**It found two real problems the first time it was used**, which is rather the point:

- *A verification that broke itself.* One of them changed a setting and only put it back if everything went well. So the first time it failed for any reason, the setting stayed changed and it then failed **forever after** — on a perfectly healthy application, with a confusing message about a certificate that already existed. It now puts the setting back on every path out, and sets up its own starting conditions rather than assuming them. It has been run four times in a row from three different starting states and passes every time.
- *A browser that was not really a browser.* Two of the programs need a camera. The browser they were using reports that it has one and then refuses every request to use it — so one program hung waiting for a button that could never appear, and another reported a failure that read like the application misbehaving. That is now checked up front, by actually opening a camera, and reported as a named skip with the fix rather than as a mysterious failure twenty minutes in.

`DEPLOYMENT.md` now lists all twenty-three with what each one proves, and a test keeps that list honest: adding a new verification without adding it to the runner fails the test rather than quietly never being run.

---

## The media library, with a picture actually in it

Uploading a logo or a headshot is one of the few things in here that is purely for you, and until now **nothing had ever put a file in it successfully**. The screen had been checked many times and checked *empty* every time, so what was being measured was the "nothing uploaded yet" message, under the name of the real screen.

An image is now uploaded through the real form on a phone-sized screen, and what appears afterwards is looked at properly:

- **The picture actually appears.** This sounds too obvious to check. It is not: a broken image shows up as its description text, which has a size and a colour and passes every other check on the page while showing you nothing at all. It is now confirmed that the browser genuinely drew the image, at the size the record says it is.
- **What was hidden in the file is gone from what your browser receives.** The test file has a street address buried in four separate places inside it — the kind of thing a phone photo carries. §13.2 promises that is removed before anything is written to disk. That promise was tested against the code before; it is now tested against the actual bytes a browser downloads.
- **The address printed under the image works.** That is the line you would paste into an email template, and nothing had ever followed it.

### And a problem worth knowing about

The first time this ran, the picture did not appear — and the reason turned out to be the *test file*, not the application. Every sample image in this project was built to be readable by a person rather than by a browser: correct in shape, deliberately wrong in its checksums. That was a sensible trade for everything that had read one until now, and it quietly meant this particular question could never have been asked.

One genuinely valid sample image has been added, and the others deliberately left as they were. So the media library is now confirmed to store pictures that browsers can actually display — which, for a library of logos and headshots, is the whole point of it.

---

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

- **Replace a published video.** It takes the published one down and the new one arrives unpublished, so you watch it in place before anyone else does. The screen warns you before you upload. Your caption and transcript are carried across. *(This is now driven by machine — see below. It was described here for three weeks before anybody had actually done it.)*
- **Remove one altogether.** The row goes and so does the file. This is the only control in this part of the application that actually deletes anything, which is why it now has checks of its own.
- **Sign in as the owner rather than the operator.** You can watch the video. You cannot record, replace, publish or delete one — it is David's, and the buttons refuse you rather than hiding.
- **Suspend an investor's account** and try their portal. The video goes with everything else.

**And the recorder itself is now driven by a machine, which it never was before.**

```bash
pnpm build && pnpm verify:recorder
```

A hundred and four checks. It signs in as the owner and confirms he is offered no camera at all — and that the upload address refuses him too, not just the button. Then it signs in as David *before* he has finished setting up, confirms he is sent to the setup screen, walks all six setup steps through the real forms, and only then reaches the recorder. Then it turns the camera on, turns it off, records, watches the timer count, stops, plays the recording back, discards it, records another, keeps that one, and checks that the file on disk is exactly the file that was recorded.

Two of those checks are worth calling out because they are about the camera light rather than about the video:

- **Turning the camera off stops it,** rather than only hiding the picture. A page that keeps a camera open behind a hidden video element is the sort of thing that makes a person stop trusting a website, and nothing had ever confirmed this one does not.
- **Walking away from the page stops it too.**

Both were confirmed by deliberately breaking the code that releases the camera and watching the run go red before putting it back.

**It also found the worst mistake in this whole run of work, and it was one this build had made a week earlier.** The security headers added recently needed a small piece of code to run on every request. That piece of code brought a default with it: any file posted to the application larger than 10 MB was quietly cut off at 10 MB. Not refused — *cut off*, and then stored, with a success message. A video is allowed to be 64 MB. So for about a week, any video longer than a minute or two would have been saved broken and nothing would have said so. It was invisible to every existing check, because no check had ever posted anything that big. Fixed, with a test that fails if the limit ever slips back below what a video is allowed to be.

The run also now covers what happens after the recording: saving a caption and transcript, publishing, and taking it down again. The important one is proved from a real investor's browser rather than from the database — **before you publish, an investor asking for the video directly gets exactly the same "not found" as somebody asking for a video that was never recorded.** Not a "you are not allowed", which would confirm there is something there. The two responses are compared character by character.

> **The setup screen had never been opened by any automated check until now** — it is David's alone, and every other browser check signs in as Michael. Walking through it also proved something worth knowing: **finishing setup stores the sending address and password but does not mark the connection as working.** Sending stays blocked until the connection is actually tested, which is the correct order and is now checked rather than assumed. The run uses an obviously fake password and puts your real settings back when it finishes.
- **Leave the caption and transcript empty.** The screen tells you that anyone who cannot play sound gets nothing at all from the video. Fill them in and they appear on the portal as text, in full, not hidden behind a control somebody has to find.

**The last two controls, finally driven.** Two things had been described on this page for weeks without anybody having done them, and both are now walked end to end:

- **Recording over a video that is live.** The run publishes one, records another over the top of it, and then checks every clause of the warning on the screen: the live one comes down, the new one arrives unpublished, the caption and the transcript you typed survive, the old file is deleted and the new one is there. Then it asks *from a real investor's browser* for the video they could watch a moment ago — and gets the same "not found" as for a video that never existed. Not "that has been replaced". The same nothing.
- **Removing one altogether, while it is published.** The row goes, the file goes, the investor gets the same nothing again, and the portal shows no gap. Removing something nobody could see would have proved very little, so it is done from the live state on purpose.

**And one of the existing checks turned out to be watching the wrong thing.** The check that a video taken down really is out of reach had been reported green twice. Run four times in a row it failed twice, with the video still being served after the database said it had been taken down — which, if it had been true, would be the most serious thing in this section. It was not true: the check was waiting for the *screen* to update and then asking, and the screen and the database do not change in the same instant. It now waits for the database, which is what every other check in that script already did. Three runs in a row, clean.

That is worth reading twice, because the lesson is not about videos. A check that waits for a page to look right is not the same as a check that waits for something to *be* right, and the first kind can pass for months.

**And then the reason turned out to be worse and more interesting than that.** Chasing it properly meant measuring rather than reasoning, so a nine-line throwaway script loaded the sign-in page in a real browser and asked it how much text it had. The answer:

- What a person can read on that page: **294 characters.**
- What the check was reading: **8,646 characters.**

The other 8,352 are invisible. Every page in this application ships a second copy of itself, in a script tag, for the browser to work from — that is how the framework does its job, and it is completely normal. But a check written to ask "is this word on the page?" the way these were was reading that hidden copy as well, and it *never changes* when part of the page updates. So the check was looking for a word that had been sitting in the invisible copy since the page loaded. It found it instantly, every time, and then went on to test something before it had happened.

Thirteen checks across four scripts were reading pages that way. They have been split into two, because two different questions were being asked and the answers are opposites:

- **"Is the operator told this?"** — now reads only what is actually drawn on the screen. A check of this kind that reads the hidden copy can pass on words nobody can see.
- **"Did anything about another investor reach this browser?"** — now reads *everything* the browser was sent, hidden copy and link addresses included. A check of this kind that reads only the screen can pass on a name that was sent and merely not displayed. Three checks about what an investor's browser receives are stronger than they were yesterday.

**All thirteen still pass**, which is the honest headline: the hidden copy had made exactly one check unreliable, and the rest were asking about words that really were on the screen. What was worth fixing was the method, and there is now a test that fails the build if anybody reads a page the old way again.

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

## Two upload limits that did not work, and a page that was never written

**This is worth testing yourself, because it would have bitten you on your first real document.**

The media screen says images can be up to 5 MB. The documents panel says a PDF can be up to 20 MB. Neither was true. Anything over **1 MB** was refused by the framework before the application ever saw it — and the refusal was silent. No message, no error, the form simply sat there as though the button had not been pressed. A 3 MB photograph and a 2 MB PDF both behaved that way.

It had been like that since documents were built. Nothing caught it because nothing had ever uploaded anything bigger than a test fixture of a few hundred bytes. It was found by finally trying it.

**Try it now:** upload an image of about 3 MB on **Admin → Media**. It should upload and tell you how much hidden metadata it removed. Then try one over 5 MB: you should get *"That file is 6 MB and the limit for an image is 5 MB. Nothing was stored."* — the application's own sentence, naming both numbers. That is the difference between a limit and a silence.

**And the error that revealed it revealed something else.** When the upload failed, the page it fell through to was the framework's own plain "404 / something went wrong" screen — black text on white, no Flipit wording, no colour, no link to the verification page. It had also stopped being styled at all, because of the security tightening described earlier.

There are now proper pages for both: **type any address that does not exist** and you get a Flipit page that says there is nothing there, does not tell you whether it is because the page is missing or because you are not allowed, and points you at the verification page. That last part matters — the moment a page fails is the moment somebody looks hardest at what they are looking at, and an unrecognisable failure on a page about somebody's investment is the worst possible time to look like anybody else's website.

### And then the same thing was true one size up

The paragraph above was written after fixing the 1 MB limit. It described the fix as done. **It was done for files up to 24 MB, and silent above that** — and nobody had tried, because nobody had tried anything over 1 MB either.

The numbers, in order: an image may be **5 MB**, a spreadsheet **5 MB**, a PDF **20 MB**. The framework will accept a request of up to **24 MB**, which is what the last fix raised it to. Your file picker will hand the browser a **200 MB** file without comment. So everything between 24 MB and whatever is on your disk went straight back to doing nothing at all — no message, form untouched, exactly the behaviour that had just been fixed one band lower.

**Two things have now happened.** The first is that all three screens check the size *in the browser, before sending anything*, and say the same sentence the server would have said. The second is that this is now driven by a real browser with real files, which is how the gap was found: `pnpm verify:uploads` chooses a 3 MB PDF, a 20 MB PDF, a 21 MB PDF and a 30 MB PDF in turn, and checks both what you are told and whether anything was actually sent.

**Try it yourself, on any investor's *Documents* panel:**

- **A PDF of a few megabytes.** Uploads, arrives *not issued*, and the card shows its size. This is the thing that was impossible before either fix.
- **A PDF of about 19 MB.** Also uploads. This is the one that matters most, because 20 MB is the number printed on the screen, and until now that was a promise the application could not keep.
- **A PDF over 20 MB.** *"That file is 21 MB and the limit for a document is 20 MB. Nothing was stored."* — and it is refused **instantly**, because your browser checked before uploading. You do not sit and watch a progress bar for a file that was never going to be accepted.
- **A PDF of 50 or 100 MB, if you have one.** Exactly the same sentence. That is the point: there is no size at which the screen goes quiet.

The same is true of **Admin → Media** and of the **import** screen. And the server has not become more trusting: it still reads every byte that reaches it and still refuses on its own account. The browser check saves you the wait and gives you the sentence; it is not what makes the limit true.

---

## Three checks that could not be run — and one that said so wrongly

There is an earlier section on this page called *"Six checks that existed and could not be run"*. This is the same thing one level down, and it was found by simply trying to run everything.

`pnpm verify:uploads`, `pnpm verify:viewport` and `pnpm verify:recorder` all drive a real browser. On this machine all three died before they started:

> **Executable doesn't exist at .../chromium_headless_shell-1234/...**
> Looks like Playwright was just installed or updated. Please run the following command to download new browsers.

There *was* a perfectly good browser on the machine. It simply had a different version number than the one the testing library expected, and the three scripts had no idea to look for it — **while two other scripts in the same folder did**. `pnpm verify:account-access` and `pnpm verify:erasure-bytes` each carried a small piece of code that says "try the expected one; if it isn't there, look in the four places a browser usually lives". It worked. It had been written twice. It had been copied to none of the three scripts that needed it.

And `pnpm verify:all` — the command whose whole job is to run all twenty-three checks and shout if any were skipped — held a fourth copy of the same launch. So it reported *"Chromium will not launch"*, skipped those scripts, and filed it under "your machine is missing something" rather than "this repository has the fix and did not use it".

**There is now one place that decides which browser to use**, and every script goes through it. A test enforces that: adding a sixth script that launches its own browser fails the suite.

The effect is not subtle. Those three commands run **704 checks** between them (**753** now — see the two sections below) — every file-size limit at real sizes, every screen at 375 pixels, and David's video recorder driven with a synthetic camera. All 704 were unrunnable here and all 704 pass. And `pnpm verify:all` now prints what actually happened:

```
  note  Playwright's own build is absent; using /opt/pw-browsers/chromium
  browser    Chromium 141.0.7390.37 launches
  camera     a synthetic camera opens
```

**And with that fixed, `pnpm verify:all` was run to the end for the first time on this machine:**

```
  25 passed, 0 failed, 0 skipped — 5 minutes
```

Zero skipped is the number that matters — the three scripts above are in that list.

**One thing about running these yourself.** `pnpm verify:viewport` needs somewhere to put a file, and will stop with *"a media store is configured for this run — set MEDIA_STORE in .env"* if you have not set one. That is the script being honest rather than measuring an empty library and calling it a pass — set `MEDIA_STORE="filesystem"` in `.env` and it runs.

---

## A warning that was on the wrong page

Every admin screen has a banner at the top when something needs a person. It is fed by a short list of checks — deliberately short, because it runs on every page load.

**A storage bucket that keeps what it is told to delete was not on that list.** It appeared only on **Admin → System health**, which you have to go and open. Meanwhile a file of the wrong size *did* raise the banner.

That is the wrong way round. The versioning problem is the one that makes an erasure a lie: the application deletes an investor's signed agreement, the bucket writes a note saying "deleted" and keeps the file, and every check in the application passes. It is the most serious thing this report can find and it was the quietest.

It is on the banner now, and there is a test that walks five different storage states and insists that anything serious enough for the health page is also on the banner — so the next check added to one cannot quietly miss the other.

---

## A check that could not fail

This one is worth reading even though nothing you can see has changed, because
it is the least visible kind of defect there is.

`pnpm verify:viewport` opens every screen in a real browser at phone size and
measures it. One of its checks is about the orange banner at the top of the
admin screens — the one that appears when something needs a person. It induces
three faults, confirms the banner appears and says the right things, puts the
faults back, and then confirms **the banner has gone**.

That last check had passed every time it had ever run. The banner was still
there every time.

The test database had never recorded a completed reminder run, and the
application quite correctly says so — *"No reminder run has ever completed."*
That is one thing needing a person, so the banner read **"One thing needs you"**.
The check was looking for the words **"things need you"**, in the plural. The
singular is a different sentence, so the check could not match it — and a check
that cannot match cannot fail.

Two things came out of that. The banner is now recognised in either of its two
sentences, everywhere it is asked about. And the test database now records a
completed run, so it starts **healthy** — which means every screen measured by
that script had, until today, been measured with an orange banner across the top
of it, and the ordinary quiet version had been drawn by nothing.

**How it was proved.** The completed run was taken back out and the script run
again: five checks failed, including that one. It has now failed once, which is
more than it had managed in its entire existence.

---

## The half-finished erasure, on the screen

Erasing an investor is the one thing in this application that cannot be undone,
and it is the one thing that can go half-done: the stored files are destroyed
first, on purpose, because the other order would leave a signed agreement in a
bucket with nothing pointing at it. If the storage refuses part way through, the
files are gone and the record still describes the investor in full.

The application already noticed that and put it on two screens — a line on
**Admin → System health**, and a count in the banner. **Neither had ever been
looked at in a browser.** They were proved by testing the rule that produces the
words, which is not the same as opening the page.

They have now been driven, at phone size, with a genuinely half-erased investor
in the database. Forty-nine checks. The ones worth knowing about:

- **The banner says two things need you, names "erasure", and names it once**
  even though two separate findings are behind it.
- **The banner carries no account, no name, no address and neither count.** The
  finding itself names the account — deliberately, so you can find the record —
  and the banner is meant to carry the subject and nothing else. This is the only
  place that separation is actually checked.
- **The health page carries both findings and, importantly, both remedies.** They
  are different: a storage refusal means *run the erasure again*; a run that
  died mid-way means *look at the name first, and if it is already a pseudonym,
  suspend and unsuspend to sign them out everywhere*. A screen showing one
  remedy under the other's headline would have somebody destroying more of an
  investor's data than they meant to.
- **The claim the warning makes about every other screen is now checked.** The
  warning says the database was not touched and every screen still shows an
  ordinary record. The same run opens the investors screen and confirms exactly
  that — the investor is there in full, with nothing to suggest an erasure was
  ever attempted. That is the whole reason this is a red warning rather than a
  note, and until now it was only a sentence.
- **A record written by a future version of the application still raises the
  warning**, and reports its count as *"at least 7"* rather than pretending it
  knows the total.
- **Record a completion for each, and the banner goes.**

Every line the check writes into the audit log is removed afterwards, and it
checks that it was.

---

## The next rule to go missing

There is a section above about a storage bucket whose warning was on the wrong
page. The fix included a test — and that test names the storage rule. So it
would catch the same mistake again, and it would not catch the same mistake
made one rule along.

That is now handled differently. There is a check that asks the question
**without naming any rule at all.**

The banner at the top of the admin screens is a short list, on purpose: it runs
on every page load, so it is only allowed to ask the questions that are cheap to
answer. Several warnings on **Admin → System health** are legitimately absent
from it because answering them means another trip to the database. That is a
cost decision, not a mistake.

So the check holds the cheap facts still, changes everything expensive
underneath, and watches what each rule answers. A rule that gives the same
answer every time never looked at anything expensive — which means the banner
could have shown it, and if the banner does not, that is the mistake. The rules
are found by looking through the code rather than listed, so **a rule written
next year is covered the day it is written**, with nobody having to remember.

**How it was proved.** Three deliberate breakages. The erasure warnings taken
off the banner: caught. The storage-bucket warning taken off the banner — the
original mistake, put back deliberately: caught. And a brand-new warning that
did not exist when the check was written, added to the page and not the banner:
**caught, and named.** That last one is the whole point.

---

## Twenty-two more checks that could not fail

The section above describes one check that could not fail, found by accident.
That raised an obvious question, and asking it properly gave an uncomfortable
answer: **twenty-two more**, all of the same two shapes.

The first shape is a quirk of the language. Asking "is every one of these
things true?" about a list with **nothing in it** gives the answer *yes*. That
is correct arithmetic and wrong for a check, because in these scripts the list
is almost always the result of a database query — so an empty list does not mean
"everything passed", it means "there was nothing there to look at".

The clearest example is the check that an erasure did not touch anybody else's
data. It asks "are the other investor's messages all still intact?". If a bug
deleted that other investor's messages **entirely**, the list is empty, and the
check says yes. **The worse the bug, the more likely it was to go unnoticed** —
which is precisely backwards.

Twenty-one checks were written that way, including the one that proves the
stored files are actually gone after an erasure, the one that proves the
neighbour's files survived, the one that proves a suspended investor's screen
carries nobody's email address, and the one that proves no other investor's
certificate is visible.

The second shape is an ordering check. A warning about a stuck reminder is
supposed to tell you to run the lock probe **before** it suggests rescheduling,
because rescheduling something that is genuinely still in progress is how a
message gets sent twice. The check compared where the two sentences appeared in
the text — and if the first sentence is deleted altogether, the comparison still
comes out in the right order. So the check was satisfied by the advice being
missing.

All twenty-two now go through a shared helper that treats "nothing to look at"
as a failure, and there is a check that fails the build if anybody writes the old
form again — the same guard that already exists to stop a script launching its
own browser.

**How it was proved.** The lock-probe sentence was deleted from the warning. With
the new check: one failure, named. With the old check restored and the exact same
deletion: **nothing failed at all.** Same defect, same run, one form catches it
and the other does not.

All twenty-five checking commands were run afterwards — **25 passed, 0 failed, 0
skipped** — so none of the twenty-one had been quietly depending on finding
nothing.

---

## And the same mistake upside down

The section above is about checks that ask *"is every one of these true?"* of an
empty list. There is a mirror image, and it is where the privacy claims live.

Asking *"is any one of these Bruno's document?"* of an empty list gives the
answer *no* — so a check written as **"and Bruno's document is not on Alice's
portal"** passes when Alice's portal is showing her nothing at all. That is not
the claim. The claim is that Alice sees her own things and not other people's,
and a version of it satisfied by Alice seeing nothing is worthless.

Twelve checks were written that way. The important ones are exactly the privacy
promises: Bruno's document not on Alice's portal, Bruno's document not in
Alice's group on the operator's screen, and an update sent to one investor not
appearing in anybody else's feed.

Six of them now check against a **control** — Alice's own document is there and
Bruno's is not; the general update is still in both other feeds and the targeted
one is not. That is a stronger statement than the original: it proves the list is
being filtered, rather than merely coming back empty.

The other six are cases where an empty list is the honest answer — a draft that
nobody has been sent yet, an update that was withdrawn and was the only one
there, a deleted file in a bucket that holds nothing else. **Those now carry a
written note saying so, and naming the neighbouring check that stands in for a
control.** A gap somebody wrote down is a different thing from a gap nobody
knows about.

**How it was proved.** Every investor's update feed was made to come back empty.
The new form failed and named the check; the old form said *ok*. Same defect,
same run.

---

## A command that breaks the application on purpose

There is now a twenty-sixth checking command, and it is the odd one out:
`pnpm verify:mutants`. Every other command checks that the application is right.
This one checks that **the other commands would notice if it stopped being
right.**

The three sections above were all found the same way — by breaking something
deliberately and seeing which checks went quiet. That worked every time it was
tried, and nothing was running it, so the answer went stale the moment somebody
stopped looking.

The command holds a short list of promises this application makes, each with the
smallest possible change that would make it a lie, and the check that is supposed
to catch it:

- **Money is never handled as an ordinary computer number** — the percentage
  calculation switched to one.
- **The operator can never sign off a compliance approval** — the operator
  allowed to.
- **Nothing real is sent from a testing deployment** — that refusal switched off.
- **An erased investor keeps no name** — the replacement name made to keep it.
- **An update sent to one investor appears on nobody else's portal** — every
  portal feed made to come back empty.

...and two more. For each, it breaks the code, runs the check, **puts the code
back**, and reports a failure if the check said everything was fine. All seven
are caught, and six of them are also checked for saying *which* thing broke,
rather than just failing.

It is careful with your files: it reads the original before writing anything,
puts it back afterwards, reads it again to confirm, and restores if you press
Ctrl-C. It never uses git to undo, so uncommitted work of your own is safe.

**It now holds fifteen promises, and eleven of the twelve items on the release
checklist have one.** Among the newer ones: no send can skip the compliance
approval; one investor in a country the approval does not cover must not stop
everybody else's invitation; sign-in links are stored scrambled rather than as
themselves; a suspended investor cannot be issued a fresh link; and no page but
the anti-phishing one may be indexed by a search engine.

### And it immediately found something

One promise was **not** caught: *a published question and answer carries nothing
that identifies who asked it.*

That rule is enforced in two places on purpose — once when the answer is saved,
and again when the shared page is drawn. The first was thoroughly checked. The
second had never been checked at all, because nothing in the existing tests
could produce the situation it guards against: the save refuses to create it.

So a row was written into the database directly, the way a hand-run correction
or a future piece of code might: published, answered, asked by an investor, with
no rewritten public version. The shared page must refuse it — and it does. There
are now three checks saying so, including one that the investor's original
wording does not appear anywhere on the page.

That is the mutation command earning its place on its second run: it found a
real defence that nothing had ever tested.

A second promise later turned out to be a different case, and it is worth
knowing the difference. A related rule — a withdrawn question must not reappear
on the shared page — is also enforced twice, and the second enforcement is
deliberately unreachable from the page: it exists for code that has not been
written yet. That one was already tested, just not by the command it had been
paired with. So the pairing was corrected rather than a new test invented.

**A promise that goes uncaught means one of two things** — a defence nobody has
tested, or the wrong check named beside it — and the temptation with the second
is to quietly delete the entry. Both outcomes are now written down where the
next person will read them.

### One more thing it caused

Running all twenty-six commands failed once, in the middle of three runs that
passed. The cause was this new command: it breaks the code on purpose, so the
checks it runs fail on purpose, and a check that fails part way through does not
always tidy up the test data it created. It was sitting in the middle of the
list, so its mess was in front of ten commands that had not run yet.

It runs **last** now, and there is a note in the code explaining why, so that a
later tidy-up that sorts the list alphabetically does not quietly bring the
problem back. Three clean runs since.

**How it was proved.** One promise was deliberately paired with a check that
could not possibly see it: *"MUTANT SURVIVED — the check reported success"*. And
one of the code snippets it looks for was misspelled: *"NOT APPLIED"* — so a
promise it can no longer find is reported, rather than quietly counted as passed.

### The last item on the release checklist

Of the twelve things on the release checklist, eleven had a promise on that list
and one did not: **no line this application writes to a log may contain a
password, an email's contents, or an API key.**

It had been left because it is not a rule about one piece of code. It is a rule
about *every* place in the whole application that writes anything down, and there
is no single line to break. That is true, and it turned out not to be the end of
it — a rule about every place is a rule about the **list** of places, and a list
can be written out.

So there is now a check that reads every file in the application and every one of
the checking commands, finds all **447** places that write to a console, and asks
of each: does it print anything whose name is a password, a token, a key, or the
contents of an email? None of them do. It also holds a list of **the two files in
the application that are allowed to write anything at all** — the health signal's
fixed one-line message, and the seed command you ran at setup — each with a
written reason. A new one anywhere else fails the check until somebody says why
it is there.

There is one deliberate exception and it is now named in writing: the seed prints
the one-time setup links, tokens and all, to the screen of whoever ran it. That
is how you got your password-setting link in the first place, it is single-use
and expiring, and it goes nowhere but that terminal.

**All twelve items on the release checklist now have a promise on the list, and
this one has five of them.** Three switch off a defence — the class that keeps a
password printing as `[redacted]`, the cleaner that strips one out of an error
message handed back by Google, and the refusal to write an email body into the
audit log. The other two do the opposite: they **add** the mistake — a line
printing the email's contents in the middle of the sending code, exactly where
somebody debugging a send would leave one behind — and check that it is caught.

### What that new check found about itself

On its first run it reported the application completely clean, and it was wrong
twice.

Once harmlessly: it read a *sentence* in a report about storage buckets that
happened to contain the word "question", and flagged it as an email's contents. A
check that cries wolf on ordinary English is one somebody eventually switches
off, so it now tells the difference between a name in the code and prose in a
message.

Once not harmlessly at all. One of the checking commands contains a piece of
pattern-matching with quotation marks inside it. The new check misread those as
the start of a quoted message and from there stopped reading properly — it
skipped five hundred lines, and **fourteen real places that write to a log went
unexamined**. It reported a cleaner application than the truth, in exactly the
words a genuinely clean one uses.

That is the fourth time in this project a check has reported success about
something it was not actually looking at, and the first time the thing it was not
looking at was **its own input**. It is fixed, the count of examined lines went
from 413 to 447, and there is a test that would catch it happening again.

### And a second way of writing to the screen it had missed

There is another way to print something that does not go through the usual one,
and two of the commands use it — one to show you a long check's progress as it
happens, and one to print a bare setup token so an automated check can pick it
up. That second one is a **second place a token is printed on purpose**, and the
check that claimed to have listed every place this application writes anything
did not know about it.

Both are now on the list with their reasons, and there is a check that neither
of them is in the application itself — printing this way inside a live page
would be a log line with the rule taken off it. The count went from 447 to 449.

---

## "There are none of these" needs something to compare against

Three times now, a check in this project has reported success about a thing it
was not looking at. This is the third, and it is the same shape as the first two.

A check that says **"every session was ended"** was written as *count the
sessions still alive; there should be none*. That passes when every session was
ended. It also passes when there never was a session to end, and when the
question being asked stopped matching anything after an unrelated change. The
sentence being reported — *changing your address logs out the old mailbox* — can
be false while the check is green.

The fix is the same one used twice before: **prove there was something there**.
Five checks now compare against a control in the same run:

- Moving an address runs the same two questions **before** it moves and after —
  there was a live session and a live link, and now there are none.
- A suspended investor's question page is checked against **another investor's,
  loaded at the same moment**. That one also proves the page went blank because
  of the suspension rather than because the page stopped working for everybody.
- Another investor's offer carries no acknowledgements — checked beside the
  offer that does carry some.

**How it was proved.** The question page was broken so that it returned nothing
to *anybody*, and the check run in both forms against that one defect:

- The old form: *ok — a suspended account sees no shared entries.*
- The new one: *FAIL — the control sees a shared entry and a thread of their own.*

Green and worthless, red and right, on the same defect in the same run. Both are
now permanent entries in the break-it-on-purpose command, which holds
twenty-two promises.

---

## Things worth knowing

- The `ENCRYPTION_KEY` and `AUTH_SECRET` in your local `.env` are throwaway development values. Generate fresh ones for anything real.
- No email is ever sent to anyone but the operator's own address during development.
- The application refuses to send real invitations unless its configured base URL is the production one. Every portal link embeds the domain it was issued from, and a link issued from a testing deployment dies the moment the application moves.
- Uploaded images and video are stored on disk only if you set `MEDIA_STORE` in `.env`. With it unset, the two upload screens say so and everything else works.
- An erasure cannot be undone, and it is the only thing in the application of which that is true. Everything else — suspension, closure, withdrawing a document, voiding an approval — keeps the record and changes its state.
- The colours are taken from the FLIPIT demo file, which is a faithful copy of the live site but not the source of truth. Somebody should check them against flipit.com before launch.
- The invitation email and the participation certificate are light-coloured documents rather than dark ones, and that is deliberate: an email has to be readable in every mail programme, and a certificate has to print.
