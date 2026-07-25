'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { audit } from '@/lib/audit'
import { requireOperator } from '@/lib/auth/guards'
import { renderEmail, UnresolvedVariableError } from '@/lib/email/render'
import { loadCurrentTemplate } from '@/lib/email/templates'
import { sendOneEmail } from '@/lib/email/transport'
import { loadSenderDefaults } from '@/lib/email/variables'
import { optionalText } from '@/lib/form-values'
import { currentVideo } from '@/lib/media/video-store'
import {
  loadPreviewRecipient,
  loadPreviewRecipients,
  previewPortalLink,
  toVariableInput,
} from '@/app/(admin)/templates/data'

/**
 * Sending David the complete invitation, to his own address. BUILD_SPEC §13.3,
 * §19, §22 AC34.
 *
 * §13.3: *"Offer him a test email first. Before any real send, prompt David to
 * send himself the complete invitation — with his video linked — so he
 * experiences exactly what a recipient will. This should be a prompt in the
 * flow, not a feature he has to find."*
 *
 * Until now the pre-flight had an item called "test email sent and reviewed"
 * that he could only *tick*. The transport's TEST intent had existed since WP5
 * and nothing in the application ever used it. This is the button behind the
 * tick.
 *
 * **Three things make this safe, and all three are somebody else's code:**
 *
 *   1. The gate refuses a TEST addressed to anywhere but the operator's own
 *      address (`TEST_SEND_TO_OTHER_ADDRESS`). The recipient here is not taken
 *      from a form at all — it is read from the allowlist — but the gate
 *      checks it anyway, and that is the check that matters.
 *   2. The gate still requires a working, verified credential. A test send is
 *      exempt from the service-mode and production-deployment gates by §7,
 *      §8.2 and §18.1; it is exempt from nothing else.
 *   3. **The portal link is the preview's fake token, not a real one.** This
 *      is the decision worth reading twice. Minting a genuine single-use claim
 *      token for a test would issue a working credential against a real
 *      investor's record and spend it when David clicked — a send by another
 *      name, which is exactly what §11.4 refuses for the preview. The link is
 *      the right shape, the right length and the right domain, and it opens
 *      the "link not valid" page.
 *
 * Nothing here writes an `EmailSnapshot` or a `send_event`. Those record what
 * an investor was sent; a test send is not that, and putting one in the
 * recipient's history would make the record say something untrue.
 */

const RECIPIENTS_PATH = '/recipients'

const schema = z.object({ offerId: z.string().min(1) })

export async function sendTestInvitationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Operator only. The message leaves from his mailbox and arrives in it; the
  // owner pressing this would put mail in somebody else's inbox to answer a
  // question about his own screen.
  const operator = await requireOperator()

  const parsed = schema.safeParse({ offerId: optionalText(formData.get('offerId')) })
  if (!parsed.success) {
    // No recipient chosen: use the first one, so the button works on a screen
    // where there is nothing to choose from yet.
    const [first] = await loadPreviewRecipients()
    if (!first) {
      return actionError(
        'There is no recipient to render a test from yet. Import the recipient file first — ' +
          'a test send is worth having only when it shows real figures.',
      )
    }
    return runTest(first.offerId, operator)
  }

  return runTest(parsed.data.offerId, operator)
}

async function runTest(
  offerId: string,
  operator: { id: string; email: string },
): Promise<ActionState> {
  const recipient = await loadPreviewRecipient(offerId)
  if (!recipient) return actionError('That recipient is no longer on the list.')

  const [template, defaults, video] = await Promise.all([
    loadCurrentTemplate('INVITATION'),
    loadSenderDefaults(),
    currentVideo(),
  ])

  const input = toVariableInput(recipient, previewPortalLink())

  let rendered
  try {
    rendered = renderEmail(template, input, defaults)
  } catch (error) {
    if (error instanceof UnresolvedVariableError) {
      return actionError(
        `The invitation will not render for ${recipient.name}, so there is nothing to test ` +
          `with. ${error.message}`,
      )
    }
    throw error
  }

  try {
    const result = await sendOneEmail({
      intent: 'TEST',
      message: {
        to: operator.email,
        fromName: defaults.defaultSenderName ?? 'Flipit',
        subject: `[TEST] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
      },
      // Both are the operator's own address. The gate compares them and
      // refuses if they differ, which is what makes this unable to reach a
      // real recipient even if the code above were wrong.
      operatorEmail: operator.email,
      actor: { kind: 'user', id: operator.id, label: operator.email },
    })

    if (result.outcome !== 'SUCCEEDED') {
      return actionError(
        `The test did not send. ${result.failure.message} Nothing reached any investor — a ` +
          'test send can only ever go to your own address.',
      )
    }
  } catch (error) {
    // A gate refusal. Its message names the problem and what to do.
    return actionError(error instanceof Error ? error.message : 'Sending is currently refused.')
  }

  await audit({
    actor: { kind: 'user', id: operator.id, label: operator.email },
    entityType: 'offer',
    entityId: recipient.offerId,
    action: 'email.test_sent',
    metadata: {
      templateHash: rendered.templateHash,
      renderedFor: recipient.offerId,
      videoPublished: video?.publishedAt != null,
    },
  })

  revalidatePath(RECIPIENTS_PATH)

  return actionOk(
    `Sent to ${operator.email}, rendered from ${recipient.name}'s real figures. ` +
      (video?.publishedAt
        ? 'Open it on your phone, follow the link, and watch your video the way they will. ' +
          'The link goes to the "link not valid" page — a test never issues a working token.'
        : 'Open it on your phone. The link goes to the "link not valid" page — a test never ' +
          'issues a working token, so it cannot be spent by accident.'),
  )
}
