/**
 * Template drift. BUILD_SPEC §8.2 item 2.
 *
 * "The live template is hashed at send time and compared to the approved hash.
 * Any mismatch — a changed word, a changed subject — disables sending until a
 * new approval is recorded. Show a diff so it is obvious what changed."
 *
 * The comparison is over the template SOURCE, including its conditional
 * blocks (§2.1). That is what `hashTemplateSource` hashes and it is the whole
 * reason the operator can choose WhatsApp over a phone number without voiding
 * an approval, while a single changed character in the body does void it.
 *
 * The evaluation is a pure function of two hashes. Everything else in this
 * file — loading the live template, recovering the approved source so a diff
 * can be rendered — is convenience around that one comparison.
 */

import type { EmailTemplateKind, EmailTemplateSource } from '@/lib/email/templates'
import { loadCurrentTemplate } from '@/lib/email/templates'
import { findSourceByHash, getCurrentApproval, type ComplianceApprovalRecord } from './approvals'
import { diffTemplateSource, type TemplateDiff, type TemplateSourceParts } from './diff'

export type DriftState =
  /** No approval exists for this template at all. Nothing can be sent. */
  | 'NO_APPROVAL'
  /** The live source hashes to exactly the approved hash. */
  | 'APPROVED'
  /** The live source has changed since approval. Sending is disabled. */
  | 'DRIFTED'

export interface DriftEvaluation {
  state: DriftState
  approvedHash: string | null
  liveHash: string
  /** True only when the state is APPROVED. Read this, not the state string. */
  sendingPermitted: boolean
  /** Specific, plain language, and never generic. */
  message: string
}

/**
 * The comparison itself. Pure — no database, no template loading, no clock.
 *
 * Deliberately a string equality and nothing else. There is no normalisation,
 * no trimming and no case folding: whitespace in an email body is content, and
 * a gate that decided some differences did not count would be a gate with an
 * opinion about the approver's letter.
 */
export function evaluateDrift(input: {
  approvedHash: string | null | undefined
  liveHash: string
  templateKind: EmailTemplateKind
}): DriftEvaluation {
  const kindLabel = input.templateKind === 'INVITATION' ? 'invitation' : 'reminder'

  if (!input.approvedHash) {
    return {
      state: 'NO_APPROVAL',
      approvedHash: null,
      liveHash: input.liveHash,
      sendingPermitted: false,
      message:
        `No compliance approval has been recorded for the ${kindLabel} template, so nothing ` +
        'can be sent with it. This email is an offer of securities; the application will not ' +
        'send one until a qualified person has signed it off and the owner has recorded that ' +
        'sign-off here. Test sends to the operator’s own address remain available so the ' +
        'template can be prepared meanwhile.',
    }
  }

  if (input.approvedHash === input.liveHash) {
    return {
      state: 'APPROVED',
      approvedHash: input.approvedHash,
      liveHash: input.liveHash,
      sendingPermitted: true,
      message: `The live ${kindLabel} template matches the approved version exactly.`,
    }
  }

  return {
    state: 'DRIFTED',
    approvedHash: input.approvedHash,
    liveHash: input.liveHash,
    sendingPermitted: false,
    message:
      `The ${kindLabel} template has changed since it was approved, so sending is disabled ` +
      'until a new approval is recorded against the current wording. The approval covers the ' +
      'exact text that was signed off, and a changed word or a changed subject line is a ' +
      'different offer document. Show the approver what changed and record the new approval.',
  }
}

export interface TemplateDriftReport extends DriftEvaluation {
  kind: EmailTemplateKind
  /** The template that would actually be sent right now. */
  live: EmailTemplateSource
  approval: ComplianceApprovalRecord | null
  /**
   * The source the approval was recorded against, when it is still on file.
   * Null means the diff cannot be shown — the report says so rather than
   * inventing one.
   */
  approvedSource: TemplateSourceParts | null
  /** Present only when the state is DRIFTED and the approved source was found. */
  diff: TemplateDiff | null
  /** Set when drift is real but the approved version can no longer be recovered. */
  diffUnavailableReason: string | null
}

/**
 * The full picture for one template kind: approval, live hash, drift state and
 * a diff if there is one to show.
 *
 * The live hash is recomputed from the live source every time. It is never
 * read from a stored column, because a stored hash that disagrees with its own
 * body is precisely the thing this function exists to detect.
 */
export async function checkTemplateDrift(
  kind: EmailTemplateKind,
): Promise<TemplateDriftReport> {
  const [live, approval] = await Promise.all([
    loadCurrentTemplate(kind),
    getCurrentApproval(kind),
  ])

  const evaluation = evaluateDrift({
    approvedHash: approval?.approvedTemplateHash ?? null,
    liveHash: live.hash,
    templateKind: kind,
  })

  if (evaluation.state !== 'DRIFTED' || !approval) {
    return {
      ...evaluation,
      kind,
      live,
      approval,
      approvedSource: null,
      diff: null,
      diffUnavailableReason: null,
    }
  }

  const approvedSource = await findSourceByHash(kind, approval.approvedTemplateHash)

  if (!approvedSource) {
    return {
      ...evaluation,
      kind,
      live,
      approval,
      approvedSource: null,
      diff: null,
      diffUnavailableReason:
        'The approved version of this template is no longer on file, so the exact change ' +
        'cannot be shown line by line. The hashes differ, which is enough to disable sending. ' +
        'Compare the current wording against the approver’s letter directly before ' +
        'recording a new approval.',
    }
  }

  return {
    ...evaluation,
    kind,
    live,
    approval,
    approvedSource,
    diff: diffTemplateSource(approvedSource, {
      subject: live.subject,
      htmlSource: live.htmlSource,
      textSource: live.textSource,
    }),
    diffUnavailableReason: null,
  }
}
