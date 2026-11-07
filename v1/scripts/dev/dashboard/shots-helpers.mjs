/** Synthetic empty-dashboard responses, used only by the screenshot browser route. */
export function emptyDashboardResponse(path) {
  const page = { success: true, data: [], meta: { limit: 20, nextCursor: null } }
  // Seven completed UTC days for the synthetic company, matching the real bucket contract.
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const days = Array.from({ length: 7 }, (_, index) => ({
    startAt: new Date(today.getTime() - (7 - index) * 86_400_000).toISOString(),
    endAt: new Date(today.getTime() - (6 - index) * 86_400_000).toISOString(),
  }))
  const responses = {
    '/api/analytics/summary': { success: true, data: { activeProjects: 0, openTasks: 0, openTimers: 0, projectsWithBudget: 0, knownPlannedBudget: null, currentSpend: '0.00', currency: 'BAM' } },
    '/api/analytics/tasks/created': { success: true, data: { timezone: 'UTC', limit: 7, nextCursor: null, current: 0, previous: 0, delta: 0, deltaPercent: null, series: days.map((day) => ({ ...day, count: 0 })) } },
    '/api/analytics/timers/closed': { success: true, data: { timezone: 'UTC', limit: 7, nextCursor: null, currentMinutes: '0', previousMinutes: '0', deltaMinutes: '0', deltaPercent: null, series: days.map((day) => ({ ...day, minutes: '0', workers: 0 })) } },
    '/api/dashboard/projects': { ...page, meta: { limit: 10, nextCursor: null } },
    '/api/presence/people': page,
    '/api/alerts/documents': page,
    '/api/alerts/tasks': page,
    '/api/activity/events': page,
  }
  return responses[path] ?? null
}
export function parseShotsConfig(env) {
  if (!env.E2E_LOGIN_EMAIL || !env.E2E_LOGIN_PASSWORD) throw new Error('E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD are required')
  const url = new URL(env.DASHBOARD_SHOTS_URL || 'http://127.0.0.1:5173')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('DASHBOARD_SHOTS_URL must be an http(s) origin without credentials')
  const mode = env.DASHBOARD_SHOTS_MODE || 'full'
  if (!['full', 'viewport'].includes(mode)) throw new Error('Invalid dashboard shots mode')
  const file = env.DASHBOARD_SHOTS_FILE || 'admin-light-viewport.png'
  if (!/^[a-zA-Z0-9_-]+\.png$/.test(file)) throw new Error('Invalid dashboard screenshot filename')
  return { url: url.origin, email: env.E2E_LOGIN_EMAIL, password: env.E2E_LOGIN_PASSWORD, baselineRevision: '0d3980a', mode, file }
}
