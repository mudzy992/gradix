import { api } from '@/lib/api-client'
import type { CursorMeta } from '@/lib/api-types'

type PageQuery = { limit?: number; cursor?: string }
export type DashboardSummary = { activeProjects: number; openTasks: number; openTimers: number; projectsWithBudget: number; knownPlannedBudget: string | null; currentSpend: string; currency: string | null }
export type TaskMetrics = { timezone: string; limit: number; nextCursor: string | null; current: number; previous: number; delta: number; deltaPercent: number | null; series: Array<{ startAt: string; endAt: string; count: number }> }
export type TimerMetrics = { timezone: string; limit: number; nextCursor: string | null; currentMinutes: string; previousMinutes: string; deltaMinutes: string; deltaPercent: string | null; series: Array<{ startAt: string; endAt: string; minutes: string; workers: number }> }
export type DashboardProject = { id: string; name: string; status: string; plannedBudget: string | null; currentSpend: string; lat: string | null; lng: string | null; geofenceRadius: number }
export type PresencePerson = { userId: string; firstName: string; lastName: string; projectId: string; lastSeenAt: string }
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type DocumentAlert = { id: string; kind: 'COMPANY' | 'WORKER' | 'MACHINE'; type: string; expiresAt: string; daysUntilExpiry: number; severity: Severity }
export type TaskAlert = { id: string; projectId: string; title: string; status: string; plannedEnd: string; severity: Severity }
export type ActivityEvent = { id: string; action: string; entityType: string; entityId: string; actorId: string; createdAt: string }

export const getSummary = () => api<DashboardSummary>('/api/analytics/summary')
export const getCreatedTasks = (query: PageQuery) => api<TaskMetrics>('/api/analytics/tasks/created', { query })
export const getClosedTimers = (query: PageQuery) => api<TimerMetrics>('/api/analytics/timers/closed', { query })
export const getProjects = (query: PageQuery) => api<DashboardProject[], CursorMeta>('/api/dashboard/projects', { query })
export const getPresence = (query: PageQuery) => api<PresencePerson[], CursorMeta>('/api/presence/people', { query })
export const getDocumentAlerts = (query: PageQuery) => api<DocumentAlert[], CursorMeta>('/api/alerts/documents', { query })
export const getTaskAlerts = (query: PageQuery) => api<TaskAlert[], CursorMeta>('/api/alerts/tasks', { query })
export const getActivity = (query: PageQuery) => api<ActivityEvent[], CursorMeta>('/api/activity/events', { query })
