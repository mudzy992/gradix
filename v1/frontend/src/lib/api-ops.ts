import { api } from '@/lib/api-client'
import type {
  AssignmentRow,
  DashboardPayload,
  DiaryRow,
  DocumentRow,
  IncidentRow,
  PhaseRow,
  ProjectRow,
  QuantityRow,
  TaskRow,
  TimerMe,
} from '@/lib/ops-types'

export function getDashboard() {
  return api<DashboardPayload>('/api/dashboard')
}

export function listProjects(query: { page?: number; q?: string; status?: string; limit?: number }) {
  return api<ProjectRow[]>('/api/projects', { query })
}

export function getProject(id: string) {
  return api<ProjectRow>(`/api/projects/${id}`)
}

export function createProject(body: Record<string, unknown>) {
  return api<ProjectRow>('/api/projects', { method: 'POST', body })
}

export function patchProject(id: string, body: Record<string, unknown>) {
  return api<ProjectRow>(`/api/projects/${id}`, { method: 'PATCH', body })
}

export function patchProjectStatus(id: string, status: string) {
  return api<ProjectRow>(`/api/projects/${id}/status`, { method: 'PATCH', body: { status } })
}

export function patchProjectPublic(id: string, body: { isPublic: boolean; coverAssetId?: string }) {
  return api<ProjectRow>(`/api/projects/${id}/public`, { method: 'PATCH', body })
}

export function uploadPublicAsset(file: File, kind: 'LOGO' | 'COVER', projectId?: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('kind', kind)
  if (projectId) {
    formData.append('projectId', projectId)
  }
  return api<{ id: string; kind: string; mime: string }>('/api/public/assets', {
    method: 'POST',
    formData,
  })
}

export function listPhases(projectId: string) {
  return api<PhaseRow[]>(`/api/projects/${projectId}/phases`)
}

export function createPhase(projectId: string, body: Record<string, unknown>) {
  return api<PhaseRow>(`/api/projects/${projectId}/phases`, { method: 'POST', body })
}

export function listAssignments(projectId: string) {
  return api<AssignmentRow[]>(`/api/projects/${projectId}/assignments`)
}

export function createAssignment(projectId: string, body: { userId: string; role: string }) {
  return api<AssignmentRow>(`/api/projects/${projectId}/assignments`, { method: 'POST', body })
}

export function removeAssignment(projectId: string, userId: string) {
  return api<null>(`/api/projects/${projectId}/assignments/${userId}`, { method: 'DELETE' })
}

export function listDocuments(projectId: string) {
  return api<DocumentRow[]>(`/api/projects/${projectId}/documents`)
}

export function createDocument(projectId: string, body: { path: string; fileName: string; idempotencyKey?: string }) {
  return api<DocumentRow>(`/api/projects/${projectId}/documents`, { method: 'POST', body })
}

export function listQuantities(projectId: string) {
  return api<QuantityRow[]>(`/api/projects/${projectId}/quantities`)
}

export function createQuantity(projectId: string, body: Record<string, unknown>) {
  return api<QuantityRow>(`/api/projects/${projectId}/quantities`, { method: 'POST', body })
}

export function patchQuantity(projectId: string, id: string, body: Record<string, unknown>) {
  return api<QuantityRow>(`/api/projects/${projectId}/quantities/${id}`, { method: 'PATCH', body })
}

export function listPresence(projectId: string) {
  return api<{ userId: string; firstName: string; lastName: string; lastSeenAt: string }[]>(
    `/api/projects/${projectId}/presence`,
  )
}

export function listTasks(query: { page?: number; projectId?: string; status?: string; limit?: number }) {
  return api<TaskRow[]>('/api/tasks', { query })
}

export function getTask(id: string) {
  return api<TaskRow>(`/api/tasks/${id}`)
}

export function createTask(body: Record<string, unknown>) {
  return api<TaskRow>('/api/tasks', { method: 'POST', body })
}

export function completeTask(id: string) {
  return api<TaskRow>(`/api/tasks/${id}/complete`, { method: 'POST' })
}

export function getTimerMe() {
  return api<TimerMe>('/api/timer/me')
}

export function startTimer(body: { taskId: string; machineId?: string }) {
  return api<unknown>('/api/timer/start', { method: 'POST', body })
}

export function pauseTimer() {
  return api<unknown>('/api/timer/pause', { method: 'POST' })
}

export function resumeTimer() {
  return api<unknown>('/api/timer/resume', { method: 'POST' })
}

export function stopTimer() {
  return api<unknown>('/api/timer/stop', { method: 'POST' })
}

export function listDiary(query: { projectId?: string; from?: string; to?: string; page?: number; limit?: number }) {
  return api<DiaryRow[]>('/api/diary', { query })
}

export function createDiary(body: Record<string, unknown>) {
  return api<DiaryRow>('/api/diary', { method: 'POST', body })
}

export function patchDiary(id: string, body: Record<string, unknown>) {
  return api<DiaryRow>(`/api/diary/${id}`, { method: 'PATCH', body })
}

export function generateDiaryPdf(id: string) {
  return api<DiaryRow>(`/api/diary/${id}/pdf`, { method: 'POST' })
}

export function resolveDiaryConflict(body: Record<string, unknown>) {
  return api<DiaryRow>('/api/sync/resolve-conflict', { method: 'POST', body })
}

export function listIncidents(query: { page?: number; projectId?: string; status?: string; limit?: number }) {
  return api<IncidentRow[]>('/api/incidents', { query })
}

export function createIncident(body: Record<string, unknown>) {
  return api<IncidentRow>('/api/incidents', { method: 'POST', body })
}

export function patchIncident(id: string, status: 'ACK' | 'CLOSED') {
  return api<IncidentRow>(`/api/incidents/${id}`, { method: 'PATCH', body: { status } })
}
