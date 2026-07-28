import { describe, expect, it } from 'vitest'
import {
  ERASURE_BEGAN_ACTION,
  ERASURE_COMPLETED_ACTION,
  ERASURE_INCOMPLETE_ACTION,
} from './erase'
import { latestPerAccount } from './unfinished'

/**
 * The fold that decides whether an erasure is unfinished.
 *
 * The query around it is one `where` and one `order by` and is proved against a
 * real database by `pnpm verify:erasure`. The rule — which of an account's
 * erasure lines counts, and what an unresolved one means — is the part with a
 * wrong answer that would look right, so it is separated from the query and
 * tested on its own.
 */

const ACCOUNT = 'acct_one'
const OTHER = 'acct_two'

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 6, 26, 12, minutes, 0))
}

function row(
  action: string,
  minutes: number,
  metadata: unknown = {},
  entityId: string = ACCOUNT,
) {
  return { entityId, action, createdAt: at(minutes), metadata }
}

describe('an erasure that finished', () => {
  it('is not reported', () => {
    const out = latestPerAccount([
      row(ERASURE_BEGAN_ACTION, 0, { objectsToDestroy: 3 }),
      row(ERASURE_COMPLETED_ACTION, 1, { objectsDestroyed: 3 }),
    ])
    expect(out).toEqual([])
  })

  it('and neither is one that failed and was then run again successfully', () => {
    /*
     * The state a deployment reaches by doing exactly as it was told. Reporting
     * it would mean the remedy never clears the finding, and a finding that
     * cannot be cleared is one somebody learns to scroll past.
     */
    const out = latestPerAccount([
      row(ERASURE_BEGAN_ACTION, 0, { objectsToDestroy: 3 }),
      row(ERASURE_INCOMPLETE_ACTION, 1, { objectsDestroyed: 1, objectsRemaining: 2 }),
      row(ERASURE_BEGAN_ACTION, 5, { objectsToDestroy: 3 }),
      row(ERASURE_COMPLETED_ACTION, 6, { objectsDestroyed: 3 }),
    ])
    expect(out).toEqual([])
  })

  it('even when the rows arrive out of order', () => {
    // The query orders by time; the fold must not depend on it having done so,
    // because a fold that reads its input's order is one index change away from
    // reporting every completed erasure as unfinished.
    const out = latestPerAccount([
      row(ERASURE_COMPLETED_ACTION, 6),
      row(ERASURE_BEGAN_ACTION, 0),
      row(ERASURE_INCOMPLETE_ACTION, 1, { objectsDestroyed: 1, objectsRemaining: 2 }),
      row(ERASURE_BEGAN_ACTION, 5),
    ])
    expect(out).toEqual([])
  })
})

describe('an erasure that stopped', () => {
  it('is reported with what it destroyed', () => {
    const out = latestPerAccount([
      row(ERASURE_BEGAN_ACTION, 0, { objectsToDestroy: 3 }),
      row(ERASURE_INCOMPLETE_ACTION, 1, { objectsDestroyed: 2, objectsRemaining: 1 }),
    ])
    expect(out).toEqual([
      {
        accountId: ACCOUNT,
        at: at(1),
        stage: 'INCOMPLETE',
        objectsDestroyed: 2,
        objectsRemaining: 1,
      },
    ])
  })

  it('including the one that destroyed nothing at all', () => {
    // A clean refusal changed nothing and is still unfinished: the investor
    // asked to be erased and has not been. It resolves the `began` line, and
    // the finding it produces says the database was not touched.
    const out = latestPerAccount([
      row(ERASURE_BEGAN_ACTION, 0),
      row(ERASURE_INCOMPLETE_ACTION, 1, { objectsDestroyed: 0, objectsRemaining: 3 }),
    ])
    expect(out[0]?.stage).toBe('INCOMPLETE')
    expect(out[0]?.objectsDestroyed).toBe(0)
  })

  it('and metadata this version cannot read degrades to null, not to zero', () => {
    /*
     * `mediaCheckRecordSchema` learnt this the same way: a row written by a
     * different version of the application must degrade to "something is here
     * and it will not say how much". Zero would read as "nothing was destroyed",
     * which is the reassuring answer and the one there is no evidence for.
     */
    const out = latestPerAccount([
      row(ERASURE_INCOMPLETE_ACTION, 1, { destroyed: 'two' }),
    ])
    expect(out[0]?.stage).toBe('INCOMPLETE')
    expect(out[0]?.objectsDestroyed).toBeNull()
    expect(out[0]?.objectsRemaining).toBeNull()
  })
})

describe('an erasure that vanished', () => {
  it('is reported when nothing followed it', () => {
    const out = latestPerAccount([row(ERASURE_BEGAN_ACTION, 0, { objectsToDestroy: 3 })])
    expect(out[0]?.stage).toBe('BEGAN')
  })

  it('and does not report what it meant to destroy as what it did destroy', () => {
    // `objectsToDestroy: 3` is an intention. The process that would have turned
    // it into an outcome is the one that died. Reporting it as three destroyed
    // would overstate the damage on every abandoned run.
    const out = latestPerAccount([row(ERASURE_BEGAN_ACTION, 0, { objectsToDestroy: 3 })])
    expect(out[0]?.objectsDestroyed).toBeNull()
    expect(out[0]?.objectsRemaining).toBeNull()
  })
})

describe('more than one account', () => {
  it('is folded separately, and one finished does not resolve another', () => {
    const out = latestPerAccount([
      row(ERASURE_BEGAN_ACTION, 0, {}, ACCOUNT),
      row(ERASURE_BEGAN_ACTION, 1, {}, OTHER),
      row(ERASURE_COMPLETED_ACTION, 2, {}, OTHER),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.accountId).toBe(ACCOUNT)
  })

  it('and the most recent comes first', () => {
    const out = latestPerAccount([
      row(ERASURE_BEGAN_ACTION, 0, {}, ACCOUNT),
      row(ERASURE_BEGAN_ACTION, 9, {}, OTHER),
    ])
    expect(out.map((entry) => entry.accountId)).toEqual([OTHER, ACCOUNT])
  })

  it('and a row with no entity on it is skipped rather than grouped together', () => {
    // `entity_id` is nullable on the table. Folding nulls into one bucket would
    // invent an account id of "null" and report it.
    const out = latestPerAccount([
      { entityId: null, action: ERASURE_BEGAN_ACTION, createdAt: at(0), metadata: {} },
    ])
    expect(out).toEqual([])
  })
})

describe('two lines in the same instant', () => {
  it('resolve towards reporting, not towards silence', () => {
    /*
     * Theoretical — a whole transaction and a network round trip separate these
     * two rows — and the tie has to break somewhere. It breaks towards telling
     * somebody: a spurious "check this erasure" costs a minute, and a silently
     * half-erased investor is the failure this file exists for.
     */
    const out = latestPerAccount([
      row(ERASURE_COMPLETED_ACTION, 3),
      row(ERASURE_BEGAN_ACTION, 3),
    ])
    expect(out[0]?.stage).toBe('BEGAN')
  })
})
