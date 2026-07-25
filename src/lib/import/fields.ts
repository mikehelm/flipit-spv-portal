/**
 * The target fields of an import. BUILD_SPEC §9.
 *
 * Six required, five optional, and nothing else. A column in the spreadsheet
 * that maps to none of these is simply ignored — extra columns are expected
 * (§9.1) and are not an error.
 */

export const TARGET_FIELDS = [
  'recipient_name',
  'recipient_email',
  'investment_amount_usd',
  'spv_percentage',
  'response_deadline',
  'recipient_jurisdiction',
  'indirect_flipit_percentage_override',
  'sender_name',
  'sender_email',
  'sender_phone',
  'internal_notes',
] as const

export type TargetField = (typeof TARGET_FIELDS)[number]

export const REQUIRED_FIELDS: readonly TargetField[] = [
  'recipient_name',
  'recipient_email',
  'investment_amount_usd',
  'spv_percentage',
  'response_deadline',
  'recipient_jurisdiction',
]

export const OPTIONAL_FIELDS: readonly TargetField[] = TARGET_FIELDS.filter(
  (field) => !REQUIRED_FIELDS.includes(field),
)

/** How the value is read. Drives which ambiguity questions a column can raise. */
export type FieldKind = 'text' | 'email' | 'money' | 'percentage' | 'date' | 'country'

export const FIELD_KIND: Readonly<Record<TargetField, FieldKind>> = {
  recipient_name: 'text',
  recipient_email: 'email',
  investment_amount_usd: 'money',
  spv_percentage: 'percentage',
  response_deadline: 'date',
  recipient_jurisdiction: 'country',
  indirect_flipit_percentage_override: 'percentage',
  sender_name: 'text',
  sender_email: 'email',
  sender_phone: 'text',
  internal_notes: 'text',
}

export const FIELD_LABEL: Readonly<Record<TargetField, string>> = {
  recipient_name: 'Recipient name',
  recipient_email: 'Recipient email',
  investment_amount_usd: 'Investment amount (USD)',
  spv_percentage: 'SPV percentage',
  response_deadline: 'Response deadline',
  recipient_jurisdiction: 'Jurisdiction (ISO country code)',
  indirect_flipit_percentage_override: 'Indirect Flipit % override',
  sender_name: 'Sender name',
  sender_email: 'Sender email',
  sender_phone: 'Sender phone',
  internal_notes: 'Internal notes',
}

export const FIELD_HELP: Readonly<Record<TargetField, string>> = {
  recipient_name: 'As it should appear in the invitation.',
  recipient_email: 'One address per recipient. Duplicates block the whole file.',
  investment_amount_usd: 'The proposed amount. Stored exactly, never rounded.',
  spv_percentage: 'Their share of the SPV, as a percentage.',
  response_deadline: 'Must be in the future. Deadlines are dates, not times.',
  recipient_jurisdiction:
    'Two-letter ISO code. An invalid code blocks the file; a valid code outside the approved list blocks only that recipient.',
  indirect_flipit_percentage_override:
    'Leave empty unless a specific figure was agreed. Otherwise it is calculated.',
  sender_name: 'Only if it differs per recipient. Normally taken from settings.',
  sender_email: 'Only if it differs per recipient. Normally taken from settings.',
  sender_phone: 'Only if it differs per recipient. Normally taken from settings.',
  internal_notes: 'Never shown to the investor.',
}

/** The value used in the mapping UI for "this column is not imported". */
export const IGNORE_COLUMN = '__ignore__'

export function isTargetField(value: string): value is TargetField {
  return (TARGET_FIELDS as readonly string[]).includes(value)
}

/**
 * Header synonyms for the deterministic fallback proposal used when no AI key
 * is configured. This is a convenience only — the operator still confirms
 * every column before anything is imported (BUILD_SPEC §9.1 step 4).
 */
export const HEADER_SYNONYMS: Readonly<Record<TargetField, readonly string[]>> = {
  recipient_name: ['name', 'recipient', 'recipient name', 'full name', 'investor', 'investor name', 'contact', 'contact name', 'person'],
  recipient_email: ['email', 'e mail', 'email address', 'recipient email', 'investor email', 'contact email', 'mail'],
  investment_amount_usd: ['amount', 'investment', 'investment amount', 'investment amount usd', 'usd', 'proposed amount', 'ticket', 'ticket size', 'allocation', 'allocation usd', 'contribution', 'sum', 'how much', 'size', 'commitment'],
  spv_percentage: ['spv', 'spv percentage', 'spv %', 'spv pct', 'percentage', 'percent', 'share', 'spv share', 'stake', 'equity', 'holding'],
  response_deadline: ['deadline', 'response deadline', 'reply by', 'respond by', 'due', 'due date', 'date', 'expiry', 'closes'],
  recipient_jurisdiction: ['jurisdiction', 'country', 'country code', 'location', 'residence', 'domicile', 'nation', 'based'],
  indirect_flipit_percentage_override: ['indirect', 'indirect percentage', 'indirect flipit', 'indirect flipit percentage', 'flipit percentage', 'flipit %', 'override', 'indirect override'],
  sender_name: ['sender', 'sender name', 'from name', 'from'],
  sender_email: ['sender email', 'from email', 'reply to', 'reply-to'],
  sender_phone: ['sender phone', 'phone', 'telephone', 'mobile', 'whatsapp'],
  internal_notes: ['notes', 'note', 'internal notes', 'comment', 'comments', 'remarks', 'internal'],
}
