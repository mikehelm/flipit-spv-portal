/**
 * The address the preview frame's body is fetched from.
 *
 * One place builds it, for the same reason `lib/media/urls.ts` says: the
 * application runs under `/SPV` before it runs at a domain root, and a
 * hard-coded `/templates/…` in a frame's `src` would break silently on the way.
 * A broken frame here is an **empty** frame — no error, no console line, just a
 * white rectangle where the email an operator is about to send should be.
 *
 * It is separate from `csp.ts` on purpose. That module is imported by the
 * middleware and runs in the Edge runtime, so it deliberately imports nothing —
 * it holds the *pattern* that recognises this path, and this holds the builder
 * that produces one. `preview-url.test.ts` is what stops the two drifting apart,
 * which is the failure this repository has now found in three separate pairs of
 * files.
 */

import { env } from '@/lib/env'
import type { EmailTemplateKind } from './templates'

/** Root-relative, because the frame is fetched from wherever the page was served. */
export function emailBodyPath(offerId: string, kind: EmailTemplateKind): string {
  return `${env().BASE_PATH}/templates/preview/${encodeURIComponent(offerId)}/body?kind=${kind}`
}
