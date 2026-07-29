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
export const DAVID_PREVIEW_PATH = '/portal/demo/david'
export const TOHU_PREVIEW_PATH = '/portal/demo/tohu'

export type DemoPreviewKind = 'JOHN' | 'DAVID' | 'TOHU'

function previewView(input: {
  accountId: string
  name: string
  email: string
  proposedAmount: string
  spvPercentage: string
  indirectPercentage: string
  responseDeadline: string
  responseChoice: 'NO_RESPONSE' | 'INTERESTED'
  stage: 'INVITATION_SENT' | 'RESPONSE_RECORDED'
}): PortalView {
  const interested = input.responseChoice === 'INTERESTED'

  return {
    accountId: input.accountId,
    name: input.name,
    email: input.email,
    status: 'ACTIVE',
    access: {
      capability: 'FULL',
      issueLink: false,
      allowClaim: false,
      notice: null,
    },
    offers: [
      {
        offerId: `${input.accountId}-offer`,
        proposedAmount: input.proposedAmount,
        spvPercentage: input.spvPercentage,
        indirectPercentage: input.indirectPercentage,
        committedAmount: interested ? input.proposedAmount : null,
        acceptedAmount: null,
        receivedAmount: null,
        responseDeadline: input.responseDeadline,
        responseChoice: input.responseChoice,
        responseNote: interested
          ? 'Please send me the formal documents when they are ready.'
          : null,
        stage: input.stage,
        timeline: buildTimeline(input.stage, {
          sentOn: interested ? '2026-07-24' : null,
          responseChoice: input.responseChoice,
          respondedOn: interested ? '2026-07-25' : null,
          responseDeadline: input.responseDeadline,
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

export function johnDoeDemoPortalView(): PortalView {
  return previewView({
    accountId: 'demo-john-doe',
    name: 'John Doe',
    email: 'johndoe@gmail.com',
    proposedAmount: 'USD 5,000.00',
    spvPercentage: '5.000%',
    indirectPercentage: '1.500%',
    responseDeadline: '2026-08-31',
    responseChoice: 'INTERESTED',
    stage: 'RESPONSE_RECORDED',
  })
}

export function davidDemoPortalView(combined = false): PortalView {
  return previewView({
    accountId: combined ? 'demo-david-tohu' : 'demo-david-serene',
    name: combined ? 'David Serene + Tohu Bohu' : 'David Serene',
    email: 'serenedavid@gmail.com',
    proposedAmount: combined ? 'USD 10,973.00' : 'USD 4,128.00',
    spvPercentage: combined ? '36.577%' : '13.760%',
    indirectPercentage: combined ? '10.973%' : '4.128%',
    responseDeadline: 'Not set yet',
    responseChoice: 'NO_RESPONSE',
    stage: 'INVITATION_SENT',
  })
}

export function tohuDemoPortalView(): PortalView {
  return previewView({
    accountId: 'demo-tohu-bohu',
    name: 'Tohu Bohu Agence d’objets Ltd',
    email: 'serenedavid+tohu@gmail.com',
    proposedAmount: 'USD 6,845.00',
    spvPercentage: '22.817%',
    indirectPercentage: '6.845%',
    responseDeadline: 'Not set yet',
    responseChoice: 'NO_RESPONSE',
    stage: 'INVITATION_SENT',
  })
}
