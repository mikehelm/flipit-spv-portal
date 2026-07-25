/**
 * Who may download a document package, and when. BUILD_SPEC §5, §7, §13.
 *
 * §5's timeline gives status 3 as *"Documents issued · Operator · Date,
 * document list, download links"*. §13 lists *"Documents issued to them,
 * downloadable"* among what an investor sees. §7 adds the rule that matters
 * once a round is over: *"Investors must be able to download their own records
 * (offer, correspondence, status history, documents) while in `read_only` or
 * `sunset`."*
 *
 * So a document is readable in more states than most things are writable in,
 * and the decision is pure and lives here rather than inside the route.
 *
 * **Uploaded is not issued.** The table has an `issued_at` column and it is
 * null until the operator says so. §5 makes issuing an event on the investor's
 * timeline with a date attached — a draft sitting on the record while it is
 * still being checked must not appear on their portal, and the alternative
 * (upload means live) would make the timeline's date a lie about when they
 * could first read it.
 */

export type DocumentAudience = 'INVESTOR' | 'ADMIN' | 'ANONYMOUS'

export interface DocumentVisibilityInput {
  audience: DocumentAudience
  /** Null until the operator issues it. */
  issuedAt: Date | null
  /** Whether this document's offer belongs to the account asking for it. */
  belongsToRequester: boolean
  /**
   * The §4.2 and §7 result the portal already computes — `canView(access)`.
   * A suspended account and a disabled service both make this false.
   */
  portalReadable: boolean
}

/**
 * The single answer. `false` means 404 — the same 404 an id that does not
 * exist produces, never a 403 and never a different 404.
 *
 * `belongsToRequester` is checked for the administrator too, and it is `true`
 * for him by construction: the admin route looks the document up by its own id
 * with no account to compare against. Requiring the caller to state it means a
 * new caller has to think about it rather than inherit an answer.
 */
export function mayDownloadDocument(input: DocumentVisibilityInput): boolean {
  if (input.audience === 'ANONYMOUS') return false
  if (input.audience === 'ADMIN') return true

  return input.issuedAt !== null && input.belongsToRequester && input.portalReadable
}

/**
 * What an investor sees listed on their portal.
 *
 * Unissued documents are not in the list, so the count on the screen is the
 * count of things they can open. A list that showed a document they could not
 * download would be telling them something exists and refusing it, which is
 * the shape of every enumeration problem in this application.
 */
export function issuedOnly<T extends { issuedAt: Date | null }>(documents: T[]): T[] {
  return documents.filter((document) => document.issuedAt !== null)
}
