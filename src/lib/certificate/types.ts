import { z } from 'zod'
import { Dec } from '@/lib/money'

const exactDecimal = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Use a non-negative plain decimal string.')
  .refine((value) => new Dec(value).isFinite(), 'Decimal value must be finite.')

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date in YYYY-MM-DD form.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Date must be a real calendar date.')

export const participationCertificateDataSchema = z.object({
  investorName: z.string().trim().min(1),
  spvName: z.string().trim().min(1),
  amountReceived: exactDecimal,
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter uppercase currency code.'),
  valueDate: isoDate,
  spvPercentage: exactDecimal,
  indirectFlipitPercentage: exactDecimal,
  paymentReference: z.string().trim().min(1),
  issuedOn: isoDate,
  signedByName: z.string().trim().min(1),
  signedByRole: z.string().trim().min(1),
  version: z.number().int().positive(),
})

export type ParticipationCertificateData = z.infer<
  typeof participationCertificateDataSchema
>
