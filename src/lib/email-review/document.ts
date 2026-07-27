/**
 * The internal comparison shown only after an owner/operator guard.
 *
 * These constants intentionally duplicate the two repository artifacts rather
 * than reading or importing a Markdown rationale at runtime. The tests compare
 * them byte-for-byte (ignoring the final newline) with the canonical source
 * files, so a copy-paste change cannot silently drift.
 */

export const ORIGINAL_EMAIL_TEXT = `HI Mike,

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

David Serene`

export const REVISED_EMAIL_TEXT = `Subject: Private invitation to participate in Flipit

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
{{sender_phone}}`

export type EmailReviewEvidenceKind = 'SPEC' | 'TEST' | 'UNVERIFIED'

export interface EmailReviewClause {
  id: string
  title: string
  original: string
  revised: string
  reason: string
  evidenceKind: EmailReviewEvidenceKind
  evidence: string
}

export const EMAIL_REVIEW_CLAUSES = [
  {
    id: 'subject',
    title: 'Subject',
    original: 'Investment opportunities in Flipit',
    revised: 'Private invitation to participate in Flipit',
    reason: 'Reason not recorded anywhere.',
    evidenceKind: 'UNVERIFIED',
    evidence: 'Reason not recorded anywhere.',
  },
  {
    id: 'greeting',
    title: 'Personalized greeting',
    original: 'Dear XXXXX',
    revised: 'Dear {{recipient_name}},',
    reason:
      'The specification requires the recipient-name template variable and requires unresolved variables to fail before sending.',
    evidenceKind: 'SPEC',
    evidence: 'BUILD_SPEC.md §§11.1, 11.4.',
  },
  {
    id: 'opening-context',
    title: 'Opening and process context',
    original:
      'I hope you are doing well. I am contacting you today because I believe you may be interested…',
    revised:
      'Two new paragraphs beginning “Flipit has completed…” and “Before pursuing broader financing…”',
    reason: 'Reason not recorded anywhere.',
    evidenceKind: 'UNVERIFIED',
    evidence: 'Reason not recorded anywhere.',
  },
  {
    id: 'vehicle',
    title: 'Vehicle and proposed acquisition',
    original:
      'A BVI holding company “intends to acquire a 30% equity stake” in Flipit Hong Kong for USD 30,000.',
    revised:
      'A BVI SPV “may acquire up to 30%” of Flipit Global Limited for a total aggregate investment of USD 30,000.',
    reason:
      'The repository regression test requires this sentence as part of the approved invitation copy. No further reason is recorded.',
    evidenceKind: 'TEST',
    evidence:
      'src/lib/email/templates/templates.test.ts — “reproduces the approved copy from EMAIL_TEMPLATE.txt”.',
  },
  {
    id: 'offer-figures',
    title: 'Recipient-specific offer figures',
    original:
      'No recipient-specific investment amount, SPV percentage or indirect Flipit percentage.',
    revised:
      'Proposed investment, proposed SPV ownership and approximate indirect Flipit interest use recipient variables.',
    reason:
      'The specification requires these invitation variables and requires the offer figures to appear together in a self-contained bordered panel.',
    evidenceKind: 'SPEC',
    evidence: 'BUILD_SPEC.md §§11.1, 11.5.',
  },
  {
    id: 'thirty-percent-assumption',
    title: 'Thirty-percent assumption',
    original: 'No indirect-interest calculation or caveat.',
    revised:
      'The indirect interest assumes the SPV completes its proposed acquisition of 30% of Flipit Global Limited.',
    reason:
      'The template test requires the self-contained offer panel to carry its own caveat because it may be read separately.',
    evidenceKind: 'TEST',
    evidence:
      'src/lib/email/templates/templates.test.ts — “puts the offer figures in a bordered panel that survives being read alone”.',
  },
  {
    id: 'new-investment',
    title: 'New investment and governing documents',
    original: 'No equivalent statement.',
    revised:
      'This is a new investment in the current structure and will be governed by new subscription and SPV documentation.',
    reason: 'Reason not recorded anywhere.',
    evidenceKind: 'UNVERIFIED',
    evidence: 'Reason not recorded anywhere.',
  },
  {
    id: 'david-role',
    title: 'David’s role and authority',
    original:
      'The agreement “will appoint me as Chief Executive Officer with full executive authority”.',
    revised:
      'David is “expected to assume” the CEO role, subject to agreements and formal corporate approvals.',
    reason: 'Reason not recorded anywhere.',
    evidenceKind: 'UNVERIFIED',
    evidence: 'Reason not recorded anywhere.',
  },
  {
    id: 'endorsement',
    title: 'Personal investment and growth endorsement',
    original:
      'David says he decided to invest alongside others and believes Flipit offers significant growth potential.',
    revised: 'Removed.',
    reason: 'Reason not recorded anywhere.',
    evidenceKind: 'UNVERIFIED',
    evidence: 'Reason not recorded anywhere.',
  },
  {
    id: 'deadline',
    title: 'Response deadline',
    original: 'Reply within the next 10 days.',
    revised: 'Please respond no later than {{response_deadline}}.',
    reason:
      'The workflow stores and reviews a per-recipient deadline, and the invitation template requires the deadline variable.',
    evidenceKind: 'SPEC',
    evidence: 'BUILD_SPEC.md §§3, 11.1.',
  },
  {
    id: 'response-effect',
    title: 'Deemed refusal and response effect',
    original:
      'If I do not hear from you, I will assume that you have decided not to participate.',
    revised:
      'The deemed-refusal sentence is removed; the template says a response does not create a binding investment commitment.',
    reason:
      'The invitation test requires the non-binding sentence and rejects wording that says the recipient agrees to subscribe or invest.',
    evidenceKind: 'TEST',
    evidence:
      'src/lib/email/templates/templates.test.ts — “does not present a response as a binding subscription — §8.2”.',
  },
  {
    id: 'other-investors',
    title: 'Other investors and proportional allocation',
    original:
      'References other investors, responses from all potential investors and possible proportional allocation.',
    revised: 'Removed.',
    reason:
      'The invitation test prohibits references to other investors, remaining allocation and round progress.',
    evidenceKind: 'TEST',
    evidence:
      'src/lib/email/templates/templates.test.ts — “says nothing about any other investor — §35”.',
  },
  {
    id: 'portal',
    title: 'Secure portal and persistent record',
    original: 'No portal; responses and questions are handled by replying to the email.',
    revised:
      'A secure link opens the recipient’s private portal for responding, questions, updates, documents and the persistent process record.',
    reason:
      'The specified workflow requires a single-use claim link, a private persistent account and the recipient’s own offer record.',
    evidenceKind: 'SPEC',
    evidence: 'BUILD_SPEC.md §§1, 3, 4.',
  },
  {
    id: 'non-binding',
    title: 'No payment and no binding commitment',
    original: 'No equivalent non-binding sentence.',
    revised:
      'No payment is requested at this stage, and submitting a response does not create a binding investment commitment.',
    reason:
      'The approved-copy test requires this sentence and separately enforces that the response is not presented as a binding subscription.',
    evidenceKind: 'TEST',
    evidence:
      'src/lib/email/templates/templates.test.ts — approved-copy and non-binding-subscription assertions.',
  },
  {
    id: 'documents',
    title: 'Documents before payment',
    original:
      'Before funds are requested, participating investors receive the proposed structure and legal documentation.',
    revised:
      'Before investment is accepted or funds requested, recipients receive the SPV structure, subscription documents, risk disclosures and other relevant materials.',
    reason:
      'The specified investor timeline places documents issued before commitment, allocation acceptance, payment instructions and funds received.',
    evidenceKind: 'SPEC',
    evidence: 'BUILD_SPEC.md §5.',
  },
  {
    id: 'payment-warning',
    title: 'Payment-instruction warning',
    original: 'No equivalent warning.',
    revised:
      'Bank details are never changed by email; payment instructions must be verified with David by voice.',
    reason:
      'The anti-phishing specification requires a standing warning that payment details will never be changed by email and requires it to match the invitation.',
    evidenceKind: 'SPEC',
    evidence: 'BUILD_SPEC.md §15.1.',
  },
  {
    id: 'declined-allocation',
    title: 'Declined or unanswered allocation',
    original:
      'Discusses allocating oversubscribed interest among people who confirm interest.',
    revised:
      'A declined or unanswered proposed allocation may be offered to other eligible participants or used for another company-approved purpose.',
    reason:
      'The approved-copy regression test requires the current reallocation sentence. No further reason is recorded.',
    evidenceKind: 'TEST',
    evidence:
      'src/lib/email/templates/templates.test.ts — “reproduces the approved copy from EMAIL_TEMPLATE.txt”.',
  },
  {
    id: 'questions',
    title: 'Questions and contact route',
    original: 'Please feel free to contact me.',
    revised: 'Contact David through the private portal or reply to the email.',
    reason:
      'The workflow allows an investor to ask a question in the private portal and requires replies to remain attached to the correct record and email thread.',
    evidenceKind: 'SPEC',
    evidence: 'BUILD_SPEC.md §§3, 6.7, 14.',
  },
  {
    id: 'titles',
    title: 'David’s closing titles',
    original: 'David Serene',
    revised:
      'David Serene; SPV Manager; Proposed Chief Executive Officer, Flipit Global Limited.',
    reason: 'Reason not recorded anywhere.',
    evidenceKind: 'UNVERIFIED',
    evidence: 'Reason not recorded anywhere.',
  },
  {
    id: 'sender-fields',
    title: 'Sender contact fields',
    original: 'No sender email or phone in the closing.',
    revised: '{{sender_email}} and {{sender_phone}}.',
    reason:
      'The invitation requires sender-email and sender-phone variables with an explicit resolution order; an unresolved sender phone blocks sending.',
    evidenceKind: 'SPEC',
    evidence: 'BUILD_SPEC.md §§11.1, 11.2.',
  },
] as const satisfies readonly EmailReviewClause[]

export interface EmailReviewDocument {
  original: {
    title: string
    attribution: string
    text: string
  }
  revised: {
    title: string
    attribution: string
    text: string
  }
  clauses: readonly EmailReviewClause[]
}

export const EMAIL_REVIEW_DOCUMENT: EmailReviewDocument = {
  original: {
    title: 'David’s original draft',
    attribution:
      'From David Serene to Michael Helm, subject “Investment opportunities in Flipit”, sent 25 July 2026 at 18:32 ICT.',
    text: ORIGINAL_EMAIL_TEXT,
  },
  revised: {
    title: 'Current invitation template',
    attribution:
      'Canonical EMAIL_TEMPLATE.txt at commit 4b58585, SHA-256 f1491501…ff65554.',
    text: REVISED_EMAIL_TEXT,
  },
  clauses: EMAIL_REVIEW_CLAUSES,
}

export function findEmailReviewClause(id: string): EmailReviewClause | null {
  return EMAIL_REVIEW_CLAUSES.find((clause) => clause.id === id) ?? null
}
