import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { serviceConfig } from '@/db/schema'
import { SERVICE_CONFIG_ID } from '@/lib/auth/service-config'
import { encrypt } from '@/lib/crypto'

/**
 * The one write path for a Gmail SMTP credential.
 *
 * The password is accepted only long enough to encrypt it. Callers receive no
 * stored or decrypted secret back, and changing either half clears the prior
 * verification because it no longer describes the credential now in use.
 */
export const smtpCredentialSchema = z.object({
  smtpUser: z
    .string()
    .trim()
    .pipe(z.email('Enter the full Gmail address mail will be sent from.'))
    .transform((value) => value.toLowerCase()),
  smtpPassword: z
    .string()
    .transform((value) => value.replace(/\s+/g, ''))
    .refine((value) => value.length >= 8 && value.length <= 128, {
      message:
        'A Google app password is 16 letters. Paste it here — spaces are removed for you.',
    }),
})

export type SmtpCredentialInput = z.infer<typeof smtpCredentialSchema>

export async function storeSmtpCredential(input: SmtpCredentialInput): Promise<void> {
  await db
    .update(serviceConfig)
    .set({
      emailTransport: 'SMTP',
      smtpUserEncrypted: encrypt(input.smtpUser),
      smtpPasswordEncrypted: encrypt(input.smtpPassword),
      smtpLastVerifiedAt: null,
      smtpLastVerifyResult: null,
    })
    .where(eq(serviceConfig.id, SERVICE_CONFIG_ID))
}
