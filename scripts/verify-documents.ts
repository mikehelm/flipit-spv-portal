/**
 * Database-backed verification of document packages. BUILD_SPEC §5, §7, §13, §15.
 *
 * The unit tests pin the pure rule. This runs the real queries against a real
 * Postgres and a real store, **with two investors who each hold a document**,
 * and checks the thing that only becomes meaningful once there are two: that
 * Alice's portal shows Alice's document and not Bruno's, that a guessed id
 * finds nothing, and that the answer is the same whether the document belongs
 * to somebody else or does not exist.
 *
 * It creates its own data under an obvious prefix and deletes it at the end.
 * Run it against a development database only:
 *
 *   pnpm verify:documents
 */

import 'dotenv/config'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { documentPackages, investorAccounts, offers, rounds, users } from '@/db/schema'
import { readServiceConfig } from '@/lib/auth/service-config'
import { mayDownloadDocument } from '@/lib/documents/access'
import {
  documentWithOwner,
  documentsByAccount,
  documentsForOffer,
  investorDocuments,
} from '@/lib/documents/data'
import { lineagesOf, nextVersion, whyNotCorrectable } from '@/lib/documents/versions'
import { resetEnvCache } from '@/lib/env'
import { ingest } from '@/lib/media/ingest'
import { mediaStore, resetMediaStoreCache } from '@/lib/media/store'
import { canView, portalAccess } from '@/lib/portal/access'

const PREFIX = 'docs-verify'

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** A minimal but real PDF: header, one object, trailer. */
function pdfBytes(marker: string): Uint8Array {
  const text =
    `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${marker}\n` +
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n'
  return new Uint8Array(Buffer.from(text, 'latin1'))
}

async function cleanup(): Promise<void> {
  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  const store = mediaStore()

  for (const account of accounts) {
    const theirOffers = await db
      .select({ id: offers.id })
      .from(offers)
      .where(eq(offers.accountId, account.id))

    for (const offer of theirOffers) {
      const documents = await db
        .select()
        .from(documentPackages)
        .where(eq(documentPackages.offerId, offer.id))
      for (const document of documents) {
        if (store) await store.remove(document.storageKey)
      }
      await db.delete(documentPackages).where(eq(documentPackages.offerId, offer.id))
      await db.delete(offers).where(eq(offers.id, offer.id))
    }
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }

  await db.delete(rounds).where(like(rounds.name, `${PREFIX}%`))
}

async function main(): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'spv-verify-docs-'))
  process.env.MEDIA_STORE = 'filesystem'
  process.env.MEDIA_DIR = directory
  resetEnvCache()
  resetMediaStoreCache()

  console.log(`\nDocument packages, against the real database\n  store: ${directory}\n`)

  await cleanup()

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) {
    console.log('  FAIL  no seeded operator — run pnpm db:seed first')
    process.exitCode = 1
    return
  }

  const [round] = await db
    .insert(rounds)
    .values({ name: `${PREFIX} round`, aggregateTargetUsd: '30000', flipitShare: '0.300000' })
    .returning()

  const people = []
  for (const who of ['alice', 'bruno']) {
    const [account] = await db
      .insert(investorAccounts)
      .values({
        name: `${who} Verify`,
        email: `${PREFIX}-${who}@example.com`,
        status: 'ACTIVE',
      })
      .returning()

    const [offer] = await db
      .insert(offers)
      .values({
        roundId: round!.id,
        accountId: account!.id,
        proposedAmountUsd: '5000',
        spvPercentage: '0.166667',
        indirectPercentage: '0.050000',
        responseDeadline: '2026-08-10',
      })
      .returning()

    people.push({ who, account: account!, offer: offer! })
  }

  const [alice, bruno] = people

  const config = await readServiceConfig()
  const access = (status: 'ACTIVE' | 'SUSPENDED') =>
    portalAccess({
      accountStatus: status,
      closedAccountAccess: config.closedAccountAccess,
      serviceMode: config.serviceMode,
    })

  // --- Ingest -------------------------------------------------------------
  console.log('§5 — uploading, and not issuing')

  const stored = []
  for (const person of people) {
    const result = await ingest('document', pdfBytes(`for ${person.who}`), 'image/png')
    check(`${person.who}'s PDF is accepted despite declaring itself a PNG`, result.ok)
    if (!result.ok) return
    check(`and is identified from its own bytes`, result.format === 'application/pdf')
    check(`and gets a document-shaped key`, result.storageKey.startsWith('doc_'))

    const [row] = await db
      .insert(documentPackages)
      .values({
        offerId: person.offer.id,
        title: `${PREFIX} subscription agreement for ${person.who}`,
        storageKey: result.storageKey,
        contentType: result.format,
        sizeBytes: result.sizeBytes,
        issuedAt: null,
        uploadedById: operator.id,
      })
      .returning()

    stored.push({ ...person, document: row! })
  }

  const [aliceDoc, brunoDoc] = stored

  const onDisk = await readFile(path.join(directory, aliceDoc!.document.storageKey))
  check(
    'a document is stored byte-for-byte — a legal instrument is not rewritten',
    onDisk.toString('latin1').includes('for alice') && onDisk.length === aliceDoc!.document.sizeBytes,
  )

  const notPdf = await ingest('document', new Uint8Array(Buffer.from('%PNG stuff')), 'application/pdf')
  check('something that is not a PDF is refused, whatever it declares', !notPdf.ok)
  check('and nothing was written for it', (await readdir(directory)).length === 2)

  // --- Before issuing -----------------------------------------------------
  console.log('\n§5 — nothing reaches the investor before it is issued')

  check(
    "Alice's own portal lists nothing yet",
    (await investorDocuments(alice!.account.id)).length === 0,
  )
  check(
    'and the rule agrees',
    mayDownloadDocument({
      audience: 'INVESTOR',
      issuedAt: aliceDoc!.document.issuedAt,
      belongsToRequester: true,
      portalReadable: canView(access('ACTIVE')),
    }) === false,
  )
  check(
    'the operator can open it, which is how he checks it',
    mayDownloadDocument({
      audience: 'ADMIN',
      issuedAt: null,
      belongsToRequester: true,
      portalReadable: false,
    }),
  )

  // --- Issued -------------------------------------------------------------
  console.log('\n§5, §13 — issued, and only to the person it belongs to')

  for (const entry of stored) {
    await db
      .update(documentPackages)
      .set({ issuedAt: new Date() })
      .where(eq(documentPackages.id, entry.document.id))
  }

  const aliceList = await investorDocuments(alice!.account.id)
  const brunoList = await investorDocuments(bruno!.account.id)

  check("Alice's portal lists exactly one document", aliceList.length === 1)
  check('and it is hers', aliceList[0]?.id === aliceDoc!.document.id)
  check("and Bruno's is not in it", !aliceList.some((d) => d.id === brunoDoc!.document.id))
  check("Bruno's portal lists exactly one, and it is his", brunoList.length === 1 && brunoList[0]?.id === brunoDoc!.document.id)
  check(
    "nothing in Alice's list mentions Bruno",
    !JSON.stringify(aliceList).includes('bruno') && !JSON.stringify(aliceList).includes(bruno!.account.id),
  )

  const brunosDocument = await documentWithOwner(brunoDoc!.document.id)
  check(
    "Alice is refused Bruno's document by id",
    mayDownloadDocument({
      audience: 'INVESTOR',
      issuedAt: brunosDocument!.issuedAt,
      belongsToRequester: brunosDocument!.accountId === alice!.account.id,
      portalReadable: canView(access('ACTIVE')),
    }) === false,
  )
  check(
    'a document id that does not exist resolves to nothing at all',
    (await documentWithOwner('doc-that-does-not-exist')) === null,
  )

  // --- §7 -----------------------------------------------------------------
  console.log('\n§7 — download survives read-only and sunset, and not suspension')

  for (const mode of ['READ_ONLY', 'SUNSET'] as const) {
    const modeAccess = portalAccess({
      accountStatus: 'ACTIVE',
      closedAccountAccess: config.closedAccountAccess,
      serviceMode: mode,
    })
    check(
      `${mode.toLowerCase()}: an investor can still take their records with them`,
      mayDownloadDocument({
        audience: 'INVESTOR',
        issuedAt: aliceList[0]!.issuedAt,
        belongsToRequester: true,
        portalReadable: canView(modeAccess),
      }),
    )
  }

  check(
    'a suspended account cannot',
    mayDownloadDocument({
      audience: 'INVESTOR',
      issuedAt: aliceList[0]!.issuedAt,
      belongsToRequester: true,
      portalReadable: canView(access('SUSPENDED')),
    }) === false,
  )

  // --- Withdrawal ---------------------------------------------------------
  console.log('\n§5 — withdrawing is recorded, not erased')

  await db
    .update(documentPackages)
    .set({ issuedAt: null })
    .where(eq(documentPackages.id, aliceDoc!.document.id))

  check(
    'a withdrawn document leaves her portal',
    (await investorDocuments(alice!.account.id)).length === 0,
  )
  check(
    'but the row is still there',
    (await documentWithOwner(aliceDoc!.document.id)) !== null,
  )
  check(
    "and Bruno's is untouched",
    (await investorDocuments(bruno!.account.id)).length === 1,
  )

  // --- A correction, end to end -------------------------------------------
  console.log('\n§5 — a correction is never a silent overwrite')

  // Put Alice's document back on her portal so there is something to correct.
  const reissuedAt = new Date()
  await db
    .update(documentPackages)
    .set({ issuedAt: reissuedAt })
    .where(eq(documentPackages.id, aliceDoc!.document.id))

  const v1 = (await documentWithOwner(aliceDoc!.document.id))!
  check('version 1 is version 1', v1.version === 1)
  check('and is not superseded', v1.supersededAt === null)

  const siblings = await documentsForOffer(v1.offerId)
  check('an issued, current document may be corrected', whyNotCorrectable(v1, siblings) === null)

  const correctedFile = await ingest('document', pdfBytes(`${PREFIX} corrected for alice`))
  if (!correctedFile.ok) throw new Error('the corrected file was refused')

  const [v2row] = await db
    .insert(documentPackages)
    .values({
      offerId: v1.offerId,
      title: v1.title,
      description: 'Corrected.',
      storageKey: correctedFile.storageKey,
      contentType: correctedFile.format,
      sizeBytes: correctedFile.sizeBytes,
      issuedAt: null,
      version: nextVersion(v1),
      supersedesId: v1.id,
    })
    .returning()

  check('the correction is version 2', v2row!.version === 2)
  check('and points at the version it replaces', v2row!.supersedesId === v1.id)

  const duringUpload = await investorDocuments(alice!.account.id)
  check(
    'while it waits, she still has exactly one document',
    duringUpload.length === 1 && duringUpload[0]!.id === v1.id,
  )
  check(
    'and the correction is not on her portal',
    !duringUpload.some((d) => d.id === v2row!.id),
  )

  check(
    'a second correction of the same document is refused while one waits',
    whyNotCorrectable(v1, await documentsForOffer(v1.offerId)) === 'CORRECTION_ALREADY_WAITING',
  )

  // Issue it, the way the action does: both statements, one transaction.
  const supersededAt = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(documentPackages)
      .set({ issuedAt: supersededAt })
      .where(eq(documentPackages.id, v2row!.id))
    await tx
      .update(documentPackages)
      .set({ supersededAt })
      .where(eq(documentPackages.id, v1.id))
  })

  const afterIssue = await investorDocuments(alice!.account.id)
  check('after issuing, she has both versions listed', afterIssue.length === 2)

  const lineages = lineagesOf(afterIssue)
  check('and they are one chain, not two documents', lineages.length === 1)
  check('whose current version is the correction', lineages[0]!.current.id === v2row!.id)
  check('with version 1 kept as history', lineages[0]!.superseded.map((d) => d.id).join() === v1.id)
  check('and nothing pending', lineages[0]!.pending === null)

  // §5.1's rule for certificates, applied here: the superseded version is
  // retained and stays downloadable.
  const oldStill = await documentWithOwner(v1.id)
  check('the superseded version is still downloadable by her', mayDownloadDocument({
    audience: 'INVESTOR',
    issuedAt: oldStill!.issuedAt,
    belongsToRequester: oldStill!.accountId === alice!.account.id,
    portalReadable: true,
  }))
  check('and its file is still in the store', (await mediaStore()!.get(v1.storageKey)) !== null)
  check('and it is marked superseded', oldStill!.supersededAt !== null)

  check(
    'an already superseded version cannot itself be corrected',
    whyNotCorrectable(oldStill!, await documentsForOffer(v1.offerId)) === 'ALREADY_SUPERSEDED',
  )

  check(
    'none of this reached Bruno',
    (await investorDocuments(bruno!.account.id)).length === 1 &&
      !JSON.stringify(await investorDocuments(alice!.account.id)).includes(bruno!.account.id),
  )

  // Withdrawing the correction puts her back where she was.
  await db.transaction(async (tx) => {
    await tx.update(documentPackages).set({ issuedAt: null }).where(eq(documentPackages.id, v2row!.id))
    await tx
      .update(documentPackages)
      .set({ supersededAt: null })
      .where(eq(documentPackages.id, v1.id))
  })

  const afterWithdraw = await investorDocuments(alice!.account.id)
  check(
    'withdrawing the correction leaves her holding version 1 again',
    afterWithdraw.length === 1 && afterWithdraw[0]!.id === v1.id,
  )
  check(
    'and version 1 is current again, not superseded',
    (await documentWithOwner(v1.id))!.supersededAt === null,
  )

  // --- The operator's grouped view ---------------------------------------
  console.log('\nThe Investors screen')

  const grouped = await documentsByAccount()
  const aliceGroup = grouped.get(alice!.account.id) ?? []
  check('the operator sees the withdrawn document, which the investor does not',
    aliceGroup.some((entry) => entry.documents.some((d) => d.id === aliceDoc!.document.id)))
  check(
    "and Alice's group contains no document belonging to Bruno",
    !aliceGroup.some((entry) => entry.documents.some((d) => d.id === brunoDoc!.document.id)),
  )

  await cleanup()

  const leftovers = await db
    .select({ id: documentPackages.id })
    .from(documentPackages)
    .where(like(documentPackages.title, `${PREFIX}%`))
  check('verification data is removed', leftovers.length === 0)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
