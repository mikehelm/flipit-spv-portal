# Open Decisions

**Version 7.0 · 2026-07-27**

> **Every statement in this document has now been checked against the code**, one
> at a time, and five of them were wrong. That is the point of this version.
>
> It was written as *"before the build starts"* and dated 2026-07-25, and the
> build has been moving underneath it for two days. A note written for a person to
> act on is a claim like any other, and this one was being held to nothing while
> every check in the repository was being held to *"would this still pass if the
> thing it names were absent?"* Items 4, 6 and 12 had quietly stopped being true,
> item 1 was true of the mechanism and wrong about the default state, and one line
> in the settled list contradicted another seven lines below it.
>
> What each item is now marked with: **verified** means somebody read the code
> and it says what this says. **Corrected** means it did not.

Settled in v2: owner is Michael Helm `mike@flipthepage.com`; operator is David Serene `serenedavid@gmail.com`; investors hold persistent accounts; the two pre-launch gates are specified in Build Spec §8.

What follows is what still needs an answer. Ordered by how much rework a late answer causes.

---

## Settled on 2026-07-25

- Sender: `serenedavid@gmail.com` · one-at-a-time sending, no bulk send · 15–40 recipients
- Same response deadline for everyone
- Automatic reminders to non-responders: **in v1**
- AI-assisted spreadsheet import with an owner-supplied API key: **in v1**
- ~~Hosting: `invest.flipit.com`~~ — **superseded** by the line below, which is the current answer. Managed Postgres, roughly USD 20–50/month. (The old hostname also survives in BUILD_SPEC §11.3, in the line about where email images are served from. It is stale there too and is not marked as superseded — worth a one-word fix to the spec next time it is open.)
- Retention: indefinite — the portal becomes David's ongoing surface for SPV members
- Compliance: David, via the BVI/HK formation agents
- Branding: FLIPIT palette from the demo file, plus an admin image library
- Optional personal video from David, previewed and published by him
- No round-progress or other-investor visibility until after the round closes
- Funds received: recorded by David alone
- Hosting: **`mikehelm.com/SPV`** to test, **`spv.flipit.com`** before anything is sent
- Owner sign-in: both `mike@flipthepage.com` and `mike@flipit.com` allowlisted
- AI: **OpenAI**, key entered in-app by Mike, used transparently by David, with a spend cap
- David's contact method (phone / WhatsApp / email-only) collected at operator onboarding
- Round closes when **David presses the button** — the app reminds him, never closes it for him
- Invitation is a **designed HTML email**, not plain text
- Build: **in-house, here**
- **Shared Q&A**: investors ask, answers private by default, David ticks a box to publish anonymised — **visible from the start**. *Verified: visible during an open round by default, the switch is owner-only, and hiding it queues entries rather than losing them.*
- Extras in v1: **participation certificate PDF**, **anti-phishing verification page**, and a **register of interest** (§5.2) — explicitly non-promissory. *All three built and verified; the register's non-promissory sentence is locked to the spec by a test, and the word "waitlist" is asserted absent from everything an investor sees.*
- US recipient: **held**, with an in-app explanation to David
- No hard close date — David closes when ready
- Product demo in the portal: **decide after seeing the build**
- **Sending is Gmail SMTP with an app password** — no Google verification, no wait, no 7-day expiry

---

## Still open — in priority order

### 1. The US recipient — get advice before sending to them

**Corrected.** Still the highest-risk item, and the recommendation is unchanged: **send to the other recipients, hold the US one pending advice.** One conversation, one person delayed; the alternative is unwinding an offer already made.

What was wrong was the sentence *"the app blocks that recipient by default while everyone else proceeds."* Half of that is right and the half that is wrong matters:

- **The per-recipient block is real and structural.** Compliance is evaluated one offer at a time and a block is written to that one offer row. A held recipient stops that recipient and leaves the batch alone — this is checked in three places and is one of the twelve questions asked of every change.
- **There is no US-by-default rule.** The block is entirely data-driven off the countries on the recorded approval. The only US-specific thing in the codebase is the *wording* of the refusal an operator reads.
- **And the default state is not "everyone else proceeds" — it is nobody proceeds.** The seed ships an empty approved-country list, and with no approval recorded the gate refuses every send to everybody. The US recipient will be blocked because the US will not be on the list, not because the code singles them out.

### 2. ~~Google verification~~ — no longer needed

**Verified.** Sending goes over Gmail SMTP with an app password (spec §8.1). No Google review, no waiting period, no demo video, no 7-day expiry. **This is off the critical path entirely.** All David has to do is turn on 2-Step Verification if it is not already on, and generate an app password — a two-minute job the onboarding walks him through.

One thing to know that this item did not say, because it is the application's rule rather than Google's: **the app tests the connection and the test goes stale after twelve hours.** Sending refuses on a stale one and the onboarding re-tests in a click. Long enough that David is not re-testing between two sends; short enough that a password revoked this morning cannot still be trusted this evening. (The Gmail-API path still exists as a named stub that refuses; there is no OAuth code anywhere and no `googleapis` dependency.)

The only remaining item on the critical path is the compliance approval below.

### 3. Confirm the formation agents are reviewing the *email*, not just the structure

BVI/HK formation agents set up the SPV. That is not the same as approving the wording of a solicitation sent to named individuals in their own countries. Worth one direct question to David: *has anyone read the investor email and confirmed we can send it to these particular people, in these particular countries?*

**Verified: nothing sends until that approval is recorded**, and recording, amending and voiding one are all owner-only — the operator can do none of the three. Reminders are gated against their own separate approval rather than borrowing the invitation's. Voiding an approval immediately re-blocks every recipient. The one thing that works without an approval is a test send to the operator's own address, so the template can be prepared meanwhile, and the refusal message says so.

### 4. Approved jurisdiction list

**Corrected — and this is the one to read carefully, because it reads as though the application already knows something it does not.**

There is **no list in the application**. The approved countries are data typed in by the owner when recording the compliance approval, and the seed ships **an empty list**. `Australia, England, France, Thailand, USA (blocked)` is a note about the recipients, not a configuration anybody has entered.

Two practical consequences:

- **Nothing sends until that list is typed in**, country by country, as part of recording the approval. Not one recipient, not to test the batch.
- **It takes ISO country codes, not names.** `AU`, `GB`, `FR`, `TH` — and the defined blocs `EU`, `EEA`, `EFTA`. A country *name* is refused rather than guessed at, deliberately: guessing which country somebody meant by "England" is not a thing to do quietly on a securities offer. So the list to hand to the approval screen is `AU, GB, FR, TH`, with the US absent.

Still to confirm, unchanged: UK financial-promotion rules and Australian small-scale offer thresholds are the usual ones to check.

### 5. ~~David's phone number~~ — resolved, and **verified**

Collected during his onboarding, along with whether he prefers phone, WhatsApp or email only. One precision worth having: choosing **email only** stores no number and removes the phone line from the invitation entirely, rather than rendering it blank.

### 6. ~~Privacy policy text~~ — **corrected: it is written**

`/privacy` renders roughly 490 words of finished prose across eight sections — what is held, what is not, who can see it, email, retention, storage, rights, and what to do about a suspicious message. It reads the configured sending address rather than hard-coding one, and it is deliberately one of only two indexable pages.

**What is left is a read, not a draft.** It makes commitments on your behalf — see item 12, which is where one of them turned out to have no procedure behind it.

### 7. Fallback contact if David is unavailable

The portal's closed and suspended states need an address someone will still be reading.

**Half-answered by the build — and this time every part of that sentence was checked.** All four sub-claims below are true of the code as it stands: the field, both rendering rules, the health finding and the settings refusal. There is now a place to put it — the *service contact address* in settings — and it is rendered where it is needed: underneath the sending address on a suspended or concluded account, and *alone* once the portal is closing or closed, because that is the point at which the sending address stops being monitored. The health report says so when it is empty, and refuses in the settings form for sunset and disabled. **What is still open is whose address it should be.**

### 8. Ask David whether he wants to do a video

Optional, and entirely his call — but it is the highest-impact thing on the list and costs him ten minutes with a phone. **The slot is built and waiting**: he can record it in the browser, watch it back in the real portal layout, and publish it, and until he presses publish no investor can reach it by any means. **Publishing is operator-only — verified.** You deliberately cannot do it for him.

### 9. Confirm the brand palette against the live site

The colours in §13.2 come from your demo file, not from flipit.com directly — the live site returned nothing useful to an automated fetch. A two-minute eyeball check before launch. **Not checkable from here**, and it is the only item on this list that is not.

---

## Raised by the build, and still unanswered

These two have been recorded in PROGRESS.md across several sessions as questions for you. They are here because that is where questions for you belong.

### 10. A forgotten password

Sign-in for you and David is an email address and a password, and **there is no "forgotten password?" link** — deliberately, and the comment in the sign-in page says why: it would answer the one question that page is built not to answer, which is whether a given address has access at all.

What actually happens in each case, checked against the code rather than assumed:

- **David forgets his.** You fix it yourself, in the app. *Operator access* under Admin issues him a fresh single-use setup link, and it works on an operator who already has a password — it does not refuse a re-issue. No console, no database.
- **You forget one of yours.** You have **two owner accounts** — `mike@flipthepage.com` and `mike@flipit.com` — with separate passwords. If you have not set the same password on both, one still gets you in, and from there you can reach everything.
- **You lose both of yours.** This is the only real hole. David cannot help: the invite screen is owner-only, *and* it refuses any address that is not on the operator allowlist, so even a signed-in owner cannot mint a link for an owner address. The only way back is `pnpm setup-link <your address>` on the server console.

So the honest summary is: **one scenario, and only if you use the same password twice.** Smaller than it first looked.

The question is still worth answering before there is a third administrator, because it is the answer that changes then. The options:

- **Leave it**, and write the recovery step into the runbook: *if both owner passwords are lost, run `pnpm setup-link` on the server.* Costs nothing and adds no way in.
- **Use different passwords on your two owner accounts**, which turns the second one into a deliberate spare rather than an accident. Free, and it is what makes the summary above true.
- **Build a reset journey** — a link emailed to the address on the account. This is the one to be careful about: it means the application sends mail to a real address on an unauthenticated request, which is exactly the shape a phishing email takes, and the anti-phishing page (§15.1) exists because you are already worried about that.

Nothing is blocked on this.

### 11. An SPV percentage that will not divide

The application refuses an import file when the **derived** Flipit percentage needs more than six decimal places, and tells the operator to round the SPV percentage in the spreadsheet.

The arithmetic: the indirect Flipit percentage is `spv_percentage × 0.30` (§10). An SPV percentage of `41.666667` — one third of 125%, the shape a three-way split produces — derives `12.5000001`. Seven decimals into a column that stores six, so the file is refused.

**The awkward part is that this happens even when the file supplies the indirect percentage explicitly.** The `indirect_flipit_percentage_override` column exists for exactly this: the operator writes `12.5` and that is the figure stored and sent. The derived figure is discarded — but it is computed and rejected *first*, so the file is still refused, and the message asks the operator to change the SPV percentage, which is a real figure that will appear in an investment document.

**This was reproduced, not inferred.** A two-row file with `41.666667` in it was put through the real import and the application returned one file error, `PRECISION_LOSS`, on that row, with both rows dropped and the Import button disabled. That is also how the defect in the test fixture came to light.

Three ways out. The second is the one that is hardest to argue against — a number that is thrown away should not be able to stop a file — but it is a change in the money path, which is the last place in this application to change anything without you saying so:

- **Leave it.** A file that will not divide cleanly is worth a second look, and a refusal is the safe direction.
- **Skip the derived check when an override is present.** The discarded number stops blocking the file. Narrow, and it only affects rows that supply the override.
- **Keep the refusal and change the message**, so it at least says the override does not rescue the row and why, instead of pointing at a contractual figure.

Nothing is blocked on this. It will only be met by a file with an awkward split in it, and no such file exists yet.

### 12. ~~The privacy policy promises a deletion that has no procedure~~ — built

**Built on 2026-07-27, taking the second of the three options below. This item is closed except for one question that needs advice rather than code, which is set out at the end.**

`/privacy` says two things to an investor, in their own section:

> *"Anyone who would rather their record were removed can say so, and it will be — subject only to anything that has to be retained to meet a legal or regulatory obligation."*

> *"You can ask what is held about you, ask for it to be corrected, ask for a copy, or ask for it to be deleted … it will be dealt with by a person rather than a form."*

When this item was written there was no way to delete an investor record in this application — not owner-only, none — and the complaint was never that the page over-promised. It says *a person* will deal with it, not that a button exists, and a person could. What was missing was that **nobody had written down how**, so it meant somebody typing `DELETE` against a live Postgres holding every investor's figures, improvised, at the moment somebody had asked for something they were entitled to.

**What now exists.** An owner-only erasure, reachable from the investor's own card on `/investors`, and a written procedure in `DEPLOYMENT.md §12` for the cases the screen does not cover.

- **It is pseudonymisation, not deletion, and the difference is stated rather than blurred.** A `DELETE FROM investor_accounts` would cascade into `offers`, which `portal_tokens`, `conversation_messages`, `rounds` and `recipients` then reference with no `onDelete` — the schema fights it, and it should, because an offer is a securities record. So the rows stay, and every direct identifier and every free-text field a human typed is overwritten.
- **One line, applied everywhere:** *free text a human typed goes; structured fields — enums, figures, timestamps, hashes, foreign keys — stay.* The four amounts, the percentages, the stages and the dates are untouched, on every offer. What goes is the name, the address, the notes, the message bodies, the questions, the bank reference and the personalised copy of every email as sent.
- **One thing is genuinely destroyed and cannot be recovered:** the stored bytes of any document package or certificate PDF. There is no pseudonymising a signed subscription agreement. If the media store cannot be reached, the whole erasure refuses before the database is touched.
- **The audit log keeps every event and loses only the address.** No audit row is removed, none is added but the erasure's own; the `actorLabel` on rows the investor themselves wrote becomes the pseudonym, and the erased address is swept out of every metadata object. This is the one write to `audit_events` anywhere in the application that is not an insert from `audit()`, and it is one column.
- **The operator cannot do it, and cannot preview it either.** Suspending and closing are David's and both are reversible; this one is not, so it sits with you alongside the compliance approval. A refused attempt is audited and says why.
- **There is no reason box**, deliberately — this is the one action that must not add new writing about a person to the record. What it asks for instead is the account's own email address, typed out, and a tick.

**The plan cannot go stale.** `src/lib/erasure/plan.ts` names every table in the schema exactly once, with a sentence saying what happens to it and why, and `plan.test.ts` fails on the commit that adds a table nobody has an opinion about. `pnpm verify:erasure` runs the whole thing against real Postgres with a second investor present and checks that one is untouched, column for column — 99 checks.

**What is still open, and it is a question for advice rather than a build:**

> **Is pseudonymisation enough?** Under UK and EU data-protection law, pseudonymised data is still personal data. What this does is the *maximum* that can be done while keeping a coherent securities record — and keeping that record is what the page's own "subject only to anything that has to be retained to meet a legal or regulatory obligation" is for. Whether that clause covers what has been kept here is the formation agents' question, not a developer's. **Two specific calls to put to them**, both taken conservatively and both reversible: the **country** on a recipient row is kept (structured, and it is the compliance record), and the **answer** half of a published Q&A entry is kept while the question is redacted and the entry unpublished (it is David's writing and other investors have read it).

The third option in the original item — **narrowing the wording on `/privacy`** — was deliberately not taken. It remains the one to be slow about: the sentence as written is the ordinary expectation, and narrowing it is a decision to take on advice rather than to save an afternoon.

Related, and corrected earlier: this document used to say deletion was *"currently owner-only"*, which described a control that did not exist. It does now, and it is.

---

## Worth deciding, not blocking

- **Does the raise have a hard close date** the portal should display?
- ~~**Should the shared Q&A be visible during the raise, or held until the round closes?**~~ — **this is answered in the settled list above** ("visible from the start") and it is built that way: visible during an open round by default, with an owner-only switch, and hiding it queues entries rather than losing them. Publishing is anonymised structurally — the object an investor receives has no field capable of carrying an identity. Left here only to note that the two halves of this document disagreed and that the settled one wins.
- **Who may delete investor data**, and after how long? **The owner, and nobody else — see item 12, which was built on 2026-07-27.** Retention is still indefinite by default, which is deliberate and is what the privacy page tells investors; what has changed is that an investor who asks to be removed can now be, by a procedure rather than by hand. *After how long* is still unanswered and still nobody's deadline: nothing expires on its own.
- **Confirm the name spelling** — "David Serene" appears throughout and will sit on investment correspondence.

---

## Noted, no action needed yet

- The `SPV/` folder is the natural home for this application; it is currently empty.
- The FLIPIT product itself (`flipit/`) is at M1 — runnable locally, extension builds working, M2–M4 stubbed. Investors asking "what actually exists?" can be shown it. Whether any of that belongs in the portal as a Flipit progress update is a later question, but the updates feed (§6) is where it would live.
