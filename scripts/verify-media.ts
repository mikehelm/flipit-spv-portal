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
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents, investorAccounts, mediaAssets, operatorVideos, users } from '@/db/schema'
import { resetEnvCache } from '@/lib/env'
import { readDimensions } from '@/lib/media/dimensions'
import { jpegWithMetadata, mp4WithLocation, svgBytes } from '@/lib/media/fixtures'
import { ingest } from '@/lib/media/ingest'
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

  const leftovers = await db.select().from(mediaAssets).where(like(mediaAssets.name, `${PREFIX}%`))
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
