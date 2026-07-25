# Flipit Investor Outreach Portal — Build Specification

**Version 6.0 · 2026-07-25**
Changes from v1: confirmed owner/operator identities; investors now hold **persistent accounts** rather than one-shot links; added the **investor status timeline** through to funds received; added an **updates feed**; added **service lifecycle** (expansion, read-only, sunset, disable); added **Section 8 — Pre-launch gates** covering Gmail OAuth verification and legal/compliance sign-off.

Decided 2026-07-25:
- Emails send through the Gmail API **one recipient at a time**; David reviews each. No bulk send. Expected list: 15–40 recipients.
- Sender is `serenedavid@gmail.com`. **Mail goes out over Gmail SMTP using an app password, not the Gmail API** — see §8.1. This removes the Google verification wait entirely.
- **Automatic reminder emails are in v1** (§6.5). SMTP has no 7-day expiry, so unattended scheduled sending is no longer a problem.
- **AI-assisted spreadsheet import** is in v1 (§9.1). The layout of David's spreadsheet is unknown in advance.
- The portal is long-lived and will grow into an ongoing tool for SPV members (§13.1). Retention is indefinite by default.
- **FLIPIT branding throughout** (§13.2), with an admin media library for images.
- **A personal video from David** is offered but optional (§13.3).
- Investors see **nothing** about other investors or round progress. That changes only after the round closes (§21.1).
- Recording funds received stays with David alone — no second approver.
- Hosted at **`mikehelm.com/SPV` for testing**, moving to **`spv.flipit.com`** before anything is sent (§18.1).
- AI provider is **OpenAI**, key entered in-app by the owner and used transparently by the operator.
- David's contact preference (phone / WhatsApp / email-only) is captured at **operator onboarding** (§2.1), not hard-coded.
- The deadline does **not** auto-close. David closes the round himself, prompted by a reminder (§6.6).
- The invitation is a **designed HTML email**, not plain text (§11.5).
- **Shared Q&A** (§6.7): investors ask, David answers privately by default, and publishes anonymised answers when useful.
- **Participation certificate** (§5.1), **anti-phishing verification page** (§15.1) and **register of interest** (§5.2) are in v1.
- **One recipient is a US person.** See §8.3 — David gets an in-app explanation of why and what to do. — this is the single highest-risk item in the project.

## 1. Goal

Build a secure web application that lets an authorized operator upload a recipient list, review personalized Flipit investment emails, send them through Gmail, and then carry each recipient through a private portal — from first response, to commitment, to acceptance, to confirmation that their funds have been received — with a full audit trail throughout.

The portal is not a one-time mailer. It is the private record each investor returns to.

## 2. Roles and confirmed identities

| Role | Person | Account | Capabilities |
|---|---|---|---|
| **Owner Admin** | Michael Helm | `mike@flipthepage.com` **and** `mike@flipit.com` — both allowlisted | Full access to all records. Manages roles and access, configures service mode, records compliance approval, exports all data, revokes any account. Cannot be removed by an operator. |
| **SPV Operator** | David Serene | `serenedavid@gmail.com` | Joins via single-use invite, signs in with Google. Uploads recipients, reviews and sends emails, answers questions, advances investor status, publishes updates, exports results. |
| **Investor** | Per recipient | Own verified email | Holds a persistent account (§4). Sees only their own offer, status, documents, and updates. |

Both privileged accounts sign in with **email and password**. Google OAuth is deliberately not used — see §2.2.

Role is assigned by email address on an allowlist. There is **no self-registration of any kind**: an address that is not on the allowlist and does not hold an investor account cannot sign in, and no record is created for it.

If David is later issued a `@flipthepage.com` Workspace account, see §8.1 — it materially changes the Gmail integration path and should be decided before build, not after.

## 2.2 Why not Google sign-in

The application has exactly two privileged users. Requiring a Google Cloud project, an OAuth consent screen and client credentials to let two known people log in is machinery out of proportion to the problem, and it puts a third party in the path of the owner reaching his own application.

So: **email and password for the owner and operator. No OAuth, no Google Cloud project, no consent screen.**

**The two mechanisms and why they differ**

| Who | How they sign in | Why |
|---|---|---|
| Owner, Operator | Email and password | Works before any email is configured. Solves the bootstrap problem below. |
| Investors | Emailed single-use link, no password | They sign in rarely, must never manage a credential, and by the time they exist the mail connection is already working. |

That split is deliberate, not inconsistency. A passwordless admin login cannot work on first run, because sending the link needs an SMTP credential that can only be entered by signing in.

**First run**

1. The seed creates the allowlisted accounts with **no password set**.
2. It prints a one-time, expiring setup link to the console — the same pattern the FLIPIT M1 skeleton uses for its local magic link.
3. The owner opens it and chooses a password. It is never placed in an environment variable, a configuration file, or the console output itself.
4. The operator gets the same thing through the existing single-use invite (§2.1).

**What replaces the security Google was providing**

Dropping OAuth means the password becomes the only thing between an attacker and investor names, amounts, and the ability to send mail as the operator. That is a real trade and it is paid for here, not waved away:

- **Argon2id** password hashing, per-user salt, sensible cost parameters. Never a fast hash.
- **Minimum 12 characters**, checked against a common-password list. No composition rules — length beats symbols.
- **Rate limiting** on sign-in: progressive delay by address and by IP, then a temporary lock. Enumeration-resistant — a wrong address and a wrong password fail identically, in the same time.
- **TOTP two-factor** for both privileged accounts. Optional in v1 and strongly recommended, mandatory before the production deployment sends anything real. Standard authenticator apps; recovery codes issued once at setup.
- **Sessions** are server-side, revocable, and expire. Changing a password ends every other session immediately.
- **Password reset** by emailed single-use link, available only once the mail connection works. Until then the owner can reissue a setup link from the console.
- Every sign-in, failed attempt, lockout, password change and 2FA change is audit-logged (§16).

**What this removes:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, the Cloud project, the consent screen, the redirect-URI configuration at every deployment, and a dependency on Google being reachable for anyone to log in at all.

## 2.1 Operator onboarding

The first time David signs in, walk him through a short setup rather than assuming details about him.

1. **Confirm his display name** exactly as it should appear on investment correspondence.
2. **How should investors reach him?** Three choices, and the answer changes the email:
   - **Phone** — he enters a number; `{{sender_phone}}` renders as a phone line.
   - **WhatsApp** — he enters the number; it renders as a WhatsApp contact, with a `wa.me` link in the portal.
   - **Email only** — no number is collected, and the phone line is **removed from the template entirely** rather than rendering blank or unresolved.
3. **Confirm the sending Gmail account** and authorize it.
4. **Offer the personal video** (§13.3) — record now, upload later, or skip.
4b. **Explain the Q&A** (§6.7) in two sentences and let him try it: questions arrive here, answers are private unless he ticks the publish box, published questions never show who asked, and he can write his own entries now to fill the section before anyone asks. Offer to seed three or four starter entries with him.
5. **Prompt a test invitation to himself** before he can send to anyone else.

Because option 3 changes the email body, the compliance hash (§8.2) is computed over the **template source including its conditional blocks**, not the rendered output. Otherwise every contact-method choice would silently void the approval. Changing contact method after approval is a template change and does require re-approval — that is correct, since it alters what recipients receive.

## 3. Core workflow

1. Owner deploys the app, opens the one-time setup link printed by the seed (§2.2), and chooses a password. Both `mike@flipthepage.com` and `mike@flipit.com` are allowlisted as owner, since mail for both reaches the same person.
2. Owner records the compliance approval (§8.2). Until this exists, sending is disabled.
3. Owner creates a one-time operator invite for `serenedavid@gmail.com`.
4. David opens the invite, sets his own password, and accepts operator access.
5. David uploads a CSV/XLSX of recipient data.
6. The app validates rows and calculates indirect Flipit ownership as `spv_percentage × 30%` unless an override is supplied.
7. The app shows a review table: recipient, email, jurisdiction, investment amount, SPV percentage, indirect Flipit percentage, deadline, validation status.
8. David can edit any record, preview the exact email, and send a test email to himself.
9. David confirms the pre-flight checklist (§19), which unlocks sending. He then sends the emails **one recipient at a time**, reviewing each before it goes. There is no Send All. The gates in §8 must pass before any send is possible.
10. The app sends one personalized email per recipient through the Gmail API — never CC/BCC bulk mail.
11. Each email contains a single-use claim link to that investor's private portal.
12. On first use, the investor claims the link, which verifies their email and activates the account created for them at send time (§4.1). They see a read-only snapshot of the exact email sent, plus their offer details.
13. The investor selects Interested, Not Interested, or Ask a Question, optionally adds a message, and submits.
14. David's dashboard updates immediately and the response is logged.
15. David replies from the dashboard. The reply is emailed and stored in the conversation log.
16. As the process advances, David moves each investor along the status timeline (§5) — documents issued, commitment agreed, allocation accepted, payment instructions issued, funds received. The investor sees each step in their portal.
17. David publishes updates (§6) to all investors or to one.
18. David or Mike exports the full recipient, response, commitment and funds data to CSV/XLSX at any time.

## 4. Investor accounts

Investors do **not** self-register. An account can only come into existence from an operator-issued invitation. Once it exists, it persists.

### 4.1 Claiming

Record lifecycle, stated precisely because the two records are easy to confuse:

- **On upload**, a `Recipient` row is created. No account exists yet.
- **At send time**, an `InvestorAccount` is created in state `invited`, bound to the recipient's email address but not yet verified. The claim token is issued against this account.
- **On claim**, the account's email is marked verified and the account transitions to `active`.

So `invited` is a real account state on a real row — it simply predates verification. The account, not the recipient, owns the lifecycle in §4.2.

- The emailed link carries a single-use, high-entropy claim token (§15). Opening it verifies control of that mailbox.
- Claiming verifies the account's email address and establishes a session.
- Return visits use passwordless sign-in: the investor enters their email and receives a fresh sign-in link.
- **No passwords.** No account recovery path other than the verified email address, and any change of address requires verification of the new address before it replaces the old one (§13).

### 4.2 Lifecycle states

| State | Meaning | Portal behaviour |
|---|---|---|
| `invited` | Email sent, link not yet claimed | Claim link works; nothing else exists yet |
| `active` | Claimed and verified | Full access to own record |
| `suspended` | Temporarily withdrawn by owner or operator | Sessions and links invalidated immediately; neutral notice page with a contact route |
| `closed` | Process ended for this investor — declined, withdrawn, reallocated, or completed | Per the `closed_account_access` setting: either a read-only view of their own history, or a neutral closed page |
| `archived` | Retained for records only | No portal access; data remains exportable by the owner |

Every state change writes an `AccountStatusEvent` with actor, timestamp, reason, and whether the investor was notified. Suspension and closure take effect immediately — active sessions are terminated, outstanding links are revoked.

Sign-in after suspension or closure, stated explicitly because revocation alone does not answer it:

- **Suspended:** requesting a sign-in link is accepted silently (no enumeration signal) but no link is issued. The investor cannot get back in until reinstated.
- **Closed:** if `closed_account_access` is `read_only`, the investor may request a fresh sign-in link and reach a read-only view of their own record and documents. If it is `none`, sign-in links are not issued and the closed notice is shown. Default is `read_only` — an investor who has sent money should not lose the record of it.
- **Archived:** never issues sign-in links.

In all cases, *existing* tokens and sessions are killed at the moment of the state change. Whether a *new* one can be obtained is the setting above.

The owner can suspend or close any account, including one an operator created. An operator cannot close the owner's access.

### 4.3 Durability across rounds

Structure the data so that **the account is durable and the offer is per-round.** An `InvestorAccount` may hold more than one `Offer`, each belonging to a `Round`. The current SPV raise is simply the first round.

This is what makes a later advancement, top-up, or follow-on offer a configuration change rather than a rebuild: a new round is created, offers are attached to existing accounts, and those investors see the new offer alongside their history. Build this structure now even though v1 ships with a single round.

## 5. Investor status timeline

Each offer carries an ordered status. The investor sees the timeline in their portal — completed steps, the current step, and the steps still ahead — so they always know where they stand.

| # | Status | Set by | Visible detail |
|---|---|---|---|
| 1 | Invitation sent | System | Date sent |
| 2 | Response recorded | Investor | Their own choice and message |
| 3 | Documents issued | Operator | Date, document list, download links |
| 4 | Commitment agreed | Investor / Operator | Committed amount, SPV %, indirect %, date |
| 5 | Allocation accepted | Operator | Confirmation that the company has accepted their allocation, date, accepted amount |
| 6 | Payment instructions issued | Operator | Date issued and how instructions were delivered |
| 7 | **Funds received** | Operator | Amount, currency, value date, reference |
| 8 | Completed | Operator | Final recorded position |

Rules:

- Statuses advance forward. Any reversal or correction requires a reason and is written to the audit log as a correction, never a silent overwrite.
- **Funds received requires two-step confirmation** in the operator UI, with the amount re-typed to confirm. It is a financial assertion the investor will rely on — treat it accordingly.
- Committed and received amounts are stored separately from the originally proposed amount. Proposed, committed, accepted, and received are four distinct numbers and the export must show all four.
- Statuses 3–8 are operator-driven in v1. Document e-signature and payment integration are phase two (§21); the states exist now so the portal can tell the truth without them.
- The portal displays a plain-language explanation beside each step so an investor is never guessing what "allocation accepted" means.

## 5.1 Participation certificate

Once an investor reaches **Funds received**, the app generates a PDF confirmation for them.

- Contains: their name, the SPV, the amount received, the value date, their SPV percentage, the resulting indirect Flipit percentage, the reference, and the date of issue.
- FLIPIT branded, signed off by David in his stated role.
- Downloadable from their portal and attached to no email by default — it lives where the rest of their record lives.
- Regenerated if a figure is corrected, with the superseded version retained on the record and marked as such.
- **Wording constraint:** it confirms receipt of funds and a recorded position. It is not a share certificate, not a title document, and must say so in a footer line. The subscription and SPV documents remain the governing instruments.

## 5.2 Register of interest

Your invitation already says a declined allocation may be offered to other eligible participants. This is that, made real — a standing register of people who would take more if more became available.

**Call it a register of interest, not a waitlist.** A waitlist implies a queue you are progressing along and a thing you will eventually receive. Neither is true here, and the naming should not quietly suggest otherwise.

### 5.2.1 What it promises — nothing

The copy has to carry this precisely, because the whole feature lives or dies on not overstating:

> **Register of interest**
>
> If further allocations become available, we contact people from this register.
>
> Adding your name records your interest. It does not reserve an allocation, create any entitlement to one, or oblige anyone to offer you anything. Whether anything becomes available at all, and whether it is offered to you, depends on circumstances at the time, on the final SPV and subscription documents, and on applicable law.
>
> Where we are able to make an offer, we work through the register beginning with those who completed their own participation earliest — commitment agreed and funds settled. Joining the register does not itself create a position; completing your current participation does.
>
> You can remove yourself at any time.

That last mechanic is the honest version of "in order of accepting and investing": position is earned by having finished your own participation, not by being quick to raise your hand.

### 5.2.2 How the order is computed

Deterministic, and shown to David so he is never guessing:

1. Investors whose **funds have been received**, ordered by value date, earliest first.
2. Then investors who have **agreed a commitment** but not yet settled, ordered by commitment date.
3. Then everyone else on the register, ordered by the date they joined it.

David can override the order for a specific person, but only with a recorded reason, and the override is audit-logged and visible in the admin view. There will be legitimate cases; there should be a trail.

**The computed order is never shown to investors.** No one sees their own position or anyone else's — a displayed rank is a promise whatever the surrounding text says, and it would leak the existence and relative standing of other investors, which cuts against everything else in §13.

### 5.2.3 Mechanics

- Any active investor can join or leave from their portal. Joining and leaving are both one click and both confirmed.
- David can add someone manually — including people who were never on the original recipient list. This is how the register becomes the starting list for a later round (§21).
- An optional free-text field: *how much more would you be interested in, if it were available?* Indicative only, labelled as such, and never treated as a commitment.
- When an allocation frees up, David sees the register in computed order with each person's history, and issues an offer to whoever he chooses. Issuing an offer from the register creates a normal `Offer` against that existing account (§4.3) — it does not invent a parallel mechanism.
- Joining, leaving, ordering, overrides, and offers issued from the register are all audit-logged.

### 5.2.4 Compliance

Anyone offered an allocation from the register receives the same treatment as an original recipient: the jurisdiction gate (§8.2) applies, the compliance approval must be current, and the offer email goes through the same one-at-a-time send. **A freed allocation is a new offer, not a continuation of an old one.** Nothing about the register shortcuts any gate.

## 6. Updates feed

- The operator composes an update, saves it as a draft, previews it, and publishes it.
- Audience: all active investors, a filtered subset (by status), or a single investor.
- Published updates appear in the investor's portal in reverse-chronological order with a published date.
- Publishing may optionally trigger a notification email. **The notification email says only that an update is available and links to the portal — it carries no amounts, percentages, or personal detail.**
- Updates are immutable once published; corrections are published as new updates. Withdrawal is possible but leaves a tombstone in the audit log.

## 6.5 Reminder emails

Recipients who have not responded are chased automatically.

- **Schedule:** configurable, default 7 days and 2 days before that recipient's `response_deadline`.
- **Audience:** only accounts with no recorded response, in state `invited` or `active`, not blocked, not closed. Anyone who has responded is never chased.
- **Cap:** a configurable maximum per recipient, default 2. Never more.
- **Content:** the reminder is a nudge with the portal link. It restates the deadline and nothing else. **It contains no offer terms, amounts, or percentages** — those live in the portal, which is where the investor should be looking anyway.
- **Its own approved template.** The reminder body is a separate template with its own hash and its own compliance approval under §8.2. Reminders do not send under the invitation email's approval.
- **Visible and cancellable.** The dashboard shows a queue of upcoming reminders with dates and recipients. David can cancel or reschedule any of them, individually or in bulk, up until they send.
- Reminders respect service mode: nothing sends outside `active`.
- Every reminder — sent, cancelled, skipped, failed — is written to the audit log.

This is the one place in the app that sends without a human clicking send at that moment. That is deliberate, and it is why the constraints above are tight: no offer terms in the body, a separate approval, a hard cap, and a visible queue David can stop.

## 6.6 Closing the round

The deadline does not close anything by itself. David decides.

- On the deadline date the app emails David — not the investors — with a summary: who responded, who did not, who asked for more time, and totals committed against the USD 30,000 aggregate.
- That email says plainly that it is **his call**: close the round now, extend the deadline for everyone, or extend it for named stragglers he knows need it or who have asked.
- Extending is a per-recipient action as well as a global one. Anyone extended gets a fresh deadline and, if configured, a fresh reminder schedule.
- Closing the round is an explicit button with a confirmation. It stops further responses, marks unfilled allocations as available, and unlocks the post-close features in §21.
- If David does nothing, nothing happens. The round stays open and he is reminded again on a configurable cadence. **Silence never closes anyone's opportunity.**

## 6.7 Questions and answers

A private raise generates the same five questions twenty times. This turns that into one answer, written once, that everyone can see — without ever revealing who asked.

### 6.7.1 Asking

- Any investor can type a question into their portal at any time.
- On submit they see a plain confirmation: *Thank you — your question has been sent to David. He will get back to you by email, and you will also see the answer here.* No fake urgency, no promised timeframe the app cannot keep.
- Questions can be asked more than once and form a thread with the answer, so a follow-up does not start from nothing.
- A new question emails David immediately. It is the one thing in this process where a slow reply costs a decision.

### 6.7.2 Answering

David sees a queue of open questions with who asked, their offer detail, and their status, so he answers with context rather than blind.

When he writes an answer there is a single checkbox: **"Also publish this answer to the shared Q&A."**

- **Unchecked is the default.** Only the person who asked ever sees the answer. Publishing is a deliberate act, never an accident.
- **Checked** puts the question and answer on the shared Q&A page that every investor can see.

Then:

- **The email to the asker requires David to press send.** Same rule as everything else in this app — nothing goes to an investor because a checkbox was ticked. He sees the rendered email first.
- Publishing to the page happens on save; emailing the asker happens on send. They are separate actions and either can happen without the other.

### 6.7.3 Publishing, and the anonymity that has to be real

**The published question never shows who asked.** No name, no initials, no date precise enough to identify, no email.

That is not enough on its own, because people identify themselves inside the text — *"As we discussed on Tuesday, I'd want to put in more than the 5% you offered me…"* would expose both the asker and their allocation. So:

- **David can edit the question wording before publishing.** He rewrites it into a general form; the original text is preserved unchanged on the private record and in the audit log.
- The editor shows the original and the public version side by side, with a reminder to check for identifying detail, amounts, and percentages.
- Published entries can be unpublished, reordered, pinned, and edited. Editing a published answer stamps it as updated. Unpublishing is logged — but David should be told plainly that unpublishing does not un-see it.

### 6.7.4 David can seed it himself

He does not have to wait to be asked. He can write question-and-answer pairs directly and publish them, which is how the section should look on day one rather than empty. Obvious candidates: what the SPV is, what the 30% means, when documents arrive, what happens if the round does not fill, who to contact.

### 6.7.5 Visibility control

A shared Q&A implies other recipients exist. It names nobody, but the inference is there — and you decided investors should learn nothing about each other until the round closes.

So the shared section has an owner-level switch: **visible during the raise**, or **hidden until the round closes**, in which case private answers still work exactly as described and publishing simply queues entries for later. Default is visible; the reasoning is that a well-answered Q&A does more for confidence than the inference costs.

### 6.7.6 One compliance note

An answer published to everyone is a communication to every recipient of the offer, and carries the same weight as the invitation itself. The publish dialog says so, once, in one line. Private answers to one person are ordinary correspondence and are not gated.

Every question, answer, edit, publication, unpublication, and send is audit-logged with actor and timestamp.

## 7. Service lifecycle — expansion, wind-down, disable

The portal must be able to grow into an ongoing investor-relations surface, or be shut down cleanly. Both are first-class states, not afterthoughts.

Global `ServiceMode`, settable by the owner:

| Mode | Investor experience | Admin experience |
|---|---|---|
| `active` | Full function | Full function |
| `read_only` | Can view everything; cannot submit responses, questions, or changes. Banner explains why. | Full function |
| `sunset` | Read-only plus a configurable notice and closing date, with a prompt to download their records | Full function; export strongly prompted |
| `disabled` | All portal routes return a neutral closed page with a contact address | Owner retains full access to data and export |

`ServiceConfig` holds, at minimum: `service_mode`, `sunset_closing_date`, `service_contact_email` (shown once the portal is closed and after the operator's own address stops being monitored), `closed_account_access`, `decimal_places`, `approved_jurisdictions`, `aggregate_raise_usd`, `default_sender_name`, `default_sender_email`, `default_sender_phone`.

Requirements:

- **Sending requires `active`.** Individual send and resend are disabled in `read_only`, `sunset`, and `disabled`. Inviting someone into a portal that will not accept their response is a contradiction the app should make impossible rather than leave to operator discipline. Test sends to the operator remain available.
- Moving to `disabled` requires a completed export within the preceding **7 days**, or an explicit owner override that is logged with a reason.
- Investors must be able to download their own records (offer, correspondence, status history, documents) while in `read_only` or `sunset`.
- Phase-two modules ship behind feature flags so functionality can be switched on for a later round without redeployment risk.
- Deletion of investor data is a separate, deliberate, owner-only action with confirmation — never a side effect of disabling the service.
- **Default retention is indefinite.** The portal stays live after the raise closes and becomes the ongoing surface for SPV members (§13.1). The `sunset` and `disabled` modes exist so that ending it is possible and clean, not because it is planned.

## 8. Pre-launch gates

These two decisions must be made and recorded **before the build is finished**, not discovered at send time. Both are implemented as hard gates in the application, not as documentation.

### 8.1 Gmail sending — OAuth scope and verification

`https://www.googleapis.com/auth/gmail.send` is classified by Google as a **sensitive** scope, not a restricted one. That is materially lighter than the restricted tier: it requires OAuth app verification, but **not** the CASA third-party security assessment that restricted Gmail scopes (`gmail.readonly`, `gmail.modify`, `mail.google.com`, and similar) trigger. Request `gmail.send` and nothing broader — adding any read scope moves the app into the restricted tier and turns a few days of review into weeks plus an assessment.

### Decided: SMTP with an app password, not the Gmail API

**The application does not use the Gmail API to send.** It authenticates to `smtp.gmail.com` with a Google **app password** generated on David's account.

This sidesteps the entire OAuth verification problem. There is no sensitive-scope review, no 3–5 day wait, no demo video, no unverified-app warning screen, and no 7-day authorization expiry — which was the thing that made automated reminders (§6.5) incompatible with the unverified path.

**What is unchanged:** mail is sent by Google's own servers from David's own address, so deliverability is identical to the API. Messages land in his Gmail **Sent** folder. Replies arrive in his inbox as normal. Threading works, because the application sets and tracks its own `Message-ID` and honours `In-Reply-To`. Personal Gmail allows roughly 500 recipients a day; the list is 15–40.

**Configuration**

- Host `smtp.gmail.com`, port 587 with STARTTLS.
- Username is the full Gmail address; password is the 16-character app password.
- App passwords require 2-Step Verification to be enabled on the account first.
- **The app password is encrypted at rest, write-only in the UI, and never logged or exported** — identical handling to the OpenAI key (§9.1).
- Onboarding walks David through generating it, and links to where he revokes it.

**The honest trade-offs**

- An app password is a static credential rather than a revocable scoped token. If the server were compromised, an attacker could send as David until it is revoked. It is mail-sending only, it cannot read his mail, and he can revoke it instantly from his Google account — but it deserves the same care as any secret, and the onboarding says so.
- Google describes app passwords as a transitional mechanism for software that cannot do OAuth. No end date has been announced, but it is not a permanent guarantee. This is why the transport stays swappable.
- Connection health is still surfaced (§14): a wrong or revoked app password must block sending with a specific message, exactly as an expired token would.

**Upgrade path.** If the portal outlives the raise and becomes a long-term member surface, moving to the Gmail API with `gmail.send` is a configuration change behind the `EmailTransport` interface, and the verification can be done calmly rather than on the critical path. The three OAuth paths below are retained for that decision.

The three OAuth paths, retained for reference:

**Path A — Testing publishing status (no verification).**
Fastest. David is added as one of up to 100 test users. Two consequences that matter here: an "unverified app" caution screen at authorization, and **authorizations and refresh tokens expire after 7 days**. For a single send that is tolerable. For a portal that runs for weeks — replies, reminders, status updates — it means David re-authorizes roughly weekly, and a send batch will fail if he has not. If this path is chosen, the token-health surface described below is mandatory rather than optional.

**Path B — Publish and complete sensitive-scope verification (recommended).**
Typically 3–5 business days. Requires: a privacy policy hosted on the app's own domain and linked from the consent screen, domain ownership verified in Google Search Console, an accurate consent screen (app name, support email, homepage), and an unlisted YouTube demo video showing the OAuth grant and what the scope is used for. Removes both the warning screen and the 7-day expiry. Given the portal's expected lifespan, this is the right default.

**Path C — Google Workspace internal app. Not available given the chosen sender; retained here in case that changes.**
If `flipthepage.com` is on Google Workspace and the sending account is a Workspace account on that domain, the consent screen can be set to `Internal` — no verification, no warning screen, no 7-day expiry. Note that the Google Cloud project itself must be owned by that Workspace organization for `Internal` to be selectable at all; a project created under a personal Google account cannot be switched to it later without being recreated. Decide this before creating the project. This is the cleanest option, but it does **not** cover `serenedavid@gmail.com`, which is a personal Gmail account outside the organization. It only becomes available if David is issued something like `david@flipthepage.com` and sends from there. That is a business decision about which address investors should see replies from, and it should be made deliberately.

Build requirements regardless of path:

- Implement sending behind an `EmailTransport` interface. Ship `SmtpTransport` as the working implementation and `GmailApiTransport` as a substitutable alternative selected by configuration. Do not scatter transport calls through the codebase.
- Show **connection health** on the admin dashboard: the authenticated address, when it was last verified, and the result of the most recent check. Provide a "test connection" action that authenticates against SMTP without sending.
- Block sending when the credential is missing, rejected, or has failed its most recent check — with a specific message naming the problem, not a generic failure.
- Store the active transport in configuration so the state is never ambiguous.

### 8.2 Legal and compliance sign-off

This email is an offer of securities, sent to named individuals who may sit in several jurisdictions. The v1 checklist carried a "legal/compliance approval recorded" line. In v2 that line becomes a technical gate: **all sending is disabled until a compliance approval record exists, and any change to the email template voids it.**

*Note: this specification is written by a builder, not a lawyer, and none of it is legal advice. The gate exists to ensure a qualified person has actually signed off — it does not substitute for that person.*

Implement a `ComplianceApproval` record with:

- Approver name, role, and firm
- Approval date and an evidence reference (uploaded letter, email, or document ID)
- **Jurisdictions cleared** — an explicit list of ISO 3166-1 alpha-2 country codes. Blocs are expanded to their member codes when the approval is recorded, so the stored list is always comparable to a recipient's field value.
- **Approved template hash** — a SHA-256 of the exact approved subject line and body
- Any conditions or restrictions noted by the approver
- Recorded by (owner only) and timestamp

Enforcement:

1. **No approval, no send.** Individual send and resend are both disabled. Test sends to the operator's own address remain available so the template can be prepared while approval is pending, and are clearly labelled as test sends.
2. **Template drift voids approval.** The live template is hashed at send time and compared to the approved hash. Any mismatch — a changed word, a changed subject — disables sending until a new approval is recorded. Show a diff so it is obvious what changed.
3. **Jurisdiction gating.** `recipient_jurisdiction` is a required upload field. Any recipient whose jurisdiction is not in the approved list is blocked from sending and flagged in the review table with the reason. This must be per-recipient, not per-batch.
4. **Approval is owner-only.** The operator cannot record or amend it.
5. The gate screen displays the approval details, the cleared jurisdictions, and a prominent notice that the application does not provide legal advice and does not assess the adequacy of the approval.
6. Every element of the above is written to the audit log — including blocked send attempts and the reason they were blocked.

Also enforced at the copy level: the email and portal must not present a response as a binding subscription unless the final legal documents expressly make it so, and the portal's acknowledgement checkboxes are configurable so that approved wording can be applied without a code change.

## 8.3 The US recipient

One recipient on the list is a US person; the rest are spread across Australia, England, France, Thailand and elsewhere. These are not comparable situations and the app must not treat them as one.

**Why this one matters more than the others.** An offering made entirely outside the United States is generally structured to rely on that fact. Adding a single US person changes the analysis for the offering, not just for that person — and the amount involved does not create an exemption. Small offerings are still offerings.

**None of this is legal advice, and I am not a lawyer.** The point of this section is that the *application* should make the safe path the easy one.

**How the app handles it**

- The compliance approval (§8.2) holds an approved jurisdiction list. `US` is simply not on it until someone qualified puts it there.
- The US recipient therefore imports normally, appears in the dashboard, and is **blocked from sending** with the reason shown — while every other recipient proceeds untouched. This is exactly the per-recipient gate in §9, doing the job it exists for.
**What David sees.** A blocked recipient is not a silent failure — the app explains it to him in plain language at the point he tries to send: that this person is a US person, that an offering structured as non-US generally depends on remaining so, that the amount does not create an exemption, and that the safe path is to get advice for that one person while the rest of the round proceeds. It tells him exactly what unblocking requires — a recorded approval reference from whoever is qualified to give it — and does not let him route around it. The wording makes clear the app is not giving legal advice; it is refusing to guess.

- A recipient can be **individually approved** against a recorded approval reference, so if advice comes back clearing that specific person, David unblocks them without loosening the gate for anyone else.
- The dashboard shows blocked recipients prominently rather than hiding them, so nobody is quietly forgotten.

**The practical recommendation:** send to everyone else and hold the US recipient pending advice. That costs one conversation and delays one person. Reversing an offer already made to a US person costs considerably more.

**Also worth raising with whoever approves this,** since they are the common traps rather than exotic ones: the UK restricts who may communicate a financial promotion and on what basis; Australia has specific small-scale and sophisticated-investor thresholds; France sits under EU rules. All of these are routinely satisfied for a small private round among known contacts — but they are satisfied *deliberately*, not by accident.

## 9. Upload fields

**Required**

- `recipient_name`
- `recipient_email`
- `investment_amount_usd`
- `spv_percentage`
- `response_deadline`
- `recipient_jurisdiction` — required for the §8.2 gate

**Optional**

- `indirect_flipit_percentage_override`
- `sender_name`
- `sender_email`
- `sender_phone`
- `internal_notes`

Validation has two distinct severities, and they must not be conflated:

**File-level errors — nothing in the file can be sent until resolved:** missing required fields, malformed emails, duplicate emails within the file, duplicates against existing records, non-numeric or out-of-range percentages, past-dated deadlines, jurisdiction values that are not valid ISO 3166-1 alpha-2 codes.

**Per-recipient blocks — the row is imported and blocked individually while the rest of the batch proceeds normally:** a jurisdiction that is a valid code but outside the compliance-approved list (§8.2). These rows appear in the review table flagged `Blocked` with the reason shown, and their send button is disabled while every other row remains sendable.

## 9.1 AI-assisted import

David's spreadsheet layout is not known in advance and will not match the field names in §9. Rather than forcing him to reformat it, the app uses a language model to propose a mapping.

**Key configuration**

- The owner has a settings page holding an AI provider API key. Encrypted at rest, write-only in the UI (never displayed again after saving), never written to logs or exports.
- When a key is present, AI assistance is available to any signed-in operator — David gets it automatically without ever seeing the key.
- **The app must work fully without a key.** Absent one, the user maps columns manually from dropdowns. AI is an accelerator, not a dependency.
- **Provider is OpenAI.** Keep it behind a small interface so it can be swapped, but ship with OpenAI as the default and configured model.
- **Spend cap.** A configurable monthly ceiling, plus a per-import token cap. At 15–40 recipients real usage is pennies, which is exactly why a runaway loop against a live key would go unnoticed until the bill arrived. Cap it, and show usage on the settings page.
- The key belongs to the owner and is used transparently by the operator — David gets AI assistance without ever seeing or handling the key.

**Mapping flow**

1. David uploads any `.csv`, `.xlsx`, or `.xls`, with any column names, in any order, with extra columns present.
2. The app extracts the header row and a small sample of data rows.
3. The model proposes: which source column maps to each field in §9, which columns are irrelevant, and how to normalise the values it sees.
4. **The proposal is shown, never applied.** David sees each source column beside its proposed target field, a confidence indicator, and the first few converted values as they would be stored. He confirms or corrects every mapping. Nothing imports until he confirms.
5. On confirmation, the normal §9 validation runs exactly as it would for a hand-formatted file. AI changes how the file is *read*, not what is *accepted*.

**Ambiguities that must be raised rather than guessed**

- A percentage column containing `5`, `5%`, or `0.05` — is it five percent or five hundredth of a percent?
- Dates in `03/04/2026` — day-month or month-day?
- Amounts with currency symbols, thousands separators, parentheses for negatives, or a trailing `k`.
- Two columns that could both be the email, or a single "name" column needing no split.
- Jurisdiction written as a country name, a bloc, or a city.

Each ambiguity is presented as an explicit question with David's answer applied to the whole column. Silent coercion of financial figures is not acceptable.

**Hard limits**

- **AI never performs the money math.** The `spv_percentage × 0.30` calculation, all rounding, and all totals are deterministic code (§10). The model may read a number out of a spreadsheet; it may never compute one.
- **AI never sends anything, never writes email copy, and never decides who is eligible.** It maps columns. That is the whole job.
- Only headers and a bounded sample of rows are sent to the provider — never the full list. The settings page states plainly that this sample leaves the system, and offers a headers-only mode for when that is not acceptable.
- Every proposal, every correction, and every confirmation is audit-logged with the actor, so a mis-import can be traced afterwards.

## 10. Calculations

- Default indirect Flipit percentage = `spv_percentage × 0.30`
- Round display to a configurable number of decimal places, default 3.
- Store exact decimal values — use a decimal type, never floating point, for any money or percentage.
- Warn if the sum of all `spv_percentage` values exceeds 100, or if the sum of `investment_amount_usd` exceeds the stated aggregate raise. Warn, do not block — the operator may be modelling.

## 11. Template variables

### 11.1 Email template

`{{recipient_name}}` · `{{investment_amount}}` · `{{spv_percentage}}` · `{{indirect_flipit_percentage}}` · `{{response_deadline}}` · `{{secure_portal_link}}` · `{{sender_name}}` · `{{sender_email}}` · `{{sender_phone}}`

### 11.2 Sender field resolution

The sender fields have three possible sources, which must be tried in a fixed order rather than left ambiguous:

1. The per-row value from the upload, if present.
2. The `default_sender_*` values in `ServiceConfig` — this is the normal case, and it is why the sample CSV omits those columns.
3. For `sender_email` only, the authenticated Gmail address as a final fallback.

`sender_phone` has no automatic fallback. If neither the row nor the config supplies it, that is an unresolved variable and the send is blocked (see below). Set it in configuration before the first send.

### 11.3 Portal template variables

The investor portal uses its own set, all resolved from stored records or `ServiceConfig`:

`{{date}}` · `{{response}}` · `{{deadline}}` · `{{amount}}` · `{{currency}}` · `{{value_date}}` · `{{reference}}` · `{{spv_percentage}}` · `{{portal_link}}` · `{{sender_email}}` · `{{closing_date}}` (from `sunset_closing_date`) · `{{contact_email}}` (from `service_contact_email`)

### 11.5 Designed HTML email

The invitation is a designed, branded HTML email — not plain text.

- FLIPIT palette from §13.2. Dark header carrying the logo, light readable body, orange used only for the portal button.
- **The offer figures sit in a bordered panel**, visually separated from the prose: proposed investment, SPV percentage, indirect Flipit percentage, deadline. This is the part people screenshot and forward to their accountant; it should survive being read alone.
- One clear primary action — the portal button. No competing links.
- **Plain-text multipart alternative is mandatory**, and must carry the same information. Some recipients block HTML, and a text part materially helps deliverability.
- Table-based layout with inline styles — email clients have not moved on. Test in Gmail, Apple Mail, and Outlook.
- Maximum 600px wide, legible at phone size, no reliance on background images.
- Images served from `invest.flipit.com` and kept minimal; the email must read correctly with images blocked, which is how many clients open it by default.
- No tracking pixels (§12).
- The template source, both HTML and text parts, is what gets hashed for §8.2.

### 11.4 Rendering rule

Rendering must fail loudly on any unresolved variable, in both the email and the portal, after the fallback chain above has been applied. A literal `{{recipient_name}}` reaching an investor's inbox is unacceptable. Validate template rendering for every recipient at pre-flight, not at send time — an unresolved variable should be caught before the batch starts, not halfway through it.

## 12. Admin dashboard

**Columns:** Name · Email · Jurisdiction · Investment amount · SPV % · Indirect Flipit % · Deadline · Email status (Draft / Sent / Failed / Blocked) · Account status (§4.2) · Timeline status (§5) · Response status (No response / Interested / Not interested / Question) · Last activity · Actions (Edit, Preview, Send, Resend, Advance status, Suspend, Reinstate, Close, Archive, Open record)

Close and Archive require a reason and a confirmation step; both are available to the owner, and Close is available to the operator.

**Filters:** email status · account status · timeline status · response status · jurisdiction · deadline · search by name or email

**Summary cards:** Total recipients · Sent · **Portal opened** · Interested · Not interested · Questions · No response · Total proposed · Total committed · Total accepted · Total funds received

"Portal opened" counts accounts that have claimed and opened their portal at least once. It is **not** email open tracking — do not implement tracking pixels or link-wrapped open detection. They are unreliable, they sit badly against the minimal-data posture in §15, and on a private securities solicitation they are the wrong instinct. The four money totals correspond exactly to the four amounts defined in §5 and exported in §20; there is no fifth.

**Always visible:** compliance approval state (§8.2) and mail connection health (§8.1). These are the two things that silently break a send, so they belong on the main screen rather than buried in settings.

## 13. Investor portal

- The exact sent email, as an immutable snapshot.
- Offer detail: amount, SPV percentage, indirect Flipit percentage, deadline.
- The status timeline (§5) with plain-language explanations.
- Response actions: Interested · Not Interested · Ask a Question, with an optional message. Responses may be updated until the deadline.
- The conversation thread with the operator.
- Documents issued to them, downloadable.
- The updates feed (§6).
- Change of contact email, effective only after the new address is verified.
- Acknowledgement checkboxes, configurable, and not to be treated as a binding subscription unless the final legal documents expressly make them so.
- Submission confirmations for every action.
- A clear statement of what the portal is and is not, and a route to contact the operator.
- Nothing on any screen reveals another investor's existence, identity, or allocation.

## 13.1 What's ahead

The portal is intended to outlive the raise and become David's working surface for SPV members. Investors should be able to see that without being told what is coming.

- A **"Coming to your portal"** area: a small set of named tiles with short labels and no explanation, visibly marked as in development.
- The effect to aim for is *this is a real system that is still being built out*, not a list of promises. Suggested tiles, deliberately thin: **Holdings & documents · Company updates · Direct line to David · Reporting**. Names only.
- More prominent once an investor reaches `Commitment agreed` — the implication being that participants get the tools, which is the point.
- Configurable by the owner: tiles can be added, renamed, hidden, or switched from "in development" to live as features ship.

**Wording constraint, and it matters.** This sits on a securities offer page, so the teaser must stay about *tooling and communication* and never drift into anything that reads as a promise of returns, valuation, liquidity, or a timeline. No dates. No "soon". A standing line beneath the tiles: *Features shown are in development, are indicative only, and form no part of the investment being offered.* Have the compliance approver look at this section along with the email — it is the easiest place in the build to say something unintended.

## 13.2 Branding and media

The portal should look like FLIPIT, not like a generic form. Investors are being asked to back this brand; the portal is the first time most of them will see it presented properly.

**Palette** — taken from the working FLIPIT demo (`FLIPIT Rebuttal Curl Demo.html`), which was built to match the live site:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#070823` | Page background, deep navy |
| `--bg-2` | `#0d0f2e` | Raised background |
| `--paper` | `#14162f` | Cards and panels |
| `--ink` | `#0b0c22` | Deepest surfaces |
| `--orange` | `#F59A23` | Primary accent, buttons, active states |
| `--orange-soft` | `#ffb84d` | Hover and highlight |
| `--text` | `#e7e9f5` | Body text |
| `--dim` | `#9498b5` | Secondary text |
| `--line` | `rgba(255,255,255,.09)` | Borders and dividers |
| `--ok` | `#35d07f` | Success — funds received, confirmations |
| `--warn` | `#ff5b52` | Warnings, blocked states |
| `--silver-1/2/3` | `#f6f8fc` / `#cbd1de` / `#98a0b4` | The silver page-curl gradient |

Type: `"Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.

Notes:

- Verify against the live site before launch — this palette is lifted from the demo file, which is a faithful copy but not the source of truth.
- The **page curl** is FLIPIT's signature. Use it as a restrained brand mark somewhere in the portal chrome. Do not animate it aggressively; this is an investment document, not the product demo.
- **Mobile first.** These are personal contacts who will open the email on a phone. Every screen must be excellent at 375px before it is considered at all on desktop.
- Dark palette throughout, matching the brand. Ensure text contrast meets WCAG AA — `--dim` on `--bg` is the pairing to check.

**Attribution**

A quiet **"Made by Make with Mike"** credit sits in the footer, present throughout the app.

- **Subtle is the requirement, not a nicety.** Small, in `--dim`, below the legal footer notice, no logo competing with FLIPIT's, no colour, no animation.
- Present on both the admin side and the investor portal. Configurable so it can be switched off per-surface if it ever feels wrong beside the offer figures.
- Optionally a link, opening in a new tab, but never styled to draw the eye.
- It does not appear inside the invitation email or on the participation certificate. Those are formal instruments about someone's money, and a maker's credit does not belong on either.

**Admin media library**

- Owner and operator can upload images: logo variants, favicon, an email header image, portal hero imagery, David's headshot, product screenshots.
- Stored with a name and description, re-usable across the portal, the email templates, and §13.1's roadmap tiles.
- Size and type limits, stripped of EXIF, served from the app's own domain — never hot-linked from elsewhere.
- Uploading an image is audit-logged. Images used in an email become part of that email's immutable snapshot.
- Ship with sensible defaults so the portal looks finished before anything is uploaded.

## 13.3 Personal video (optional)

Offer David the ability to put a short personal video in the portal. It is the single highest-leverage addition to a private raise of this kind, and it is entirely his call.

- **Two ways in:** record directly in the browser via webcam, or upload a file shot on his phone. Both land in the same place.
- **He sees it before anyone else does.** Preview in the real portal layout, re-record or replace as many times as he likes, and nothing is visible to investors until he explicitly publishes it.
- **Offer him a test email first.** Before any real send, prompt David to send himself the complete invitation — with his video linked — so he experiences exactly what a recipient will. This should be a prompt in the flow, not a feature he has to find.
- Video is hosted on the app's own domain, served only to authenticated investors, and never indexed.
- Include a caption/transcript field. Some recipients will open this somewhere they cannot play sound.
- The whole feature is optional and removable. If he never records one, the portal shows no gap where it would have been.

## 14. Email sending

- Gmail SMTP with an app password; see §8.1 for why, and for the trade-offs.
- Show the authenticated sender address and an editable display name before sending.
- Set and record a `Message-ID` for every message, and honour `In-Reply-To` so replies thread correctly.
- Never store or request David's actual Google account password. An app password only.
- Support test send and individual send. **Do not build a Send All / bulk send.** Sending is deliberately one recipient at a time so the operator reads each email before it goes; this is a decision, not an omission. A progress view showing who has and has not been sent yet replaces the bulk action.
- Rate-limit sends and retry transient failures with backoff. Distinguish permanent failures (invalid address) from transient ones and surface them differently.
- Save the Gmail message ID and thread ID against each record.
- Replies from the dashboard send through the operator's Gmail, stay on the correct thread, and remain associated with the investor record.
- Never auto-send in development. Test mode plus explicit pre-flight confirmation is mandatory.

## 15. Security

- Never place a name, email, amount, or percentage in a portal URL.
- At least 128 bits of cryptographically secure random entropy per token.
- Store only a hash of investor access and claim tokens.
- Claim tokens are single-use and expire; sign-in links are single-use and short-lived; all are revocable and regenerable.
- Suspension or closure of an account invalidates every outstanding token and active session immediately.
- Enforce HTTPS, secure and `HttpOnly` cookies, CSRF protection, rate limiting on every token-bearing and sign-in route, audit logging, and role-based access control on every route including the API.
- Encrypt OAuth tokens and sensitive database fields at rest.
- Never log full access tokens or email bodies.
- Prevent search-engine indexing of all portal routes — `noindex`, `robots.txt`, and no sitemap entries.
- Single-use, expiring admin invite tokens.
- Enumeration resistance: sign-in and claim responses must not reveal whether an address exists.
- Automated backups, with a documented and tested restore path.

## 15.1 Anti-phishing verification page

An unexpected email asking for an investment, with a link, from an address the recipient may not have seen before, is indistinguishable from a scam — because that is exactly what a scam looks like. Give people a way to check.

- A **public page** at a memorable path on the production domain, reachable without signing in and safe to reach by typing rather than clicking.
- It states plainly: what this process is, who David and Michael are, the exact sending address the invitation comes from, the exact domain every legitimate link uses, and what the email will and will not ever ask for.
- **A standing warning that payment details will never be changed by email**, matching the notice in §13 and the invitation itself.
- A contact route to verify by other means.
- Linked from the invitation footer and from the portal, and worded so it is useful to someone who arrived there suspicious.
- This page is the one part of the system deliberately indexed and public — everything else is `noindex` (§15). It only works if someone can find it.

## 16. Audit log

Record: uploads and edits · preview and test sends · email sends, failures, and **blocked attempts with the blocking reason** · account claims, sign-ins, suspensions, closures · portal opens · investor responses and changes · **status timeline advances and corrections** · **funds-received confirmations** · admin replies · update publication and withdrawal · exports · role and access changes · compliance approval records and voids · service-mode changes · OAuth authorizations and re-authorizations.

Each event: actor, timestamp, record ID, action, and relevant non-secret metadata. The log is append-only and visible to the owner.

## 17. Data model

`User` · `Role` · `OperatorInvite` · `InvestorAccount` · `AccountStatusEvent` · `Round` · `Recipient` · `Offer` · `OfferStatusEvent` · `EmailSnapshot` · `SendEvent` · `PortalToken` · `InvestorResponse` · `ConversationMessage` · `Commitment` · `PaymentInstruction` · `FundsReceipt` · `DocumentPackage` · `PortalUpdate` · `UpdateDelivery` · `ComplianceApproval` · `ReminderSchedule` · `ReminderEvent` · `ImportJob` · `ColumnMapping` · `AiProposal` · `QaEntry` · `QaThreadMessage` · `ParticipationCertificate` · `InterestRegisterEntry` · `RoadmapTile` · `MediaAsset` · `OperatorVideo` · `ServiceConfig` · `FeatureFlag` · `AuditEvent` · `ExportJob`

`InvestorAccount` is durable and holds many `Offer` records across many `Round` records (§4.3).

## 18. Suggested stack

Next.js with TypeScript · PostgreSQL · Drizzle · Auth.js with a credentials provider for the two privileged users and a passwordless email provider for investors · Gmail API · a background job queue for scheduled reminders (BullMQ/Redis or a managed queue) · Zod for validation · Tailwind or a simple component library. A different secure, maintainable stack is acceptable.

**Hosting — two phases, and the order matters.**

1. **Testing: `mikehelm.com/SPV`.** The app runs under a path prefix, so `basePath` must be configurable from an environment variable from day one rather than retrofitted. Every internal link, asset path, cookie path, and callback URL has to respect it.
2. **Production: `spv.flipit.com`** before a single real email goes out. Move the app, re-point DNS, and update the Google OAuth callback and the privacy-policy URL.

**Do not send real invitations from the testing instance.** Portal links embed the domain, and every link issued from `mikehelm.com/SPV` breaks the moment the app moves — leaving investors holding dead links to a securities offer. Test sends to David's own address only. The migration therefore has to happen before the pre-flight checklist can be completed, and the app should refuse to send if its configured base URL does not match the production value in configuration.

Old guidance retained for reference: deploy at `invest.flipit.com`. `flipit.com` is the live brand domain and its DNS is already managed; adding a subdomain does not touch the existing site. `flipthepage.com` is mail-only with no website, and `mikehelm.com` is a personal domain — a securities invitation hosted on either reads as improvised, and the whole point of this portal is that it does not. Use `mikehelm.com` only as a fallback if `flipit.com` DNS turns out to be inaccessible. A managed platform (Vercel or similar) with a managed Postgres and a managed queue is appropriate at this scale — expect roughly USD 20–50/month, plus AI API usage which at 15–40 recipients is negligible. A real domain is needed *before* Gmail verification can start, because the privacy policy has to be hosted on it, so stand the domain and a placeholder privacy policy up early even if the app is not ready.

## 19. Pre-flight checklist before the first send

Completed once per batch. It unlocks per-recipient sending; it does not itself send anything.

Every item is an explicit confirmation, and the §8 gates are machine-enforced rather than merely ticked.

- Recipient file reviewed
- No missing or duplicate emails
- All percentages and amounts validated
- Deadlines present and future-dated
- Recipients outside the approved jurisdiction list identified and excluded from this batch *(enforced per-recipient, §8.2)*
- Sender identity confirmed, and `sender_phone` resolves for every recipient *(enforced, §11.2)*
- Template renders cleanly for every recipient in the batch, with no unresolved variables *(enforced, §11.4)*
- Service mode is `active` *(enforced, §7)*
- Mail connection verified within the session *(enforced, §8.1)*
- Test email sent and reviewed
- Final email template approved, and its hash matches the compliance approval *(enforced, §8.2)*
- Compliance approval recorded and current, for both the invitation template and the reminder template *(enforced, §8.2)*

## 20. Export

CSV and XLSX containing: recipient details · jurisdiction · offer details · proposed, committed, accepted and received amounts · send status and timestamps · account status and history · timeline status and timestamps · response status and timestamps · investor questions · admin replies · updated contact email · internal notes. An audit-log export is available separately to the owner.

## 21. After the round closes

Investors currently see nothing about each other or about the round's progress — that is deliberate and stays that way through the raise. Once the round closes, the portal becomes the tool for SPV members, and the following become worth adding. Listed so the v1 data model does not paint them into a corner.

- **Round summary and cap table.** Total raised, number of participants, each member's own percentage shown against the whole. Safe to reveal once the round is closed and nobody is being influenced into a decision.
- **Holdings statement.** A per-member page: what they hold, what they paid, when, and the documents behind it. The thing they will come back for.
- **Periodic company updates** with read tracking, so David knows who is actually engaged.
- **A shared Q&A.** One good question answered once, published anonymised to everyone. Turns twenty repeated conversations into one.
- **Document vault with e-signature**, replacing the manual document issuance in §5.
- **KYC/AML collection**, if the structure comes to require it.
- **Waitlist and secondary interest register** — who wanted in and could not get an allocation. That list is the start of the next round.
- **Member introductions.** Existing members refer the next round's participants. This is the same creator-led loop FLIPIT itself runs on, applied to capital.
- **Registry export** in whatever format the BVI agent wants, so the portal is the source of truth rather than a parallel spreadsheet.
- **Distribution tracking**, if and when there is anything to distribute.

## 21.2 Phase two — deferred regardless

Follow-up sequences by response status · document delivery and e-signature · KYC/AML workflow · payment integration and automatic reconciliation against `FundsReceipt` · subsequent rounds and advancement offers on existing accounts (§4.3) · reporting and analytics.

## 22. Acceptance criteria

1. Uploading the sample CSV creates valid recipient records; a file with errors cannot be sent.
2. Indirect ownership is calculated correctly, stored as an exact decimal, and the override is respected.
3. The preview exactly matches the sent email snapshot.
4. Each send produces one personalized email to one recipient and records its result individually. No bulk-send path exists anywhere in the UI or API.
5. Investor links reveal no personal data in the URL.
6. **Sending is impossible without a current compliance approval, and editing one character of the template disables sending until re-approval.**
7. **A recipient in a jurisdiction outside the approved list is blocked individually, with the reason shown, while the rest of the batch proceeds.**
8. **The dashboard shows mail connection health, and a missing or rejected credential blocks sending with a specific message.**
9. Claiming an invitation creates a verified, persistent investor account that can be signed back into later without the original link.
10. **Suspending or closing an account immediately ends its sessions and invalidates its links.** A suspended account cannot obtain a new sign-in link. A closed account can, and reaches a read-only view, when `closed_account_access` is `read_only`.
11. An investor sees their status advance through commitment, acceptance, and funds received, with the amounts and dates the operator recorded.
12. Recording funds received requires two-step confirmation and is written to the audit log.
13. A published update appears in the intended investors' portals and in no one else's, and its notification email contains no financial detail.
14. Setting the service to read-only, sunset, or disabled produces the behaviour in §7, and the owner retains access and export throughout.
15. An investor account can hold a second offer under a second round without schema changes.
16. David can reply and the message is logged against the correct record and thread.
17. Mike can view and export all data, including the audit log.
18. Unauthorized users cannot access investor or admin records. An unknown address cannot sign in and no record is created for it. Sign-in is enumeration-resistant: an unknown address and a wrong password fail identically.
19. **The operator cannot record, amend, or void a compliance approval; the control is owner-only and the attempt is logged.**
20. **Sending is unavailable in `read_only`, `sunset`, and `disabled` service modes.**
21. A recipient row missing `sender_phone` with no configured default is caught at pre-flight, before the batch starts — not as a mid-batch failure.
22. A file containing an invalid jurisdiction code blocks the whole file; a file containing a valid code that is merely outside the approved list does not.
23. **A spreadsheet with unfamiliar column names, extra columns and mixed date formats produces a mapping proposal that David can correct, and imports correctly once confirmed.**
24. **The app imports a file with no AI key configured, using manual column mapping.**
25. **The AI key is never displayed after saving, never logged, and never exported.**
26. **A percentage column that could read as 5% or 0.05 raises an explicit question rather than being coerced.**
27. **No AI output is used in any monetary calculation** — the indirect-ownership figure is identical whether or not AI was used to import.
28. **A reminder sends only to non-responders, respects the per-recipient cap, contains no offer terms, and requires its own approved template.**
29. **A queued reminder can be cancelled before it sends, and the cancellation is logged.**
30. The "Coming to your portal" tiles render without promising returns, dates, or specific functionality, and are configurable by the owner.
31. **The portal renders correctly and legibly at 375px width, and text contrast meets WCAG AA against the dark palette.**
32. **An uploaded image is served from the app's own domain, stripped of EXIF, and available to both the portal and the email templates.**
33. **David can record or upload a video, preview it in the real portal layout, replace it, and publish it — and nothing is investor-visible until he publishes.**
34. **The flow prompts David to send himself a complete test invitation, including his video, before any real send is possible.**
35. **No investor-facing screen reveals the existence, identity, count, or aggregate contribution of any other investor.**
36. **A question submitted from the portal reaches David's queue and emails him, and the asker sees a confirmation.**
37. **An answer defaults to private — visible only to the asker — and is published only when the box is explicitly ticked.**
38. **A published entry shows no name, initials, email, or identifying timestamp, and David can rewrite the question text for publication while the original is preserved on the record.**
39. **The answer email to the asker is not sent until David presses send.**
40. **David can create and publish a Q&A entry with no question behind it.**
41. **Unpublishing removes an entry from the shared page and is audit-logged.**
42. **Reaching Funds received generates a branded PDF certificate the investor can download, carrying the correct figures and the not-a-share-certificate footer.**
43. **The anti-phishing page is publicly reachable without sign-in, is the only indexed route, and names the exact sending address and link domain.**
44. **The app refuses to send real invitations when its configured base URL is not the production value.**
45. **The blocked US recipient produces an explanation to the operator, and can only be unblocked with a recorded approval reference.**
46. **An investor can join and leave the register of interest from their portal, and never sees their position or anyone else's.**
47. **The register order is computed from funds-received date, then commitment date, then join date, and an operator override requires a recorded reason.**
48. **An offer issued from the register passes through the jurisdiction gate and compliance approval exactly as an original offer does.**
