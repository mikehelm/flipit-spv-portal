# Flipit investor-email provenance

> **INTERNAL ONLY — owner, operator and compliance approver.**
>
> Never render, import, serve or link this document, `SOURCE_RECEIPT.md`, or
> `David_Serene_Original_Email_2026-07-25.txt` from an investor-facing page,
> response or error. David's original identifies other investors and describes
> proportional allocation. Exposing it would violate the portal's investor
> isolation rule.

This record preserves the two texts and identifies what the repository does and
does not establish about their differences. It is not legal advice. The
rewrite's authorship and rationale were not recovered; `SOURCE_RECEIPT.md`
records the provenance and remaining uncertainty. No missing rationale has been
reconstructed.

## 1. David Serene's original

**Attribution:** Email from David Serene (`serenedavid@gmail.com`) to Michael
Helm (`mikehelm@gmail.com`), subject **“Investment opportunities in Flipit”**,
sent `2026-07-25T11:32:43Z` (`18:32:43` at `UTC+07:00`). The text below is the
verbatim Gmail plaintext rendering preserved in
`David_Serene_Original_Email_2026-07-25.txt`.

```text
HI Mike,

Please find below the email I am planning to send to investors

Thanks for your comments

David




Dear XXXXX

I hope you are doing well.

I am contacting you today because I believe you may be interested in participating in a new investment opportunity related to Flipit.

I am currently in the process of establishing a holding company in the British Virgin Islands (BVI), which intends to acquire a 30% equity stake in Flipit Hong Kong for a total investment of USD 30,000.

The majority shareholder of Flipit Hong Kong is Mike Helm. We are currently finalizing a shareholders' agreement that will appoint me as Chief Executive Officer with full executive authority over the company's operations, including recruitment, financing, and execution of the business plan.

After reviewing the platform and agreeing on the governance framework with the majority shareholder, I have decided to personally invest alongside the other investors under the same terms. I believe Flipit is now ready for commercial launch and offers significant growth potential.

If you are interested in participating in this investment, please reply to this email within the next 10 days. If I do not hear from you by then, I will assume that you have decided not to participate.

Once I have received responses from all the potential investors, I will determine the allocation of the investment opportunity among those who have confirmed their interest. If the total amount of interest exceeds the available investment, the allocation may be made on a proportional basis or according to another fair allocation method.

Before any funds are requested, I will provide all participating investors with the proposed investment structure and the legal documentation for their review.

If you have any questions or would like additional information before making a decision, please feel free to contact me.

Kind regards,

David Serene
```

## 2. Current template

**Source:** `EMAIL_TEMPLATE.txt`, verified at canonical commit `4b58585` as
3,249 bytes with SHA-256
`f1491501cdf2c8a2e00309fd53a14a6d3dbc3f9f884bf7eaf8a4084f5ff65554`.
The text below is verbatim.

```text
Subject: Private invitation to participate in Flipit

Dear {{recipient_name}},

Flipit has completed an extended period of development, planning, and corporate restructuring. The company is now moving into a more active phase focused on commercial launch, product activation, promotion, new feature releases, and user growth.

Before pursuing broader financing, we are first completing a limited private investment process with a carefully selected group of individuals who are familiar with Flipit and who we believe could be valuable participants in its next stage.

A British Virgin Islands special purpose vehicle, or SPV, is being established to invest in Flipit Global Limited, the Hong Kong company that owns and operates the current Flipit business. The SPV may acquire up to 30% of Flipit Global Limited for a total aggregate investment of USD 30,000.

We would like to offer you the following opportunity:

Proposed investment: USD {{investment_amount}}
Proposed ownership of the SPV: {{spv_percentage}}%
Approximate indirect economic interest in Flipit Global Limited: {{indirect_flipit_percentage}}%

The indirect interest shown above assumes the SPV completes its proposed acquisition of 30% of Flipit Global Limited.

This is a new investment in the current structure and will be governed by new subscription and SPV documentation.

David Serene is leading the formation and administration of the SPV and will coordinate the investment process. He is also expected to assume the role of Chief Executive Officer of Flipit Global Limited, subject to completion of the relevant agreements and formal corporate approvals.

Please respond no later than {{response_deadline}} by using the secure private link below:

{{secure_portal_link}}

The link opens your own private portal. It will display this offer and allow you to indicate whether you wish to proceed, ask questions, or update your preferred email address. The portal remains yours for the duration of this process: you can return to it at any time to see where things stand, read updates, access your documents, and see confirmation once your participation has been accepted and any funds received. If you return later without this email, simply enter your address and a fresh sign-in link will be sent to you.

No payment is requested at this stage, and submitting a response does not create a binding investment commitment.

Before any investment is accepted or funds are requested, you will receive the proposed SPV structure, subscription documents, risk disclosures, and other relevant materials for review.

Please note that we will never email you a change of bank details. When payment instructions are issued, verify them with David by voice before transferring any funds.

If you decline or do not respond by the deadline, your proposed allocation may be offered to other eligible participants or used for another company-approved purpose, subject to the final documents and applicable law.

For questions about the investment, your proposed allocation, or the SPV, please contact David through the private portal or reply to this email.

Kind regards,

David Serene
SPV Manager
Proposed Chief Executive Officer, Flipit Global Limited
{{sender_email}}
{{sender_phone}}
```

## 3. Clause-by-clause comparison

The reason column reports only what the cited repository evidence establishes.
`UNVERIFIED` means the reason was not recorded; it is not an invitation to infer
one.

| Clause | Original wording | Current wording | Reason | Evidence |
|---|---|---|---|---|
| Subject | `Investment opportunities in Flipit` | `Private invitation to participate in Flipit` | Reason not recorded anywhere. | UNVERIFIED — Reason not recorded anywhere. |
| Personalized greeting | `Dear XXXXX` | `Dear {{recipient_name}},` | The specification requires the recipient-name template variable and requires unresolved variables to fail before sending. | SPEC — BUILD_SPEC.md §§11.1, 11.4. |
| Opening and process context | `I hope you are doing well.` and `I am contacting you today because I believe you may be interested...` | Two new paragraphs beginning `Flipit has completed...` and `Before pursuing broader financing...` | Reason not recorded anywhere. | UNVERIFIED — Reason not recorded anywhere. |
| Vehicle and proposed acquisition | `a holding company in the British Virgin Islands (BVI), which intends to acquire a 30% equity stake in Flipit Hong Kong for a total investment of USD 30,000` | `A British Virgin Islands special purpose vehicle... may acquire up to 30% of Flipit Global Limited for a total aggregate investment of USD 30,000.` | The repository regression test requires this sentence as part of the approved invitation copy. No further reason is recorded. | TEST — src/lib/email/templates/templates.test.ts, assertion “reproduces the approved copy from EMAIL_TEMPLATE.txt”. |
| Recipient-specific offer figures | No recipient-specific investment amount, SPV percentage or indirect Flipit percentage. | `Proposed investment`, `Proposed ownership of the SPV`, and `Approximate indirect economic interest...` use recipient variables. | The specification requires these invitation variables and requires the offer figures to appear together in a self-contained bordered panel. | SPEC — BUILD_SPEC.md §§11.1, 11.5. |
| Thirty-percent assumption | No indirect-interest calculation or caveat. | `The indirect interest shown above assumes the SPV completes its proposed acquisition of 30%...` | The template test requires the self-contained offer panel to carry its own caveat because it may be read separately. | TEST — src/lib/email/templates/templates.test.ts, assertion “puts the offer figures in a bordered panel that survives being read alone”. |
| New-investment and governing-document statement | No equivalent statement. | `This is a new investment in the current structure and will be governed by new subscription and SPV documentation.` | Reason not recorded anywhere. | UNVERIFIED — Reason not recorded anywhere. |
| David's role and authority | `will appoint me as Chief Executive Officer with full executive authority...` | `expected to assume the role of Chief Executive Officer... subject to completion of the relevant agreements and formal corporate approvals.` | Reason not recorded anywhere. | UNVERIFIED — Reason not recorded anywhere. |
| Personal investment and growth endorsement | `I have decided to personally invest alongside the other investors...` and `offers significant growth potential.` | Removed. | Reason not recorded anywhere. | UNVERIFIED — Reason not recorded anywhere. |
| Response deadline | `reply to this email within the next 10 days` | `Please respond no later than {{response_deadline}}...` | The workflow stores and reviews a per-recipient deadline, and the invitation template requires the deadline variable. | SPEC — BUILD_SPEC.md §§3, 11.1. |
| Deemed refusal and response effect | `If I do not hear from you by then, I will assume that you have decided not to participate.` | Removed; the template instead says `submitting a response does not create a binding investment commitment.` | The invitation test requires the non-binding sentence and rejects wording that says the recipient agrees to subscribe or invest. | TEST — src/lib/email/templates/templates.test.ts, assertion “does not present a response as a binding subscription — §8.2”. |
| References to other investors and proportional allocation | `alongside the other investors`, `responses from all the potential investors`, and allocation `on a proportional basis` | Removed. | The invitation test prohibits references to other investors, remaining allocation and round progress. | TEST — src/lib/email/templates/templates.test.ts, assertion “says nothing about any other investor — §35”. |
| Secure portal and persistent record | No portal. Responses and questions are handled by replying to the email. | A secure link opens the recipient's private portal for responding, questions, updates, documents and the persistent process record. | The specified workflow requires a single-use claim link, a private persistent account and the recipient's own offer record. | SPEC — BUILD_SPEC.md §§1, 3, 4. |
| No payment and no binding commitment at this stage | No equivalent non-binding sentence. | `No payment is requested at this stage, and submitting a response does not create a binding investment commitment.` | The approved-copy test requires this sentence, and a separate assertion enforces that the response is not presented as a binding subscription. | TEST — src/lib/email/templates/templates.test.ts, assertions “reproduces the approved copy from EMAIL_TEMPLATE.txt” and “does not present a response as a binding subscription — §8.2”. |
| Documents before payment | `Before any funds are requested, I will provide... the proposed investment structure and the legal documentation...` | `Before any investment is accepted or funds are requested, you will receive the proposed SPV structure, subscription documents, risk disclosures, and other relevant materials...` | The specified investor timeline places documents issued before commitment, allocation acceptance, payment instructions and funds received. | SPEC — BUILD_SPEC.md §5. |
| Payment-instruction warning | No equivalent warning. | `we will never email you a change of bank details` and instructions to verify payment details with David by voice. | The anti-phishing specification requires a standing warning that payment details will never be changed by email and requires it to match the invitation. | SPEC — BUILD_SPEC.md §15.1. |
| Treatment of a declined or unanswered allocation | The original discusses allocating oversubscribed interest among people who respond. | `If you decline or do not respond by the deadline, your proposed allocation may be offered to other eligible participants...` | The approved-copy regression test requires the current reallocation sentence. No further reason is recorded. | TEST — src/lib/email/templates/templates.test.ts, assertion “reproduces the approved copy from EMAIL_TEMPLATE.txt”. |
| Questions and contact route | `please feel free to contact me` | Contact David through the private portal or reply to the email. | The specified workflow allows an investor to ask a question in the private portal and requires David's replies to remain attached to the correct record and email thread. | SPEC — BUILD_SPEC.md §§3, 6.7, 14. |
| David's closing titles | `David Serene` | `David Serene`, `SPV Manager`, and `Proposed Chief Executive Officer, Flipit Global Limited` | Reason not recorded anywhere. | UNVERIFIED — Reason not recorded anywhere. |
| Sender contact fields | No sender email or phone in the closing. | `{{sender_email}}` and `{{sender_phone}}` | The invitation requires sender-email and sender-phone variables with an explicit resolution order; an unresolved sender phone blocks sending. | SPEC — BUILD_SPEC.md §§11.1, 11.2. |
