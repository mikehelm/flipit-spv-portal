import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAwaitingAnswer } from './service'

/**
 * The parts of the Q&A mutation layer that can be reasoned about without a
 * database, plus the source-level rules that must hold for the whole module.
 *
 * The database-backed verification lives in `scripts/verify-qa.ts`, which runs
 * the real flow against a real Postgres with a second investor present
 * throughout — the same shape as WP8's verification.
 */

const QA_DIR = join(process.cwd(), 'src/lib/qa')

function qaSources(): Array<{ name: string; source: string }> {
  return readdirSync(QA_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, source: readFileSync(join(QA_DIR, name), 'utf8') }))
}

/** Comments explain what the code avoids; they must not trip the check for it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ---------------------------------------------------------------------------

describe('when a thread is waiting on the operator', () => {
  const asked = new Date('2026-07-10T09:00:00Z')
  const replied = new Date('2026-07-10T15:00:00Z')

  it('waits when there is no answer at all', () => {
    expect(
      isAwaitingAnswer({ answer: null, answerEmailSentAt: null, lastInvestorMessageAt: asked }),
    ).toBe(true)
  })

  it('waits when the answer is only whitespace', () => {
    expect(
      isAwaitingAnswer({ answer: '   ', answerEmailSentAt: null, lastInvestorMessageAt: asked }),
    ).toBe(true)
  })

  it('waits when an answer is written but has never been sent', () => {
    expect(
      isAwaitingAnswer({
        answer: 'Written but not sent.',
        answerEmailSentAt: null,
        lastInvestorMessageAt: asked,
      }),
    ).toBe(true)
  })

  it('is settled once the reply has gone out', () => {
    expect(
      isAwaitingAnswer({
        answer: 'Sent.',
        answerEmailSentAt: replied,
        lastInvestorMessageAt: asked,
      }),
    ).toBe(false)
  })

  it('re-opens when a follow-up arrives after the reply (§6.7.1)', () => {
    expect(
      isAwaitingAnswer({
        answer: 'Sent.',
        answerEmailSentAt: replied,
        lastInvestorMessageAt: new Date('2026-07-12T08:00:00Z'),
      }),
    ).toBe(true)
  })

  it('treats a seeded entry with no investor messages as settled', () => {
    expect(
      isAwaitingAnswer({
        answer: 'Written by the operator.',
        answerEmailSentAt: null,
        lastInvestorMessageAt: null,
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Source-level rules
// ---------------------------------------------------------------------------

describe('no money or percentage becomes a JavaScript number (checklist 1)', () => {
  it('never coerces a value anywhere in the Q&A modules', () => {
    for (const { name, source } of qaSources()) {
      const code = withoutComments(source)
      expect(code, `${name} uses Number(`).not.toMatch(/\bNumber\s*\(/)
      expect(code, `${name} uses parseFloat`).not.toContain('parseFloat')
      expect(code, `${name} uses parseInt`).not.toContain('parseInt')
      expect(code, `${name} uses .toNumber(`).not.toContain('.toNumber(')
      expect(code, `${name} uses Intl.NumberFormat`).not.toContain('Intl.NumberFormat')
    }
  })
})

describe('no bulk send exists (§14, checklist 2)', () => {
  it('has no function that loops over recipients sending', () => {
    for (const { name, source } of qaSources()) {
      const code = withoutComments(source)
      expect(code, name).not.toMatch(/sendMany|sendAll|sendBatch|sendBulk/i)
    }
  })

  it('reaches the transport through the one gated entry point only', () => {
    for (const { name, source } of qaSources()) {
      const code = withoutComments(source)
      // No transport is constructed here, and no retry loop is re-implemented.
      expect(code, name).not.toContain('new SmtpTransport')
      expect(code, name).not.toContain('getTransport(')
      expect(code, name).not.toContain('nodemailer')
    }
  })
})

describe('nothing logs a credential, a body or a token (checklist 8)', () => {
  it('never console-logs from the Q&A modules', () => {
    for (const { name, source } of qaSources()) {
      const code = withoutComments(source)
      expect(code, name).not.toMatch(/console\.(log|info|warn|error|debug)/)
    }
  })

  it('never puts a message body in audit metadata', () => {
    // `assertNoSecrets` throws on a `body` key at runtime. This catches it at
    // the source, where the fix is cheaper.
    for (const { name, source } of qaSources()) {
      const code = withoutComments(source)
      const metadataBlocks = code.match(/metadata:\s*\{[^}]*\}/g) ?? []
      for (const block of metadataBlocks) {
        // Value position only. `characters: body.length` is a length and is
        // exactly what should be recorded instead of the text; `body: body`
        // is the mistake this is looking for.
        expect(block, name).not.toMatch(
          /:\s*(?:input\.)?(?:body|answer|question|questionOriginal|questionPublic|entry\.question\w*|entry\.answer)\s*[,}]/,
        )
      }
    }
  })
})

describe('the original question is never overwritten (§6.7.3)', () => {
  it('has no update that writes question_original after creation', () => {
    const service = withoutComments(readFileSync(join(QA_DIR, 'service.ts'), 'utf8'))
    // `.set({ ... })` is the only way an update writes a column with Drizzle.
    const setBlocks = service.match(/\.set\(\{[\s\S]*?\}\)/g) ?? []
    for (const block of setBlocks) {
      expect(block).not.toContain('questionOriginal')
    }
  })
})

describe('saving an answer never sends one (§6.7.2)', () => {
  it('keeps sendOneEmail out of recordAnswer and createSeededEntry', () => {
    const service = withoutComments(readFileSync(join(QA_DIR, 'service.ts'), 'utf8'))

    for (const fn of ['recordAnswer', 'createSeededEntry']) {
      const start = service.indexOf(`export async function ${fn}(`)
      expect(start, fn).toBeGreaterThan(-1)

      const rest = service.slice(start)
      const end = rest.indexOf('\nexport ', 1)
      const bodyText = end === -1 ? rest : rest.slice(0, end)

      expect(bodyText, `${fn} must not send`).not.toContain('sendOneEmail')
    }
  })
})
