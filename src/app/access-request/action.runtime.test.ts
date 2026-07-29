import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  record: vi.fn(),
  clientIp: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({ audit: mocks.audit }))
vi.mock('@/lib/access-requests/store', () => ({
  recordAccessRequest: mocks.record,
}))
vi.mock('@/actions/client-ip', () => ({ clientIp: mocks.clientIp }))

import { MINIMUM_VALID_SUBMISSION_MS } from '@/lib/access-requests/policy'
import { submitAccessRequestAction } from './action'

function form(): FormData {
  const value = new FormData()
  value.set('firstName', 'Test')
  value.set('lastName', 'Person')
  value.set('email', 'person@example.invalid')
  value.set('phone', '+1 202 555 0100')
  return value
}

async function settlesAtTheFloor(changed: boolean): Promise<void> {
  mocks.record.mockResolvedValue({
    changed,
    created: changed,
    id: changed ? 'request-1' : null,
    editCapability: changed ? 'capability' : null,
  })
  mocks.audit.mockImplementation(
    () => new Promise((resolve) => setTimeout(resolve, 120)),
  )

  let settled = false
  const pending = submitAccessRequestAction({ status: 'idle' }, form()).then(
    (result) => {
      settled = true
      return result
    },
  )

  await vi.advanceTimersByTimeAsync(MINIMUM_VALID_SUBMISSION_MS - 1)
  expect(settled).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await expect(pending).resolves.toMatchObject({ status: 'ok' })
}

describe('public access-request response timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T03:00:00Z'))
    vi.clearAllMocks()
    mocks.clientIp.mockResolvedValue('203.0.113.42')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pads a new request including its conditional audit write', async () => {
    await settlesAtTheFloor(true)
    expect(mocks.audit).toHaveBeenCalledOnce()
  })

  it('pads a duplicate or throttled request to the same floor', async () => {
    await settlesAtTheFloor(false)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
