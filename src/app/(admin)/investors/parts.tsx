'use client'

import { useState } from 'react'
import { changeAccountStatusAction } from '@/actions/accounts'
import { eraseInvestorAction } from '@/actions/erasure'
import { ActionForm } from '@/components/admin/action-form'
import { Checkbox, Field, Notice, Select, TextArea, TextInput } from '@/components/admin/ui'

/**
 * Changing one account's state. BUILD_SPEC §4.2.
 *
 * Three things are required before anything happens, and each guards against a
 * different mistake:
 *
 *   - **The destination**, chosen from a list, because the five states are the
 *     five states.
 *   - **A reason**, at least ten characters, because it goes on the investor's
 *     own record and a record of something happening with no record of why is
 *     the half that is not worth keeping.
 *   - **The word typed out.** Suspension and closure end somebody's access to
 *     the record of money they may already have sent. A click on the wrong row
 *     looks exactly like a click on the right one; typing SUSPEND does not.
 *
 * The server re-checks all three. What is on this screen is manners.
 */

const CONSEQUENCE: Readonly<Record<string, string>> = {
  INVITED:
    'Back to invited. Their claim link becomes the way in again. Nothing they have already done is lost.',
  ACTIVE:
    'Restores full access. Any session or link revoked earlier stays revoked — they sign in again the ordinary way.',
  SUSPENDED:
    'Ends every session they hold, immediately, and revokes every unspent link. Asking for a new link is accepted politely and produces nothing. Reversible.',
  CLOSED:
    'Ends every session and link. By default they can still sign back in and read their own record — an investor who has sent money should not lose the record of it. That default is on the settings page.',
  ARCHIVED:
    'Ends every session and link, and no sign-in link is ever issued again. Owner only.',
}

export function ChangeStatusForm({
  accountId,
  currentStatus,
  liveSessions,
  liveLinks,
}: {
  accountId: string
  currentStatus: string
  liveSessions: number
  liveLinks: number
}) {
  const options = ['INVITED', 'ACTIVE', 'SUSPENDED', 'CLOSED', 'ARCHIVED'].filter(
    (status) => status !== currentStatus,
  )

  const [to, setTo] = useState(options[0] ?? 'SUSPENDED')

  const ends = to === 'SUSPENDED' || to === 'CLOSED' || to === 'ARCHIVED'

  return (
    <ActionForm
      action={changeAccountStatusAction}
      submitLabel={`Move to ${to.toLowerCase()}`}
      tone={ends ? 'danger' : 'quiet'}
      hidden={{ accountId }}
    >
      <Field label="New status" name="to">
        <Select
          name="to"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          options={options.map((status) => ({
            value: status,
            label: status.charAt(0) + status.slice(1).toLowerCase(),
          }))}
        />
      </Field>

      <p className="mb-4 border-l-2 border-orange pl-3 text-xs leading-relaxed text-dim">
        {CONSEQUENCE[to]}
        {ends && (liveSessions > 0 || liveLinks > 0) ? (
          <>
            {' '}
            <span className="text-ftext">
              Right now that is {liveSessions} live session{liveSessions === 1 ? '' : 's'} and{' '}
              {liveLinks} unspent link{liveLinks === 1 ? '' : 's'}.
            </span>
          </>
        ) : null}
      </p>

      <Field
        label="Reason"
        name="reason"
        hint="At least ten characters. It goes on the investor's own record, with your name and the time."
      >
        <TextArea name="reason" rows={3} />
      </Field>

      <div className="mb-4">
        <Checkbox
          name="investorNotified"
          id={`notified-${accountId}`}
          label="I have told the investor about this change"
        />
        <p className="mt-2 pl-7 text-xs leading-relaxed text-dim">
          Recorded either way. This application sends nothing on a status change — telling them
          is an update or an email you write deliberately.
        </p>
      </div>

      <Field
        label={`Type ${to} to confirm`}
        name="confirmation"
        hint="The word is what confirms which change you meant."
      >
        <TextInput name="confirmation" autoComplete="off" spellCheck={false} />
      </Field>
    </ActionForm>
  )
}

/**
 * Erasing one investor's personal data. OPEN_DECISIONS.md item 12.
 *
 * Owner-only, and the whole design of this form is about the gap between
 * deciding and doing. Three things stand in that gap:
 *
 *   - **The list of what is actually here**, before anything is pressed. Not
 *     "this will erase their record" but "this will redact 11 messages, 2
 *     documents and 1 bank reference, and destroy 2 stored files". Item 12's
 *     complaint was that the procedure was improvised at the moment somebody
 *     had asked for it; a count read from the database is the opposite of that.
 *   - **The address, typed out.** The precedent is the send screen, where
 *     confirming means typing the recipient rather than a word. On a page
 *     listing forty people, the mistake worth preventing is the wrong row.
 *   - **A tick that says it cannot be undone**, because it cannot.
 *
 * There is no reason field, deliberately, and the note below says why on the
 * screen rather than only in the code: an erasure must not be the moment new
 * prose about a person enters the record.
 *
 * **The pseudonym is on the finished state, not only in the success banner**,
 * and that is a fix rather than a flourish. The action revalidates `/investors`,
 * which re-renders this card into the branch below and unmounts the form — and
 * the banner with it. So the one thing the runbook tells the owner to write
 * down was on screen for less than a second and then gone for ever. Driving
 * this in a browser is what found it; nothing else could have.
 */
export function EraseInvestorForm({
  accountId,
  name,
  email,
  counts,
  alreadyErased,
  blockedBy,
}: {
  accountId: string
  /** What the record is called now. After an erasure, the pseudonym. */
  name: string
  email: string
  counts: { label: string; n: number }[]
  alreadyErased: boolean
  blockedBy: string | null
}) {
  if (alreadyErased) {
    return (
      <Notice tone="warn">
        This record has been erased. It is held under{' '}
        <span className="font-semibold text-ftext">{name}</span> — that is the name to quote if
        anybody asks you to show that the erasure happened, and the audit log has a row against
        it saying who did it and when. The figures are what is left. Running it again would
        produce exactly what is already here, and it refuses rather than pretending otherwise.
      </Notice>
    )
  }

  const present = counts.filter((row) => row.n > 0)

  return (
    <>
      <Notice tone="warn">
        This cannot be undone, and it is not the same as closing an account. Closing keeps
        everything and turns it read-only. This overwrites every name, address and line of free
        text with a pseudonym, destroys any stored document, and leaves the figures behind with
        nobody attached to them. The audit log keeps every event and loses only the address.
      </Notice>

      <div className="mb-4 rounded-sm border hairline bg-bg2 p-3">
        <p className="text-xs font-semibold text-silver2">What is actually here</p>
        {present.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-dim">
            Nothing but the account row itself — no offers, no messages, no documents.
          </p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-1">
            {present.map((row) => (
              <li key={row.label} className="text-xs text-dim">
                <span className="text-ftext">{row.n}</span> {row.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {blockedBy ? (
        <Notice tone="warn">{blockedBy}</Notice>
      ) : (
        <ActionForm
          action={eraseInvestorAction}
          submitLabel="Erase this record"
          tone="danger"
          hidden={{ accountId }}
        >
          <Field
            label="Type their email address to confirm"
            name="confirmation"
            hint={`Exactly as it appears above: ${email}`}
          >
            <TextInput name="confirmation" autoComplete="off" spellCheck={false} />
          </Field>

          <div className="mb-4">
            <Checkbox
              name="acknowledged"
              id={`erase-ack-${accountId}`}
              label="I understand this cannot be undone"
            />
            <p className="mt-2 pl-7 text-xs leading-relaxed text-dim">
              There is no reason box here, and that is deliberate: this is the one action that
              must not add new writing about a person to the record. Who ran it and when is on
              the audit log. Nothing is emailed to anybody.
            </p>
          </div>
        </ActionForm>
      )}
    </>
  )
}
