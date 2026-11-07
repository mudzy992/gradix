import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyDashboardResponse, parseShotsConfig } from './shots-helpers.mjs'

test('empty-company fixtures cover only dashboard reads and never invent comparisons', () => {
  const summary = emptyDashboardResponse('/api/analytics/summary')
  assert.equal(summary.data.activeProjects, 0)
  assert.equal(summary.data.knownPlannedBudget, null)
  assert.equal(emptyDashboardResponse('/api/analytics/tasks/created').data.deltaPercent, null)
  assert.equal(emptyDashboardResponse('/api/analytics/timers/closed').data.deltaPercent, null)
  assert.equal(emptyDashboardResponse('/api/analytics/tasks/created').data.series.length, 7)
  assert.ok(emptyDashboardResponse('/api/analytics/tasks/created').data.series.every((row) => row.count === 0))
  assert.ok(emptyDashboardResponse('/api/analytics/timers/closed').data.series.every((row) => row.minutes === '0'))
  for (const path of ['/api/dashboard/projects', '/api/presence/people', '/api/alerts/documents', '/api/alerts/tasks', '/api/activity/events']) {
    assert.deepEqual(emptyDashboardResponse(path).data, [])
    assert.equal(emptyDashboardResponse(path).meta.nextCursor, null)
  }
  assert.equal(emptyDashboardResponse('/api/me'), null)
})

test('shots require explicit credentials and accept only http(s) base URLs', () => {
  assert.throws(() => parseShotsConfig({}), /E2E_LOGIN_EMAIL/)
  assert.throws(() => parseShotsConfig({ E2E_LOGIN_EMAIL: 'a', E2E_LOGIN_PASSWORD: 'b', DASHBOARD_SHOTS_URL: 'file:///tmp/x' }), /http/)
  const config = parseShotsConfig({ E2E_LOGIN_EMAIL: 'a', E2E_LOGIN_PASSWORD: 'b' })
  assert.equal(config.url, 'http://127.0.0.1:5173')
  assert.equal(config.baselineRevision, '0d3980a')
})

test('viewport-only mode accepts a safe screenshot filename', () => {
  const base = { E2E_LOGIN_EMAIL: 'a', E2E_LOGIN_PASSWORD: 'b', DASHBOARD_SHOTS_MODE: 'viewport' }
  assert.equal(parseShotsConfig(base).mode, 'viewport')
  assert.equal(parseShotsConfig({ ...base, DASHBOARD_SHOTS_FILE: 'v2-with-rich-seed.png' }).file, 'v2-with-rich-seed.png')
  assert.throws(() => parseShotsConfig({ ...base, DASHBOARD_SHOTS_FILE: '../escape.png' }), /filename/)
  assert.throws(() => parseShotsConfig({ ...base, DASHBOARD_SHOTS_MODE: 'unknown' }), /mode/)
})
