/**
 * The wording an investor ticks, and the two rules around it.
 * BUILD_SPEC §13, §8.2.
 *
 * §13 asks for *"acknowledgement checkboxes, configurable, and not to be
 * treated as a binding subscription unless the final legal documents expressly
 * make them so"*. §8.2 says why they are configurable: *"so that approved
 * wording can be applied without a code change"*. The wording belongs to the
 * compliance approver, so it lives in a table an owner can edit.
 *
 * This module holds the parts that must **not** be editable, and it has no
 * database import so that it stays reviewable as a piece of text — the same
 * reasoning as `roadmap.ts`.
 *
 * Two rules, and both of them are about the same failure.
 *
 * **The standing line cannot be switched off.** §13's second clause is a
 * constraint on the application, not a default an owner may change. Whatever
 * the checkboxes say, the sentence beneath them says the response is not a
 * binding subscription. There is no column for it and no prop that would let a
 * caller replace it.
 *
 * **The wording gate refuses words that would make a tick read as a
 * commitment.** A label is free text typed onto a securities offer page. If it
 * said "I agree to subscribe for the amount shown", a checkbox would be doing
 * the work the subscription documents are supposed to do — which is exactly
 * what §13's second clause forbids, arrived at through the settings screen
 * rather than through the code.
 */

/**
 * The line beneath the checkboxes. §13, reproduced as a constraint.
 *
 * Not configurable, on purpose. It is the sentence that keeps a set of ticked
 * boxes from reading as a signature.
 */
export const ACKNOWLEDGEMENT_STANDING_LINE =
  'Ticking these boxes records that you have read and understood them. It is not a ' +
  'subscription, not a commitment to invest, and not a binding agreement of any kind — ' +
  'only the final subscription and SPV documents can create one, and they will say so ' +
  'expressly.'

export const ACKNOWLEDGEMENT_HEADING = 'Before you record an interest'

/**
 * Words a label may not contain.
 *
 * Each of these turns "I have read and understood X" into "I agree to do X",
 * which is the one thing §13 says a checkbox may not be. `subscribe` and
 * `binding` are the two somebody reaches for first; the rest are the ways of
 * saying the same thing without those words.
 */
export const FORBIDDEN_IN_ACKNOWLEDGEMENT = [
  'subscribe',
  'subscription',
  'binding',
  'irrevocable',
  'irrevocably',
  'undertake',
  'undertaking',
  'hereby agree to invest',
  'commit to invest',
  'legally bound',
  'contract',
  'guarantee',
  'guaranteed',
] as const

/**
 * The offending words in a proposed label, or an empty array.
 *
 * Matched on word boundaries so that "uncontracted" does not trip "contract",
 * and case-insensitively because a capital letter is not a different word.
 */
export function forbiddenWordsInAcknowledgement(label: string): string[] {
  const haystack = label.toLowerCase()
  return FORBIDDEN_IN_ACKNOWLEDGEMENT.filter((word) => {
    if (word.includes(' ')) return haystack.includes(word)
    return new RegExp(`\\b${word}\\b`).test(haystack)
  })
}

/**
 * Which responses require the boxes to be ticked.
 *
 * **Only an expression of interest.** Declining and asking a question do not.
 *
 * This is the conservative reading and it took a moment's thought to see that
 * the obvious one is wrong. Requiring an acknowledgement before somebody may
 * say *"I am not interested"* would make the acknowledgements a toll on
 * declining — an investor who did not want to tick them would be pushed toward
 * silence, and silence and a decline are not the same fact. The same goes for a
 * question: a person who has not understood something is exactly the person who
 * should not be made to confirm they have.
 */
export function acknowledgementsRequiredFor(
  choice: 'INTERESTED' | 'NOT_INTERESTED' | 'QUESTION',
): boolean {
  return choice === 'INTERESTED'
}

/**
 * The refusal an investor sees when a required box is unticked.
 *
 * Names how many are outstanding rather than which, because the form shows
 * which — and repeating the wording in an error message is a second place for
 * approved wording to live.
 */
export function missingAcknowledgementMessage(count: number): string {
  const boxes = count === 1 ? 'one box' : `${count} boxes`
  return (
    `Your response has not been recorded: there ${count === 1 ? 'is' : 'are'} still ` +
    `${boxes} to confirm above. Nothing has been changed. If you would rather not ` +
    'confirm them, you can ask a question instead and David will pick it up.'
  )
}
