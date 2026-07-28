import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  coarsePagePath,
  retentionCutoff,
  USABILITY_RETENTION_DAYS,
} from './index'

const root = process.cwd()
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), 'utf8')

describe('short-lived usability signals', () => {
  it('keeps exactly seven days', () => {
    const now = new Date('2026-07-28T12:00:00.000Z')
    expect(USABILITY_RETENTION_DAYS).toBe(7)
    expect(retentionCutoff(now).toISOString()).toBe('2026-07-21T12:00:00.000Z')
  })

  it('removes query strings and dynamic record identifiers from stored paths', () => {
    expect(coarsePagePath('/admin/email-review?section=legal')).toBe(
      '/admin/email-review',
    )
    expect(
      coarsePagePath(
        '/recipients/01K1B8R8C6MJ72V4W7ZXQ2R0GC/document/secret-record-id',
      ),
    ).toBe('/recipients/:item/document/:item')
  })

  it('has no field capable of receiving text, click targets or replay data', () => {
    const route = read('src/app/api/usability/route.ts')
    const migration = read('drizzle/0016_red_darwin.sql')
    const tracker = read('src/components/usability-tracker.tsx')
    const forbidden = [
      'inputValue',
      'typedText',
      'questionText',
      'documentText',
      'targetLabel',
      'coordinates',
      'screenReplay',
      'innerText',
      'textContent',
    ]

    for (const name of forbidden) {
      expect(route).not.toContain(`${name}:`)
      expect(tracker).not.toContain(`${name}:`)
      expect(migration.toLowerCase()).not.toContain(
        name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      )
    }
    expect(route).toContain('.strict()')
    expect(route).toContain("identity.email.toLowerCase() !== DAVID_EMAIL")
  })

  it('prunes on every write and has a separate scheduled pruning command', () => {
    const store = read('src/lib/usability/index.ts')
    const script = read('scripts/prune-usability.ts')
    const packageJson = read('package.json')

    expect(store).toContain('.delete(usabilityEvents)')
    expect(store).toContain('retentionCutoff(now)')
    expect(script).toContain('pruneUsabilityEvents()')
    expect(packageJson).toContain('"usability:prune"')
  })
})
