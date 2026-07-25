import { describe, expect, it } from 'vitest'
import { diffTemplateSource } from './diff'

/** BUILD_SPEC §8.2 item 2 — "Show a diff so it is obvious what changed." */

const base = {
  subject: 'An invitation to join the Flipit SPV',
  htmlSource: '<p>Hello {{recipient_name}}</p>\n<p>The deadline is {{response_deadline}}.</p>',
  textSource: 'Hello {{recipient_name}}\nThe deadline is {{response_deadline}}.',
}

describe('diffTemplateSource', () => {
  it('reports no difference for identical source', () => {
    const diff = diffTemplateSource(base, { ...base })
    expect(diff.changedParts).toEqual([])
    expect(diff.totalAdded).toBe(0)
    expect(diff.totalRemoved).toBe(0)
    expect(diff.summary).toMatch(/No line differs/)
  })

  it('names the subject line when only the subject changed', () => {
    const diff = diffTemplateSource(base, {
      ...base,
      subject: 'An invitation to join the Flipit SPV.',
    })
    expect(diff.changedParts).toEqual(['SUBJECT'])
    expect(diff.summary).toMatch(/subject line/)
  })

  it('shows the removed and added lines of a one-word change', () => {
    const diff = diffTemplateSource(base, {
      ...base,
      textSource: 'Hi {{recipient_name}}\nThe deadline is {{response_deadline}}.',
    })

    const part = diff.parts.find((entry) => entry.part === 'TEXT')!
    expect(part.changed).toBe(true)
    expect(part.added).toBe(1)
    expect(part.removed).toBe(1)

    const removed = part.lines.filter((line) => line.kind === 'REMOVED')
    const added = part.lines.filter((line) => line.kind === 'ADDED')
    expect(removed[0].text).toBe('Hello {{recipient_name}}')
    expect(added[0].text).toBe('Hi {{recipient_name}}')

    // The unchanged line is kept as context so the change reads in place.
    expect(part.lines.some((line) => line.kind === 'CONTEXT')).toBe(true)
  })

  it('counts an inserted line as added and nothing as removed', () => {
    const diff = diffTemplateSource(base, {
      ...base,
      textSource: 'Hello {{recipient_name}}\nA new line.\nThe deadline is {{response_deadline}}.',
    })
    const part = diff.parts.find((entry) => entry.part === 'TEXT')!
    expect(part.added).toBe(1)
    expect(part.removed).toBe(0)
  })

  it('reports every changed part at once', () => {
    const diff = diffTemplateSource(base, {
      subject: 'Different',
      htmlSource: '<p>Different</p>',
      textSource: 'Different',
    })
    expect(diff.changedParts).toEqual(['SUBJECT', 'HTML', 'TEXT'])
  })

  it('elides long unchanged stretches but keeps context either side', () => {
    const many = Array.from({ length: 60 }, (_value, index) => `line ${index}`).join('\n')
    const changed = many.replace('line 30', 'line thirty')

    const diff = diffTemplateSource(
      { ...base, textSource: many },
      { ...base, textSource: changed },
    )
    const part = diff.parts.find((entry) => entry.part === 'TEXT')!

    expect(part.truncated).toBe(true)
    expect(part.lines.length).toBeLessThan(20)
    expect(part.lines.some((line) => line.text === 'line thirty')).toBe(true)
    expect(part.lines.some((line) => line.text === 'line 29')).toBe(true)
  })

  it('treats a whitespace-only change as a change — whitespace in a body is content', () => {
    const diff = diffTemplateSource(base, {
      ...base,
      textSource: base.textSource.replace('The deadline', 'The  deadline'),
    })
    expect(diff.changedParts).toEqual(['TEXT'])
  })

  it('does not invent a trailing blank line from a trailing newline', () => {
    const diff = diffTemplateSource(
      { ...base, textSource: 'one\ntwo' },
      { ...base, textSource: 'one\ntwo\n' },
    )
    expect(diff.changedParts).toEqual([])
  })
})
