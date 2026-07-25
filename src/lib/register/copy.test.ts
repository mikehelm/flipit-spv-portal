import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  JOINED_CONFIRMATION,
  JOIN_BUTTON_LABEL,
  LEAVE_BUTTON_LABEL,
  REGISTER_COPY,
  REGISTER_TITLE,
} from './copy'

/**
 * BUILD_SPEC §5.2.1 — "the whole feature lives or dies on not overstating".
 *
 * The specification's own blockquote is the fixture. If somebody edits either
 * the spec or the constant, this fails and they have to change both
 * deliberately rather than letting the screen drift away from the wording that
 * was agreed.
 */

/** The §5.2.1 blockquote, as paragraphs, read out of the specification. */
function specParagraphs(): string[] {
  const spec = readFileSync(join(process.cwd(), 'BUILD_SPEC.md'), 'utf8')

  const start = spec.indexOf('### 5.2.1 What it promises — nothing')
  expect(start, 'BUILD_SPEC §5.2.1 heading not found').toBeGreaterThan(-1)

  const end = spec.indexOf('### 5.2.2', start)
  const section = spec.slice(start, end)

  return section
    .split('\n')
    .filter((line) => line.startsWith('>'))
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph !== '')
}

function normalise(text: string): string {
  return text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
}

describe('the register copy matches the specification exactly', () => {
  it('carries the same title', () => {
    const paragraphs = specParagraphs()
    expect(normalise(paragraphs[0]!)).toBe(REGISTER_TITLE)
  })

  it('carries the same four paragraphs, in order, word for word', () => {
    const fromSpec = specParagraphs().slice(1).map(normalise)

    expect(fromSpec).toHaveLength(REGISTER_COPY.length)
    for (const [index, paragraph] of REGISTER_COPY.entries()) {
      expect(normalise(paragraph), `paragraph ${index + 1}`).toBe(fromSpec[index])
    }
  })

  it('promises nothing — the disclaiming sentence is present verbatim', () => {
    const joined = REGISTER_COPY.join(' ')
    expect(joined).toContain('does not reserve an allocation')
    expect(joined).toContain('create any entitlement to one')
    expect(joined).toContain('oblige anyone to offer you anything')
    expect(joined).toContain('Joining the register does not itself create a position')
    expect(joined).toContain('You can remove yourself at any time.')
  })
})

describe('it is a register, never a waitlist (§5.2)', () => {
  const REGISTER_DIR = join(process.cwd(), 'src/lib/register')

  /**
   * Comments are stripped first. These modules explain at length why the word
   * "waitlist" is forbidden, and the easy way to make a naive scan pass is to
   * delete the explanation — which is the opposite of what this is for.
   */
  function sources(): Array<{ name: string; source: string }> {
    return readdirSync(REGISTER_DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => ({
        name,
        source: readFileSync(join(REGISTER_DIR, name), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      }))
  }

  it('never uses the word waitlist', () => {
    for (const { name, source } of sources()) {
      expect(source, name).not.toMatch(/wait\s?-?list/i)
    }
    expect(REGISTER_COPY.join(' ')).not.toMatch(/wait\s?-?list/i)
  })

  it('never uses queue language in the investor-facing copy', () => {
    const investorFacing = [
      REGISTER_TITLE,
      ...REGISTER_COPY,
      JOIN_BUTTON_LABEL,
      LEAVE_BUTTON_LABEL,
      JOINED_CONFIRMATION,
    ].join(' ')

    for (const word of ['queue', 'rank', 'your position', 'ahead of', 'number ']) {
      expect(investorFacing.toLowerCase(), word).not.toContain(word)
    }
  })

  it('never tells the investor how many people are on it', () => {
    const investorFacing = [...REGISTER_COPY, JOINED_CONFIRMATION].join(' ')
    expect(investorFacing).not.toMatch(/\b\d+\s+(people|investors|others|members)\b/i)
  })
})
