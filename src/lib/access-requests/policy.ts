import { z } from 'zod'

export const ACCESS_REQUEST_RECORDED_MESSAGE =
  'Your request has been recorded. If it can be verified, the administrator may contact you.'

export const MINIMUM_VALID_SUBMISSION_MS = 500

export const accessRequestSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'Enter your first name.')
    .max(80, 'First name must be 80 characters or fewer.'),
  lastName: z
    .string()
    .trim()
    .min(1, 'Enter your last name.')
    .max(80, 'Last name must be 80 characters or fewer.'),
  email: z
    .string()
    .trim()
    .pipe(z.email('Enter a valid email address.'))
    .transform((value) => value.toLowerCase()),
  phone: z
    .string()
    .trim()
    .min(7, 'Enter a phone number, including the country code.')
    .max(40, 'Phone number must be 40 characters or fewer.')
    .refine((value) => /^[+()\d\s.-]+$/.test(value), {
      message: 'Enter a phone number using numbers and standard phone symbols.',
    }),
})

export type AccessRequestInput = z.infer<typeof accessRequestSchema>
export type AccessRequestStatus = 'PENDING' | 'VERIFIED' | 'CLOSED'

/**
 * The phone check is intentionally a small state machine. No transition here
 * grants access, creates a user, or issues an invitation.
 */
export function mayTransitionAccessRequest(
  from: AccessRequestStatus,
  to: AccessRequestStatus,
): boolean {
  if (from === 'PENDING') return to === 'VERIFIED' || to === 'CLOSED'
  if (from === 'VERIFIED') return to === 'CLOSED'
  return false
}
