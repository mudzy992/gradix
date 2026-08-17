import { api, apiBlob } from '@/lib/api-client'

export type PayrollSession = {
  id: string
  userId: string
  userName: string
  projectId: string
  projectName: string
  taskId: string
  taskTitle: string
  startedAt: string
  closedAt: string | null
  durationMinutes: number
  hourlyRate: string | null
  amount: string
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
}

export type PayrollSummary = {
  from: string
  to: string
  tz: string
  approvedMinutes: number
  approvedAmount: string
  pendingMinutes: number
  pendingCount: number
  rejectedCount: number
}

export type PayrollQuery = {
  year?: number
  month?: number
  from?: string
  to?: string
  status?: string
  page?: number
  limit?: number
}

export function listPayrollSessions(query: PayrollQuery = {}) {
  return api<PayrollSession[]>('/api/payroll/sessions', { query })
}

export function getPayrollSummary(query: PayrollQuery = {}) {
  return api<PayrollSummary>('/api/payroll/summary', { query })
}

export function exportPayroll(query: PayrollQuery = {}) {
  return apiBlob('/api/payroll/export', query)
}

export function approvePayrollSession(id: string) {
  return api<PayrollSession>(`/api/payroll/sessions/${id}/approve`, { method: 'POST' })
}

export function rejectPayrollSession(id: string, reason?: string) {
  return api<PayrollSession>(`/api/payroll/sessions/${id}/reject`, {
    method: 'POST',
    body: reason ? { reason } : {},
  })
}
