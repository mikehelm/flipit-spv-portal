import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkbox } from '@/lib/form-values'
import { PUBLISH_COMPLIANCE_NOTICE } from '@/lib/qa/anonymity'
import type { PortalAccess } from '@/lib/portal/access'
import type {
  AskQuestionResult,
  NotifyResult,
  RecordAnswerInput,
  RecordAnswerResult,
} from '@/lib/qa/service'
import { QUESTION_RECEIVED_MESSAGE } from '@/lib/qa/service'

/**
 * The two halves of §22 AC36 and AC37 that the rest of the suite leaves thin:
 * the confirmation the asker sees, and the fact that publication needs an
 * explicit tick.
 *
 * `service.test.ts` covers the mutation layer; this file sits one level up, at
 * the server actions and the screens, because both halves are decided there —
 * a missing form field is turned into `false` by `checkbox`, and the
 * confirmation is chosen by `askQuestionAction`. Neither needs a database, so
 * the boundary functions are mocked and the source-level rules are read off the
 * files themselves, in the same style as `service.test.ts`.
 */

// ---------------------------------------------------------------------------
// Boundaries. Nothing below reaches Postgres, a session or the transport.
// ---------------------------------------------------------------------------

const currentAdmin = vi.fn<() => Promise<{ id: string; email: string; role: 'OWNER' } | null>>()
const readInvestorAccount = vi.fn<() => Promise<{ id: string } | null>>()
const loadPortalView = vi.fn<(accountId: string) => Promise<{ access: PortalAccess } | null>>()
const askQuestion =
  vi.fn<
    (input: { accountId: string; body: string; entryId: string | null }) => Promise<AskQuestionResult>
  >()
const notifyOperatorOfQuestion = vi.fn<(entryId: string) => Promise<NotifyResult>>()
const recordAnswer = vi.fn<(input: RecordAnswerInput) => Promise<RecordAnswerResult>>()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirected to ${path}`)
  },
}))

vi.mock('@/lib/auth/guards', () => ({ currentAdmin: () => currentAdmin() }))

vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>()
  return { ...actual, audit: () => Promise.resolve() }
})

vi.mock('@/lib/portal/session', () => ({
  readInvestorAccount: () => readInvestorAccount(),
}))

vi.mock('@/lib/portal/data', () => ({
  loadPortalView: (accountId: string) => loadPortalView(accountId),
}))

vi.mock('@/lib/auth/service-config', () => ({
  readServiceConfig: () => Promise.resolve({ qaVisibleDuringRaise: true }),
}))

vi.mock('@/lib/qa/data', () => ({ anyRoundOpen: () => Promise.resolve(false) }))

vi.mock('@/lib/qa/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qa/service')>()
  return {
    ...actual,
    askQuestion: (input: { accountId: string; body: string; entryId: string | null }) =>
      askQuestion(input),
    notifyOperatorOfQuestion: (entryId: string) => notifyOperatorOfQuestion(entryId),
    recordAnswer: (input: RecordAnswerInput) => recordAnswer(input),
  }
})

async function actions() {
  return import('@/actions/qa')
}

const FULL_ACCESS: PortalAccess = {
  capability: 'FULL',
  issueLink: true,
  allowClaim: true,
  notice: null,
}

const OWNER = { id: 'user-owner', email: 'mike@flipit.com', role: 'OWNER' as const }

beforeEach(() => {
  currentAdmin.mockReset()
  readInvestorAccount.mockReset()
  loadPortalView.mockReset()
  askQuestion.mockReset()
  notifyOperatorOfQuestion.mockReset()
  recordAnswer.mockReset()

  currentAdmin.mockResolvedValue(OWNER)
  readInvestorAccount.mockResolvedValue({ id: 'account-1' })
  loadPortalView.mockResolvedValue({ access: FULL_ACCESS })
  askQuestion.mockResolvedValue({ ok: true, entryId: 'entry-1', isFollowUp: false })
  notifyOperatorOfQuestion.mockResolvedValue({ sent: true, detail: null })
  recordAnswer.mockResolvedValue({ ok: true, published: false })
})

function answerForm(publish?: string): FormData {
  const form = new FormData()
  form.set('entryId', 'entry-1')
  form.set('answer', 'The SPV holds the shares; you hold a participation in the SPV.')
  form.set('questionPublic', 'How is the holding structured?')
  if (publish !== undefined) form.set('publish', publish)
  return form
}

function askForm(body = 'How is the holding structured?'): FormData {
  const form = new FormData()
  form.set('body', body)
  return form
}

// ---------------------------------------------------------------------------
// Sources, read the same way `service.test.ts` reads them
// ---------------------------------------------------------------------------

const ACTIONS_FILE = join(process.cwd(), 'src/actions/qa.ts')
const OPERATOR_PARTS = join(process.cwd(), 'src/app/(admin)/questions/parts.tsx')

/** Comments explain what the code avoids; they must not trip the check for it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function qaActionsSource(): string {
  return withoutComments(readFileSync(ACTIONS_FILE, 'utf8'))
}

/** One exported function's body, from its declaration to the next export. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`)
  const declared = start === -1 ? source.indexOf(`export function ${name}(`) : start
  expect(declared, `${name} should exist`).toBeGreaterThan(-1)

  const rest = source.slice(declared)
  const end = rest.indexOf('\nexport ', 1)
  return end === -1 ? rest : rest.slice(0, end)
}

function appComponents(): Array<{ name: string; source: string }> {
  const root = join(process.cwd(), 'src/app')
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => ({ name, source: readFileSync(join(root, name), 'utf8') }))
}

/** Curly and straight apostrophes are the same word to a reader. */
function plainQuotes(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
}

// ---------------------------------------------------------------------------
// An unticked box posts nothing at all
// ---------------------------------------------------------------------------

describe('an unticked box is absent from the form (§6.7.2)', () => {
  it('reads a field that never arrived as unticked', () => {
    const form = new FormData()
    expect(form.get('publish')).toBeNull()
    expect(checkbox(form.get('publish'))).toBe(false)
  })

  it('reads a present but empty field as unticked', () => {
    const form = new FormData()
    form.set('publish', '')
    expect(checkbox(form.get('publish'))).toBe(false)
  })

  it('ticks for the two values a browser and a hidden field actually post', () => {
    expect(checkbox('on')).toBe(true)
    expect(checkbox('true')).toBe(true)
  })

  it('never coerces truthiness — a non-empty string is not a tick', () => {
    for (const value of ['false', 'FALSE', 'False', '0', '1', 'yes', 'no', 'checked', 'off']) {
      expect(checkbox(value), value).toBe(false)
    }
  })

  it('is exact about spelling and spacing, so a near miss stays unticked', () => {
    for (const value of ['On', 'ON', 'True', 'TRUE', ' on', 'on ', ' true ']) {
      expect(checkbox(value), JSON.stringify(value)).toBe(false)
    }
  })

  it('reads an uploaded file in the field as unticked', () => {
    const form = new FormData()
    form.append('publish', new Blob(['on']), 'publish.txt')
    const value = form.get('publish')
    expect(typeof value).not.toBe('string')
    expect(checkbox(value)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AC37 — the flag can only come from the form
// ---------------------------------------------------------------------------

describe('the publish flag can only come from the form (§22 AC37)', () => {
  it('reads publish and acknowledged through the checkbox helper', () => {
    const body = functionBody(qaActionsSource(), 'recordAnswerAction')

    expect(body).toContain("publish: checkbox(formData.get('publish'))")
    expect(body).toContain("acknowledged: checkbox(formData.get('acknowledged'))")
    expect(body).toContain('publish: parsed.data.publish')
  })

  it('takes every checkbox in the module straight from the form data', () => {
    const calls = qaActionsSource().match(/checkbox\([^\n]*/g) ?? []

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call).toMatch(/^checkbox\(formData\.get\('[a-zA-Z]+'\)\)/)
    }
  })

  it('has no visibility flag anywhere in the module that defaults to true', () => {
    const code = qaActionsSource()

    expect(code).not.toMatch(
      /\b(publish|published|isPublished|visible|isVisible|shared)\w*\s*:\s*true\b/i,
    )
    expect(code).not.toMatch(/\bpublish\w*\s*(\?\?|\|\|)\s*true\b/i)
    expect(code).not.toContain('.default(true)')
    expect(code).not.toContain('.catch(true)')
  })

  it('declares publish as a plain boolean, with nothing filling it in', () => {
    const code = qaActionsSource()
    const declarations = code.match(/publish:\s*z\.[^,\n]*/g) ?? []

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      expect(declaration).toBe('publish: z.boolean()')
    }
  })
})

describe('an answer publishes only when the box is ticked (§22 AC37)', () => {
  it('hands recordAnswer publish false when the field never arrives', async () => {
    const mod = await actions()
    const result = await mod.recordAnswerAction({ status: 'idle' }, answerForm())

    expect(result.status).toBe('ok')
    expect(recordAnswer).toHaveBeenCalledTimes(1)
    expect(recordAnswer.mock.calls[0][0].publish).toBe(false)
    expect(recordAnswer.mock.calls[0][0].acknowledgedIdentifyingDetail).toBe(false)
  })

  it('hands recordAnswer publish true only when the box posts "on"', async () => {
    const mod = await actions()
    recordAnswer.mockResolvedValue({ ok: true, published: true })

    await mod.recordAnswerAction({ status: 'idle' }, answerForm('on'))

    expect(recordAnswer.mock.calls[0][0].publish).toBe(true)
  })

  it('treats every other shape of the field as unticked', async () => {
    const mod = await actions()

    for (const value of ['', 'false', '0', '1', 'yes', 'On', 'TRUE', 'publish']) {
      recordAnswer.mockClear()
      await mod.recordAnswerAction({ status: 'idle' }, answerForm(value))

      expect(recordAnswer, value).toHaveBeenCalledTimes(1)
      expect(recordAnswer.mock.calls[0][0].publish, value).toBe(false)
    }
  })

  it('says plainly that nothing has gone anywhere when it saved unpublished', async () => {
    const mod = await actions()
    const result = await mod.recordAnswerAction({ status: 'idle' }, answerForm())

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.message).toMatch(/not on the shared page/i)
    expect(result.message).toMatch(/nothing has gone to the person who asked/i)
  })
})

// ---------------------------------------------------------------------------
// AC36 — the half nobody was testing: what the asker is told
// ---------------------------------------------------------------------------

describe('the asker sees a confirmation (§22 AC36)', () => {
  it('confirms in the words PORTAL_COPY uses, once the question is recorded', async () => {
    const mod = await actions()
    const result = await mod.askQuestionAction({ status: 'idle' }, askForm())

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.message).toBe(QUESTION_RECEIVED_MESSAGE)

    const copy = plainQuotes(readFileSync(join(process.cwd(), 'PORTAL_COPY.md'), 'utf8'))
    expect(copy).toContain(plainQuotes(QUESTION_RECEIVED_MESSAGE))
  })

  it('confirms even when the notification to David could not get out', async () => {
    const mod = await actions()
    notifyOperatorOfQuestion.mockResolvedValue({
      sent: false,
      detail: 'No sending account is configured.',
    })

    const result = await mod.askQuestionAction({ status: 'idle' }, askForm())

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // The question is recorded either way, and the mail configuration is the
    // operator's problem, not something to hand to the investor.
    expect(result.message).toBe(QUESTION_RECEIVED_MESSAGE)
    expect(result.message).not.toMatch(/sending account|smtp|could not/i)
  })

  it('is the same confirmation whatever the account, and repeats nothing back', async () => {
    const mod = await actions()

    readInvestorAccount.mockResolvedValue({ id: 'account-alice' })
    const first = await mod.askQuestionAction({ status: 'idle' }, askForm('Who else is in?'))

    readInvestorAccount.mockResolvedValue({ id: 'account-bruno' })
    const second = await mod.askQuestionAction({ status: 'idle' }, askForm('What is the fee?'))

    expect(first).toEqual(second)
    if (first.status !== 'ok') return
    expect(first.message).not.toContain('account-alice')
    expect(first.message).not.toContain('entry-1')
    expect(first.message).not.toContain('Who else is in?')
  })

  it('names nobody but David and promises no timeframe it cannot keep', () => {
    const message = plainQuotes(QUESTION_RECEIVED_MESSAGE)

    expect(message).toContain('David')
    // No counts, no positions in a queue, no other participants.
    expect(message).not.toMatch(/\d/)
    expect(message).not.toMatch(/other (investor|people|person|recipient|participant)/i)
    expect(message).not.toMatch(/\bqueue\b|\bfirst\b|\bothers\b/i)
    // No promise the app has no way of keeping.
    expect(message).not.toMatch(
      /\bwithin\b|\bimmediately\b|\bshortly\b|\bstraight away\b|\btoday\b|\btomorrow\b|\bhours?\b|\bdays?\b|\bminutes?\b|\bguarantee/i,
    )
  })

  it('returns the constant with nothing interpolated into it', () => {
    const body = functionBody(qaActionsSource(), 'askQuestionAction')

    expect(body).toContain('return actionOk(QUESTION_RECEIVED_MESSAGE)')
    expect(body).not.toMatch(/actionOk\(`/)
    expect(QUESTION_RECEIVED_MESSAGE).not.toContain('${')
  })
})

// ---------------------------------------------------------------------------
// §6.7.6 — the one compliance line, where publishing happens
// ---------------------------------------------------------------------------

describe('the publish dialog carries the compliance note (§6.7.6)', () => {
  it('says a published answer is a communication to every recipient of the offer', () => {
    const notice = plainQuotes(PUBLISH_COMPLIANCE_NOTICE)

    expect(notice).toMatch(/communication to every recipient of the offer/i)
    expect(notice).toMatch(/same weight as the invitation/i)
    // §6.7.6: "Private answers to one person are ordinary correspondence and
    // are not gated." The notice has to say which case it is talking about.
    expect(notice).toMatch(/private answer to one person is ordinary correspondence/i)
  })

  it('says it once, in one line', () => {
    expect(PUBLISH_COMPLIANCE_NOTICE).not.toContain('\n')
    expect(PUBLISH_COMPLIANCE_NOTICE.length).toBeLessThan(400)
  })

  it('renders it beside the publish box on both operator forms', () => {
    const source = readFileSync(OPERATOR_PARTS, 'utf8')

    for (const form of ['AnswerForm', 'SeedEntryForm']) {
      const body = functionBody(source, form)
      expect(body, form).toContain('name="publish"')
      expect(body, form).toContain('{PUBLISH_COMPLIANCE_NOTICE}')
    }
  })

  it('leaves no publish box anywhere in the app without the notice', () => {
    const publishing = appComponents().filter((file) => file.source.includes('name="publish"'))

    expect(publishing.length).toBeGreaterThan(0)
    for (const file of publishing) {
      expect(file.source, file.name).toContain('PUBLISH_COMPLIANCE_NOTICE')
    }
  })

  it('starts the operator publish box unticked, whatever the entry (§6.7.2)', () => {
    const body = functionBody(readFileSync(OPERATOR_PARTS, 'utf8'), 'AnswerForm')

    expect(body).toContain('useState(false)')
    expect(body).not.toMatch(/useState\(\s*entry\.isPublished/)
    expect(body).not.toMatch(/defaultChecked|checked=\{true\}/)
  })
})
