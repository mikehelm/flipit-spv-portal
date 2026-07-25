import { z } from 'zod'
import { Dec } from '@/lib/money'

const exactDecimal = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Use a plain non-negative decimal string.')
  .refine((value) => new Dec(value).isFinite(), 'Decimal value must be finite.')

const optionalDecimal = exactDecimal.nullable()
const timestamp = z.string().datetime({ offset: true })

const historyEventSchema = z.object({
  status: z.string().min(1),
  at: timestamp,
  reason: z.string().nullable().optional(),
})

const messageSchema = z.object({
  body: z.string(),
  at: timestamp,
})

export const recipientExportRowSchema = z.object({
  recipientName: z.string().min(1),
  recipientEmail: z.string().email(),
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  roundName: z.string().min(1),
  offerId: z.string().min(1),
  responseDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  spvPercentage: exactDecimal,
  indirectFlipitPercentage: exactDecimal,
  proposedAmount: exactDecimal,
  committedAmount: optionalDecimal,
  acceptedAmount: optionalDecimal,
  receivedAmount: optionalDecimal,
  paymentReference: z.string().nullable(),
  sendStatus: z.string().min(1),
  invitationSentAt: timestamp.nullable(),
  lastSendAt: timestamp.nullable(),
  accountStatus: z.string().min(1),
  accountCreatedAt: timestamp.nullable(),
  accountStatusHistory: z.array(historyEventSchema),
  timelineStage: z.string().min(1),
  timelineStageChangedAt: timestamp.nullable(),
  timelineHistory: z.array(historyEventSchema),
  responseStatus: z.string().min(1),
  responseAt: timestamp.nullable(),
  responseHistory: z.array(historyEventSchema),
  investorQuestions: z.array(messageSchema),
  adminReplies: z.array(messageSchema),
  updatedContactEmail: z.string().email().nullable(),
  internalNotes: z.string().nullable(),
})

export type RecipientExportRow = z.infer<typeof recipientExportRowSchema>

export const auditExportRowSchema = z.object({
  id: z.string().min(1),
  actorLabel: z.string().min(1),
  actorUserId: z.string().nullable(),
  actorAccountId: z.string().nullable(),
  entityType: z.string().min(1),
  entityId: z.string().nullable(),
  action: z.string().min(1),
  metadata: z.unknown().nullable(),
  createdAt: timestamp,
})

export const ownerAuditExportRequestSchema = z.object({
  requestedByRole: z.literal('OWNER'),
  rows: z.array(auditExportRowSchema),
})

export type OwnerAuditExportRequest = z.infer<
  typeof ownerAuditExportRequestSchema
>
