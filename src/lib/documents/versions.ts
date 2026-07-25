/**
 * A corrected document, and the rules that keep the chain honest.
 * BUILD_SPEC §5: a correction is *"never a silent overwrite"*.
 *
 * Until now, correcting a document meant withdrawing it and uploading another,
 * and the only thing connecting the two was the audit log. That is a record of
 * the correction for whoever reads the log, and nothing at all for the investor
 * holding a copy of the old one — which is exactly the person the rule is for.
 *
 * The certificate has had real version history since WP13 (§5.1 asks for it),
 * and this is the same shape, on purpose. A version number, a `supersededAt`
 * on the version that was replaced, and a pointer from the new one to the old.
 * Superseded versions stay downloadable, as superseded certificates do.
 *
 * **Everything here is pure.** No database, no session, no clock — a clock is a
 * parameter where one is needed. The actions in `actions/documents.ts` ask
 * these functions whether something is allowed and then do it; the rules are
 * not repeated inside the mutations, and they are not enforced by the screen.
 */

export interface VersionedDocument {
  id: string
  version: number
  issuedAt: Date | null
  supersededAt: Date | null
  supersedesId: string | null
}

export type CorrectionRefusal =
  | 'NEVER_ISSUED'
  | 'ALREADY_SUPERSEDED'
  | 'CORRECTION_ALREADY_WAITING'

/**
 * May this document be corrected, and if not, why not.
 *
 * `siblings` is every document on the same offer — the caller already has
 * them, and a pending correction is found among them rather than by a second
 * query.
 */
export function whyNotCorrectable(
  document: VersionedDocument,
  siblings: readonly VersionedDocument[],
): CorrectionRefusal | null {
  // A draft that was never issued is not corrected, it is removed and
  // re-uploaded — which is already possible, and leaves no half-version behind.
  // It also keeps the chain meaningful: every version in one was issued.
  if (document.issuedAt === null) return 'NEVER_ISSUED'

  // Correct the current version, not a historical one. Allowing a branch would
  // make "which document does this investor hold" a question with two answers.
  if (document.supersededAt !== null) return 'ALREADY_SUPERSEDED'

  const pending = siblings.find(
    (sibling) => sibling.supersedesId === document.id && sibling.issuedAt === null,
  )
  if (pending) return 'CORRECTION_ALREADY_WAITING'

  return null
}

/** What the operator is told. Specific, and says what to do instead. */
export function correctionRefusalMessage(reason: CorrectionRefusal): string {
  switch (reason) {
    case 'NEVER_ISSUED':
      return (
        'This document has not been issued, so there is nothing to correct — the investor has ' +
        'never seen it. Remove it and upload the right file instead.'
      )
    case 'ALREADY_SUPERSEDED':
      return (
        'This is an earlier version that has already been replaced. Correct the current ' +
        'version instead — it is the one the investor holds.'
      )
    case 'CORRECTION_ALREADY_WAITING':
      return (
        'A corrected version of this document is already uploaded and waiting to be issued. ' +
        'Issue it or remove it before uploading another.'
      )
  }
}

export function nextVersion(predecessor: VersionedDocument): number {
  return predecessor.version + 1
}

// ---------------------------------------------------------------------------

export interface DocumentLineage<T extends VersionedDocument> {
  /** The version in force — the newest one that has not been superseded. */
  current: T
  /** Everything it replaced, newest first. May be empty. */
  superseded: T[]
  /** A correction uploaded and not yet issued. Operator-side only. */
  pending: T | null
}

/**
 * Group a flat list of documents into chains.
 *
 * A chain is walked forward from its root — the document with no predecessor
 * *in this list*. "In this list" matters: the investor's view is issued-only,
 * so a chain whose root is an unissued draft simply starts at the first issued
 * version, and nothing has to be filtered out afterwards.
 *
 * An unissued correction is separated out as `pending` rather than becoming the
 * current version, because it is not on the investor's portal yet and calling
 * it current on the operator's screen would be the same lie in the other
 * direction.
 */
export function lineagesOf<T extends VersionedDocument>(
  documents: readonly T[],
): DocumentLineage<T>[] {
  const byId = new Map(documents.map((document) => [document.id, document]))
  const successorOf = new Map<string, T>()

  for (const document of documents) {
    if (document.supersedesId && byId.has(document.supersedesId)) {
      successorOf.set(document.supersedesId, document)
    }
  }

  const roots = documents.filter(
    (document) => !document.supersedesId || !byId.has(document.supersedesId),
  )

  return roots.map((root) => {
    const chain: T[] = [root]
    const seen = new Set<string>([root.id])

    let cursor = successorOf.get(root.id)
    // `seen` is a cycle guard. A cycle cannot be created by any action here —
    // a new version always points backwards at an existing row — but a walk
    // that trusts data to be acyclic is a walk that hangs when it is not.
    while (cursor && !seen.has(cursor.id)) {
      chain.push(cursor)
      seen.add(cursor.id)
      cursor = successorOf.get(cursor.id)
    }

    const last = chain[chain.length - 1]!
    const pending = last.issuedAt === null && chain.length > 1 ? last : null
    const issuedChain = pending ? chain.slice(0, -1) : chain
    const current = issuedChain[issuedChain.length - 1]!

    return {
      current,
      superseded: issuedChain.slice(0, -1).reverse(),
      pending,
    }
  })
}

/**
 * A version label for a screen. Version 1 with no history says nothing at all,
 * because "Version 1" on a document nobody has corrected is noise.
 */
export function versionLabel(document: VersionedDocument, historyLength: number): string {
  if (document.version === 1 && historyLength === 0) return ''
  return `Version ${document.version}`
}
