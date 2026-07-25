import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toVariableInput, previewPortalLink } from '@/app/(admin)/templates/data'
import type { PreviewRecipient } from '@/app/(admin)/templates/data'
import { renderEmail } from '@/lib/email/render'
import { INVITATION_TEMPLATE } from '@/lib/email/templates'
import {
  buildPortalLink,
  PREVIEW_CLAIM_TOKEN,
  type SenderDefaults,
} from '@/lib/email/variables'

/**
 * BUILD_SPEC §22, AC3 — "The preview exactly matches the sent email snapshot" —
 * and AC4 — "Each send produces one personalized email to one recipient and
 * records its result individually."
 *
 * AC3 is a claim about two code paths, not about one function. The preview
 * screen renders on read; the send renders once and stores the bytes. They only
 * agree if they load the same template, resolve the same variables through the
 * same resolver, and render through the same renderer — and if nothing ever
 * rewrites the stored copy afterwards. Each of those is asserted below, and the
 * one difference the spec *requires* (§11.4: a preview must not mint a working
 * claim token) is pinned to exactly that: the token, and nothing else.
 *
 * The send path writes to the database, so its half is a source-level test in
 * the manner of `approved-source.test.ts`. The render and variable path is
 * pure, so the byte comparison is a real render of the real preview mapper.
 */

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

/** Comments explain what the code avoids; they must not satisfy a check for it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const SEND = 'src/lib/sending/send-invitation.ts'
const PREVIEW = 'src/app/(admin)/templates/data.ts'
const BATCH = 'src/lib/sending/data.ts'
const RENDER = 'src/lib/email/render.ts'
const TEST_SEND = 'src/actions/send-test.ts'

/** Every shipped source file, so a check covers the application and not a list. */
function sourceFiles(dir = join(root, 'src')): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full))
      continue
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
    found.push(full)
  }
  return found
}

const relative = (path: string) => path.slice(root.length + 1)

/**
 * The keys a mapper puts into a `RecipientVariableInput`, shorthand included.
 * Used to compare the three places that build one.
 */
function mappedKeys(source: string, name: string): string[] {
  const start = source.indexOf(`function ${name}(`)
  expect(start, `${name} was not found`).toBeGreaterThan(-1)
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end)
  return [...body.matchAll(/^ {4}(\w+)\s*[:,]/gm)].map((match) => match[1]).sort()
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const row: PreviewRecipient = {
  offerId: 'offer_1',
  name: 'Alex Fournier',
  email: 'alex@example.com',
  jurisdiction: 'FR',
  blocked: false,
  emailStatus: 'NOT_SENT',
  proposedAmountUsd: '5000.00',
  spvPercentage: '16.666667',
  indirectPercentage: '5.000000',
  responseDeadline: '2026-08-10',
  rowSenderName: null,
  rowSenderEmail: null,
  rowSenderPhone: null,
}

const defaults: SenderDefaults = {
  defaultSenderName: 'David Serene',
  defaultSenderEmail: 'serenedavid@gmail.com',
  defaultSenderPhone: '+66 81 234 5678',
  authenticatedSenderEmail: 'serenedavid@gmail.com',
  contactMethod: 'PHONE',
  operatorContactValuePresent: true,
  decimalPlaces: 3,
  verificationLink: 'https://spv.flipit.com/verify',
}

/** What the send mints in step 2. Any opaque string does; this one is obvious. */
const REAL_CLAIM_TOKEN = 'a-real-single-use-claim-token'

// ---------------------------------------------------------------------------

describe('the preview and the sent snapshot are one document (BUILD_SPEC §22, AC3)', () => {
  it('renders the preview from the same source the send snapshots', () => {
    const send = withoutComments(read(SEND))
    const preview = withoutComments(read(PREVIEW))

    // The same loader, which prefers a stored `email_templates` row over the
    // shipped default. A preview reading the default while the send read a
    // stored row would show one document and post another.
    expect(send).toContain('loadCurrentTemplate(')
    expect(preview).toContain('loadCurrentTemplate(')
    expect(preview).not.toContain('templateSource(')

    // The same renderer, called with the template, the recipient input and the
    // sender defaults, in that order, on both sides.
    expect(send).toContain('renderEmail(source, variableInput(target, buildPortalLink(token)), input.defaults)')
    expect(preview).toContain('renderEmail(template, input, defaults)')
  })

  it('has no second rendering path anywhere in the application', () => {
    const callers = sourceFiles()
      .filter((file) => /renderEmail\(|renderPart\(|renderTemplateKind\(/.test(withoutComments(readFileSync(file, 'utf8'))))
      .map(relative)
      .sort()

    // `render.ts` defines them and uses them for pre-flight; the send, the
    // preview and §13.3's test send are the only other callers. A fifth entry
    // here is a divergent renderer, which is precisely what AC3 forbids.
    expect(callers).toEqual([PREVIEW, RENDER, SEND, TEST_SEND].sort())
  })

  it('the test send is the preview, posted — not a third document', () => {
    // §13.3 asks David to "experience exactly what a recipient will", which is
    // only true if the thing he receives is rendered the way the preview and
    // the send are. It borrows the preview's own loader, input builder and
    // link, so there is nothing here that could drift from either of them.
    const source = withoutComments(read(TEST_SEND))

    expect(source).toContain('loadCurrentTemplate(')
    expect(source).toContain('renderEmail(template, input, defaults)')
    expect(source).toContain('toVariableInput(recipient, previewPortalLink())')

    // §11.4's one permitted difference, and it applies here for the same
    // reason: a test send must not mint a working claim token against a real
    // investor's record. There is no call to `issueToken` in this file.
    expect(source).not.toContain('issueToken')
    expect(source).not.toContain('portalTokens')

    // And it is a test, so it can only ever be addressed to the operator.
    expect(source).toContain("intent: 'TEST'")
    expect(source).toContain('to: operator.email')
  })

  it('builds the renderer input from the same fields on every path', () => {
    const keys = mappedKeys(withoutComments(read(SEND)), 'variableInput')

    expect(keys).toEqual(mappedKeys(withoutComments(read(PREVIEW)), 'toVariableInput'))
    // Pre-flight renders the same recipients before the batch starts (§11.4);
    // a field it did not validate is a field that could still fail at send.
    expect(keys).toEqual(mappedKeys(withoutComments(read(BATCH)), 'toVariableInput'))
    expect(keys).toContain('portalLink')
    expect(keys).toContain('recipientName')
  })

  it('resolves the sender defaults through the same loader on both sides', () => {
    expect(withoutComments(read(PREVIEW))).toContain('loadSenderDefaults()')
    // The send takes its defaults from the batch context, which loads them the
    // same way, so a settings change moves both together or neither.
    expect(withoutComments(read(BATCH))).toContain('loadSenderDefaults()')
    expect(withoutComments(read(SEND))).toContain('input.defaults')
  })

  it('differs from the email it will send only in the claim token', () => {
    const previewed = renderEmail(INVITATION_TEMPLATE, toVariableInput(row, previewPortalLink()), defaults)
    const snapshotted = renderEmail(
      INVITATION_TEMPLATE,
      toVariableInput(row, buildPortalLink(REAL_CLAIM_TOKEN)),
      defaults,
    )

    // The two really do differ before the token is substituted, so the
    // comparison below is a comparison and not a no-op.
    expect(previewed.html).not.toBe(snapshotted.html)
    expect(previewed.text).not.toBe(snapshotted.text)

    expect(previewed.subject).toBe(snapshotted.subject)
    expect(previewed.html.replaceAll(PREVIEW_CLAIM_TOKEN, REAL_CLAIM_TOKEN)).toBe(
      snapshotted.html,
    )
    expect(previewed.text.replaceAll(PREVIEW_CLAIM_TOKEN, REAL_CLAIM_TOKEN)).toBe(
      snapshotted.text,
    )
    expect(previewed.templateHash).toBe(snapshotted.templateHash)
  })

  it('shows an obviously fake link rather than minting a working one', () => {
    const previewed = renderEmail(INVITATION_TEMPLATE, toVariableInput(row, previewPortalLink()), defaults)

    expect(previewed.html).toContain(PREVIEW_CLAIM_TOKEN)
    expect(previewed.text).toContain(PREVIEW_CLAIM_TOKEN)
    // A preview is a read. Nothing in that module issues a credential.
    expect(withoutComments(read(PREVIEW))).not.toContain('issueToken(')
    expect(withoutComments(read(PREVIEW))).not.toContain('portalTokens')
  })
})

describe('the snapshot is what was sent, and it is never rewritten (BUILD_SPEC §13, AC3)', () => {
  it('stores the rendered subject and both bodies rather than re-rendering', () => {
    const send = withoutComments(read(SEND))

    expect(send).toContain('subject: rendered.subject')
    expect(send).toContain('htmlBody: rendered.html')
    expect(send).toContain('textBody: rendered.text')
    expect(send).toContain('templateHash: rendered.templateHash')

    // The transport is handed the same rendered object, so the bytes that were
    // stored are the bytes that went out.
    expect(send).toContain('subject: rendered.subject,')
    expect(send).toContain('html: rendered.html,')
    expect(send).toContain('text: rendered.text,')

    // Exactly one render for the whole call. A second one could drift.
    expect(send.match(/renderEmail\(/g)).toHaveLength(1)
  })

  it('writes the snapshot before the transport is touched', () => {
    const send = withoutComments(read(SEND))
    const renderIndex = send.indexOf('renderEmail(')
    const snapshotIndex = send.indexOf('.insert(emailSnapshots)')
    const transportIndex = send.indexOf('await sendOneEmail(')

    expect(renderIndex).toBeGreaterThan(-1)
    expect(snapshotIndex).toBeGreaterThan(renderIndex)
    // A snapshot written after a successful send would not exist for a failed
    // one, which is the case where knowing what was attempted matters most.
    expect(transportIndex).toBeGreaterThan(snapshotIndex)
  })

  it('never updates or deletes a snapshot row after it is inserted', () => {
    const writers = sourceFiles().filter((file) =>
      /\.insert\(emailSnapshots\)/.test(withoutComments(readFileSync(file, 'utf8'))),
    )
    expect(writers.map(relative)).toEqual([SEND])

    for (const file of sourceFiles()) {
      const source = withoutComments(readFileSync(file, 'utf8'))
      expect(source, relative(file)).not.toMatch(/\.update\(\s*emailSnapshots/)
      expect(source, relative(file)).not.toMatch(/\.delete\(\s*emailSnapshots/)
    }

    // Immutable in the schema too: a row that is only ever inserted has no
    // reason to carry an `updatedAt`, and carrying one would invite a writer.
    const schema = read('src/db/schema.ts')
    const table = schema.slice(
      schema.indexOf('export const emailSnapshots = pgTable('),
      schema.indexOf('export const sendEvents = pgTable('),
    )
    expect(table).toContain('createdAt: createdAt(),')
    expect(table).not.toContain('updatedAt')
  })

  it('reads the stored snapshot in the portal rather than rendering again', () => {
    const portal = withoutComments(read('src/lib/portal/data.ts'))

    expect(portal).toContain('db.query.emailSnapshots.findFirst(')
    expect(portal).not.toContain('renderEmail(')
    expect(portal).not.toContain('loadCurrentTemplate(')
  })
})

describe('one send is one recipient, recorded on its own (BUILD_SPEC §22, AC4)', () => {
  it('takes a single recipient and offers no list parameter', () => {
    const send = withoutComments(read(SEND))

    expect(send).toContain('target: SendInvitationTarget')
    expect(send).not.toMatch(/targets\s*:\s*(readonly\s+)?SendInvitationTarget\[\]/)
    expect(send).not.toMatch(/\bsendMany\b|\bsendAll\b|\bsendBatch\b/)
    // No loop over recipients: the only iteration a send may do is over its own
    // fields, and there is none of that here either.
    expect(send).not.toMatch(/\bfor\s*\(|\.forEach\(|\.map\(/)
  })

  it('writes exactly one snapshot and one send event per call', () => {
    const send = withoutComments(read(SEND))

    expect(send.match(/\.insert\(emailSnapshots\)/g)).toHaveLength(1)

    // Five terminal paths — blocked, unrenderable, refused by the transport,
    // sent, failed — and each records itself once, against this offer alone.
    const events = [...send.matchAll(/db\.insert\(sendEvents\)\.values\(\{([\s\S]*?)\}\)/g)]
    expect(events).toHaveLength(5)
    for (const event of events) {
      expect(event[1]).toContain('offerId: target.offerId')
    }
  })

  it('records every outcome against that one offer alone', () => {
    const send = withoutComments(read(SEND))

    const updates = [...send.matchAll(/db\s*\.update\(offers\)[\s\S]*?where\(([^)]*\))/g)]
    expect(updates.length).toBeGreaterThan(0)
    for (const update of updates) {
      expect(update[1]).toContain('eq(offers.id, target.offerId)')
    }

    // The audit entry names the one offer, and carries no body.
    expect(send).toContain('entityId: target.offerId')
    expect(send).not.toContain('metadata: { kind, subject')
  })

  it('exposes no bulk send in the server action or the row it is bound to', () => {
    const action = withoutComments(read('src/actions/send.ts'))

    expect(action.match(/await sendInvitation\(/g)).toHaveLength(1)
    expect(action).toContain('offerId: z.string().min(1)')
    expect(action).not.toMatch(/z\.array\(/)
    expect(action).not.toMatch(/\bsendMany\b|\bsendAll\b|\bsendBatch\b/)

    // The confirmation is per recipient — an address typed out — so a send
    // cannot be reached by pressing one button for a list.
    expect(action).toContain('confirmation: z.string().min(1)')
    expect(withoutComments(read('src/app/(admin)/recipients/send-row.tsx'))).toContain(
      'sendInvitationAction',
    )
  })
})
