import { randomBytes } from 'node:crypto'

/**
 * Message-ID generation and threading headers. BUILD_SPEC §14:
 *
 *   "Set and record a `Message-ID` for every message, and honour `In-Reply-To`
 *   so replies thread correctly."
 *
 * §8.1 makes the same point from the other side: threading works over SMTP
 * "because the application sets and tracks its own `Message-ID`". We generate
 * it rather than letting the library do it, because a value we did not choose
 * is a value we cannot reliably record against the send event.
 */

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export interface MessageIdDeps {
  now?: () => number
  randomHex?: () => string
}

/** The domain part of an address, validated. Throws rather than guessing. */
export function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  const domain = at === -1 ? '' : address.slice(at + 1).trim().toLowerCase()
  if (!HOSTNAME.test(domain)) {
    throw new Error(
      `Cannot build a Message-ID: "${address}" has no usable domain. The sending ` +
        'address must be a full email address such as someone@gmail.com.',
    )
  }
  return domain
}

/**
 * `<random.timestamp@domain>` — RFC 5322 shape, globally unique in practice.
 *
 * The random half is 16 bytes of CSPRNG output. Nothing about the recipient,
 * the offer or the amount goes anywhere near it: §15 forbids identifying
 * detail in anything the outside world sees, and a Message-ID is a header
 * that travels with the message and is visible to every hop in between.
 */
export function createMessageId(senderAddress: string, deps: MessageIdDeps = {}): string {
  const domain = domainOf(senderAddress)
  const now = deps.now ? deps.now() : Date.now()
  const random = deps.randomHex ? deps.randomHex() : randomBytes(16).toString('hex')
  return `<${random}.${now}@${domain}>`
}

export function isMessageId(value: string): boolean {
  return /^<[^\s<>]+@[^\s<>]+>$/.test(value.trim())
}

/**
 * Coerce a stored id into header form. We record ids with their angle brackets;
 * a value that arrived from somewhere else may not have them, and an
 * `In-Reply-To` without them will not thread.
 */
export function normaliseMessageId(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error('A Message-ID cannot be empty.')
  }
  const bracketed = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed : `<${trimmed}>`
  if (!isMessageId(bracketed)) {
    throw new Error(
      `"${value}" is not a usable Message-ID. Threading headers are not guessed at — ` +
        'a malformed one would silently break the reply thread.',
    )
  }
  return bracketed
}

/**
 * The `References` chain for a reply.
 *
 * RFC 5322: References is the parent's References plus the parent's Message-ID.
 * Getting this right is what keeps a long exchange with an investor in one
 * Gmail thread rather than a scatter of separate messages.
 */
export function buildReferences(
  inReplyTo: string | undefined,
  existing: readonly string[] | undefined,
): string[] {
  const chain = (existing ?? []).map(normaliseMessageId)
  if (inReplyTo) {
    const parent = normaliseMessageId(inReplyTo)
    if (!chain.includes(parent)) chain.push(parent)
  }
  return chain
}
