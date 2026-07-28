/**
 * The object store, against a real socket and a real database.
 *
 * The unit tests pin the signature and the parity. This runs the thing that
 * actually ships: the real `ingest`, the real `mediaStore()` built from real
 * environment variables, writing over TCP to a server that verifies every
 * signature before it accepts a byte — and then reads the row back out of
 * Postgres and serves it the way the public image route does.
 *
 * The endpoint is a fake, and that is the honest limit of this script: it
 * proves the client is well-formed, idempotent and leak-free, not that AWS
 * agrees with it. See PROGRESS.md, Uncertain.
 *
 *   pnpm verify:object-store
 */

import 'dotenv/config'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { auditEvents, mediaAssets } from '@/db/schema'
import { resetEnvCache } from '@/lib/env'
import { jpegWithMetadata } from '@/lib/media/fixtures'
import { ingest } from '@/lib/media/ingest'
import { S3ObjectClient } from '@/lib/media/s3'
import { mediaStore, newStorageKey, resetMediaStoreCache } from '@/lib/media/store'
import { FakeS3, FAKE_S3_ACCESS_KEY_ID, FAKE_S3_BUCKET, FAKE_S3_REGION, FAKE_S3_SECRET } from '@/test/fake-s3'

const PREFIX = 'object-store-verify'
/** A string that is in the uploaded file's metadata and must never reach the bucket. */
const SECRET_LOCATION = 'Privet Drive'

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
  const rows = await db.select().from(mediaAssets).where(like(mediaAssets.name, `${PREFIX}%`))
  const store = mediaStore()
  for (const row of rows) {
    if (store) await store.remove(row.storageKey).catch(() => undefined)
    await db.delete(mediaAssets).where(eq(mediaAssets.id, row.id))
  }
}

function selectObjectStore(endpoint: string, overrides: Record<string, string> = {}): void {
  process.env.MEDIA_STORE = 'object-store'
  process.env.MEDIA_S3_ENDPOINT = endpoint
  process.env.MEDIA_S3_REGION = FAKE_S3_REGION
  process.env.MEDIA_S3_BUCKET = FAKE_S3_BUCKET
  process.env.MEDIA_S3_ACCESS_KEY_ID = FAKE_S3_ACCESS_KEY_ID
  process.env.MEDIA_S3_SECRET_ACCESS_KEY = FAKE_S3_SECRET
  Object.assign(process.env, overrides)
  resetEnvCache()
  resetMediaStoreCache()
}

async function main(): Promise<void> {
  const fake = new FakeS3()
  await fake.start()

  console.log(`\nThe object store, against a real socket\n  endpoint: ${fake.endpoint}\n`)

  selectObjectStore(fake.endpoint)
  await cleanup()

  // --- The store the application actually builds -------------------------
  console.log('§13.2 — what the application builds from the environment')

  const store = mediaStore()
  check('a store is configured', store !== null)
  check('and it is the object store', store?.kind === 'object-store')
  check('it says where it writes', store?.describe().includes(FAKE_S3_BUCKET) === true)
  check(
    'and never says it with a credential',
    !store?.describe().includes(FAKE_S3_SECRET) && !store?.describe().includes(FAKE_S3_ACCESS_KEY_ID),
  )

  // --- The real ingest path ----------------------------------------------
  console.log('\n§13.2 — a real upload, through the one ingest')

  const uploaded = jpegWithMetadata()
  const uploadedText = Buffer.from(uploaded).toString('latin1')
  check(
    'the uploaded file really does carry the thing that must not survive',
    uploadedText.includes(SECRET_LOCATION),
  )

  const result = await ingest('image', uploaded)
  check('the upload is accepted', result.ok, result.ok ? '' : result.message)

  if (!result.ok) {
    console.log('\nNothing further can be checked without a stored object.')
    process.exitCode = 1
    await fake.stop()
    return
  }

  const objectInBucket = fake.objects.get(result.storageKey)
  check('the bytes reached the bucket', objectInBucket !== undefined)
  check(
    'the object in the bucket is the stripped file, not the uploaded one',
    objectInBucket !== undefined && objectInBucket.bytes.length === result.sizeBytes,
  )
  check('something was actually stripped', result.strippedBytes > 0)
  check(
    'the location the uploaded file carried is not in the bucket',
    objectInBucket !== undefined &&
      !objectInBucket.bytes.toString('latin1').includes(SECRET_LOCATION),
  )
  check('the original never reached the bucket at all', fake.objects.size === 1)
  check('the content type stored is the sniffed one', objectInBucket?.contentType === 'image/jpeg')
  check('the key names what it is', result.storageKey.startsWith('img_'))

  // --- Read it back the way the route does --------------------------------
  console.log('\n§13.2 — serving it back')

  const [row] = await db
    .insert(mediaAssets)
    .values({
      name: `${PREFIX} header`,
      description: null,
      storageKey: result.storageKey,
      contentType: result.format,
      sizeBytes: result.sizeBytes,
    })
    .returning()

  const fetched = await mediaStore()!.get(row!.storageKey)
  check('the row round-trips through the store', fetched !== null)
  check(
    'byte for byte what was stored',
    fetched !== null && Buffer.from(fetched.bytes).equals(objectInBucket!.bytes),
  )
  check(
    'the store does not offer its own opinion on the content type',
    fetched?.contentType === 'application/octet-stream',
  )

  // --- Absence, and the failure that used to look like absence ------------
  console.log('\n§13.2 — absent, versus pointed at the wrong bucket')

  check('a key never stored is null', (await mediaStore()!.get('img_NEVERNEVERNEVERNEVERNEV')) === null)

  const wrongBucket = new S3ObjectClient({ ...fake.config(), bucket: 'a-bucket-nobody-created' })
  const wrongBucketAnswer = await wrongBucket
    .getObject(result.storageKey)
    .then((value) => ({ threw: false, value }))
    .catch((error: unknown) => ({ threw: true, value: String(error) }))

  check(
    'a bucket that does not exist is an error, not an empty library',
    wrongBucketAnswer.threw === true,
  )
  check(
    'and the error says which code came back',
    typeof wrongBucketAnswer.value === 'string' && wrongBucketAnswer.value.includes('NoSuchBucket'),
  )

  // --- A wrong secret -----------------------------------------------------
  console.log('\n§8 — a wrong key pair, and what the refusal says')

  const wrongSecret = new S3ObjectClient(fake.config('a-secret-that-is-not-the-right-one'))
  const refusal = await wrongSecret
    .putObject('img_WRONGSECRETWRONGSECRETX', new Uint8Array([1, 2, 3]), 'image/png')
    .then(() => '')
    .catch((error: unknown) => String(error))

  check('a wrong secret is refused', refusal !== '')
  check('the refusal names the code', refusal.includes('SignatureDoesNotMatch'))
  check('and carries neither key', !refusal.includes('a-secret-that-is-not-the-right-one') && !refusal.includes(FAKE_S3_ACCESS_KEY_ID))
  check('nor a signature', !refusal.includes('Signature=') && !refusal.includes('AWS4-HMAC'))
  check('nothing was stored by the refused put', !fake.objects.has('img_WRONGSECRETWRONGSECRETX'))

  // --- Idempotence --------------------------------------------------------
  console.log('\n§13.2 — a retry cannot do half of something twice')

  fake.failures.push(500, 503)
  fake.requests = 0
  await mediaStore()!.put('img_RETRYRETRYRETRYRETRYRE', new Uint8Array([4, 4, 4]), 'image/png')
  check('a transient failure is retried until it succeeds', fake.requests === 3)
  check(
    'and stores the bytes once, not three times',
    fake.objects.get('img_RETRYRETRYRETRYRETRYRE')?.bytes.length === 3,
  )
  await mediaStore()!.remove('img_RETRYRETRYRETRYRETRYRE')

  // --- Parity with the filesystem store -----------------------------------
  console.log('\n§13.2 — the seam: both stores, the same answers')

  const directory = await mkdtemp(path.join(tmpdir(), 'spv-verify-object-'))
  process.env.MEDIA_STORE = 'filesystem'
  process.env.MEDIA_DIR = directory
  resetEnvCache()
  resetMediaStoreCache()

  const onDisk = mediaStore()!
  const parityKey = 'img_PARITYPARITYPARITYPARI'
  const parityBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7])

  await onDisk.put(parityKey, parityBytes, 'image/png')
  const fromDisk = await onDisk.get(parityKey)

  selectObjectStore(fake.endpoint)
  const inBucket = mediaStore()!
  await inBucket.put(parityKey, parityBytes, 'image/png')
  const fromBucket = await inBucket.get(parityKey)

  check(
    'the same bytes come back from both',
    fromDisk !== null &&
      fromBucket !== null &&
      Buffer.from(fromDisk.bytes).equals(Buffer.from(fromBucket.bytes)),
  )
  check(
    'and the same content type from both',
    fromDisk?.contentType === fromBucket?.contentType,
  )

  const diskAbsent = await onDisk.get('img_ABSENTABSENTABSENTABSE')
  const bucketAbsent = await inBucket.get('img_ABSENTABSENTABSENTABSE')
  check('absence is null on both', diskAbsent === null && bucketAbsent === null)

  const diskBadKey = await onDisk.get('../../etc/passwd').then(() => false).catch(() => true)
  const bucketBadKey = await inBucket.get('../../etc/passwd').then(() => false).catch(() => true)
  check('a key that is not a key is refused by both', diskBadKey && bucketBadKey)

  fake.requests = 0
  await inBucket.get('../../etc/passwd').catch(() => undefined)
  check('and refused before a request is ever made', fake.requests === 0)

  await onDisk.remove(parityKey)
  await inBucket.remove(parityKey)

  // --- The log ------------------------------------------------------------
  console.log('\n§16, checklist 8 — what is in the log')

  const entries = await db.select().from(auditEvents).where(like(auditEvents.entityType, '%media%'))
  const serialised = JSON.stringify(entries)

  check('no audit entry contains the secret key', !serialised.includes(FAKE_S3_SECRET))
  check('no audit entry contains the access key id', !serialised.includes(FAKE_S3_ACCESS_KEY_ID))
  check('no audit entry contains a storage key', !serialised.includes(result.storageKey))
  check('no audit entry contains the endpoint', !serialised.includes(fake.endpoint))

  // --- Whether the bucket keeps what it is told to delete ------------------
  console.log('\nDELETE against a versioned bucket, which is a delete that is not one')

  /*
   * **The one property of a store that cannot be discovered by using it.**
   *
   * Everything above this line establishes that the client puts, gets, ranges,
   * lists, pages and deletes correctly. None of it can tell a versioned bucket
   * from an unversioned one, because there is nothing to tell: with versioning
   * on, a `DELETE` returns the same 204, the object stops answering `GET`,
   * `HEAD` and listings, and the bytes stay in the bucket behind a marker.
   *
   * That matters here more than it would in most applications, because this one
   * has an action whose entire promise is that bytes are destroyed. An investor
   * erasure prints *"stored files destroyed outright"* on the screen and writes
   * it into the audit log. On a versioned bucket that sentence is false and
   * nothing in the application can see it — so the answer is to ask the bucket,
   * and this is the check that the asking works and that it matters.
   */
  const store2 = mediaStore()!
  check('an unversioned bucket reports its deletes as permanent', (await store2.versioning()) === 'DISABLED')

  /*
   * Two refusals, because they leave the client by two different doors: a 403
   * is a response that is not ok, and a 501 is retried and then raised. Both
   * have to arrive at `UNKNOWN`, and a check that only exercised one of them
   * would pass over a client that called the other one safe.
   */
  fake.versioningApi = 'REFUSED'
  check(
    'a bucket that refuses the question reads as not known, never as permanent',
    (await store2.versioning()) === 'UNKNOWN',
  )
  fake.versioningApi = 'ABSENT'
  check(
    'and a provider that does not implement it reads the same way',
    (await store2.versioning()) === 'UNKNOWN',
  )
  fake.versioningApi = 'PRESENT'

  fake.versioning = 'Enabled'
  check('and a versioned bucket says so', (await store2.versioning()) === 'ENABLED')

  /*
   * The demonstration, which is worth more than the assertion above it.
   */
  const doomedKey = newStorageKey('doc')
  const doomedBytes = new TextEncoder().encode('%PDF-1.4 a signed subscription agreement')
  await store2.put(doomedKey, doomedBytes, 'application/pdf')
  check('an object is stored', (await store2.stat(doomedKey)) !== null)

  await store2.remove(doomedKey)

  check(
    'the delete is accepted, exactly as it would be on any other bucket',
    (await store2.get(doomedKey)) === null,
  )
  check('and a stat says it is gone', (await store2.stat(doomedKey)) === null)
  check(
    'and it is in no listing',
    !(await store2.list(1000)).objects.some((object) => object.key === doomedKey),
  )
  check(
    '— and the bytes are still in the bucket, which is the whole point',
    fake.nonCurrent.get(doomedKey)?.bytes.equals(Buffer.from(doomedBytes)) === true,
    'the fake bucket no longer holds the non-current version',
  )
  check(
    'so the only thing that could have found this is asking the bucket',
    (await store2.versioning()) === 'ENABLED',
  )

  fake.versioning = 'DISABLED'
  fake.nonCurrent.clear()

  await cleanup()
  const leftovers = await db.select().from(mediaAssets).where(like(mediaAssets.name, `${PREFIX}%`))
  check('verification data is removed', leftovers.length === 0)

  await fake.stop()

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
