import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { investorAccounts, offers, recipients, rounds } from './schema'

/**
 * BUILD_SPEC §22 AC15 — "An investor account can hold a second offer under a
 * second round without schema changes."
 *
 * §4.3 is the reason this is a criterion at all: the account is durable and
 * outlives the round. `schema.test.ts` proves the shape — an offer points at a
 * round and at an account, and the account points at neither. What it does not
 * prove is that nothing *else* forbids the second offer, and there are two
 * plausible ways it could:
 *
 *   1. A unique index on `offers.account_id`, which would allow exactly one
 *      offer per investor for all time. `offers_account_idx` is deliberately a
 *      plain index — it is there to make "this investor's offers" fast, which
 *      is a query that only makes sense if there can be more than one.
 *   2. An import path that creates a fresh account per file rather than
 *      matching the existing one by address, which would give the same person
 *      two accounts instead of one account with two offers.
 *
 * Both are checked below. The write itself needs a database and is exercised
 * by the verification scripts; what a unit test can do is prove that nothing
 * in the schema or the import path stands in its way.
 */

const PERSIST = readFileSync(join(process.cwd(), 'src/lib/import/persist.ts'), 'utf8')

/** Comments describe what the code avoids; they must not satisfy a check for it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function uniqueColumnSets(table: Parameters<typeof getTableConfig>[0]): string[][] {
  const config = getTableConfig(table)
  return [
    ...config.indexes.filter((index) => index.config.unique),
    ...config.uniqueConstraints.map((constraint) => ({ config: constraint })),
  ].map((entry) =>
    (entry.config.columns ?? [])
      .map((column) => ('name' in column ? String(column.name) : String(column)))
      .sort(),
  )
}

// ---------------------------------------------------------------------------

describe('an account is durable and the round is not — §4.3, §22 AC15', () => {
  it('holds a second offer under a second round with no schema change', () => {
    const offerColumns = getTableConfig(offers).columns.map((column) => column.name)
    expect(offerColumns).toContain('round_id')
    expect(offerColumns).toContain('account_id')

    // Nothing unique names account_id on its own, or the second offer would be
    // rejected by the database whatever the application intended.
    const uniques = uniqueColumnSets(offers)
    expect(uniques).not.toContainEqual(['account_id'])
    expect(uniques.every((columns) => !(columns.length === 1 && columns[0] === 'account_id'))).toBe(true)

    // Nor is there a unique on the pair, which would allow one offer per round
    // per investor. §5 permits a corrected re-issue, so even that would bind.
    expect(uniques).not.toContainEqual(['account_id', 'round_id'])

    // The index that does exist on account_id is a plain one: a lookup aid for
    // "this investor's offers", a query with no purpose unless there are many.
    const accountIndex = getTableConfig(offers).indexes.find(
      (index) => index.config.name === 'offers_account_idx',
    )
    expect(accountIndex).toBeDefined()
    expect(accountIndex?.config.unique).toBe(false)
  })

  it('keeps the account free of anything round-shaped', () => {
    const accountColumns = getTableConfig(investorAccounts).columns.map((column) => column.name)
    expect(accountColumns).not.toContain('round_id')
    expect(accountColumns.filter((name) => name.includes('round'))).toEqual([])

    // One row per address, forever. That is what makes the second offer attach
    // to the same person rather than to a second copy of them. The constraint
    // is declared on the column, so it is read off the column rather than out
    // of the table's index list.
    const emailColumn = getTableConfig(investorAccounts).columns.find(
      (column) => column.name === 'email',
    )
    expect(emailColumn?.isUnique).toBe(true)
  })

  it('scopes the recipient row to its round, so the same address can appear in the next one', () => {
    // A recipient is a row of the uploaded file and belongs to one round. The
    // uniqueness is on the pair, not on the address, or a second round could
    // not carry the same investor at all.
    const uniques = uniqueColumnSets(recipients)
    expect(uniques).toContainEqual(['email', 'round_id'])
    expect(uniques).not.toContainEqual(['email'])
  })

  it('lets rounds accumulate rather than replacing one another', () => {
    const roundColumns = getTableConfig(rounds).columns.map((column) => column.name)
    expect(roundColumns).toContain('id')
    // No singleton marker: nothing in the table says "there is one current
    // round and this is it", so a second row is an ordinary insert.
    expect(roundColumns).not.toContain('singleton')
  })
})

describe('the import path attaches to the account that already exists', () => {
  const source = withoutComments(PERSIST)

  it('matches an incoming row to the account that already exists', () => {
    // Selects existing accounts by address before inserting anything, and keys
    // a lookup off that result.
    expect(source).toMatch(/\.from\(investorAccounts\)/)
    expect(source).toMatch(/inArray\(investorAccounts\.email/)
    expect(source).toMatch(/accountByEmail/)

    // The insert is reached only when the lookup came back empty.
    const insertIndex = source.indexOf('.insert(investorAccounts)')
    expect(insertIndex).toBeGreaterThan(-1)
    const preamble = source.slice(0, insertIndex)
    expect(preamble).toMatch(/accountByEmail\.get\(/)
  })

  it('creates one account per address and never a second copy of a person', () => {
    // The map is written back after an insert, so two rows for the same address
    // inside one file cannot produce two accounts either.
    expect(source).toMatch(/accountByEmail\.set\(/)
    expect(source).not.toMatch(/\.delete\(investorAccounts\)/)
  })

  it('never reuses an offer row across rounds', () => {
    // Each round gets its own offer. Nothing updates an existing offer's
    // round_id, which would move an offer rather than adding one.
    expect(source).not.toMatch(/set\(\s*\{[^}]*roundId/)
  })
})
