# Investor Portal Copy

**Version 5.2 · 2026-07-25** — extended for persistent accounts, the status timeline, the updates feed, and service wind-down states.

All wording below is a starting draft. Anything describing the offer, the response, or the acceptance of funds should be reviewed by the compliance approver before the first send (Build Spec §8.2).

Template variables used on this page are declared in Build Spec §11.3. Rendering fails loudly on any unresolved variable, so do not introduce a new one here without adding it there.

---

## Header

Private Flipit Investment Invitation

## Intro

This page displays the personalized invitation sent to you, and it will remain your private record of this process. Please review the offer below and select a response. Your response is not a binding subscription and no payment is requested at this stage.

## Signing back in

This is your private portal. You can return to it at any time by entering your email address below — we will send you a fresh sign-in link. Only the email address this invitation was sent to can access this record.

*(If the address is unknown, the response must be identical to a known address: "If that address has a record with us, a sign-in link is on its way.")*

---

## Response choices

- I am interested in receiving the formal investment documents.
- I am not interested at this time.
- I have a question before deciding.

## Optional message

Questions or comments

## Email update

Use a different contact email. A verification message must be completed before the new address replaces the current one.

## Confirmation

Thank you. Your response has been recorded. You may update it through this private portal until the stated deadline.

---

## Status timeline

**Where things stand**

Each step below updates as the process moves forward. You will not need to do anything until a step asks you to.

| Step | Investor-facing label | Explanation shown beside it |
|---|---|---|
| 1 | Invitation sent | Your personalized invitation was sent on {{date}}. |
| 2 | Your response recorded | You told us you are {{response}} on {{date}}. You can change this until {{deadline}}. |
| 3 | Documents issued | The proposed SPV structure, subscription documents and risk disclosures have been sent to you for review. |
| 4 | Commitment agreed | You have confirmed the amount you wish to invest. This becomes binding only to the extent the signed documents say so. |
| 5 | Allocation accepted | The company has accepted your allocation. Your confirmed participation is {{amount}} for {{spv_percentage}}% of the SPV. |
| 6 | Payment instructions issued | Payment instructions were sent to you on {{date}}. Always verify payment details directly with David before transferring funds. |
| 7 | Funds received | We confirm receipt of {{currency}} {{amount}} on {{value_date}}. Reference: {{reference}}. |
| 8 | Completed | Your participation is recorded. Ongoing updates will appear below. |

Steps not yet reached are shown greyed with the note: *Not yet reached. There is nothing for you to do at this stage.*

## Payment safety notice

*(Shown from step 6 onward, prominently.)*

We will never email you a change of bank details. If you receive any message appearing to change payment instructions, do not act on it — contact David directly using the number you already have for him and confirm by voice before sending any funds.

---

## Updates

**Updates**

Notices and progress reports from David appear here, newest first. This is the authoritative place for updates on the SPV and on Flipit.

*(Empty state:)* There are no updates yet. You will be notified by email when one is published.

## Update notification email

Subject: A new update is available in your Flipit investor portal

There is a new update waiting for you in your private portal.

{{portal_link}}

For your security, updates are not included in this email.

---

## Questions and answers

**Ask a question**

Have a question about the SPV, the structure, or your allocation? Ask it here and David will come back to you by email. You'll also see his answer on this page.

*(Placeholder in the box:)* What would you like to know?

**After submitting**

Thank you — your question has been sent to David. He'll reply by email, and the answer will appear here too.

**Shared answers**

**Common questions**

Questions other people have asked, answered by David. Names are never shown — if you ask something here, nobody else sees that it came from you.

*(Empty state:)* No shared questions yet. If you have one, ask above.

**Your own questions**

Your questions and David's replies to you. These are private to you unless David marks an answer as generally useful, in which case the question appears in Common questions above with your name removed.

---

## Register of interest

**Register of interest**

If further allocations become available, we contact people from this register.

Adding your name records your interest. It does not reserve an allocation, create any entitlement to one, or oblige anyone to offer you anything. Whether anything becomes available at all, and whether it is offered to you, depends on circumstances at the time, on the final SPV and subscription documents, and on applicable law.

Where we are able to make an offer, we work through the register beginning with those who completed their own participation earliest — commitment agreed and funds settled. Joining the register does not itself create a position; completing your current participation does.

*(Button:)* Add my name to the register

*(Optional field:)* If more became available, roughly how much would interest you? Indicative only — this is not a commitment and nothing is held on the basis of it.

*(Once joined:)* Your name is on the register. We'll be in touch if anything becomes available. You can remove yourself at any time.

*(Button:)* Remove my name

---

## Documents

Documents issued to you appear here. Download and keep your own copies — access to this portal may end after the process concludes.

---

## Account states

**Suspended**

Access to this portal is temporarily unavailable. Please contact David at {{sender_email}} if you have any questions.

**Closed**

This process has concluded for your record. If you need a copy of your documents or correspondence, please contact David at {{sender_email}}.

**Read-only**

This portal is currently read-only. You can view your record and download your documents, but responses and messages are not being accepted at this time.

**Sunset notice**

This portal will close on {{closing_date}}. Please download any documents or correspondence you wish to keep before that date. After it closes, please contact David at {{sender_email}} for anything you need.

**Service closed**

The Flipit investor portal is no longer available. For any questions about your record, please contact {{contact_email}}.

---

## Footer notice

*(Beneath the notice below, small and dimmed:)* Made by Make with Mike

This portal displays your own record only. Nothing shown here is an offer to the public, investment advice, or a recommendation. The formal terms of any investment are set out solely in the subscription and SPV documents you receive. If anything here appears inconsistent with those documents, the documents govern.
