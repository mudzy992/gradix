import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSummary, getCreatedTasks, getClosedTimers, getProjects, getPresence, getDocumentAlerts, getTaskAlerts, getActivity } from './api-dashboard'

const call = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ api: call }))
beforeEach(() => { call.mockReset(); call.mockResolvedValue({ data: [], meta: { limit: 2, nextCursor: 'next' } }) })
describe('dashboard API', () => {
  it('uses separate bounded, client-neutral endpoints and preserves cursor metadata', async () => {
    await getSummary()
    await getCreatedTasks({ limit: 7, cursor: '2025-01-08' })
    await getClosedTimers({ limit: 7 })
    const projects = await getProjects({ limit: 2, cursor: 'p' })
    await getPresence({ limit: 2, cursor: 'u' })
    await getDocumentAlerts({ limit: 2, cursor: 'd' })
    await getTaskAlerts({ limit: 2, cursor: 't' })
    await getActivity({ limit: 2, cursor: 'a' })
    expect(projects.meta?.nextCursor).toBe('next')
    expect(call.mock.calls).toEqual([
      ['/api/analytics/summary'],
      ['/api/analytics/tasks/created', { query: { limit: 7, cursor: '2025-01-08' } }],
      ['/api/analytics/timers/closed', { query: { limit: 7 } }],
      ['/api/dashboard/projects', { query: { limit: 2, cursor: 'p' } }],
      ['/api/presence/people', { query: { limit: 2, cursor: 'u' } }],
      ['/api/alerts/documents', { query: { limit: 2, cursor: 'd' } }],
      ['/api/alerts/tasks', { query: { limit: 2, cursor: 't' } }],
      ['/api/activity/events', { query: { limit: 2, cursor: 'a' } }],
    ])
  })
})
