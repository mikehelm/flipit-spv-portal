import type { EmailTemplateSource } from '@/lib/email/templates'
import type { TemplateSourceParts } from '@/lib/compliance/diff'

export interface EmailReviewSection {
  id: string
  title: string
  currentText: string
  editable: boolean
  lockedReason?: string
  subjectNeedle?: string
  htmlNeedle?: string
  textNeedle?: string
}

const EDITABLE_SECTIONS: readonly EmailReviewSection[] = [
  {
    id: 'subject',
    title: 'Subject',
    currentText: 'Private invitation to participate in Flipit',
    editable: true,
    subjectNeedle: 'Private invitation to participate in Flipit',
  },
  {
    id: 'opening-context',
    title: 'Opening and company context',
    currentText:
      'Flipit has completed an extended period of development, planning, and corporate restructuring. The company is now moving into a more active phase focused on commercial launch, product activation, promotion, new feature releases, and user growth.',
    editable: true,
    htmlNeedle:
      'Flipit has completed an extended period of development, planning, and corporate restructuring. The company is now moving into a more active phase focused on commercial launch, product activation, promotion, new feature releases, and user growth.',
    textNeedle:
      'Flipit has completed an extended period of development, planning, and corporate restructuring. The company is now moving into a more active phase focused on commercial launch, product activation, promotion, new feature releases, and user growth.',
  },
  {
    id: 'private-process',
    title: 'Private process',
    currentText:
      'Before pursuing broader financing, we are first completing a limited private investment process with a carefully selected group of individuals who are familiar with Flipit and who we believe could be valuable participants in its next stage.',
    editable: true,
    htmlNeedle:
      'Before pursuing broader financing, we are first completing a limited private investment process with a carefully selected group of individuals who are familiar with Flipit and who we believe could be valuable participants in its next stage.',
    textNeedle:
      'Before pursuing broader financing, we are first completing a limited private investment process with a carefully selected group of individuals who are familiar with Flipit and who we believe could be valuable participants in its next stage.',
  },
  {
    id: 'vehicle',
    title: 'Vehicle and proposed acquisition',
    currentText:
      'A British Virgin Islands special purpose vehicle, or SPV, is being established to invest in Flipit Global Limited, the Hong Kong company that owns and operates the current Flipit business. The SPV may acquire up to 30% of Flipit Global Limited for a total aggregate investment of USD 30,000.',
    editable: true,
    htmlNeedle:
      'A British Virgin Islands special purpose vehicle, or SPV, is being established to invest in Flipit Global Limited, the Hong Kong company that owns and operates the current Flipit business. The SPV may acquire up to 30% of Flipit Global Limited for a total aggregate investment of USD 30,000.',
    textNeedle:
      'A British Virgin Islands special purpose vehicle, or SPV, is being established to invest in Flipit Global Limited, the Hong Kong company that owns and operates the current Flipit business. The SPV may acquire up to 30% of Flipit Global Limited for a total aggregate investment of USD 30,000.',
  },
  {
    id: 'offer-intro',
    title: 'Offer introduction',
    currentText: 'We would like to offer you the following opportunity:',
    editable: true,
    htmlNeedle: 'We would like to offer you the following opportunity:',
    textNeedle: 'We would like to offer you the following opportunity:',
  },
  {
    id: 'new-investment',
    title: 'New investment and documents',
    currentText:
      'This is a new investment in the current structure and will be governed by new subscription and SPV documentation.',
    editable: true,
    htmlNeedle:
      'This is a new investment in the current structure and will be governed by new subscription and SPV documentation.',
    textNeedle:
      'This is a new investment in the current structure and will be governed by new subscription and SPV documentation.',
  },
  {
    id: 'david-role',
    title: 'David’s role and authority',
    currentText:
      '{{sender_name}} is leading the formation and administration of the SPV and will coordinate the investment process. He is also expected to assume the role of Chief Executive Officer of Flipit Global Limited, subject to completion of the relevant agreements and formal corporate approvals.',
    editable: true,
    htmlNeedle:
      '{{sender_name}} is leading the formation and administration of the SPV and will coordinate the investment process. He is also expected to assume the role of Chief Executive Officer of Flipit Global Limited, subject to completion of the relevant agreements and formal corporate approvals.',
    textNeedle:
      '{{sender_name}} is leading the formation and administration of the SPV and will coordinate the investment process. He is also expected to assume the role of Chief Executive Officer of Flipit Global Limited, subject to completion of the relevant agreements and formal corporate approvals.',
  },
  {
    id: 'deadline',
    title: 'Response request',
    currentText:
      'Please respond no later than {{response_deadline}} by using the secure private link below.',
    editable: true,
    htmlNeedle:
      'Please respond no later than {{response_deadline}} by using the secure private link below.',
    textNeedle:
      'Please respond no later than {{response_deadline}} by using the secure private link below:',
  },
  {
    id: 'portal',
    title: 'Private portal',
    currentText:
      'The link opens your own private portal. It will display this offer and allow you to indicate whether you wish to proceed, ask questions, or update your preferred email address. The portal remains yours for the duration of this process: you can return to it at any time to see where things stand, read updates, access your documents, and see confirmation once your participation has been accepted and any funds received. If you return later without this email, simply enter your address and a fresh sign-in link will be sent to you.',
    editable: true,
    htmlNeedle:
      'The link opens your own private portal. It will display this offer and allow you to indicate whether you wish to proceed, ask questions, or update your preferred email address. The portal remains yours for the duration of this process: you can return to it at any time to see where things stand, read updates, access your documents, and see confirmation once your participation has been accepted and any funds received. If you return later without this email, simply enter your address and a fresh sign-in link will be sent to you.',
    textNeedle:
      'The link opens your own private portal. It will display this offer and allow you to indicate whether you wish to proceed, ask questions, or update your preferred email address. The portal remains yours for the duration of this process: you can return to it at any time to see where things stand, read updates, access your documents, and see confirmation once your participation has been accepted and any funds received. If you return later without this email, simply enter your address and a fresh sign-in link will be sent to you.',
  },
  {
    id: 'non-binding',
    title: 'No payment and no binding commitment',
    currentText:
      'No payment is requested at this stage, and submitting a response does not create a binding investment commitment.',
    editable: true,
    htmlNeedle:
      'No payment is requested at this stage, and submitting a response does not create a binding investment commitment.',
    textNeedle:
      'No payment is requested at this stage, and submitting a response does not create a binding investment commitment.',
  },
  {
    id: 'documents',
    title: 'Documents before funds',
    currentText:
      'Before any investment is accepted or funds are requested, you will receive the proposed SPV structure, subscription documents, risk disclosures, and other relevant materials for review.',
    editable: true,
    htmlNeedle:
      'Before any investment is accepted or funds are requested, you will receive the proposed SPV structure, subscription documents, risk disclosures, and other relevant materials for review.',
    textNeedle:
      'Before any investment is accepted or funds are requested, you will receive the proposed SPV structure, subscription documents, risk disclosures, and other relevant materials for review.',
  },
  {
    id: 'declined-allocation',
    title: 'Declining or not responding',
    currentText:
      'If you decline or do not respond by the deadline, your proposed allocation may be offered to other eligible participants or used for another company-approved purpose, subject to the final documents and applicable law.',
    editable: true,
    htmlNeedle:
      'If you decline or do not respond by the deadline, your proposed allocation may be offered to other eligible participants or used for another company-approved purpose, subject to the final documents and applicable law.',
    textNeedle:
      'If you decline or do not respond by the deadline, your proposed allocation may be offered to other eligible participants or used for another company-approved purpose, subject to the final documents and applicable law.',
  },
  {
    id: 'questions',
    title: 'Questions',
    currentText:
      'For questions about the investment, your proposed allocation, or the SPV, please contact {{sender_name}} through the private portal or reply to this email.',
    editable: true,
    htmlNeedle:
      'For questions about the investment, your proposed allocation, or the SPV, please contact {{sender_name}} through the private portal or reply to this email.',
    textNeedle:
      'For questions about the investment, your proposed allocation, or the SPV, please contact {{sender_name}} through the private portal or reply to this email.',
  },
] as const

const LOCKED_SECTIONS: readonly EmailReviewSection[] = [
  {
    id: 'personalized-greeting',
    title: 'Personalized greeting',
    currentText: 'Dear {{recipient_name}},',
    editable: false,
    lockedReason: 'The recipient-name variable is required for every invitation.',
  },
  {
    id: 'offer-figures',
    title: 'Recipient-specific figures',
    currentText:
      'Proposed investment, SPV ownership, indirect Flipit interest and response deadline.',
    editable: false,
    lockedReason:
      'These values come from the reviewed recipient record. The email editor never calculates or rewrites them.',
  },
  {
    id: 'bank-warning',
    title: 'Bank-detail warning',
    currentText:
      'WE WILL NEVER EMAIL YOU A CHANGE OF BANK DETAILS. Verify payment instructions by voice.',
    editable: false,
    lockedReason: 'The payment-safety warning is mandatory and protected.',
  },
  {
    id: 'verification-link',
    title: 'Independent verification',
    currentText: 'The footer tells the recipient how to verify the sending address and domain.',
    editable: false,
    lockedReason: 'The anti-phishing verification route is mandatory and protected.',
  },
] as const

export const EMAIL_REVIEW_SECTIONS: readonly EmailReviewSection[] = [
  ...EDITABLE_SECTIONS,
  ...LOCKED_SECTIONS,
]

export function findEmailReviewSection(id: string): EmailReviewSection | null {
  return EMAIL_REVIEW_SECTIONS.find((section) => section.id === id) ?? null
}

export function resolveEmailReviewSections(
  source: Pick<TemplateSourceParts, 'subject' | 'textSource'>,
  promotedWordings: ReadonlyMap<string, readonly string[]> = new Map(),
): readonly EmailReviewSection[] {
  return EMAIL_REVIEW_SECTIONS.map((section) => {
    if (!section.editable) return section

    const promoted = promotedWordings.get(section.id) ?? []
    const currentPromoted = promoted.find((wording) =>
      section.subjectNeedle
        ? source.subject.includes(wording)
        : source.textSource.includes(wording),
    )
    return currentPromoted ? { ...section, currentText: currentPromoted } : section
  })
}

function replaceExactlyOnce(source: string, needle: string, replacement: string): string {
  const first = source.indexOf(needle)
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error('The selected wording no longer resolves uniquely in the live template.')
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    // Template variables are source instructions, not HTML, and must remain
    // available to the renderer after the surrounding human text is escaped.
    .replaceAll(/&#123;&#123;([a-z0-9_]+)&#125;&#125;/gi, '{{$1}}')
}

export function applySectionReplacement(
  source: EmailTemplateSource | TemplateSourceParts,
  sectionId: string,
  replacement: string,
  currentText?: string,
): TemplateSourceParts {
  const section = findEmailReviewSection(sectionId)
  if (!section || !section.editable) {
    throw new Error(section?.lockedReason ?? 'That section is not editable.')
  }

  const trimmed = replacement.trim()
  if (trimmed.length < 3 || trimmed.length > 2_000) {
    throw new Error('Use between 3 and 2,000 characters for one proposed section.')
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new Error('Propose one paragraph at a time. Line breaks are not allowed here.')
  }

  if (section.subjectNeedle) {
    const subjectNeedle = currentText ?? section.subjectNeedle
    return {
      subject: replaceExactlyOnce(source.subject, subjectNeedle, trimmed),
      htmlSource: replaceExactlyOnce(
        source.htmlSource,
        currentText ? escapeHtmlText(currentText) : section.subjectNeedle,
        escapeHtmlText(trimmed),
      ),
      textSource: source.textSource,
    }
  }

  if (!section.htmlNeedle || !section.textNeedle) {
    throw new Error('That section has no safe source mapping.')
  }

  return {
    subject: source.subject,
    htmlSource: replaceExactlyOnce(
      source.htmlSource,
      currentText ? escapeHtmlText(currentText) : section.htmlNeedle,
      escapeHtmlText(trimmed),
    ),
    textSource: replaceExactlyOnce(
      source.textSource,
      currentText ?? section.textNeedle,
      trimmed,
    ),
  }
}

export function readableInvitationSource(source: {
  subject: string
  textSource: string
}): string {
  const body = source.textSource
    .replace(/^\{\{#if [^}]+\}\}$/gm, '')
    .replace(/^\{\{\/if\}\}$/gm, '')
    .replace(/^-{20,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `Subject: ${source.subject}\n\n${body}`
}
