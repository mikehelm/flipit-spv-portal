'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { actionError, actionOk, type ActionState } from '@/components/admin/action-state'
import { db } from '@/db'
import { documentPackages, offers } from '@/db/schema'
import { audit } from '@/lib/audit'
import { requireOnboardedAdmin } from '@/lib/auth/guards'
import { documentWithOwner } from '@/lib/documents/data'
import { optionalText, requiredText, zodFieldErrors as fieldErrors } from '@/lib/form-values'
import { ingest } from '@/lib/media/ingest'
import { mediaStore } from '@/lib/media/store'

/**
 * Document packages. BUILD_SPEC §5 status 3, §13.
 *
 * *"Documents issued · Operator · Date, document list, download links."*
 *
 * This was the last thing in the specification waiting on somewhere to put a
 * file, and WP15's `MediaStore` is that. It reuses the same ingest — the same
 * size check, the same identification from the file's own bytes, the same one
 * writer — with `document` as the kind, which accepts PDF and nothing else.
 *
 * **Uploading and issuing are two acts, and the gap between them is the
 * point.** §5 makes "documents issued" a dated step on the investor's
 * timeline. An upload that appeared on their portal immediately would mean the
 * operator could not assemble a package, check it, and then release it — and
 * would make the date on the timeline a claim about when a file was saved
 * rather than about when the investor could read it.
 *
 * **A document belongs to one offer, which belongs to one account.** There is
 * no shared document, no "issue to everybody", and no action here that takes
 * more than one offer id. §14's rule about sending is about email, but the
 * reason behind it is the same reason a document goes to one person at a time.
 */

const INVESTORS_PATH = '/investors'

const detailsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Give it a title the investor will recognise.')
    .max(120, 'Keep the title short — the description is where the detail goes.'),
  description: z.string().trim().max(600, 'Keep the description under 600 characters.').nullable(),
})

export async function uploadDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const offerId = optionalText(formData.get('offerId'))
  if (!offerId) return actionError('That document could not be attached to a record.')

  const offer = await db.query.offers.findFirst({ where: eq(offers.id, offerId) })
  if (!offer) return actionError('That record no longer exists.')

  const parsed = detailsSchema.safeParse({
    title: requiredText(formData.get('title')),
    description: optionalText(formData.get('description')),
  })
  if (!parsed.success) {
    return actionError('That document was not uploaded.', fieldErrors(parsed.error))
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return actionError('Choose a PDF first.', { file: 'No file was attached.' })
  }

  const result = await ingest('document', new Uint8Array(await file.arrayBuffer()), file.type)

  if (!result.ok) {
    await audit({
      actor: { kind: 'user', id: admin.id, label: admin.email },
      entityType: 'document_package',
      entityId: offerId,
      action: 'document.refused',
      metadata: { reason: result.reason },
    })
    return actionError(result.message)
  }

  const [created] = await db
    .insert(documentPackages)
    .values({
      offerId,
      title: parsed.data.title,
      description: parsed.data.description,
      storageKey: result.storageKey,
      contentType: result.format,
      sizeBytes: result.sizeBytes,
      // Not issued. §5 makes issuing a separate, dated act.
      issuedAt: null,
      uploadedById: admin.id,
    })
    .returning()

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'document_package',
    entityId: created!.id,
    action: 'document.uploaded',
    metadata: { offerId, title: created!.title, sizeBytes: result.sizeBytes },
  })

  revalidatePath(INVESTORS_PATH)
  return actionOk(
    'Uploaded, and not yet issued. Open it from this screen and check it, then issue it — ' +
      'nothing reaches the investor until you do.',
  )
}

// ---------------------------------------------------------------------------

/**
 * Issuing. The act §5 puts a date against on the investor's timeline.
 *
 * It takes an explicit confirmation for the same reason recording funds does:
 * it is the moment a document becomes something an investor reads and relies
 * on, and it should not be one mis-click away from a list of drafts.
 */
export async function issueDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const documentId = optionalText(formData.get('documentId'))
  if (!documentId) return actionError('That document could not be identified.')

  if (formData.get('confirm') !== 'ISSUE') {
    return actionError(
      'Issuing puts this document on the investor’s own portal, where they can download it. ' +
        'Tick the confirmation to go ahead.',
      { confirm: 'Confirm you have opened it and checked it is the right file.' },
    )
  }

  const document = await documentWithOwner(documentId)
  if (!document) return actionError('That document no longer exists.')
  if (document.issuedAt) return actionOk('It is already issued.')

  const issuedAt = new Date()
  await db
    .update(documentPackages)
    .set({ issuedAt })
    .where(eq(documentPackages.id, documentId))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'document_package',
    entityId: documentId,
    action: 'document.issued',
    metadata: { offerId: document.offerId, title: document.title },
  })

  revalidatePath(INVESTORS_PATH)
  revalidatePath('/portal')
  return actionOk(
    'Issued. It is on their portal now. Advancing them to “Documents issued” on the timeline ' +
      'is a separate step, so you can issue several before you tell them.',
  )
}

/**
 * Withdrawing an issued document.
 *
 * Not a deletion: the row stays, `issued_at` goes back to null, and the audit
 * log keeps both events. An investor may already have downloaded it — §5 says
 * a correction is *"never a silent overwrite"* — so the honest position is
 * that this takes it off the portal and records that it was there.
 */
export async function withdrawDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const documentId = optionalText(formData.get('documentId'))
  if (!documentId) return actionError('That document could not be identified.')

  const document = await documentWithOwner(documentId)
  if (!document) return actionError('That document no longer exists.')
  if (!document.issuedAt) return actionOk('It was not issued.')

  await db
    .update(documentPackages)
    .set({ issuedAt: null })
    .where(eq(documentPackages.id, documentId))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'document_package',
    entityId: documentId,
    action: 'document.withdrawn',
    metadata: {
      offerId: document.offerId,
      title: document.title,
      wasIssuedAt: document.issuedAt.toISOString(),
    },
  })

  revalidatePath(INVESTORS_PATH)
  revalidatePath('/portal')
  return actionOk(
    'Taken off their portal. They may already have downloaded it, so if the figures were ' +
      'wrong, tell them — the audit log records that it was issued and that you withdrew it.',
  )
}

/**
 * Removing a document that was never issued.
 *
 * Deliberately refuses once it has been. Deleting the file behind a document
 * an investor has already been given would leave the record claiming an
 * issuance with nothing behind it, and §5 does not allow a silent overwrite of
 * anything on that timeline. Withdraw first, which is recorded, and then this
 * becomes available.
 */
export async function removeDocumentAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOnboardedAdmin()

  const documentId = optionalText(formData.get('documentId'))
  if (!documentId) return actionError('That document could not be identified.')

  const document = await documentWithOwner(documentId)
  if (!document) return actionError('That document no longer exists.')

  if (document.issuedAt) {
    return actionError(
      'This document has been issued, so the investor may already hold a copy. Withdraw it ' +
        'first — that is recorded — and then it can be removed.',
    )
  }

  const store = mediaStore()
  if (store) await store.remove(document.storageKey)
  await db.delete(documentPackages).where(eq(documentPackages.id, documentId))

  await audit({
    actor: { kind: 'user', id: admin.id, label: admin.email },
    entityType: 'document_package',
    entityId: documentId,
    action: 'document.removed',
    metadata: { offerId: document.offerId, title: document.title },
  })

  revalidatePath(INVESTORS_PATH)
  return actionOk('Removed, along with the stored file. It had never been issued.')
}
