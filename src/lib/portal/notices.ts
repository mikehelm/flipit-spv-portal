import type { PortalNotice } from './access'

/**
 * What a notice says. BUILD_SPEC §4.2, §7.
 *
 * Lifted out of the page for one reason: §7 does not describe the sunset notice
 * as a fixed sentence. It describes *"read-only plus a configurable notice **and
 * closing date**, with a prompt to download their records"*, and §11.3 names the
 * variable — `{{closing_date}}`, from `sunset_closing_date`.
 *
 * The date was stored, and the settings form refused to save sunset without one
 * on the grounds that *"the portal tells investors when it closes so they can
 * download their records first"*. The portal did not. The notice was a fixed
 * string with no slot for a date in it, so the refusal enforced a promise
 * nothing kept — the same shape as the contact address one field above it.
 *
 * Copy lives here rather than in the page so that the sentence with a date in
 * it and the sentence without one are both testable, and so that the one thing
 * that must never happen — a date rendered as an empty gap, or the word
 * "Invalid Date" — is asserted rather than hoped for.
 */

export interface NoticeContext {
  /**
   * `sunset_closing_date`, already formatted for a reader. Null when the
   * portal is not closing, or when no date is set — in which case the sentence
   * is written without one rather than with a gap where one would be.
   */
  closingDate?: string | null
}

export interface NoticeCopy {
  title: string
  body: string
}

/**
 * The fixed part of each notice.
 *
 * None of these says "contact David" any more, and none of them names anybody:
 * the address comes from configuration, through `portalContacts`, and is
 * rendered underneath. A first name written into a notice is the thing that
 * goes wrong quietly on the day somebody else is answering.
 */
const BASE: Record<PortalNotice, NoticeCopy> = {
  SUSPENDED: {
    title: 'Access temporarily unavailable',
    body: 'Access to this portal is temporarily unavailable.',
  },
  CLOSED: {
    title: 'This process has concluded',
    body:
      'This process has concluded for your record. A copy of your documents and ' +
      'correspondence remains available on request.',
  },
  READ_ONLY: {
    title: 'Read-only',
    body:
      'This portal is currently read-only. You can view your record and download your ' +
      'documents, but responses and messages are not being accepted at this time.',
  },
  SUNSET: {
    title: 'This portal is closing',
    body: 'This portal will close soon.',
  },
  SERVICE_CLOSED: {
    title: 'The portal is no longer available',
    body: 'The Flipit investor portal is no longer available.',
  },
  ARCHIVED: {
    title: 'This record is closed',
    body: 'This record is retained for our files and is no longer available here.',
  },
}

/** The prompt §7 asks for, in both forms. */
const DOWNLOAD_PROMPT = 'Please download any documents or correspondence you wish to keep'

export function noticeCopy(notice: PortalNotice, context: NoticeContext = {}): NoticeCopy {
  const base = BASE[notice]

  if (notice !== 'SUNSET') return base

  const date = context.closingDate?.trim() ?? ''

  // A date, when there is one. "will close on 2026-09-30" is the whole reason
  // the setting is mandatory in this mode; "will close on ." would be worse
  // than the sentence that never mentioned a date at all.
  const opening = date === '' ? base.body : `This portal will close on ${date}.`
  const prompt = date === '' ? `${DOWNLOAD_PROMPT} before then.` : `${DOWNLOAD_PROMPT} before that date.`

  return { title: base.title, body: `${opening} ${prompt}` }
}
