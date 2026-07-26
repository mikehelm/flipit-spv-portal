import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACKNOWLEDGEMENT_HEADING,
  ACKNOWLEDGEMENT_STANDING_LINE,
  acknowledgementsRequiredFor,
  FORBIDDEN_IN_ACKNOWLEDGEMENT,
  forbiddenWordsInAcknowledgement,
  missingAcknowledgementMessage,
} from './acknowledgements'

/**
 * The acknowledgement checkboxes. BUILD_SPEC §13, §8.2.
 *
 * §8.2 makes the wording configurable — *"so that approved wording can be
 * applied without a code change"* — which means the interesting tests are about
 * the parts that are deliberately **not** configurable, and about the one way a
 * settings screen could be used to break §13's second clause.
 */

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function moduleSource(relativePath: string): string {
  return withoutComments(readFileSync(join(process.cwd(), relativePath), 'utf8'))
}

const PURE = 'src/lib/portal/acknowledgements.ts'
const DATA = 'src/lib/portal/acknowledgements-data.ts'
const ACTIONS = 'src/actions/acknowledgements.ts'
const PORTAL_ACTION = 'src/actions/portal.ts'
const PAGE = 'src/app/portal/page.tsx'
const ADMIN_PAGE = 'src/app/(admin)/admin/acknowledgements/page.tsx'

// ---------------------------------------------------------------------------
// The line that is not configurable
// ---------------------------------------------------------------------------

describe('the standing line', () => {
  it('says a tick is not a binding subscription, which is what §13 requires', () => {
    const line = ACKNOWLEDGEMENT_STANDING_LINE.toLowerCase()
    expect(line).toContain('not a subscription')
    expect(line).toContain('not a commitment')
    expect(line).toContain('not a binding agreement')
  })

  it('points at the documents as the only thing that can create one', () => {
    expect(ACKNOWLEDGEMENT_STANDING_LINE.toLowerCase()).toContain('subscription and spv documents')
    // §13's own words: "unless the final legal documents expressly make them so".
    expect(ACKNOWLEDGEMENT_STANDING_LINE.toLowerCase()).toContain('expressly')
  })

  it('comes from a constant with no database behind it', () => {
    // The reason this module has no `@/db` import: a sentence that can be
    // reviewed is one that sits in a file, and a sentence an owner could edit
    // is not a constraint on the application.
    const source = moduleSource(PURE)
    expect(source).not.toContain("from '@/db'")
    expect(source).not.toContain('pgTable')
  })

  it('is rendered from the constant on the portal, not typed into the page', () => {
    const page = moduleSource(PAGE)
    expect(page).toContain('{ACKNOWLEDGEMENT_STANDING_LINE}')
    expect(page).toContain('{ACKNOWLEDGEMENT_HEADING}')
  })

  it('is rendered wherever the boxes are, with no prop that could replace it', () => {
    const page = moduleSource(PAGE)
    const component = page.slice(page.indexOf('function Acknowledgements'))
    const body = component.slice(0, component.indexOf('function OfferSection'))
    expect(body).toContain('ACKNOWLEDGEMENT_STANDING_LINE')
    // The only props are the items and what is ticked. Nothing that carries
    // copy, and nothing that could switch the line off.
    expect(body).not.toMatch(/standingLine|disclaimer|showLine|hideLine/i)
  })

  it('is shown to the owner as something they cannot change', () => {
    const admin = moduleSource(ADMIN_PAGE)
    expect(admin).toContain('ACKNOWLEDGEMENT_STANDING_LINE')
    expect(admin).toContain('This line is fixed.')
  })

  it('has a heading that does not itself imply a commitment', () => {
    expect(ACKNOWLEDGEMENT_HEADING.toLowerCase()).not.toMatch(/agree|sign|subscrib|commit/)
  })
})

// ---------------------------------------------------------------------------
// The wording gate
// ---------------------------------------------------------------------------

describe('forbiddenWordsInAcknowledgement', () => {
  it('passes wording that acknowledges', () => {
    for (const label of [
      'I have read and understood that this is a private invitation and not an offer to the public.',
      'I understand that my response may be updated until the deadline shown.',
      'I confirm I have had the opportunity to take my own independent advice.',
      'I understand that no payment is requested at this stage.',
    ]) {
      expect(forbiddenWordsInAcknowledgement(label), label).toEqual([])
    }
  })

  it('refuses wording that undertakes', () => {
    // The one way a settings screen could break §13's second clause without a
    // code change — which is exactly what §8.2 made possible.
    for (const label of [
      'I agree to subscribe for the amount shown above.',
      'I accept that this is a binding agreement.',
      'I irrevocably commit to invest the amount shown.',
      'I undertake to transfer the funds within 14 days.',
      'I accept that I am legally bound by this response.',
      'This forms a contract between me and the SPV.',
      'I understand my capital is guaranteed.',
    ]) {
      expect(forbiddenWordsInAcknowledgement(label).length, label).toBeGreaterThan(0)
    }
  })

  it('matches on word boundaries, so an innocent word is not a false positive', () => {
    // "uncontracted" contains "contract" and means nothing of the kind.
    expect(forbiddenWordsInAcknowledgement('I understand the work is uncontracted.')).toEqual([])
    expect(forbiddenWordsInAcknowledgement('I have read the subscribers list.')).toEqual([])
  })

  it('is not fooled by a capital letter', () => {
    expect(forbiddenWordsInAcknowledgement('This is a BINDING agreement.')).toContain('binding')
  })

  it('reports every offending word, not just the first', () => {
    const found = forbiddenWordsInAcknowledgement(
      'I agree this is a binding contract and I undertake to subscribe.',
    )
    expect(found.length).toBeGreaterThanOrEqual(4)
  })

  it('names words a person would recognise in the refusal', () => {
    for (const word of FORBIDDEN_IN_ACKNOWLEDGEMENT) {
      expect(word).toBe(word.toLowerCase())
      expect(word.trim()).toBe(word)
    }
  })

  it('is applied on both write paths, and audited when it refuses', () => {
    const actions = moduleSource(ACTIONS)
    const calls = actions.match(/refuseForbiddenWords\(/g) ?? []
    // The definition, plus a call in add and a call in update.
    expect(calls.length).toBeGreaterThanOrEqual(3)
    expect(actions).toContain("action: 'acknowledgement.refused'")
  })
})

// ---------------------------------------------------------------------------
// When they are required
// ---------------------------------------------------------------------------

describe('acknowledgementsRequiredFor', () => {
  it('requires them only for an expression of interest', () => {
    expect(acknowledgementsRequiredFor('INTERESTED')).toBe(true)
  })

  it('never makes somebody tick a box in order to decline', () => {
    // Requiring them here would make the acknowledgements a toll on declining,
    // and would push an investor who does not want to tick them toward silence
    // instead. Silence and a decline are not the same fact.
    expect(acknowledgementsRequiredFor('NOT_INTERESTED')).toBe(false)
  })

  it('never makes somebody confirm they understand in order to ask a question', () => {
    expect(acknowledgementsRequiredFor('QUESTION')).toBe(false)
  })

  it('is what the response action consults', () => {
    const action = moduleSource(PORTAL_ACTION)
    expect(action).toContain('acknowledgementsRequiredFor(parsed.data.choice)')
  })
})

describe('the refusal when a box is unticked', () => {
  it('counts rather than repeats the wording', () => {
    // Approved wording has one home. Reciting it in an error message is a
    // second place for it to live and drift.
    const message = missingAcknowledgementMessage(2)
    expect(message).toContain('2 boxes')
    expect(message.toLowerCase()).toContain('nothing has been changed')
  })

  it('reads properly for one', () => {
    const message = missingAcknowledgementMessage(1)
    expect(message).toContain('one box')
    expect(message).toContain('there is still')
    expect(message).not.toContain('1 boxes')
  })

  it('offers the way out §13 allows', () => {
    // Asking a question requires nothing, so somebody unwilling to confirm has
    // somewhere to go other than away.
    expect(missingAcknowledgementMessage(1).toLowerCase()).toContain('ask a question')
  })
})

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe('what is recorded', () => {
  const data = moduleSource(DATA)

  it('copies the words rather than pointing at them', () => {
    // The whole reason this is not a foreign key. §8.2 makes the wording
    // editable; an acknowledgement whose text is a join is an acknowledgement
    // that can be rewritten after the fact from a settings screen.
    expect(data).toContain('label: item.label')
    expect(data).toContain('revision: item.revision')
  })

  it('is append-only — nothing here updates or deletes', () => {
    expect(data).not.toMatch(/db\s*\.\s*(update|delete)\s*\(/)
    expect(data).toContain('db.insert(responseAcknowledgements)')
  })

  it('never takes wording from the browser', () => {
    // The form posts ids. The words come from the table, so an edited form can
    // add nothing to the record.
    const action = moduleSource(PORTAL_ACTION)
    expect(action).toContain("formData.getAll('acknowledgement')")
    expect(action).toContain('items.filter((item) => tickedIds.has(item.id))')
    expect(action).not.toMatch(/formData\.get\(['"]acknowledgementLabel/)
  })

  it('keeps the wording out of the audit log', () => {
    const action = moduleSource(PORTAL_ACTION)
    const block = action.slice(action.indexOf("action: 'portal.response_recorded'"))
    const metadata = block.slice(block.indexOf('metadata:'), block.indexOf('})'))
    expect(metadata).toContain('acknowledgements')
    expect(metadata).not.toMatch(/label|wording|text/i)
  })

  it('is every offer keyed on itself, so no query can widen', () => {
    const offerFilters = data.match(/responseAcknowledgements\.offerId, offerId/g) ?? []
    expect(offerFilters.length).toBeGreaterThanOrEqual(3)
  })
})

describe('who may change the wording', () => {
  it('is the owner, on every write path', () => {
    // §8.2's fourth clause: the operator cannot record or amend an approval,
    // and wording an approver cleared is the same kind of thing.
    const actions = moduleSource(ACTIONS)
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1])
    expect(exported.length).toBe(3)
    const guards = actions.match(/await requireOwner\(\)/g) ?? []
    expect(guards.length).toBe(exported.length)
    expect(actions).not.toContain('requireOperator')
  })

  it('cannot delete, only archive', () => {
    // A row somebody ticked is evidence.
    const actions = moduleSource(ACTIONS)
    expect(actions).not.toMatch(/db\s*\.\s*delete\s*\(/)
    expect(actions).toContain("action: 'acknowledgement.archived'")
  })

  it('bumps the revision only when the words actually move', () => {
    const actions = moduleSource(ACTIONS)
    expect(actions).toContain('const wordsChanged = before.label !== parsed.data.label')
    expect(actions).toContain('revision: wordsChanged ? before.revision + 1 : before.revision')
  })
})
