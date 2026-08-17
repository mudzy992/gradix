import { api, apiBlob } from '@/lib/api-client'

export type TenderRow = {
  id: string
  title: string
  client: string
  submittedValue: string | null
  status: string
  convertedProjectId: string | null
  comparison: string | null
  attachments: { id: string; path: string; fileName: string }[]
}

export type ServiceRow = {
  id: string
  machineId: string
  projectId: string | null
  status: string
  totalCost: string | null
  note: string | null
}

export type TemplateRow = {
  id: string
  machineType: string
  intervalHours: number
  title: string
}

export type ComplianceDoc = {
  id: string
  type: string
  filePath: string
  expiresAt: string | null
  note: string | null
  userId: string | null
  machineId: string | null
}

export type ReportTable = {
  slug: string
  from: string
  to: string
  columns: string[]
  rows: Record<string, string | number | null>[]
}

export function listTenders(query: { limit?: number; status?: string } = {}) {
  return api<TenderRow[]>('/api/tenders', { query })
}

export function createTender(body: Record<string, unknown>) {
  return api<TenderRow>('/api/tenders', { method: 'POST', body })
}

export function patchTender(id: string, body: Record<string, unknown>) {
  return api<TenderRow>(`/api/tenders/${id}`, { method: 'PATCH', body })
}

export function convertTender(id: string) {
  return api<TenderRow>(`/api/tenders/${id}/convert`, { method: 'POST' })
}

export function attachTender(id: string, body: { path: string; fileName: string }) {
  return api<TenderRow>(`/api/tenders/${id}/attachments`, { method: 'POST', body })
}

export function listServices(query: { limit?: number; machineId?: string } = {}) {
  return api<ServiceRow[]>('/api/services', { query })
}

export function createService(body: Record<string, unknown>) {
  return api<ServiceRow>('/api/services', { method: 'POST', body })
}

export function startService(id: string) {
  return api<ServiceRow>(`/api/services/${id}/start`, { method: 'POST' })
}

export function completeService(id: string, body: Record<string, unknown> = {}) {
  return api<ServiceRow>(`/api/services/${id}/complete`, { method: 'POST', body })
}

export function cancelService(id: string) {
  return api<ServiceRow>(`/api/services/${id}/cancel`, { method: 'POST' })
}

export function listTemplates() {
  return api<TemplateRow[]>('/api/service-templates', { query: { limit: 100 } })
}

export function createTemplate(body: Record<string, unknown>) {
  return api<TemplateRow>('/api/service-templates', { method: 'POST', body })
}

export function listDocs(kind: 'company' | 'worker' | 'machine') {
  return api<ComplianceDoc[]>(`/api/documents/${kind}`, { query: { limit: 100 } })
}

export function createDoc(kind: 'company' | 'worker' | 'machine', body: Record<string, unknown>) {
  return api<ComplianceDoc>(`/api/documents/${kind}`, { method: 'POST', body })
}

export function getReport(slug: string, query: { from?: string; to?: string; projectId?: string }) {
  return api<ReportTable>(`/api/reports/${slug}`, { query })
}

export function exportReport(slug: string, query: { from?: string; to?: string; projectId?: string }) {
  return apiBlob(`/api/reports/${slug}/export`, query)
}
