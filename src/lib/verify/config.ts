import { z } from 'zod'

const verificationEnvironmentSchema = z
  .object({
    PRODUCTION_APP_URL: z.string().url(),
    VERIFICATION_SENDER_EMAIL: z.string().email().optional(),
    OPERATOR_EMAILS: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (
      !value.VERIFICATION_SENDER_EMAIL &&
      !value.OPERATOR_EMAILS?.split(',').some((entry) => entry.trim() !== '')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['VERIFICATION_SENDER_EMAIL'],
        message:
          'Set VERIFICATION_SENDER_EMAIL or configure an address in OPERATOR_EMAILS.',
      })
    }
  })

export interface VerificationConfig {
  invitationSenderEmail: string
  legitimateLinkDomain: string
}

/**
 * Public-page configuration boundary. A dedicated sender value wins; the
 * operator allowlist is the conservative fallback already present in the app.
 */
export function loadVerificationConfig(
  source: Record<string, string | undefined> = process.env,
): VerificationConfig {
  const parsed = verificationEnvironmentSchema.parse(source)
  const sender =
    parsed.VERIFICATION_SENDER_EMAIL ??
    parsed.OPERATOR_EMAILS?.split(',')
      .map((entry) => entry.trim().toLowerCase())
      .find((entry) => entry !== '')

  if (!sender) {
    throw new Error('A verification sender email must be configured.')
  }

  return {
    invitationSenderEmail: z.string().email().parse(sender),
    legitimateLinkDomain: new URL(parsed.PRODUCTION_APP_URL).hostname.toLowerCase(),
  }
}
