import { api } from '@/lib/api-client'
import type { AppRole } from '@/lib/constants'
import type {
  AuthPayload,
  CompanyRow,
  ListUser,
  MeUser,
  NotificationRow,
  SettingRow,
} from '@/lib/api-types'

export function login(body: { email?: string; phone?: string; password: string }) {
  return api<AuthPayload>('/api/auth/login', { method: 'POST', body, skipRefresh: true })
}

export function logout(refreshToken: string) {
  return api<{ ok: true }>('/api/auth/logout', { method: 'POST', body: { refreshToken } })
}

export function logoutAll() {
  return api<{ ok: true }>('/api/auth/logout-all', { method: 'POST' })
}

export function changePassword(body: { currentPassword: string; newPassword: string }) {
  return api<{ ok: true }>('/api/auth/change-password', { method: 'POST', body })
}

export function forgotPassword(email: string) {
  return api<{ ok: true }>('/api/auth/forgot', { method: 'POST', body: { email }, skipRefresh: true })
}

export function resetPassword(body: { token: string; newPassword: string }) {
  return api<{ ok: true }>('/api/auth/reset', { method: 'POST', body, skipRefresh: true })
}

export function getMe() {
  return api<MeUser>('/api/me')
}

export function patchMe(body: { firstName?: string; lastName?: string; locale?: 'bs' | 'en' }) {
  return api<MeUser>('/api/me', { method: 'PATCH', body })
}

export function listUsers(query: { page?: number; q?: string; role?: AppRole; limit?: number }) {
  return api<ListUser[]>('/api/users', { query })
}

export function createUser(body: Record<string, unknown>) {
  return api<ListUser & { temporaryPassword: string }>('/api/users', { method: 'POST', body })
}

export function patchUser(id: string, body: Record<string, unknown>) {
  return api<ListUser>(`/api/users/${id}`, { method: 'PATCH', body })
}

export function resetUserPassword(id: string) {
  return api<{ temporaryPassword: string }>(`/api/users/${id}/reset-password`, { method: 'POST' })
}

export function listCompanies(query: { page?: number; q?: string; limit?: number }) {
  return api<CompanyRow[]>('/api/companies', { query })
}

export function createCompany(body: Record<string, unknown>) {
  return api<CompanyRow & { temporaryPassword: string }>('/api/companies', { method: 'POST', body })
}

export function patchCompanyPlatform(id: string, body: Record<string, unknown>) {
  return api<CompanyRow>(`/api/companies/${id}`, { method: 'PATCH', body })
}

export function getTenantCompany() {
  return api<CompanyRow>('/api/company')
}

export function patchTenantCompany(body: Record<string, unknown>) {
  return api<CompanyRow>('/api/company', { method: 'PATCH', body })
}

export function listSettings() {
  return api<SettingRow[]>('/api/settings')
}

export function putSettings(body: Record<string, unknown>) {
  return api<SettingRow[]>('/api/settings', { method: 'PUT', body })
}

export function getPublicSettings(slug: string) {
  return api<Record<string, string>>('/api/settings/public', { query: { slug } })
}

export function listNotifications(query: { unread?: boolean; page?: number; limit?: number }) {
  return api<NotificationRow[]>('/api/notifications', {
    query: {
      page: query.page,
      limit: query.limit,
      unread: query.unread ? 'true' : undefined,
    },
  })
}

export function markNotificationRead(id: string) {
  return api<NotificationRow>(`/api/notifications/${id}/read`, { method: 'PATCH' })
}

export function markAllNotificationsRead() {
  return api<{ ok: true }>('/api/notifications/read-all', { method: 'POST' })
}

export function uploadFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return api<{ path: string; mime: string }>('/api/files', { method: 'POST', formData })
}
