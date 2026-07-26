import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthReport } from '@/lib/health/report'
import type { Finding, Severity } from '@/lib/health/rules'
import { resetEnvCache } from '@/lib/env'

/**
 * `GET /api/health`. BUILD_SPEC §6.5, §15, §18.1.
 *
 * The reduction is tested in `src/lib/health/signal.test.ts`. What is left for
 * this file is the route: that it is off unless configured, that being off is
 * indistinguishable from not existing, that it opens no database connection
 * before the token is checked, and that it never acts on what it finds.
 *
 * The last is the same rule the health page has and matters more here, because
 * this is the surface a machine talks to and the obvious next step is a POST
 * that releases a stuck reminder without a person in the loop. That would put
 * an action behind a shared secret in a monitoring service's configuration,
 * which is the loosest credential in the deployment. Pinned by a source
 * assertion, because there is nothing to call.
 */

const ROUTE = join(process.cwd(), 'src/app/api/health/route.ts')

function code(): string {
  return readFileSync(ROUTE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const TOKEN = 'Q'.repeat(43)
const AT = new Date('2026-07-25T09:00:00.000Z')

const buildHealthReport = vi.hoisted(() => vi.fn())
vi.mock('@/lib/health/report', () => ({ buildHealthReport }))

function finding(severity: Severity, area: string): Finding {
  return {
    area,
    severity,
    headline: 'A reminder was taken and never sent',
    detail: 'Reminder 6f0a1c2d, claimed by a run that died, for serenedavid@gmail.com.',
    remedy: 'Release it from the reminder queue.',
  }
}

function reportOf(findings: Finding[]): HealthReport {
  const worst: Severity = findings.some((row) => row.severity === 'WRONG')
    ? 'WRONG'
    : findings.some((row) => row.severity === 'ATTENTION')
      ? 'ATTENTION'
      : 'OK'
  return { at: AT, findings, worst }
}

async function get(headers: Record<string, string> = {}) {
  const { GET } = await import('./route')
  const { NextRequest } = await import('next/server')
  return GET(new NextRequest('https://spv.flipit.com/api/health', { headers }))
}

let original: NodeJS.ProcessEnv

beforeEach(() => {
  original = { ...process.env }
  buildHealthReport.mockReset()
  buildHealthReport.mockResolvedValue(reportOf([finding('OK', 'Backups')]))
  process.env.HEALTH_TOKEN = TOKEN
  resetEnvCache()
})

afterEach(() => {
  process.env = original
  resetEnvCache()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Off unless configured
// ---------------------------------------------------------------------------

describe('a deployment that has not turned it on', () => {
  beforeEach(() => {
    delete process.env.HEALTH_TOKEN
    resetEnvCache()
  })

  it('answers 404 to a request with no token', async () => {
    expect((await get()).status).toBe(404)
  })

  it('answers 404 to a request carrying any token', async () => {
    expect((await get({ 'x-health-token': TOKEN })).status).toBe(404)
    expect((await get({ 'x-health-token': 'anything' })).status).toBe(404)
  })

  it('never looks at the system to answer', async () => {
    await get({ 'x-health-token': TOKEN })
    // Not merely cheaper. A scanner hitting this on an unconfigured deployment
    // must cost the same as one hitting an invented path, or the difference is
    // itself the answer.
    expect(buildHealthReport).not.toHaveBeenCalled()
  })
})

describe('a wrong token', () => {
  it('is refused', async () => {
    expect((await get({ 'x-health-token': 'R'.repeat(43) })).status).toBe(404)
  })

  it('is refused before anything is read', async () => {
    await get({ 'x-health-token': 'R'.repeat(43) })
    expect(buildHealthReport).not.toHaveBeenCalled()
  })

  it('is answered identically to a deployment with the endpoint switched off', async () => {
    const refused = await get({ 'x-health-token': 'R'.repeat(43) })

    delete process.env.HEALTH_TOKEN
    resetEnvCache()
    const absent = await get({ 'x-health-token': 'R'.repeat(43) })

    expect(refused.status).toBe(absent.status)
    expect(await refused.text()).toBe(await absent.text())
    expect(await refused.text()).toBe('')
  })

  it('is not told which header it should have used', async () => {
    const response = await get({ authorization: `Bearer ${TOKEN}` })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

describe('with the token', () => {
  it('answers 200 when nothing needs a person', async () => {
    const response = await get({ 'x-health-token': TOKEN })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      at: '2026-07-25T09:00:00.000Z',
      counts: { wrong: 0, attention: 0, ok: 1 },
      areas: [],
    })
  })

  it('answers 503 when something needs a person', async () => {
    buildHealthReport.mockResolvedValue(reportOf([finding('WRONG', 'Reminders')]))
    const response = await get({ 'x-health-token': TOKEN })
    expect(response.status).toBe(503)
    expect((await response.json()).status).toBe('wrong')
  })

  it('answers 503 and says so when the report could not be built', async () => {
    buildHealthReport.mockRejectedValue(new Error('connection to postgres://user:pw@host failed'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await get({ 'x-health-token': TOKEN })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'unavailable',
      at: null,
      counts: { wrong: 0, attention: 0, ok: 0 },
      areas: [],
    })

    // The one rule with no exception. A Postgres error carries the connection
    // string and a connection string carries a password.
    const logged = errors.mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain('postgres://')
    expect(logged).not.toContain('pw@host')
    expect(logged).toContain('could not be built')
  })

  it('carries no headline, detail, remedy, id or address', async () => {
    buildHealthReport.mockResolvedValue(reportOf([finding('WRONG', 'Reminders')]))
    const body = await (await get({ 'x-health-token': TOKEN })).text()

    expect(body).not.toContain('taken and never sent')
    expect(body).not.toContain('Release it')
    expect(body).not.toContain('6f0a1c2d')
    expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  })

  it('never echoes the token back', async () => {
    const response = await get({ 'x-health-token': TOKEN })
    const body = await response.text()
    expect(body).not.toContain(TOKEN)
    for (const [, value] of response.headers) expect(value).not.toContain(TOKEN)
  })

  it('refuses to be cached or indexed, including on the 404', async () => {
    const cases: Record<string, string>[] = [{ 'x-health-token': TOKEN }, {}]
    for (const headers of cases) {
      const response = await get(headers)
      expect(response.headers.get('cache-control')).toContain('no-store')
      expect(response.headers.get('x-robots-tag')).toContain('noindex')
    }
  })
})

// ---------------------------------------------------------------------------
// It reports and never acts
// ---------------------------------------------------------------------------

describe('it reports and never acts', () => {
  it('has no handler other than GET', async () => {
    const handlers = Object.keys(await import('./route')).filter((name) =>
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(name),
    )
    expect(handlers).toEqual(['GET'])
  })

  it('imports nothing that writes', () => {
    const body = code()
    expect(body).not.toContain('@/lib/audit')
    expect(body).not.toContain('@/db')
    expect(body).not.toContain("'use server'")
  })

  it('is worked out on every request rather than cached', () => {
    const body = code()
    expect(body).toContain("export const dynamic = 'force-dynamic'")
    expect(body).toContain('export const revalidate = 0')
  })

  it('checks the token before it reads anything, in the source as well as in behaviour', () => {
    const body = code()
    const guardAt = body.indexOf('healthTokenAccepted')
    const reportAt = body.indexOf('buildHealthReport(')
    expect(guardAt).toBeGreaterThan(-1)
    expect(reportAt).toBeGreaterThan(guardAt)
  })
})
