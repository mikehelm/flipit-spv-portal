# What you can try right now

Rewritten after every work package, so it always describes the current state.

**Current state: work packages 0 to 14 are complete.** You can sign in, import a spreadsheet of recipients, see the email each one would receive with their real figures, record a compliance approval, walk the pre-flight checklist, send an invitation to one person at a time, follow the link in that invitation into the investor's own private portal, ask and answer questions — privately to one person, or published to everyone with the asker removed — keep a register of interest that can turn into a real offer, publish updates to everyone, to a subset, or to one person, queue automatic reminders for people who have not answered, walk an investor along the eight-step timeline, record that their funds arrived, and hand them a participation certificate as a PDF. Sending a real email needs a Gmail app password, which nobody has connected yet — everything up to that point works.

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
- At `/portal/signin`, ask for a link with an address that has a record, and then with one that does not. The answer is the same sentence both times.
- Suspend an investor. Their session dies on their very next click, their unused links stop working, and asking for a new one is accepted politely and produces nothing.
- Close an investor's account. By default they can still sign back in and read their own record — an investor who has sent money should not lose the record of it.
- Look at a timeline step that has not been reached. It says "Not yet reached. There is nothing for you to do at this stage." and shows no amount, no date and no blank where one would go.

**What an investor cannot see, by design:** that any other investor exists. No count, no total raised, no position in any queue, and no wording that hints at any of it. The code that loads their page is bound to their own account and never loads anybody else's data at all.

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

## What is not built yet

- **Documents.** Uploading and issuing the subscription pack is still to come.
- **The email carrying a sign-in link.** The link is created correctly; sending it is part of a later package.
- **Two-factor sign-in.** The specification makes this mandatory before the production deployment sends anything real, so it is a release gate rather than an optional extra. The database is ready for it; there is no code behind it yet.

The export was built early, out of order, in a parallel session. It is in the codebase and tested, but it is not yet linked from anywhere you would find by clicking.

---

## The verification page

Open `/verify` without signing in. This is the one page in the whole application that is meant to be public and indexed, and §15.1 explains why: an unexpected email asking about an investment, with a link, from an address you may never have seen, is indistinguishable from a scam — because that is what a scam looks like. So there has to be somewhere to check.

It names Michael and David, the exact address invitations come from, the exact domain every legitimate link uses, what the email will and will not ever ask for, a standing warning that payment details are never changed by email, and how to verify by another route entirely.

It is linked from the invitation footer, the portal, the portal sign-in page, the dead-link page and the front door — and it works if you simply type the address, which is the point.

**Everything else is invisible to search engines.** Visit `/robots.txt` and `/sitemap.xml`: the sitemap has exactly one entry, and robots.txt disallows everything except the verification page. Every other page also carries a `noindex` tag, and every response — including a downloaded certificate PDF, which no meta tag could ever reach — carries a `noindex` header.

---

## Things worth knowing

- The `ENCRYPTION_KEY` and `AUTH_SECRET` in your local `.env` are throwaway development values. Generate fresh ones for anything real.
- No email is ever sent to anyone but the operator's own address during development.
- The application refuses to send real invitations unless its configured base URL is the production one. Every portal link embeds the domain it was issued from, and a link issued from a testing deployment dies the moment the application moves.
