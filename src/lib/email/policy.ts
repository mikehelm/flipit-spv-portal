import { parseTemplate, referencedVariables } from '@/lib/email/render'
import type { TemplateSourceParts } from '@/lib/compliance/diff'

export type EmailPolicySeverity = 'BLOCK' | 'WARN'

export interface EmailPolicyOutcome {
  id: string
  section: string
  severity: EmailPolicySeverity
  passed: boolean
  message: string
}

function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, ' · ')
    .replace(/&mdash;/gi, ' — ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function outcome(
  id: string,
  section: string,
  passed: boolean,
  message: string,
  severity: EmailPolicySeverity = 'BLOCK',
): EmailPolicyOutcome {
  return { id, section, severity, passed, message }
}

function parses(value: string): boolean {
  try {
    parseTemplate(value)
    return true
  } catch {
    return false
  }
}

export function evaluateInvitationPolicy(
  candidate: TemplateSourceParts,
): EmailPolicyOutcome[] {
  const html = visibleText(candidate.htmlSource).toLowerCase()
  const text = candidate.textSource.toLowerCase()
  const all = `${candidate.subject}\n${html}\n${text}`.toLowerCase()
  const htmlVariables = [...referencedVariables(candidate.htmlSource)].sort()
  const textVariables = [...referencedVariables(candidate.textSource)].sort()
  const htmlVariableNames = new Set<string>(htmlVariables)
  const textVariableNames = new Set<string>(textVariables)
  const requiredVariables = [
    'indirect_flipit_percentage',
    'investment_amount',
    'recipient_name',
    'response_deadline',
    'secure_portal_link',
    'sender_email',
    'sender_name',
    'spv_percentage',
    'verification_link',
  ]

  return [
    outcome(
      'source-parses',
      'BUILD_SPEC §11.4',
      parses(candidate.subject) &&
        parses(candidate.htmlSource) &&
        parses(candidate.textSource),
      'The subject, HTML and plain-text sources must all parse.',
    ),
    outcome(
      'multipart-present',
      'BUILD_SPEC §11.5',
      candidate.subject.trim().length > 0 &&
        candidate.htmlSource.trim().length > 200 &&
        candidate.textSource.trim().length > 200,
      'The subject and both email bodies must remain present.',
    ),
    outcome(
      'variable-parity',
      'BUILD_SPEC §11.5',
      JSON.stringify(htmlVariables) === JSON.stringify(textVariables),
      'HTML and plain-text versions must reference the same variables.',
    ),
    outcome(
      'required-variables',
      'BUILD_SPEC §§11.1, 11.4',
      requiredVariables.every(
        (name) => htmlVariableNames.has(name) && textVariableNames.has(name),
      ),
      'Recipient, offer, deadline, sender, portal and verification variables are protected.',
    ),
    outcome(
      'no-other-investors',
      'BUILD_SPEC §35',
      !/other investors|remaining allocation|round progress|responses from all/.test(all),
      'Investor-facing wording must not reveal another investor or round progress.',
    ),
    outcome(
      'non-binding',
      'BUILD_SPEC §8.2',
      html.includes('does not create a binding investment commitment') &&
        text.includes('does not create a binding investment commitment') &&
        !/\byou agree to (subscribe|invest)\b/.test(all),
      'Both versions must say that a response is not a binding investment commitment.',
    ),
    outcome(
      'no-payment-now',
      'BUILD_SPEC §8.2',
      html.includes('no payment is requested at this stage') &&
        text.includes('no payment is requested at this stage'),
      'Both versions must say that no payment is requested at this stage.',
    ),
    outcome(
      'bank-warning',
      'BUILD_SPEC §15.1',
      html.includes('we will never email you a change of bank details') &&
        text.includes('we will never email you a change of bank details'),
      'The protected bank-detail warning must remain in both versions.',
    ),
    outcome(
      'verification-link',
      'BUILD_SPEC §15.1',
      candidate.htmlSource.includes('{{verification_link}}') &&
        candidate.textSource.includes('{{verification_link}}'),
      'The independent verification link must remain in both versions.',
    ),
    outcome(
      'no-maker-credit',
      'BUILD_SPEC §13.2',
      !/make with mike/i.test(all),
      'Formal investment emails must not carry the maker credit.',
    ),
    outcome(
      'no-tracking',
      'BUILD_SPEC §12',
      !/<img[\s>]/i.test(candidate.htmlSource) &&
        !/tracking pixel|background-image/i.test(candidate.htmlSource),
      'The invitation must remain image-free and carry no tracking request.',
    ),
    outcome(
      'email-layout',
      'BUILD_SPEC §11.5',
      candidate.htmlSource.includes('max-width:600px') &&
        candidate.htmlSource.includes('<table'),
      'The email-safe 600px table layout must remain intact.',
    ),
  ]
}

export function blockingPolicyFailures(
  outcomes: readonly EmailPolicyOutcome[],
): EmailPolicyOutcome[] {
  return outcomes.filter((entry) => entry.severity === 'BLOCK' && !entry.passed)
}
