'use server'

import { redirect } from 'next/navigation'
import { audit } from '@/lib/audit'
import { requireOperator } from '@/lib/auth/guards'
import {
  isTohuDecision,
  TOHU_ALIAS_EMAIL,
  TOHU_DECISION_ACTION,
} from '@/lib/investor-plan/tohu-decision'

export async function recordTohuDecisionAction(formData: FormData): Promise<void> {
  const operator = await requireOperator()
  const decision = formData.get('decision')
  if (!isTohuDecision(decision)) redirect('/admin')

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'user',
    entityId: operator.id,
    action: TOHU_DECISION_ACTION,
    metadata: {
      decision,
      recommendedEmail:
        decision === 'PLUS_ALIAS' ? TOHU_ALIAS_EMAIL : null,
      gmailPlusAlias: decision === 'PLUS_ALIAS',
    },
  })

  redirect('/admin')
}
