import { describe, expect, it } from 'vitest'
import type { PortalNotice } from './access'
import { noticeCopy } from './notices'

/**
 * What a notice says. BUILD_SPEC §4.2, §7, §11.3.
 *
 * §7 asks the sunset notice for *"a configurable notice **and closing date**,
 * with a prompt to download their records"*. The date was stored, the settings
 * form refused to enter sunset without one — *"the portal tells investors when
 * it closes so they can download their records first"* — and the portal did
 * not tell them, because the sentence had no slot for a date in it.
 *
 * So the assertions here are about the two shapes of that sentence and about
 * the failure between them: a date rendered as a gap, which is the thing a
 * naive interpolation produces and which reads, on a page about somebody's
 * money, as an application that has lost track of itself.
 */

const ALL: PortalNotice[] = [
  'SUSPENDED',
  'CLOSED',
  'READ_ONLY',
  'SUNSET',
  'SERVICE_CLOSED',
  'ARCHIVED',
]

describe('every notice', () => {
  it.each(ALL)('%s has a title and a body', (notice) => {
    const copy = noticeCopy(notice)
    expect(copy.title.length).toBeGreaterThan(0)
    expect(copy.body.length).toBeGreaterThan(0)
  })

  it.each(ALL)('%s names nobody', (notice) => {
    // The address comes from configuration and is rendered underneath. A first
    // name written into a notice goes wrong quietly on the day somebody else
    // is answering.
    const copy = noticeCopy(notice, { closingDate: '30 September 2026' })
    expect(`${copy.title} ${copy.body}`).not.toMatch(/David|Serene|Mike|Michael/)
  })

  it.each(ALL)('%s reveals nothing about anybody else', (notice) => {
    // §15. There is no count, no total and no other participant anywhere in
    // this copy, and nothing in the input from which one could come.
    const copy = noticeCopy(notice, { closingDate: '30 September 2026' })
    expect(`${copy.title} ${copy.body}`).not.toMatch(
      /other investor|others|participants|so far|total raised|everyone else/i,
    )
  })

  it.each(ALL.filter((notice) => notice !== 'SUNSET'))(
    '%s ignores a closing date it has no business mentioning',
    (notice) => {
      expect(noticeCopy(notice, { closingDate: '30 September 2026' })).toEqual(noticeCopy(notice))
    },
  )
})

describe('the sunset notice', () => {
  it('names the closing date', () => {
    const copy = noticeCopy('SUNSET', { closingDate: '30 September 2026' })
    expect(copy.body).toContain('30 September 2026')
  })

  it('still asks them to download their records — §7 asks for the prompt too', () => {
    const copy = noticeCopy('SUNSET', { closingDate: '30 September 2026' })
    expect(copy.body).toMatch(/download any documents or correspondence/)
  })

  it('points the prompt at the date rather than at "then"', () => {
    expect(noticeCopy('SUNSET', { closingDate: '30 September 2026' }).body).toContain(
      'before that date',
    )
  })

  it('is written without a date when there is none', () => {
    // The settings form refuses to enter sunset without one, but the mode can
    // be reached by other means and a row can be edited. The sentence has to
    // stand up either way.
    const copy = noticeCopy('SUNSET')
    expect(copy.body).toBe(
      'This portal will close soon. Please download any documents or correspondence you wish to keep before then.',
    )
  })

  it.each([null, undefined, '', '   '])('treats %p as no date at all', (value) => {
    const copy = noticeCopy('SUNSET', { closingDate: value })
    expect(copy.body).not.toMatch(/close on\s*\./)
    expect(copy.body).toContain('will close soon')
  })

  it('never renders an empty gap where a date would be', () => {
    for (const value of [null, undefined, '', '   ']) {
      const body = noticeCopy('SUNSET', { closingDate: value }).body
      expect(body).not.toMatch(/\s{2,}/)
      expect(body).not.toContain('undefined')
      expect(body).not.toContain('null')
      expect(body).not.toContain('Invalid Date')
    }
  })

  it('trims a date that arrived with whitespace on it', () => {
    expect(noticeCopy('SUNSET', { closingDate: ' 2026-09-30 ' }).body).toContain(
      'close on 2026-09-30.',
    )
  })
})
