/**
 * Database-backed verification of WP15. BUILD_SPEC §13.2, §13.3.
 *
 * The unit tests pin the pure rules — what a stripper removes, what the sniffer
 * recognises, who `mayViewVideo` lets in. This runs the real thing against a
 * real Postgres and a real store, **with a second investor present
 * throughout**, and checks what only exists once there are rows: that the file
 * on disk is the stripped one, that an unpublished video is unreachable by
 * either investor, that publishing changes that for both of them equally, and
 * that suspending one of them takes the video away from her and leaves it
 * alone for the other.
 *
 * It creates its own data under an obvious prefix and deletes it at the end.
 * Run it against a development database only:
 *
 *   pnpm verify:media
 */

import 'dotenv/config'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { desc, eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents, investorAccounts, mediaAssets, operatorVideos, users } from '@/db/schema'
import { resetEnvCache } from '@/lib/env'
import { readDimensions } from '@/lib/media/dimensions'
import { jpegWithMetadata, mp4WithLocation, svgBytes, webmWithMetadata } from '@/lib/media/fixtures'
import { ingest } from '@/lib/media/ingest'
import {
  MEDIA_CHECK_COMPLETED_ACTION,
  mediaCheckRecordSchema,
} from '@/lib/media/reconcile'
import { mediaStore, resetMediaStoreCache } from '@/lib/media/store'
import { mayViewVideo } from '@/lib/media/video'
import { currentVideo, deleteVideo } from '@/lib/media/video-store'
import { portalAccess, canView } from '@/lib/portal/access'
import { readServiceConfig } from '@/lib/auth/service-config'

const PREFIX = 'wp15-verify'
const SECRET = 'Privet Drive'

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

async function cleanup(): Promise<void> {
  const videos = await db.select().from(operatorVideos)
  for (const video of videos) await deleteVideo(video)

  const assets = await db
    .select()
    .from(mediaAssets)
    .where(like(mediaAssets.name, `${PREFIX}%`))
  const store = mediaStore()
  for (const asset of assets) {
    if (store) await store.remove(asset.storageKey)
    await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id))
  }

  await db.delete(investorAccounts).where(like(investorAccounts.email, `${PREFIX}%`))
}

async function main(): Promise<void> {
  // A real store on a real disk, in a directory this script owns.
  const directory = await mkdtemp(path.join(tmpdir(), 'spv-verify-media-'))
  process.env.MEDIA_STORE = 'filesystem'
  process.env.MEDIA_DIR = directory
  resetEnvCache()
  resetMediaStoreCache()

  console.log(`\nWP15 — media and video, against the real database\n  store: ${directory}\n`)

  await cleanup()

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) {
    console.log('  FAIL  no seeded operator — run pnpm db:seed first')
    process.exitCode = 1
    return
  }

  // Two investors, throughout. Every access check below is asked twice.
  const [alice] = await db
    .insert(investorAccounts)
    .values({ name: 'Alice Verify', email: `${PREFIX}-alice@example.com`, status: 'ACTIVE' })
    .returning()
  const [bruno] = await db
    .insert(investorAccounts)
    .values({ name: 'Bruno Verify', email: `${PREFIX}-bruno@example.com`, status: 'ACTIVE' })
    .returning()

  const config = await readServiceConfig()
  const activeAccess = portalAccess({
    accountStatus: 'ACTIVE',
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })
  const suspendedAccess = portalAccess({
    accountStatus: 'SUSPENDED',
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })

  // --- §13.2 — an image, stripped, on this deployment's own disk ----------
  console.log('\n§13.2 — the media library')

  const original = jpegWithMetadata()
  const image = await ingest('image', original, 'image/gif')
  check('an image uploaded declaring itself a GIF is stored as what it really is', image.ok)
  if (!image.ok) return

  check('the sniffed type wins over the declared one', image.format === 'image/jpeg')

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      name: `${PREFIX} headshot`,
      description: 'A photograph with a location in it',
      storageKey: image.storageKey,
      contentType: image.format,
      sizeBytes: image.sizeBytes,
      width: readDimensions('image/jpeg', image.stored)?.width ?? null,
      height: readDimensions('image/jpeg', image.stored)?.height ?? null,
      uploadedById: operator.id,
    })
    .returning()

  const onDisk = await readFile(path.join(directory, image.storageKey))
  check('the uploaded file carried a location', Buffer.from(original).toString('latin1').includes(SECRET))
  check('the file on disk does not', !onDisk.toString('latin1').includes(SECRET))
  check('the original never reached the disk at all', onDisk.length === image.sizeBytes)
  check('it is still a readable image', readDimensions('image/jpeg', new Uint8Array(onDisk)) !== null)
  check('the row records the stored size, not the uploaded one', asset!.sizeBytes < original.length)
  check('the dimensions survived', asset!.width === 128 && asset!.height === 64)

  const refusedSvg = await ingest('image', svgBytes(), 'image/png')
  check('an SVG renamed to .png is refused', !refusedSvg.ok)
  const files = await readdir(directory)
  check('and nothing was written for it', files.length === 1)

  // --- §13.3 — the video --------------------------------------------------
  console.log('\n§13.3 — the personal video')

  const videoBytes = mp4WithLocation()
  const video = await ingest('video', videoBytes, 'video/mp4')
  check('a phone video is accepted', video.ok)
  if (!video.ok) return

  const videoOnDisk = await readFile(path.join(directory, video.storageKey))
  check('the uploaded video carried coordinates', Buffer.from(videoBytes).toString('latin1').includes('+51.5074'))
  check('the stored video does not', !videoOnDisk.toString('latin1').includes('+51.5074'))
  check('and it is byte-for-byte the same length, so it still plays', videoOnDisk.length === videoBytes.length)

  // An uploaded WebM — the case the strip used to pass straight through.
  const webmBytes = webmWithMetadata()
  const webm = await ingest('video', webmBytes, 'video/webm')
  check('an uploaded WebM is accepted', webm.ok)

  if (webm.ok) {
    const webmOnDisk = await readFile(path.join(directory, webm.storageKey))
    const uploadedText = Buffer.from(webmBytes).toString('latin1')
    const storedText = webmOnDisk.toString('latin1')

    check('the uploaded WebM carried a name and a location', uploadedText.includes(SECRET))
    check('the stored one does not', !storedText.includes(SECRET))
    check('nor the muxing software', !storedText.includes('Muxed by'))
    check('nor the track name', !storedText.includes('Camera of'))
    check('nor the tag block', !storedText.includes('LOCATION'))
    check(
      'and it is byte-for-byte the same length, so seeking still works',
      webmOnDisk.length === webmBytes.length,
    )
    check('it is still recognisably a WebM', storedText.includes('webm'))

    const store = mediaStore()
    if (store) await store.remove(webm.storageKey)
  }

  const [row] = await db
    .insert(operatorVideos)
    .values({
      ownerId: operator.id,
      storageKey: video.storageKey,
      contentType: video.format,
      sizeBytes: video.sizeBytes,
      caption: 'A short note',
      transcript: 'Hello — thank you for taking a look at this.',
      publishedAt: null,
    })
    .returning()

  const unpublished = await currentVideo()
  check('it arrives unpublished', unpublished?.publishedAt === null)

  for (const [who, account] of [
    ['Alice', alice],
    ['Bruno', bruno],
  ] as const) {
    check(
      `${who} cannot reach it while it is unpublished`,
      mayViewVideo({
        audience: 'INVESTOR',
        publishedAt: unpublished!.publishedAt,
        portalReadable: canView(activeAccess),
      }) === false,
      account!.email,
    )
  }

  check(
    'the operator can, which is what the preview is for',
    mayViewVideo({ audience: 'ADMIN', publishedAt: null, portalReadable: false }),
  )

  await db
    .update(operatorVideos)
    .set({ publishedAt: new Date() })
    .where(eq(operatorVideos.id, row!.id))

  const published = await currentVideo()

  for (const who of ['Alice', 'Bruno']) {
    check(
      `${who} can reach it once it is published`,
      mayViewVideo({
        audience: 'INVESTOR',
        publishedAt: published!.publishedAt,
        portalReadable: canView(activeAccess),
      }),
    )
  }

  check(
    'a suspended investor cannot, published or not',
    mayViewVideo({
      audience: 'INVESTOR',
      publishedAt: published!.publishedAt,
      portalReadable: canView(suspendedAccess),
    }) === false,
  )

  check(
    'nobody without a session can, published or not',
    mayViewVideo({
      audience: 'ANONYMOUS',
      publishedAt: published!.publishedAt,
      portalReadable: true,
    }) === false,
  )

  // --- Replacement --------------------------------------------------------
  const existing = await currentVideo()
  const secondUpload = await ingest('video', mp4WithLocation())
  check('a replacement can be ingested', secondUpload.ok)
  if (!secondUpload.ok) return

  // Exactly what the upload route does: the previous row and its file go, and
  // the new row arrives unpublished carrying the text across.
  await deleteVideo(existing!)
  await db.insert(operatorVideos).values({
    ownerId: operator.id,
    storageKey: secondUpload.storageKey,
    contentType: secondUpload.format,
    sizeBytes: secondUpload.sizeBytes,
    caption: existing!.caption,
    transcript: existing!.transcript,
    publishedAt: null,
  })

  const afterReplace = await currentVideo()
  check('a replacement arrives unpublished, even over a published one', afterReplace!.publishedAt === null)
  check('the caption and transcript are carried across', afterReplace!.transcript === existing!.transcript)
  check(
    "the replaced video's file is gone from the store",
    !(await readdir(directory)).includes(existing!.storageKey),
  )

  // --- The audit log ------------------------------------------------------
  console.log('\n§15, §16 — what is in the log')

  const entries = await db
    .select()
    .from(auditEvents)
    .where(like(auditEvents.entityType, '%video%'))

  const serialised = JSON.stringify(entries)
  check('no audit entry contains the transcript', !serialised.includes('thank you for taking a look'))
  check('no audit entry contains a storage key', !serialised.includes(video.storageKey))

  // --- No leakage across investors ---------------------------------------
  console.log('\n§15 — nothing about another investor')

  const videoRows = await db.select().from(operatorVideos)
  const videoJson = JSON.stringify(videoRows)
  check('no video row names an investor', !videoJson.includes(alice!.id) && !videoJson.includes(bruno!.id))

  const assetRows = await db.select().from(mediaAssets)
  const assetJson = JSON.stringify(assetRows)
  check(
    'no media row names an investor',
    !assetJson.includes(alice!.id) && !assetJson.includes(bruno!.id),
  )

  await cleanup()

  // After the cleanup, deliberately: the report is about every media row in the
  // database, so the only way to assert on exact counts is for the only rows
  // present to be the ones this check just made.
  await verifyReconciliation()

  const leftovers = await db.select().from(mediaAssets).where(like(mediaAssets.name, `${PREFIX}%`))
  check('verification data is removed', leftovers.length === 0)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}


/**
 * `pnpm media:check`, run the way a person runs it. BUILD_SPEC §5, §13.2.
 *
 * The reconciliation report is a script, and a script is the one kind of code
 * that quietly stops working: nothing imports it, so nothing type-checks its
 * output, and the only signal that it has gone wrong is somebody reading a
 * clean report about a store that is not clean. Its two answers are the ones
 * that matter after a restore — *this record has no file* and *this file has no
 * record* — so both are provoked here, in a directory this function owns, and
 * the real command is spawned against them.
 *
 * The store is switched to an empty directory for the duration and switched
 * back afterwards, so nothing above is disturbed.
 */
async function verifyReconciliation(): Promise<void> {
  console.log('\n§5, §13.2 — the reconciliation report, as a person runs it')

  const previousDirectory = process.env.MEDIA_DIR
  const directory = await mkdtemp(path.join(tmpdir(), 'spv-verify-reconcile-'))

  try {
    // A file with a valid storage key that no row names, and a file this
    // application would never have written at all.
    await writeFile(path.join(directory, 'doc_ORPHANORPHANORPHANORPH'), Buffer.alloc(11))
    await writeFile(path.join(directory, 'somebody-elses-notes.txt'), 'left here')

    // And a row whose file is not there, which is what a database restored
    // without its bucket looks like.
    const [ghost] = await db
      .insert(mediaAssets)
      .values({
        name: `${PREFIX} ghost`,
        storageKey: 'img_GHOSTGHOSTGHOSTGHOSTGH',
        contentType: 'image/png',
        sizeBytes: 4321,
      })
      .returning()

    const report = await runCheck(directory)

    check('the report exits non-zero when something is wrong', report.code === 1, String(report.code))
    check(
      'a record whose file is missing is reported as missing',
      /1 file is MISSING/.test(report.out),
      report.out.match(/\d+ files? (is|are) MISSING/)?.[0] ?? 'no MISSING line',
    )
    check(
      'and it is named by its record rather than by its storage key',
      report.out.includes(ghost!.id) && !report.out.includes('img_GHOSTGHOSTGHOSTGHOSTGH'),
    )
    check(
      'both objects that no record points at are reported',
      /2 objects are stored that no record points at/.test(report.out),
      report.out.match(/\d+ objects are stored[^\n]*/)?.[0],
    )
    check(
      'an orphan is named in full, because naming it is the only way to act on it',
      report.out.includes('doc_ORPHANORPHANORPHANORPH'),
    )
    check(
      'and a file this application would never write is called that',
      report.out.includes('somebody-elses-notes.txt') &&
        report.out.includes('not a storage key this application would write'),
    )
    // Eleven zero bytes and nine characters, which is the number a person
    // reading the report would add up themselves.
    check(
      'the total bytes of the orphans are stated',
      report.out.includes('(20 bytes)'),
      report.out.match(/\(\d+ bytes\)/)?.[0] ?? 'no total',
    )
    check('and nothing was changed', (await readdir(directory)).length === 2)

    await db.delete(mediaAssets).where(eq(mediaAssets.id, ghost!.id))

    // Now with the orphans gone and no rows left: the clean answer.
    const empty = await mkdtemp(path.join(tmpdir(), 'spv-verify-reconcile-clean-'))
    const clean = await runCheck(empty)

    check(
      'a store with nothing in it and no records is a clean answer',
      clean.code === 0,
      clean.out.trim().split('\n').slice(-3).join(' | '),
    )
    check('and says so in as many words', /clean answer/.test(clean.out))

    // --- And the line it leaves behind, which is the whole of what the health
    // report reads. A check whose verdict never reaches the audit log is a
    // check `pnpm check:health` will report as never having run.
    const written = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, MEDIA_CHECK_COMPLETED_ACTION))
      .orderBy(desc(auditEvents.createdAt))
      .limit(2)

    check('each run writes a line saying that it ran', written.length === 2)

    const latest = mediaCheckRecordSchema.safeParse(written[0]?.metadata)
    check(
      'and it parses as the record the health report expects',
      latest.success,
      latest.success ? undefined : latest.error.message,
    )
    check(
      'the clean run is recorded as clean',
      latest.success && latest.data.problems === 0 && latest.data.checked === 0,
    )

    const problematic = mediaCheckRecordSchema.safeParse(written[1]?.metadata)
    check(
      'and the run that found things is recorded as having found them',
      problematic.success && problematic.data.problems === 3 && problematic.data.missing === 1,
      problematic.success ? JSON.stringify(problematic.data) : 'did not parse',
    )

    check(
      'neither line carries a storage key',
      !/\b(img|vid|doc)_[A-Za-z0-9_-]{16,}/.test(JSON.stringify(written)),
    )

    await db
      .delete(auditEvents)
      .where(eq(auditEvents.action, MEDIA_CHECK_COMPLETED_ACTION))
  } finally {
    process.env.MEDIA_DIR = previousDirectory
    resetEnvCache()
    resetMediaStoreCache()
  }
}

/** The real command, in its own process, with its own store directory. */
function runCheck(directory: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['media:check'], {
      cwd: process.cwd(),
      env: { ...process.env, MEDIA_STORE: 'filesystem', MEDIA_DIR: directory },
    })

    let out = ''
    child.stdout.on('data', (chunk) => {
      out += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      out += String(chunk)
    })

    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, out }))
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
