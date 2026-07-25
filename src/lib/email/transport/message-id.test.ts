import { describe, expect, it } from 'vitest'
import {
  buildReferences,
  createMessageId,
  domainOf,
  isMessageId,
  normaliseMessageId,
} from './message-id'

describe('createMessageId', () => {
  it('produces an RFC-shaped id on the sender domain', () => {
    const id = createMessageId('serenedavid@gmail.com')
    expect(isMessageId(id)).toBe(true)
    expect(id.endsWith('@gmail.com>')).toBe(true)
  })

  it('is unique across calls', () => {
    const ids = new Set(
      Array.from({ length: 200 }, () => createMessageId('serenedavid@gmail.com')),
    )
    expect(ids.size).toBe(200)
  })

  it('carries nothing about the recipient, the offer or the amount', () => {
    const id = createMessageId('serenedavid@gmail.com', {
      now: () => 1_700_000_000_000,
      randomHex: () => 'abc123',
    })
    expect(id).toBe('<abc123.1700000000000@gmail.com>')
  })

  it('refuses an address with no usable domain rather than inventing one', () => {
    expect(() => createMessageId('not-an-address')).toThrow(/no usable domain/i)
    expect(() => createMessageId('someone@localhost')).toThrow(/no usable domain/i)
  })
})

describe('domainOf', () => {
  it('lower-cases and trims', () => {
    expect(domainOf('Someone@Example.COM ')).toBe('example.com')
  })

  it('takes the last @ so a quoted local part cannot fool it', () => {
    expect(domainOf('"weird@thing"@example.com')).toBe('example.com')
  })
})

describe('normaliseMessageId', () => {
  it('adds the angle brackets a stored id may be missing', () => {
    expect(normaliseMessageId('abc@gmail.com')).toBe('<abc@gmail.com>')
  })

  it('leaves an already-bracketed id alone', () => {
    expect(normaliseMessageId('<abc@gmail.com>')).toBe('<abc@gmail.com>')
  })

  it('refuses something that is not a Message-ID rather than half-threading', () => {
    expect(() => normaliseMessageId('no-at-sign')).toThrow(/not a usable Message-ID/i)
    expect(() => normaliseMessageId('  ')).toThrow(/cannot be empty/i)
  })
})

describe('buildReferences — threading', () => {
  it('appends the parent to an existing chain', () => {
    expect(buildReferences('<b@x.com>', ['<a@x.com>'])).toEqual(['<a@x.com>', '<b@x.com>'])
  })

  it('does not duplicate a parent already in the chain', () => {
    expect(buildReferences('<a@x.com>', ['<a@x.com>'])).toEqual(['<a@x.com>'])
  })

  it('is empty when there is nothing to thread onto', () => {
    expect(buildReferences(undefined, undefined)).toEqual([])
  })

  it('normalises everything it is given', () => {
    expect(buildReferences('b@x.com', ['a@x.com'])).toEqual(['<a@x.com>', '<b@x.com>'])
  })
})
