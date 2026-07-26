/**
 * The claim the streaming work rests on, measured. BUILD_SPEC §13.2, §13.3.
 *
 *   pnpm verify:memory
 *
 * Three separate packages ended with the same line under Uncertain: *"Nothing
 * has measured the memory. The reasoning about memory is arithmetic rather than
 * an observation."* Every media route in this application was changed from
 * reading an object into one `Uint8Array` to opening a stream, on the argument
 * that a sixty-megabyte video otherwise sits in this process's heap for as long
 * as a phone on a slow connection takes to pull it down. There is a boundary
 * test that fails if a route reaches for the buffering read again. There is no
 * test anywhere that a byte of that argument is true.
 *
 * That gap matters because of how the failure looks. A route that buffers
 * serves exactly the same bytes with exactly the same headers as one that
 * streams; the tests pass, the file downloads, the video plays. The difference
 * appears only under load, on the day several people open the same document at
 * once, as a process that is killed for using too much memory — and by then
 * nothing points at the cause.
 *
 * So this measures it. It writes a large object into a real store, starts the
 * real built server, downloads it through the real route, and samples the
 * server's resident set size out of `/proc` while the bytes are moving. A
 * buffering route grows by the size of the file. A streaming one grows by the
 * size of a few chunks.
 *
 * **The assertion is one-directional and generous**, deliberately. Node does
 * not return freed memory to the operating system promptly, garbage collection
 * is not scheduled by this script, and a resident set is noisy. What is being
 * distinguished here is not fifty megabytes from sixty — it is *the size of the
 * file* from *the size of a buffer*, which is two orders of magnitude, and a
 * bound loose enough to survive noise still catches it. A test that measures
 * something real and asserts something modest is worth more than a tight one
 * that has to be switched off in a month.
 *
 * It creates its own data, in its own store directory, and removes both.
 * Requires a build: `pnpm build && pnpm verify:memory`.
 */

import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { mediaAssets } from '@/db/schema'

const PORT = 3211
const ORIGIN = `http://127.0.0.1:${PORT}`

/**
 * How large the object under test is.
 *
 * Ninety-six megabytes: comfortably larger than any buffer a stream would use,
 * large enough that a buffering route's growth cannot hide inside the noise of
 * a Node process going about its business, and small enough to write and read
 * in a few seconds on a modest disk.
 */
const OBJECT_BYTES = 96 * 1024 * 1024

/**
 * How much the server is allowed to grow while serving it.
 *
 * A quarter of the object. A route that buffers grows by the whole of it and
 * fails this by a factor of four; a route that streams grows by its chunk size
 * and a little bookkeeping, which is under a megabyte in practice. Nothing
 * lands between those two numbers by accident.
 */
const ALLOWED_GROWTH_BYTES = OBJECT_BYTES / 4

const STORAGE_KEY = 'img_MEMORYVERIFYMEMORYVERI'

let passed = 0
let failed = 0
let serverOutput: () => string = () => ''

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The server's resident set size, in bytes, read from `/proc`.
 *
 * `/proc/<pid>/status` rather than anything the process reports about itself:
 * asking the server how much memory it is using would mean adding a route that
 * exists only for a test, and a route that reports the process's internals is
 * one more thing to have to reason about being reachable. Reading `/proc` from
 * the parent needs nothing from the child at all.
 *
 * Returns null on a platform without `/proc`, which is a reason to skip the
 * measurement rather than to fail it.
 */
function residentBytes(pid: number): number | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m)
    return match ? Number(match[1]) * 1024 : null
  } catch {
    return null
  }
}

/**
 * Write a large object without ever holding it in memory here either.
 *
 * The same discipline the thing under test is being measured for. A script that
 * built a ninety-six-megabyte `Buffer` to test that the server does not would be
 * a poor advertisement for the argument, and on a small container it would be
 * the thing that ran out of memory.
 */
async function writeLargeObject(file: string): Promise<void> {
  const chunk = Buffer.alloc(1024 * 1024, 0)
  // A JPEG's opening bytes, so anything that sniffs the file agrees with the
  // row. Nothing in this path sniffs it — the row is written directly — but a
  // fixture that is not what it claims is a trap for whoever reads this next.
  chunk[0] = 0xff
  chunk[1] = 0xd8
  chunk[2] = 0xff
  chunk[3] = 0xe0

  const handle = await open(file, 'w')
  try {
    for (let written = 0; written < OBJECT_BYTES; written += chunk.length) {
      await handle.write(chunk)
    }
  } finally {
    await handle.close()
  }
}

async function startServer(directory: string): Promise<ChildProcess> {
  // `next` directly rather than `pnpm start`: going through pnpm puts two
  // processes in between, `kill()` reaches only the first, and — the reason
  // that matters here — the pid this script can sample is pnpm's rather than
  // the server's, so the measurement would be of the wrong process.
  const child = spawn('node_modules/.bin/next', ['start', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_URL: ORIGIN,
      BASE_PATH: '',
      MEDIA_STORE: 'filesystem',
      MEDIA_DIR: directory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let output = ''
  child.stdout?.on('data', (b: Buffer) => (output += b.toString()))
  child.stderr?.on('data', (b: Buffer) => (output += b.toString()))
  serverOutput = () => output

  let exited = false
  child.on('exit', (code, signal) => {
    exited = true
    output += `\n[the server process exited: code=${code} signal=${signal}]\n`
  })

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The server exited before it was ready:\n${output}`)
    try {
      const response = await fetch(`${ORIGIN}/verify`)
      if (response.status < 500) return child
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  child.kill('SIGTERM')
  throw new Error(`The server did not answer within 60 seconds:\n${output}`)
}

function stopServer(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

/**
 * Drain a response without keeping it.
 *
 * `response.arrayBuffer()` would put the whole object in *this* process, which
 * measures nothing about the server and would be the thing that fell over.
 * Reading the stream chunk by chunk and counting is what a browser does.
 */
async function drain(
  response: Response,
  onChunk?: () => void,
): Promise<number> {
  const reader = response.body?.getReader()
  if (!reader) return 0

  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value?.byteLength ?? 0
    onChunk?.()
  }
  return total
}

async function main(): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'spv-verify-memory-'))
  let server: ChildProcess | undefined

  console.log(`\nWhat serving a ${megabytes(OBJECT_BYTES)} object costs the server`)
  console.log(`  store: ${directory}\n`)

  try {
    await writeLargeObject(path.join(directory, STORAGE_KEY))
    const onDisk = await stat(path.join(directory, STORAGE_KEY))
    check('the fixture is the size it claims', onDisk.size === OBJECT_BYTES, String(onDisk.size))

    await db.delete(mediaAssets).where(eq(mediaAssets.storageKey, STORAGE_KEY))
    await db.insert(mediaAssets).values({
      name: 'memory-verify fixture',
      description: 'Written by pnpm verify:memory. Removed at the end of the run.',
      storageKey: STORAGE_KEY,
      contentType: 'image/jpeg',
      sizeBytes: OBJECT_BYTES,
    })

    server = await startServer(directory)
    const pid = server.pid
    if (!pid) throw new Error('The server started without a pid to sample.')

    const baseline = residentBytes(pid)
    if (baseline === null) {
      console.log('  note  this platform has no /proc, so there is nothing to sample.')
      console.log('        The measurement is skipped rather than assumed.\n')
      return
    }

    // A first, unmeasured request. Next.js compiles and caches a route on its
    // first hit, and attributing that to the download would be measuring the
    // framework rather than the response.
    const warmUp = await fetch(`${ORIGIN}/media/${STORAGE_KEY}`)
    check('the route serves the object', warmUp.status === 200, `status ${warmUp.status}`)
    check(
      'and promises exactly what is stored',
      warmUp.headers.get('content-length') === String(OBJECT_BYTES),
      warmUp.headers.get('content-length') ?? 'no content-length',
    )
    await drain(warmUp)

    const settled = residentBytes(pid)!
    console.log(`\n  resident after one full download: ${megabytes(settled)}`)

    // --- One download, sampled while the bytes are moving -------------------
    let peak = settled
    const single = await fetch(`${ORIGIN}/media/${STORAGE_KEY}`)
    const received = await drain(single, () => {
      const now = residentBytes(pid)
      if (now !== null && now > peak) peak = now
    })

    check('the whole object arrives', received === OBJECT_BYTES, `${received} bytes`)
    console.log(`  peak while serving it:            ${megabytes(peak)}`)
    console.log(`  growth:                           ${megabytes(peak - settled)}`)

    check(
      `serving it grows the server by less than ${megabytes(ALLOWED_GROWTH_BYTES)}`,
      peak - settled < ALLOWED_GROWTH_BYTES,
      `grew ${megabytes(peak - settled)} serving ${megabytes(OBJECT_BYTES)}`,
    )

    // --- Four at once, which is where buffering actually kills a process ----
    //
    // One download of a large file is survivable however it is served. The
    // failure this guards against is four people opening the same document
    // within a few seconds of each other, where buffering costs four times the
    // file and streaming costs four times a chunk.
    const before = residentBytes(pid)!
    let concurrentPeak = before

    const sampler = setInterval(() => {
      const now = residentBytes(pid)
      if (now !== null && now > concurrentPeak) concurrentPeak = now
    }, 25)

    let totals: number[] = []
    try {
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => fetch(`${ORIGIN}/media/${STORAGE_KEY}`)),
      )
      totals = await Promise.all(responses.map((response) => drain(response)))
    } finally {
      clearInterval(sampler)
    }

    check(
      'four concurrent downloads all complete in full',
      totals.every((total) => total === OBJECT_BYTES),
      totals.map(megabytes).join(', '),
    )

    console.log(`\n  peak with four at once:           ${megabytes(concurrentPeak)}`)
    console.log(`  growth:                           ${megabytes(concurrentPeak - before)}`)

    check(
      `four at once grows the server by less than one object (${megabytes(OBJECT_BYTES)})`,
      concurrentPeak - before < OBJECT_BYTES,
      `grew ${megabytes(concurrentPeak - before)}`,
    )
    check(
      `and by less than ${megabytes(ALLOWED_GROWTH_BYTES)}, which is the real claim`,
      concurrentPeak - before < ALLOWED_GROWTH_BYTES,
      `grew ${megabytes(concurrentPeak - before)} serving four × ${megabytes(OBJECT_BYTES)}`,
    )

    // --- What this route says about ranges, which is nothing ----------------
    //
    // Ranges are the video's. This route serves a library image — capped at
    // five megabytes, cached hard and immutably, with no seeking to do — and it
    // builds its own response rather than going through `serveMedia`, so it
    // neither advertises `Accept-Ranges` nor answers a `Range` header. Ignoring
    // one and sending the whole object with a 200 is what RFC 9110 says a
    // server that does not support ranges must do, and asserting it here is the
    // difference between a decision and an omission nobody noticed.
    const rangeBefore = residentBytes(pid)!
    const ranged = await fetch(`${ORIGIN}/media/${STORAGE_KEY}`, {
      headers: { Range: `bytes=0-${1024 * 1024 - 1}` },
    })
    const rangedBytes = await drain(ranged)
    const rangeAfter = residentBytes(pid)!

    check(
      'the image route does not advertise ranges',
      ranged.headers.get('accept-ranges') === null,
      ranged.headers.get('accept-ranges') ?? '',
    )
    check(
      'and answers a Range header with the whole object and a 200, as it must',
      ranged.status === 200 && rangedBytes === OBJECT_BYTES,
      `status ${ranged.status}, ${megabytes(rangedBytes)}`,
    )
    check(
      'and that download costs no more than any other',
      rangeAfter - rangeBefore < ALLOWED_GROWTH_BYTES,
      `grew ${megabytes(rangeAfter - rangeBefore)}`,
    )
  } catch (error) {
    console.error('\nThe run stopped early. The application said:\n')
    console.error(serverOutput().split('\n').slice(-30).join('\n'))
    throw error
  } finally {
    if (server) stopServer(server)
    await db.delete(mediaAssets).where(eq(mediaAssets.storageKey, STORAGE_KEY))
    await rm(directory, { recursive: true, force: true })
  }

  const left = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(eq(mediaAssets.storageKey, STORAGE_KEY))
  check('verification data is removed', left.length === 0)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
