import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The suite's own environment, which is a thing the suite can be wrong about.
 *
 * `setup.ts` promises that "unit tests never depend on a developer's local
 * `.env`", and for as long as it used `??=` that sentence was false. The suite
 * used whatever was already in the environment, so the answer it gave depended
 * on who launched it.
 *
 * It was found by `verify:determinism`, which runs the unit suite in a shuffled
 * order and does `import 'dotenv/config'` for its own database connection. The
 * suite inherited `APP_URL=http://localhost:3000` and six tests failed that pass
 * from a bare shell — and the seed printed to reproduce it reproduced nothing,
 * because the order was never the cause.
 */

const setup = readFileSync(join(process.cwd(), 'src/test/setup.ts'), 'utf8')

describe('the test environment is chosen, not inherited', () => {
  it('assigns every variable rather than filling in the gaps', () => {
    // `??=` is the defect. It reads as a courtesy and means "use the ambient
    // value if there is one", which is the opposite of what the file says.
    const deferred = setup
      .split('\n')
      .filter((line) => line.includes('??='))
      .filter((line) => !line.trimStart().startsWith('*'))

    expect(
      deferred,
      'setup.ts defers to the ambient environment. A developer with these exported in ' +
        'their profile gets a different suite from everybody else, and no hint as to why.',
    ).toEqual([])
  })

  it('sets the ones a test could otherwise be wrong about', () => {
    for (const name of [
      'DATABASE_URL',
      'APP_URL',
      'PRODUCTION_APP_URL',
      'ENCRYPTION_KEY',
      'AUTH_SECRET',
      'OWNER_EMAILS',
      'OPERATOR_EMAILS',
    ]) {
      expect(setup, name).toContain(`process.env.${name} = `)
    }
  })

  it('and the values that are actually in force are the fakes', () => {
    // The control on the rule above: a source-level check that the assignments
    // are written is satisfied by a file that is never loaded.
    expect(process.env.APP_URL).toBe('https://spv.flipit.com')
    expect(process.env.PRODUCTION_APP_URL).toBe('https://spv.flipit.com')
    expect(process.env.NODE_ENV).toBe('test')
  })

  it('points the database at a name that does not exist', () => {
    /*
     * The one that matters most. Under `??=`, a developer with their real
     * connection string exported ran the unit suite against their real
     * database. Nothing in this suite should reach a database at all, and this
     * is what makes anything that tries fail loudly rather than quietly
     * succeeding against live rows.
     */
    expect(process.env.DATABASE_URL).toContain('spv_test')
    expect(process.env.DATABASE_URL).not.toBe(process.env.npm_config_database_url)
  })
})
