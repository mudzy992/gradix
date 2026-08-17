import type { AppRole } from '@/lib/constants'

export type Envelope<T> = {
  success: true
  data: T
  meta?: { page: number; limit: number; total: number }
}

export type EnvelopeError = {
  success: false
  error: { code: string; message: string; details?: unknown }
}

export type MeCompany = {
  id: string
  name: string
  slug: string
}

export type MeUser = {
  id: string
  firstName: string
  lastName: string
  employeeCode: string | null
  email: string
  roles: AppRole[]
  permissions: string[]
  companyId: string | null
  company: MeCompany | null
  hourlyRate: string | null
  mustChangePassword: boolean
  locale: 'bs' | 'en'
}

export type AuthPayload = {
  accessToken: string
  refreshToken: string
  user: MeUser
}

export type ListUser = {
  id: string
  firstName: string
  lastName: string
  employeeCode: string | null
  email: string
  phone: string | null
  companyId: string | null
  hourlyRate?: string | null
  isActive: boolean
  mustChangePassword: boolean
  locale: 'bs' | 'en'
  roles: AppRole[]
}

export type CompanyRow = {
  id: string
  name: string
  slug: string
  isActive: boolean
  legalName: string | null
  address: string | null
  city: string | null
  country: string | null
  taxId: string | null
  phone: string | null
  email: string | null
  logoPath: string | null
  logoAssetId: string | null
}

export type SettingRow = {
  key: string
  scope: 'PUBLIC' | 'PRIVATE' | 'SECRET'
  description: string
  value: string | number | boolean
}

export type NotificationRow = {
  id: string
  type: string
  title: string
  message: string
  data: unknown
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}
