import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TemplateNotApprovedError } from './send-invitation'

/**
 * The document that is sent is the document that was approved. BUILD_SPEC §8.2.
 *
 * There was a real gap here, and it is the kind that a hash comparison exists
 * to catch. The drift check hashes `loadCurrentTemplate(kind)`, which prefers a
 * stored `email_templates` row over the shipped default. The send rendered
 * `templateSource(kind)`, which only ever returns the shipped default. Nothing
 * writes a stored row today, so the two agreed and every test passed — but the
 * moment one existed, the owner would have approved one document and a
 * different one would have gone out, with the gate reporting green.
 *
 * Two things now hold it shut, and these tests are what fail if either is
 * loosened:
 *
 *   1. Both sides load the template the same way.
 *   2. Whatever was loaded, its hash is compared with the approved hash in the
 *      second before sending, and a mismatch sends nothing.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the approved source and the sent source are the same source', () => {
  it('loads the template the same way on both sides of the gate', () => {
    const drift = withoutComments(read('src/lib/compliance/drift.ts'))
    const send = withoutComments(read('src/lib/sending/send-invitation.ts'))

    expect(drift).toContain('loadCurrentTemplate(')
    expect(send).toContain('loadCurrentTemplate(')
    // `templateSource` returns only the shipped default and would silently
    // disagree with the approval the moment a stored row existed.
    expect(send).not.toContain('templateSource(')
  })

  it('compares the rendered template hash with the approved hash before sending', () => {
    const send = withoutComments(read('src/lib/sending/send-invitation.ts'))
    expect(send).toContain('assertApprovedSource(rendered.templateHash, input.approval)')

    // It must sit inside the try that precedes the snapshot and the transport,
    // so a mismatch stops the send rather than being reported afterwards.
    const renderIndex = send.indexOf('rendered = renderEmail(')
    const assertIndex = send.indexOf('assertApprovedSource(rendered.templateHash')
    const sendIndex = send.indexOf('await sendOneEmail(')
    expect(renderIndex).toBeGreaterThan(-1)
    expect(assertIndex).toBeGreaterThan(renderIndex)
    expect(sendIndex).toBeGreaterThan(assertIndex)
  })

  it('refuses rather than warns, and the message names both hashes', () => {
    const error = new TemplateNotApprovedError('a'.repeat(64), 'b'.repeat(64))
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('aaaaaaaaaaaa')
    expect(error.message).toContain('bbbbbbbbbbbb')
    expect(error.message).toContain('Nothing was sent')
    expect(error.message).not.toMatch(/something went wrong/i)
  })
})

describe('a reminder is checked for offer terms in the second before it sends', () => {
  it('applies the §6.5 gate to the reminder and never to the invitation', () => {
    const send = withoutComments(read('src/lib/sending/send-invitation.ts'))
    expect(send).toContain("if (kind === 'REMINDER') assertNoOfferTerms(")

    // The invitation carries the figures on purpose. A gate applied to both
    // would block every invitation in the application.
    const guarded = send.match(/if \(kind === '(\w+)'\) assertNoOfferTerms/)
    expect(guarded?.[1]).toBe('REMINDER')
  })

  it('runs it against the loaded source and the rendered output, not the default', () => {
    const send = withoutComments(read('src/lib/sending/send-invitation.ts'))
    expect(send).toContain('assertNoOfferTerms({ template: source, rendered })')
  })
})
