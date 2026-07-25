import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertNoSecrets, type Actor } from './audit'
import { recordFundsReceived, type FundsReceivedInput } from './portal/advance'

/**
 * The audited half of three acceptance criteria. BUILD_SPEC §22 AC12, AC29 and
 * AC41 each say a mutation is *written to the audit log*, and every existing
 * test stops at the mutation.
 *
 * These tests never touch a database, so the honest assertion for "it writes an
 * audit entry" is a source-level one: the function body — located by matching
 * braces from its declaration, so a neighbouring function's `audit()` call
 * cannot stand in for a missing one — contains the call and the action string
 * the criterion names. The database-backed proof lives in the `scripts/verify-*`
 * runners, as it does for the rest of the mutation layer.
 *
 * The refusals in `recordFundsReceived` happen before it reads anything, so
 * those are tested for real.
 */

// ---------------------------------------------------------------------------
// Reading a single function body out of a module
// ---------------------------------------------------------------------------

/** Comments explain what the code avoids; they must not satisfy a check for it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function moduleSource(relativePath: string): string {
  return withoutComments(readFileSync(join(process.cwd(), relativePath), 'utf8'))
}

/**
 * The index of the closing quote of the string literal that opens at
 * `openIndex`. Template literals are treated as opaque: the `${...}` inside one
 * is brace-balanced, so skipping the lot keeps the brace count honest.
 */
function endOfStringLiteral(source: string, openIndex: number): number {
  const quote = source[openIndex]
  for (let index = openIndex + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
      continue
    }
    if (source[index] === quote) return index
  }
  throw new Error('The source has an unterminated string literal.')
}

/**
 * The body of one named function, braces included.
 *
 * Naive slicing to the next `export` would hand back the neighbour's code as
 * well, and a regex over the whole file would let any function's `audit()` call
 * answer for every function's. This walks from the declaration: the body opens
 * at the first `{` outside the parameter list and outside a generic return type
 * — `Promise<{ ok: false; message: string }>` is not a function body — and ends
 * at its matching `}`.
 */
function bodyOf(source: string, functionName: string): string {
  const declaration = new RegExp(`\\bfunction\\s+${functionName}\\s*\\(`).exec(source)
  if (!declaration) throw new Error(`There is no function named ${functionName} in this module.`)

  let parens = 0
  let angles = 0
  let start = -1

  for (let index = declaration.index + declaration[0].length - 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === "'" || char === '"' || char === '`') {
      index = endOfStringLiteral(source, index)
      continue
    }
    if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    else if (char === '<' && parens === 0) angles += 1
    else if (char === '>' && parens === 0 && angles > 0) angles -= 1
    else if (char === '{' && parens === 0 && angles === 0) {
      start = index
      break
    }
  }

  if (start === -1) throw new Error(`Could not find the body of ${functionName}.`)

  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === "'" || char === '"' || char === '`') {
      index = endOfStringLiteral(source, index)
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  throw new Error(`The body of ${functionName} is not brace-balanced.`)
}

/** Every `export function` / `export async function` name in a module. */
function exportedFunctionNames(source: string): string[] {
  return [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(/g)].map((match) => match[1])
}

/** The keys of every literal `metadata: { ... }` in a function body. */
function metadataKeysIn(body: string): string[] {
  const blocks = body.match(/metadata:\s*\{([^}]*)\}/g) ?? []
  return blocks.flatMap((block) =>
    block
      .slice(block.indexOf('{') + 1, block.lastIndexOf('}'))
      .split(',')
      .map((part) => part.split(':')[0].trim())
      .filter((key) => /^[A-Za-z_$][\w$]*$/.test(key)),
  )
}

const writesToDatabase = /\bdb\s*\n?\s*\.\s*(insert|update|delete)\s*\(/

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

interface AuditedMutation {
  /** The acceptance criterion that requires the entry. */
  criterion: string
  module: string
  fn: string
  /** Every action string the function can write. */
  actions: string[]
  /**
   * Set when the entry is written by the function this one delegates to, rather
   * than by its own body. `cancelMany` cancels one reminder at a time through
   * `cancelReminder`, so each cancellation is logged individually and there is
   * no separate bulk entry.
   */
  auditedVia?: string
}

const ADVANCE = 'src/lib/portal/advance.ts'
const QUEUE = 'src/lib/reminders/queue.ts'
const QA = 'src/lib/qa/service.ts'

const REGISTRY: AuditedMutation[] = [
  {
    criterion: '§22 AC12',
    module: ADVANCE,
    fn: 'recordFundsReceived',
    actions: ['offer.funds_received', 'offer.funds_corrected'],
  },
  { criterion: '§22 AC29', module: QUEUE, fn: 'cancelReminder', actions: ['reminder.cancelled'] },
  {
    criterion: '§22 AC29',
    module: QUEUE,
    fn: 'cancelMany',
    actions: ['reminder.cancelled'],
    auditedVia: 'cancelReminder',
  },
  {
    criterion: '§22 AC29',
    module: QUEUE,
    fn: 'rescheduleReminder',
    actions: ['reminder.rescheduled'],
  },
  {
    // Not itself an acceptance criterion, but it is the fourth mutation in the
    // reminder module and the exhaustiveness test below requires it to be here.
    // Its entry is written only when the caller supplies an actor and only when
    // something changed — see the note in the final report.
    criterion: '§6.5',
    module: QUEUE,
    fn: 'refreshQueue',
    actions: ['reminder.queue_refreshed'],
  },
  { criterion: '§22 AC41', module: QA, fn: 'unpublishEntry', actions: ['qa.unpublished'] },
]

function registryBody(entry: AuditedMutation): string {
  const source = moduleSource(entry.module)
  return bodyOf(source, entry.auditedVia ?? entry.fn)
}

// ---------------------------------------------------------------------------

describe('every mutation an acceptance criterion says is logged (§22 AC12, AC29, AC41)', () => {
  it('calls the one audit helper from inside its own body', () => {
    for (const entry of REGISTRY) {
      const own = bodyOf(moduleSource(entry.module), entry.fn)
      const audited = registryBody(entry)

      expect(audited, `${entry.fn} (${entry.criterion}) never calls audit(`).toContain('audit(')

      if (entry.auditedVia) {
        // The delegating function must actually delegate, or the entry above is
        // a fiction that nothing writes.
        expect(own, `${entry.fn} no longer calls ${entry.auditedVia}`).toContain(
          `${entry.auditedVia}(`,
        )
      }
    }
  })

  it('records the action string the criterion names', () => {
    for (const entry of REGISTRY) {
      const body = registryBody(entry)
      for (const action of entry.actions) {
        expect(body, `${entry.fn} (${entry.criterion}) does not write ${action}`).toContain(
          `'${action}'`,
        )
      }
    }
  })

  it('gives each audited mutation an action string of its own', () => {
    const written = REGISTRY.filter((entry) => entry.auditedVia === undefined).flatMap(
      (entry) => entry.actions,
    )

    expect(new Set(written).size, `duplicate action strings in ${written.join(', ')}`).toBe(
      written.length,
    )
  })

  it('keeps message bodies, tokens and credentials out of the metadata', () => {
    // The real rule, run against the keys visible in the source. It throws
    // rather than redacting, so a careless key fails here.
    expect(() => assertNoSecrets({ body: 'the whole email' })).toThrow(/must not contain secrets/)

    for (const entry of REGISTRY) {
      const body = registryBody(entry)
      const keys = metadataKeysIn(body)

      if (body.includes('metadata: {')) {
        expect(keys.length, `${entry.fn} has a metadata block with no readable keys`).toBeGreaterThan(
          0,
        )
      }

      const seen = Object.fromEntries(keys.map((key) => [key, 'seen in source']))
      expect(() => assertNoSecrets(seen), `${entry.fn} metadata: ${keys.join(', ')}`).not.toThrow()
    }
  })

  it('keeps the bank reference off the funds-received entry (§5)', () => {
    // On the record and on the certificate; not in the log.
    const keys = metadataKeysIn(bodyOf(moduleSource(ADVANCE), 'recordFundsReceived'))
    expect(keys).toContain('valueDate')
    expect(keys).not.toContain('reference')
    expect(keys).not.toContain('amount')
  })
})

// ---------------------------------------------------------------------------

describe('the source scan reads one function and not its neighbours', () => {
  it('stops at the closing brace of the function it was asked for', () => {
    const queue = moduleSource(QUEUE)
    const cancel = bodyOf(queue, 'cancelReminder')

    expect(cancel).toContain("'reminder.cancelled'")
    expect(cancel).not.toContain("'reminder.rescheduled'")
    expect(cancel).not.toContain("'reminder.queue_refreshed'")
    expect(cancel.length).toBeLessThan(queue.length)

    // `cancelMany` audits nothing itself — the check above passes only because
    // the registry points it at `cancelReminder`.
    expect(bodyOf(queue, 'cancelMany')).not.toContain('audit(')

    const advance = moduleSource(ADVANCE)
    expect(bodyOf(advance, 'recordAcceptedAmount')).not.toContain("'offer.funds_received'")
    expect(bodyOf(advance, 'loadStageHistory')).not.toContain('audit(')
  })

  it('refuses to answer for a function that is not there', () => {
    expect(() => bodyOf(moduleSource(QUEUE), 'cancelEverything')).toThrow(/no function named/)
  })
})

// ---------------------------------------------------------------------------

describe('recording funds received is confirmed in code, not in the form (§5, §22 AC12)', () => {
  const ACTOR: Actor = { kind: 'user', id: 'user-owner', label: 'mike@flipit.com' }

  const valid: FundsReceivedInput = {
    offerId: 'offer-1',
    amount: '5000.00',
    amountConfirmation: '5000.00',
    currency: 'USD',
    valueDate: '2026-07-20',
    reference: 'FT-20260720-01',
    confirmed: true,
    actor: ACTOR,
    actorUserId: 'user-owner',
    now: new Date('2026-07-25T09:00:00Z'),
  }

  // Both refusals below return before the first query, so these run for real
  // against the exported function. The accepting path needs a database and is
  // covered by `scripts/verify-certificate.ts`.

  it('records nothing when the confirmation is not ticked', async () => {
    const result = await recordFundsReceived({ ...valid, confirmed: false })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/second step/)
    expect(result.message).toMatch(/Nothing was recorded/)
  })

  it('records nothing when the re-typed amount is a cent out', async () => {
    const result = await recordFundsReceived({ ...valid, amountConfirmation: '5000.01' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/do not match/)
    expect(result.message).toMatch(/nothing was recorded/)
  })

  it('refuses before it reads or writes anything', () => {
    const body = bodyOf(moduleSource(ADVANCE), 'recordFundsReceived')
    const confirmationCheck = body.indexOf('if (!input.confirmed)')
    const amountCheck = body.indexOf('.equals(')
    const firstRead = body.indexOf('db.query')
    const firstWrite = body.search(writesToDatabase)

    expect(confirmationCheck).toBeGreaterThan(-1)
    expect(amountCheck).toBeGreaterThan(-1)
    expect(confirmationCheck).toBeLessThan(firstRead)
    expect(amountCheck).toBeLessThan(firstRead)
    expect(firstRead).toBeLessThan(firstWrite)
  })

  it('has no parameter that skips the comparison', () => {
    const source = moduleSource(ADVANCE)
    const input = source.slice(
      source.indexOf('export interface FundsReceivedInput'),
      source.indexOf('export async function recordFundsReceived'),
    )

    // Required, not optional: an absent flag must not read as a confirmation.
    expect(input).toContain('amountConfirmation: string')
    expect(input).toContain('confirmed: boolean')
    expect(input).not.toMatch(/confirmed\?:/)
    expect(input).not.toMatch(/amountConfirmation\?:/)
    expect(source).not.toMatch(/skipConfirmation|force|bypass/i)
  })
})

// ---------------------------------------------------------------------------

describe('the registry is exhaustive for the reminder queue (§22 AC29)', () => {
  it('names every exported reminder mutation that writes to the database', async () => {
    const source = moduleSource(QUEUE)
    const fromSource = exportedFunctionNames(source)

    // The regex above must not have missed an export.
    const module_ = await import('./reminders/queue')
    const atRuntime = Object.entries(module_)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
    expect(fromSource.slice().sort()).toEqual(atRuntime.slice().sort())

    const writers = fromSource.filter((name) => writesToDatabase.test(bodyOf(source, name)))
    const registered = REGISTRY.filter((entry) => entry.module === QUEUE).map((entry) => entry.fn)

    // A new mutation cannot be added silently: it has to be registered above,
    // and registering it asserts that it writes an audit entry.
    for (const writer of writers) {
      expect(registered, `${writer} writes to the database but is not in the registry`).toContain(
        writer,
      )
    }
    expect(writers).toContain('cancelReminder')
  })

  it('registers cancelMany even though it delegates its writes', () => {
    const registered = REGISTRY.filter((entry) => entry.module === QUEUE).map((entry) => entry.fn)
    expect(registered).toContain('cancelMany')
  })
})
