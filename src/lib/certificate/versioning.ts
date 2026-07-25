import { z } from 'zod'
import {
  participationCertificateDataSchema,
  type ParticipationCertificateData,
} from './types'

const certificateVersionSchema = z.object({
  data: participationCertificateDataSchema,
  supersededAt: z.string().datetime().nullable(),
})

export type CertificateVersion = z.infer<typeof certificateVersionSchema>

/**
 * Appends a correction without mutating or removing prior certificates.
 * Existing current versions are retained and marked with the correction time.
 */
export function appendCorrectedCertificateVersion(
  existingInput: readonly CertificateVersion[],
  correctedInput: Omit<ParticipationCertificateData, 'version'>,
  correctedAtInput: string,
): CertificateVersion[] {
  const existing = z.array(certificateVersionSchema).parse(existingInput)
  const corrected = participationCertificateDataSchema
    .omit({ version: true })
    .parse(correctedInput)
  const correctedAt = z.string().datetime().parse(correctedAtInput)
  const nextVersion =
    existing.reduce((highest, item) => Math.max(highest, item.data.version), 0) + 1

  return [
    ...existing.map((item) =>
      item.supersededAt === null ? { ...item, supersededAt: correctedAt } : item,
    ),
    {
      data: { ...corrected, version: nextVersion },
      supersededAt: null,
    },
  ]
}
