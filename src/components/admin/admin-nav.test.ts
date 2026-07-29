import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const NAV = join(process.cwd(), 'src/components/admin/admin-nav.tsx')
const PEOPLE = join(process.cwd(), 'src/app/(admin)/recipients/page.tsx')
const PREFLIGHT = join(process.cwd(), 'src/app/(admin)/recipients/preflight-panel.tsx')
const RECORD = join(process.cwd(), 'src/app/(admin)/recipients/[offerId]/page.tsx')
const FOLLOW_UP = join(process.cwd(), 'src/app/(admin)/follow-up/page.tsx')

function source(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('job-based navigation', () => {
  it('has five direct destinations and keeps specialist routes grouped', () => {
    const nav = source(NAV)
    for (const label of ['Start', 'People', 'Message', 'Follow-up', 'More']) {
      expect(nav).toContain(`label: '${label}'`)
    }
    expect(nav.match(/label: '/g)).toHaveLength(5)
    expect(nav).toContain("matches: ['/recipients', '/import', '/investors', '/register', '/round']")
    expect(nav).toContain("matches: ['/follow-up', '/questions', '/updates', '/reminders']")
    expect(nav).toContain("role === 'VIEWER' ? '/admin/email-review' : '/templates'")
    expect(nav).not.toContain('<details')
  })
})

describe('the simplified People workflow', () => {
  it('gives an empty round only one useful next action', () => {
    const people = source(PEOPLE)
    const empty = people.slice(
      people.indexOf('if (context.rows.length === 0)'),
      people.indexOf('const summary ='),
    )
    expect(empty).toContain('Upload spreadsheet')
    expect(empty).not.toContain('<PreflightPanel')
    expect(empty).not.toContain('<StatCard')
  })

  it('keeps filters, totals and passed checks collapsed', () => {
    const people = source(PEOPLE)
    const preflight = source(PREFLIGHT)
    expect(people).toContain('More filters')
    expect(people).toContain('Round totals and connection details')
    expect(preflight).toContain('safety checks passed')
    expect(preflight).toContain("item.state !== 'PASS'")
  })

  it('discloses later financial controls only when the record reaches them', () => {
    const record = source(RECORD)
    expect(record).toContain("currentStage >= stageIndex('DOCUMENTS_ISSUED')")
    expect(record).toContain("currentStage >= stageIndex('COMMITMENT_AGREED')")
    expect(record).toContain("currentStage >= stageIndex('PAYMENT_INSTRUCTIONS_ISSUED')")
    expect(record).toContain("currentStage >= stageIndex('COMPLETED')")
    expect(record).toContain('Corrections and history')
  })
})

describe('Follow-up', () => {
  it('combines replies, follow-up, waiting and completed work', () => {
    const followUp = source(FOLLOW_UP)
    for (const title of ['Needs reply', 'Needs follow-up', 'Waiting', 'Completed']) {
      expect(followUp).toContain(`title="${title}"`)
    }
    expect(followUp).toContain('Advanced communication tools')
    expect(followUp).toContain("admin.role !== 'VIEWER'")
  })
})
