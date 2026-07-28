import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HUMAN_STATUSES,
  STATUS_ICON,
  STATUS_TONE,
} from '@/components/admin/guided'

const START = join(process.cwd(), 'src/components/admin/guided-start.tsx')
const ONBOARDING = join(
  process.cwd(),
  'src/app/(admin)/admin/onboarding/page.tsx',
)

describe('the guided status language', () => {
  it('has one exported four-state vocabulary with a tone and visible icon for each state', () => {
    expect(HUMAN_STATUSES).toEqual([
      'Needs you',
      'Waiting',
      'Ready',
      'Complete',
    ])
    expect(Object.keys(STATUS_TONE)).toEqual(HUMAN_STATUSES)
    expect(Object.keys(STATUS_ICON)).toEqual(HUMAN_STATUSES)
    expect(new Set(Object.values(STATUS_ICON)).size).toBe(HUMAN_STATUSES.length)
  })

  it('keeps the Start screen on the shared status foundation', () => {
    const start = readFileSync(START, 'utf8')
    expect(start).toContain(
      "from '@/components/admin/guided'",
    )
    expect(start).not.toMatch(/type HumanStatus\s*=/)
    expect(start).not.toMatch(/const STATUS_(?:TONE|ICON)/)
    expect(start).not.toMatch(/function (?:Status|PathItem)\s*\(/)

    const literalStatuses = [
      ...start.matchAll(/status(?:\s*=\s*|\s*:\s*)['"]([^'"]+)['"]/g),
    ].map((match) => match[1])
    expect(literalStatuses.length).toBeGreaterThan(0)
    expect(
      literalStatuses.filter(
        (status) => !HUMAN_STATUSES.includes(status as (typeof HUMAN_STATUSES)[number]),
      ),
    ).toEqual([])
  })

  it('does not let the known legacy onboarding vocabulary grow before conversion', () => {
    const onboarding = readFileSync(ONBOARDING, 'utf8')
    const legacyLabels = [
      ...onboarding.matchAll(/label:\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1])
    const knownLegacyLabels = new Set(['Done', 'Now', 'Later'])

    expect(legacyLabels.length).toBeGreaterThan(0)
    expect(legacyLabels.filter((label) => !knownLegacyLabels.has(label))).toEqual([])
  })
})
