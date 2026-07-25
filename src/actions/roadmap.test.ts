import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditInput } from '@/lib/audit'
import type { AdminIdentity } from '@/lib/auth/guards'

/**
 * "Coming to your portal", the owner's half of it. BUILD_SPEC §13.1, §22 AC30:
 * *"configurable by the owner: tiles can be added, renamed, hidden, or switched
 * from 'in development' to live as features ship."*
 *
 * `lib/portal/roadmap.test.ts` already checks the wording rules against the pure
 * helper. This file checks the things that only become true once the surface
 * exists: that the rules sit on the *write* path rather than beside it, that the
 * write path is the owner's alone, and that neither of the two things §13.1
 * fixes — the standing line, and the row an investor has already seen — can be
 * edited or removed from here.
 *
 * The interesting failure mode is not "the rule is wrong". It is "somebody added
 * an action and forgot to call the rule", so the actions are enumerated from the
 * module's own exports and a new one is tested the moment it is written.
 */

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

const currentAdmin = vi.fn<() => Promise<AdminIdentity | null>>()
const requireOwner = vi.fn<() => Promise<AdminIdentity>>()
const auditSpy = vi.fn<(input: AuditInput) => void>()

/** Every row the fake database would return, in portal order. */
const tileRows = [
  { id: 'tile-a', label: 'Holdings & documents', sortOrder: 0, isLive: false, hidden: false },
  { id: 'tile-b', label: 'Company updates', sortOrder: 1, isLive: false, hidden: false },
  { id: 'tile-c', label: 'Reporting', sortOrder: 2, isLive: true, hidden: false },
]

const dbInsert = vi.fn<(values: Record<string, unknown>) => void>()
const dbUpdate = vi.fn<(values: Record<string, unknown>) => void>()

const createTileSpy = vi.fn<(input: Record<string, unknown>) => void>()
const renameTileSpy = vi.fn<(input: Record<string, unknown>) => void>()
const setTileHiddenSpy = vi.fn<(input: Record<string, unknown>) => void>()
const setTileLiveSpy = vi.fn<(input: Record<string, unknown>) => void>()
const moveTileSpy = vi.fn<(input: Record<string, unknown>) => void>()

vi.mock('@/lib/auth/guards', () => ({
  currentAdmin: () => currentAdmin(),
  requireOwner: () => requireOwner(),
}))

vi.mock('@/lib/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit')>()
  return {
    ...actual,
    audit: (input: AuditInput) => {
      // The real helper refuses secrets and message bodies. Keep that running
      // so a careless metadata key fails here rather than in production.
      actual.assertNoSecrets(input.metadata)
      auditSpy(input)
      return Promise.resolve()
    },
  }
})

/** A chainable stub, in the shape the service calls it. No Postgres. */
vi.mock('@/db', () => {
  interface SelectChain {
    from: () => SelectChain
    where: () => SelectChain
    orderBy: () => SelectChain
    then: (resolve: (rows: typeof tileRows) => unknown) => Promise<unknown>
  }

  const select = (): SelectChain => {
    const chain: SelectChain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      then: (resolve) => Promise.resolve(tileRows).then(resolve),
    }
    return chain
  }

  return {
    db: {
      select,
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          dbInsert(values)
          return { returning: () => Promise.resolve([{ id: 'tile-new' }]) }
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          dbUpdate(values)
          return { where: () => Promise.resolve() }
        },
      }),
      // `moveTile` rewrites the whole sequence in one transaction, so a
      // half-applied reorder cannot leave two tiles claiming one position.
      transaction: (run: (tx: unknown) => Promise<unknown>) =>
        run({
          update: () => ({
            set: (values: Record<string, unknown>) => {
              dbUpdate(values)
              return { where: () => Promise.resolve() }
            },
          }),
        }),
    },
  }
})

/**
 * The service is spied on but not replaced: §13.1's word gate lives inside
 * `createTile`, so a stub would be testing the gate out of the path it guards.
 */
vi.mock('@/lib/portal/roadmap-tiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/roadmap-tiles')>()
  return {
    ...actual,
    createTile: (input: Parameters<typeof actual.createTile>[0]) => {
      createTileSpy(input)
      return actual.createTile(input)
    },
    renameTile: (input: Parameters<typeof actual.renameTile>[0]) => {
      renameTileSpy(input)
      return actual.renameTile(input)
    },
    setTileHidden: (input: Parameters<typeof actual.setTileHidden>[0]) => {
      setTileHiddenSpy(input)
      return actual.setTileHidden(input)
    },
    setTileLive: (input: Parameters<typeof actual.setTileLive>[0]) => {
      setTileLiveSpy(input)
      return actual.setTileLive(input)
    },
    moveTile: (input: Parameters<typeof actual.moveTile>[0]) => {
      moveTileSpy(input)
      return actual.moveTile(input)
    },
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER: AdminIdentity = {
  id: 'user-owner',
  email: 'mike@flipit.com',
  name: 'Michael Helm',
  role: 'OWNER',
}

const OPERATOR: AdminIdentity = {
  id: 'user-operator',
  email: 'serenedavid@gmail.com',
  name: 'David Serene',
  role: 'OPERATOR',
}

const SUGGESTED_LABELS = [
  'Holdings & documents',
  'Company updates',
  'Direct line to David',
  'Reporting',
]

async function actions() {
  return import('./roadmap')
}

async function service() {
  return import('@/lib/portal/roadmap-tiles')
}

/** One form carrying every field any action reads, so a new one is covered too. */
function everyField(): FormData {
  const form = new FormData()
  form.set('label', 'Holdings & documents')
  form.set('tileId', 'tile-a')
  form.set('hidden', 'true')
  form.set('isLive', 'true')
  form.set('direction', 'up')
  return form
}

/**
 * Every exported action, read off the module rather than listed here. An action
 * added tomorrow is refused-checked tomorrow, without anyone remembering to.
 */
async function everyExportedAction() {
  const mod = await actions()

  return Object.entries(mod)
    .filter(([, value]) => typeof value === 'function')
    .map(([name, value]) => ({
      name,
      run: () => (value as (previous: unknown, form: FormData) => Promise<unknown>)(
        { status: 'idle' },
        everyField(),
      ),
    }))
}

function noWrites(context: string) {
  expect(dbInsert, `${context} inserted a row`).not.toHaveBeenCalled()
  expect(dbUpdate, `${context} updated a row`).not.toHaveBeenCalled()
  expect(createTileSpy, `${context} reached createTile`).not.toHaveBeenCalled()
  expect(renameTileSpy, `${context} reached renameTile`).not.toHaveBeenCalled()
  expect(setTileHiddenSpy, `${context} reached setTileHidden`).not.toHaveBeenCalled()
  expect(setTileLiveSpy, `${context} reached setTileLive`).not.toHaveBeenCalled()
  expect(moveTileSpy, `${context} reached moveTile`).not.toHaveBeenCalled()
}

const ACTIONS_SOURCE = join(process.cwd(), 'src/actions/roadmap.ts')
const SERVICE_SOURCE = join(process.cwd(), 'src/lib/portal/roadmap-tiles.ts')
const PAGE_SOURCE = join(process.cwd(), 'src/app/(admin)/admin/roadmap/page.tsx')

/** Comments explain what the code avoids; they must not trip the check for it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function bothModules(): Array<{ name: string; code: string }> {
  return [
    { name: 'actions/roadmap.ts', code: withoutComments(readFileSync(ACTIONS_SOURCE, 'utf8')) },
    { name: 'portal/roadmap-tiles.ts', code: withoutComments(readFileSync(SERVICE_SOURCE, 'utf8')) },
  ]
}

beforeEach(() => {
  currentAdmin.mockReset()
  requireOwner.mockReset()
  auditSpy.mockReset()
  dbInsert.mockReset()
  dbUpdate.mockReset()
  createTileSpy.mockReset()
  renameTileSpy.mockReset()
  setTileHiddenSpy.mockReset()
  setTileLiveSpy.mockReset()
  moveTileSpy.mockReset()
  requireOwner.mockResolvedValue(OWNER)
})

// ---------------------------------------------------------------------------

describe('the portal roadmap is the owner’s to edit (§13.1, §22 AC30)', () => {
  it('refuses an operator on every exported action, and writes nothing', async () => {
    currentAdmin.mockResolvedValue(OPERATOR)

    const everyAction = await everyExportedAction()
    expect(everyAction.length).toBeGreaterThan(0)

    for (const action of everyAction) {
      const result = await action.run()

      expect(result, `${action.name} should be refused`).toMatchObject({ status: 'error' })
      const { message } = result as { message: string }
      expect(message).toMatch(/owner/i)
      expect(message).not.toMatch(/something went wrong/i)
      noWrites(action.name)
    }
  })

  it('refuses a signed-out caller on every exported action, and writes nothing', async () => {
    currentAdmin.mockResolvedValue(null)

    for (const action of await everyExportedAction()) {
      const result = await action.run()

      expect(result, `${action.name} should be refused`).toMatchObject({ status: 'error' })
      expect((result as { message: string }).message).toMatch(/not signed in/i)
      noWrites(action.name)
    }
  })

  it('never reaches requireOwner for anyone but the owner', async () => {
    for (const admin of [OPERATOR, null]) {
      currentAdmin.mockResolvedValue(admin)
      for (const action of await everyExportedAction()) await action.run()
    }

    expect(requireOwner).not.toHaveBeenCalled()
  })

  it('logs every refused attempt, naming the attempted action and the role (§22 AC30)', async () => {
    currentAdmin.mockResolvedValue(OPERATOR)

    for (const action of await everyExportedAction()) {
      auditSpy.mockClear()
      await action.run()

      expect(auditSpy, `${action.name} should be audited`).toHaveBeenCalledTimes(1)
      const entry = auditSpy.mock.calls[0][0]

      expect(entry.action).toBe('roadmap_tile.refused')
      expect(entry.entityType).toBe('roadmap_tile')
      expect(entry.actor).toEqual({ kind: 'user', id: OPERATOR.id, label: OPERATOR.email })
      // The key names are `actions/compliance.ts`'s, so one audit query finds
      // every refused privileged action rather than one per module.
      expect(entry.metadata).toMatchObject({
        actorRole: 'OPERATOR',
        requiredRole: 'OWNER',
        refusalReason: 'NOT_OWNER',
      })

      // The attempted action is named, not merely counted.
      const attempted = (entry.metadata ?? {}).attemptedAction
      expect(attempted, `${action.name} should name what was attempted`).toBeTypeOf('string')
      expect(String(attempted).length).toBeGreaterThan(0)
    }
  })

  it('logs a signed-out attempt as the unauthenticated system actor', async () => {
    currentAdmin.mockResolvedValue(null)

    for (const action of await everyExportedAction()) {
      auditSpy.mockClear()
      await action.run()

      expect(auditSpy).toHaveBeenCalledTimes(1)
      expect(auditSpy.mock.calls[0][0].actor).toEqual({
        kind: 'system',
        label: 'unauthenticated',
      })
      expect(auditSpy.mock.calls[0][0].metadata).toMatchObject({
        actorRole: null,
        requiredRole: 'OWNER',
        refusalReason: 'NOT_SIGNED_IN',
      })
    }
  })

  it('records nothing about a refusal that could be a credential or a body', async () => {
    currentAdmin.mockResolvedValue(OPERATOR)
    const mod = await actions()
    await mod.createTileAction({ status: 'idle' }, everyField())

    // assertNoSecrets already ran inside the audit mock; this is the explicit
    // form, and it names the two keys §15 cares about most.
    const keys = Object.keys(auditSpy.mock.calls[0][0].metadata ?? {})
    expect(keys).not.toContain('token')
    expect(keys).not.toContain('body')
  })

  it('exports the five mutations §13.1 asks for and nothing else', async () => {
    const names = Object.keys(await actions())

    expect(names).toEqual(
      expect.arrayContaining([
        'createTileAction',
        'renameTileAction',
        'setTileHiddenAction',
        'setTileLiveAction',
        'moveTileAction',
      ]),
    )
    // If someone adds one — a delete, most of all — this fails and they have to
    // justify it here.
    expect(names).toHaveLength(5)
  })
})

describe('the owner is let through to the service (§13.1)', () => {
  beforeEach(() => {
    currentAdmin.mockResolvedValue(OWNER)
  })

  const actor = { kind: 'user', id: OWNER.id, label: OWNER.email }

  it('hands each action the form values it was given', async () => {
    const mod = await actions()

    const createForm = new FormData()
    createForm.set('label', 'Direct line to David')
    await expect(mod.createTileAction({ status: 'idle' }, createForm)).resolves.toMatchObject({
      status: 'ok',
    })
    expect(createTileSpy).toHaveBeenCalledWith({ actor, label: 'Direct line to David' })

    const renameForm = new FormData()
    renameForm.set('tileId', 'tile-b')
    renameForm.set('label', 'Company updates')
    await expect(mod.renameTileAction({ status: 'idle' }, renameForm)).resolves.toMatchObject({
      status: 'ok',
    })
    expect(renameTileSpy).toHaveBeenCalledWith({
      actor,
      tileId: 'tile-b',
      label: 'Company updates',
    })

    const hideForm = new FormData()
    hideForm.set('tileId', 'tile-c')
    hideForm.set('hidden', 'true')
    await expect(mod.setTileHiddenAction({ status: 'idle' }, hideForm)).resolves.toMatchObject({
      status: 'ok',
    })
    expect(setTileHiddenSpy).toHaveBeenCalledWith({ actor, tileId: 'tile-c', hidden: true })

    const liveForm = new FormData()
    liveForm.set('tileId', 'tile-a')
    liveForm.set('isLive', 'true')
    await expect(mod.setTileLiveAction({ status: 'idle' }, liveForm)).resolves.toMatchObject({
      status: 'ok',
    })
    expect(setTileLiveSpy).toHaveBeenCalledWith({ actor, tileId: 'tile-a', isLive: true })

    const moveForm = new FormData()
    moveForm.set('tileId', 'tile-b')
    moveForm.set('direction', 'up')
    await expect(mod.moveTileAction({ status: 'idle' }, moveForm)).resolves.toMatchObject({
      status: 'ok',
    })
    expect(moveTileSpy).toHaveBeenCalledWith({ actor, tileId: 'tile-b', direction: 'up' })
  })

  it('adds a tile in development rather than live', async () => {
    const mod = await actions()
    const form = new FormData()
    form.set('label', 'Reporting')

    await mod.createTileAction({ status: 'idle' }, form)

    expect(dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Reporting', isLive: false }),
    )
  })
})

describe('a label is refused on the way in, out loud (§13.1, §22 AC30)', () => {
  /** Each case, and the word the owner must be told about by name. */
  const forbidden = [
    { label: 'Reporting — coming soon', named: 'soon' },
    { label: 'Your returns', named: 'returns' },
    { label: 'Documents Q3', named: 'q3' },
    { label: 'Live in 2027', named: 'a year' },
  ]

  it('names the word it will not take, rather than calling the label invalid', async () => {
    const { checkTileLabel } = await service()

    for (const testCase of forbidden) {
      const verdict = checkTileLabel(testCase.label)

      expect(verdict.ok, testCase.label).toBe(false)
      if (verdict.ok) continue
      expect(verdict.message, testCase.label).toContain(testCase.named)
      expect(verdict.message).not.toMatch(/invalid/i)
      expect(verdict.message).not.toMatch(/something went wrong/i)
    }
  })

  it('refuses an empty label and one too long to be a name', async () => {
    const { checkTileLabel, MAX_TILE_LABEL_LENGTH } = await service()

    for (const empty of ['', '   ']) {
      const verdict = checkTileLabel(empty)
      expect(verdict.ok).toBe(false)
      if (verdict.ok) continue
      expect(verdict.message).toMatch(/needs a label/i)
      expect(verdict.message).not.toMatch(/invalid/i)
    }

    const tooLong = 'a'.repeat(MAX_TILE_LABEL_LENGTH + 1)
    const verdict = checkTileLabel(tooLong)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.message).toContain(String(MAX_TILE_LABEL_LENGTH))
    expect(verdict.message).not.toMatch(/invalid/i)

    // The boundary itself is allowed: the rule is a length, not a scare.
    expect(checkTileLabel('a'.repeat(MAX_TILE_LABEL_LENGTH)).ok).toBe(true)
  })

  it('refuses the same labels through createTileAction, and writes nothing', async () => {
    currentAdmin.mockResolvedValue(OWNER)
    const mod = await actions()
    const { MAX_TILE_LABEL_LENGTH } = await service()

    const cases = [
      ...forbidden,
      { label: '', named: 'needs a label' },
      { label: 'a'.repeat(MAX_TILE_LABEL_LENGTH + 1), named: String(MAX_TILE_LABEL_LENGTH) },
    ]

    for (const testCase of cases) {
      dbInsert.mockClear()
      const form = new FormData()
      form.set('label', testCase.label)

      const result = await mod.createTileAction({ status: 'idle' }, form)

      expect(result.status, testCase.label || '(empty)').toBe('error')
      if (result.status !== 'error') continue
      expect(result.message).toContain(testCase.named)
      expect(result.message).not.toMatch(/invalid/i)
      // The reason is put on the field too, so the owner reads it where they typed.
      expect(result.fieldErrors?.label).toContain(testCase.named)
      expect(dbInsert, `${testCase.label} was written anyway`).not.toHaveBeenCalled()
    }
  })

  it('refuses the same labels through renameTileAction, and writes nothing', async () => {
    currentAdmin.mockResolvedValue(OWNER)
    const mod = await actions()

    for (const testCase of forbidden) {
      dbUpdate.mockClear()
      const form = new FormData()
      form.set('tileId', 'tile-a')
      form.set('label', testCase.label)

      const result = await mod.renameTileAction({ status: 'idle' }, form)

      expect(result.status, testCase.label).toBe('error')
      if (result.status !== 'error') continue
      expect(result.message).toContain(testCase.named)
      expect(result.message).not.toMatch(/invalid/i)
      expect(result.fieldErrors?.label).toContain(testCase.named)
      expect(dbUpdate, `${testCase.label} was written anyway`).not.toHaveBeenCalled()
    }
  })

  it('accepts the four labels §13.1 suggests, through the write path', async () => {
    currentAdmin.mockResolvedValue(OWNER)
    const mod = await actions()
    const { checkTileLabel } = await service()

    for (const label of SUGGESTED_LABELS) {
      dbInsert.mockClear()
      expect(checkTileLabel(label).ok, label).toBe(true)

      const form = new FormData()
      form.set('label', label)

      expect((await mod.createTileAction({ status: 'idle' }, form)).status, label).toBe('ok')
      expect(dbInsert).toHaveBeenCalledWith(expect.objectContaining({ label }))
    }
  })
})

describe('the order is worked out as a whole, not swapped in place (§13.1)', () => {
  const ids = ['tile-a', 'tile-b', 'tile-c']

  it('moves a tile up and down', async () => {
    const { reorderIds } = await service()

    expect(reorderIds(ids, 'tile-b', 'up')).toEqual(['tile-b', 'tile-a', 'tile-c'])
    expect(reorderIds(ids, 'tile-b', 'down')).toEqual(['tile-a', 'tile-c', 'tile-b'])
    expect(reorderIds(ids, 'tile-c', 'up')).toEqual(['tile-a', 'tile-c', 'tile-b'])
  })

  it('does nothing at either end, or for an id it has never seen', async () => {
    const { reorderIds } = await service()

    expect(reorderIds(ids, 'tile-a', 'up')).toEqual(ids)
    expect(reorderIds(ids, 'tile-c', 'down')).toEqual(ids)
    expect(reorderIds(ids, 'tile-z', 'up')).toEqual(ids)
    expect(reorderIds(ids, 'tile-z', 'down')).toEqual(ids)
    expect(reorderIds([], 'tile-a', 'up')).toEqual([])
    expect(reorderIds(['only'], 'only', 'down')).toEqual(['only'])
  })

  it('never loses or duplicates an id, and leaves its input alone', async () => {
    const { reorderIds } = await service()

    for (const id of [...ids, 'tile-z']) {
      for (const direction of ['up', 'down'] as const) {
        const before = [...ids]
        const after = reorderIds(before, id, direction)

        expect([...after].sort(), `${id} ${direction}`).toEqual([...ids].sort())
        expect(new Set(after).size).toBe(after.length)
        expect(before, 'the input array was mutated').toEqual(ids)
      }
    }
  })
})

describe('a tile is hidden, never deleted (§13.1, §16)', () => {
  it('has no delete of a roadmap tile in either module', () => {
    for (const { name, code } of bothModules()) {
      expect(code, `${name} deletes a row`).not.toContain('.delete(roadmapTiles)')
      expect(code, `${name} deletes a row`).not.toMatch(/\.delete\s*\(/)
      expect(code, `${name} deletes a row`).not.toMatch(/DELETE\s+FROM/i)
    }
  })

  it('hides by setting a column, leaving the row and its trail behind', async () => {
    currentAdmin.mockResolvedValue(OWNER)
    const mod = await actions()

    const form = new FormData()
    form.set('tileId', 'tile-a')
    form.set('hidden', 'true')

    const result = await mod.setTileHiddenAction({ status: 'idle' }, form)

    expect(result.status).toBe('ok')
    expect(dbUpdate).toHaveBeenCalledWith({ hidden: true })
  })
})

describe('the standing line is not editable here (§13.1)', () => {
  it('is neither written nor accepted by the action or the service', () => {
    for (const { name, code } of bothModules()) {
      expect(code, `${name} touches the standing line`).not.toContain('ROADMAP_DISCLAIMER')
      expect(code, `${name} takes a disclaimer`).not.toMatch(/disclaimer/i)
    }

    // Drizzle writes a column only through `.set({ … })`; nothing but the four
    // configurable columns may appear in one.
    const service = withoutComments(readFileSync(SERVICE_SOURCE, 'utf8'))
    const setBlocks = service.match(/\.set\(\{[\s\S]*?\}\)/g) ?? []
    expect(setBlocks.length).toBeGreaterThan(0)
    for (const block of setBlocks) {
      expect(block).toMatch(/\b(label|hidden|isLive|sortOrder)\b/)
    }
  })

  it('is rendered on the owner screen from the constant, not retyped', () => {
    const page = readFileSync(PAGE_SOURCE, 'utf8')

    expect(page).toContain("import { ROADMAP_DISCLAIMER } from '@/lib/portal/roadmap'")
    expect(page).toContain('{ROADMAP_DISCLAIMER}')
    // A copy of the sentence in the markup is a second version to keep in step.
    expect(page).not.toContain('form no part of')
  })
})
