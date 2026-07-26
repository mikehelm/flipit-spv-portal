/**
 * How an investor reaches David from their own portal. BUILD_SPEC §2.1, §13.
 *
 * §13 asks the portal for *"a clear statement of what the portal is and is not,
 * **and a route to contact the operator**"*. §2.1 says what that route is made
 * of: the operator chooses phone, WhatsApp or email-only at onboarding, and the
 * WhatsApp choice *"renders as a WhatsApp contact, **with a `wa.me` link in the
 * portal**"*.
 *
 * The choice was captured, `whatsappLink()` was written and tested, and nothing
 * imported it. An investor looking at an active portal had no way to reach
 * anybody: the only contact route in the application appeared on the notice
 * pages for suspended and closed accounts, which is to say it appeared exactly
 * when the portal had stopped being useful.
 *
 * This is `contact.ts`'s counterpart and it follows the same three rules.
 *
 * **It never invents.** With nothing configured it returns nothing, and the
 * page renders nothing rather than a dead link or a name with no address.
 *
 * **Email-only still produces a route.** §2.1's third option removes the phone
 * line *from the email template*; it does not mean the investor is left with
 * nowhere to write. §13 asks for a route unconditionally, so the address is the
 * route.
 *
 * **Pure, and it takes no account.** Every input is operator configuration.
 * There is no parameter through which anything belonging to an investor —
 * theirs or anybody else's — could arrive.
 */

import type { ContactMethod } from '@/lib/auth/onboarding'
import { isPlausibleContactNumber, whatsappLink } from '@/lib/auth/onboarding'

export type OperatorContactKind = 'WHATSAPP' | 'PHONE' | 'EMAIL'

export interface PortalOperatorContact {
  kind: OperatorContactKind
  /** What the investor reads. Never a URL. */
  display: string
  /** Where the link goes: `https://wa.me/…`, `tel:…` or `mailto:…`. */
  href: string
}

export interface OperatorContactInput {
  /** `users.contact_method` for the operator. */
  method: ContactMethod | null
  /** `users.contact_value` — the number, for phone and WhatsApp. */
  value: string | null
  /** `default_sender_email` — the address the invitation came from. */
  email: string | null
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/**
 * The one route, or none.
 *
 * A single contact rather than a list, deliberately. `contact.ts` offers two
 * addresses on a notice because the whole subject of a notice is that the first
 * one may not be answered. This is a working portal: two ways to reach the same
 * person is a question about which one is real.
 *
 * A number that does not look dialable falls back to the address instead of
 * being rendered. A `tel:` link that does nothing is worse than an email
 * address, because it looks like it worked.
 */
export function operatorContact(
  input: OperatorContactInput,
): PortalOperatorContact | null {
  const value = clean(input.value)
  const email = clean(input.email)

  if (value !== null && isPlausibleContactNumber(value)) {
    if (input.method === 'WHATSAPP') {
      return { kind: 'WHATSAPP', display: value, href: whatsappLink(value) }
    }
    if (input.method === 'PHONE') {
      return { kind: 'PHONE', display: value, href: `tel:${value.replace(/[^\d+]/g, '')}` }
    }
  }

  if (email !== null) {
    return { kind: 'EMAIL', display: email, href: `mailto:${email}` }
  }

  return null
}

/**
 * The words around the route, in one place because they are investor-facing.
 *
 * No name. The route makes the name unnecessary, and a hard-coded first name is
 * a thing that goes wrong quietly on the day somebody else is answering — the
 * same reasoning that took "David" out of the notice pages.
 *
 * No promise, either. "Is the way to reach us" is a statement about a channel;
 * "we reply within two days" would be a commitment this application cannot keep
 * on anybody's behalf.
 */
export const OPERATOR_CONTACT_COPY: Record<OperatorContactKind, string> = {
  WHATSAPP: 'If you would rather talk than write, message us on WhatsApp at ',
  PHONE: 'If you would rather talk than write, call us on ',
  EMAIL: 'If you would rather write outside this portal, the address is ',
}

/**
 * The line beneath the route, and it is not decoration.
 *
 * §15.1's posture, applied where an investor is being given a phone number on a
 * page about their money: the number on the portal is the number, and anything
 * arriving by another route claiming to be us is worth checking. It also heads
 * off the one thing a private channel makes easier — a request to change
 * payment details in a chat window.
 */
export const OPERATOR_CONTACT_SAFETY =
  'This is the only number and address we use. We will never ask you for payment ' +
  'details, or send you a change of bank details, by message or by phone.'
