'use server'

import { z } from 'zod'
import { audit } from '@/lib/audit'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import {
  answerEmailReviewQuestion,
} from '@/lib/email-review/ai'
import { findEmailReviewClause } from '@/lib/email-review/document'
import {
  EMAIL_REVIEW_MODEL,
  MAX_EMAIL_REVIEW_QUESTION_LENGTH,
} from '@/lib/email-review/model'
import { loadAiKey } from '@/lib/import/persist'

export type EmailReviewAiState =
  | { status: 'idle' }
  | {
      status: 'ok'
      answer: string
      model: string
      scopeLabel: string
    }
  | { status: 'error'; message: string }

export const idleEmailReviewAiState: EmailReviewAiState = { status: 'idle' }

const questionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, 'Ask a complete question.')
    .max(
      MAX_EMAIL_REVIEW_QUESTION_LENGTH,
      `Keep the question under ${MAX_EMAIL_REVIEW_QUESTION_LENGTH.toLocaleString()} characters.`,
    ),
  clauseId: z.string().trim().max(100),
})

export async function askEmailReviewQuestionAction(
  _previous: EmailReviewAiState,
  formData: FormData,
): Promise<EmailReviewAiState> {
  const admin = await requireOnboardedAdmin()

  const parsed = questionSchema.safeParse({
    question: formData.get('question'),
    clauseId: formData.get('clauseId') ?? '',
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'The question could not be read.',
    }
  }

  const clauseId = parsed.data.clauseId || undefined
  if (clauseId && !findEmailReviewClause(clauseId)) {
    return { status: 'error', message: 'Choose a clause from this review and try again.' }
  }

  const configured = await loadAiKey()
  if (!configured) {
    return {
      status: 'error',
      message:
        'AI questions are not connected yet. Mike can add the OpenAI key in Settings; the comparison and recorded explanations remain available without it.',
    }
  }

  try {
    const result = await answerEmailReviewQuestion({
      apiKey: configured.apiKey,
      actorId: admin.id,
      question: parsed.data.question,
      ...(clauseId ? { clauseId } : {}),
    })

    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'email_review',
      entityId: clauseId ?? 'whole-document',
      action: 'email_review.question_answered',
      metadata: {
        model: EMAIL_REVIEW_MODEL,
        scope: result.scope,
        clauseId: clauseId ?? null,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
      },
    })

    return {
      status: 'ok',
      answer: result.answer,
      model: result.model,
      scopeLabel: result.scopeLabel,
    }
  } catch {
    return {
      status: 'error',
      message:
        'OpenAI could not answer just now. Nothing was saved. Try again, or use the recorded clause explanation above.',
    }
  }
}
