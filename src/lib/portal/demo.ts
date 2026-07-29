import type { PortalView } from './data'
import { buildTimeline } from './timeline'

/**
 * A synthetic investor used only by the authenticated owner/operator preview.
 *
 * John is deliberately not stored in `investor_accounts`, `recipients` or
 * `offers`. That keeps him out of totals, exports, reminders, compliance
 * checks and every sending path. The Gmail-shaped address is display copy only.
 */
export const JOHN_DOE_PREVIEW_PATH = '/portal/demo'

export function johnDoeDemoPortalView(): PortalView {
  const responseDeadline = '2026-08-31'

  return {
    accountId: 'demo-john-doe',
    name: 'John Doe',
    email: 'johndoe@gmail.com',
    status: 'ACTIVE',
    access: {
      capability: 'FULL',
      issueLink: false,
      allowClaim: false,
      notice: null,
    },
    offers: [
      {
        offerId: 'demo-john-doe-offer',
        proposedAmount: 'USD 5,000.00',
        spvPercentage: '5.000%',
        indirectPercentage: '1.500%',
        committedAmount: 'USD 5,000.00',
        acceptedAmount: null,
        receivedAmount: null,
        responseDeadline,
        responseChoice: 'INTERESTED',
        responseNote: 'Please send me the formal documents when they are ready.',
        stage: 'RESPONSE_RECORDED',
        timeline: buildTimeline('RESPONSE_RECORDED', {
          sentOn: '2026-07-24',
          responseChoice: 'INTERESTED',
          respondedOn: '2026-07-25',
          responseDeadline,
        }),
        showPaymentSafetyNotice: false,
        snapshot: {
          subject: 'Your private Flipit Global SPV invitation',
          htmlBody: '',
          sentAt: new Date('2026-07-24T09:00:00.000Z'),
        },
        certificates: [],
      },
    ],
    tiles: [
      { label: 'Holdings & documents', isLive: false },
      { label: 'Company updates', isLive: true },
      { label: 'Direct line to David', isLive: true },
      { label: 'Reporting', isLive: false },
    ],
    roundName: 'Flipit Global SPV — first round',
    contacts: [],
    operatorContact: null,
    closingDate: null,
  }
}
