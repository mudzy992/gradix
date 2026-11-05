export const REFRESH_KEY = 'gradix:refresh'
export const REMEMBER_KEY = 'gradix:remember'
export const COMPANY_KEY = 'gradix:company-id'
export const LOGOUT_KEY = 'gradix:logout'
export const PROJECT_DOCUMENT_PENDING_QUERY = 'project-document-pending'
export const STOCK_MOVEMENT_PENDING_QUERY = 'stock-movement-pending'

export const KNOWN_NOTIFY_TYPES = [
  'TASK_DISPATCHED',
  'TASK_COMPLETED',
  'TIMER_FORCE_CLOSED',
  'TIMER_AUTO_CLOSED',
  'GEOFENCE_ENTER',
  'GEOFENCE_EXIT',
  'DOCUMENT_EXPIRING',
  'SERVICE_DUE',
  'FUEL_ANOMALY',
  'HSE_CREATED',
  'AMENDMENT_CREATED',
  'DIARY_CONFLICT',
  'PAYROLL_REJECTED',
] as const

export const ROLES = [
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
  'ADMIN',
  'PROJECT_MANAGER',
  'SITE_SUPERVISOR',
  'MACHINE_OPERATOR',
  'DRIVER',
  'WORKER',
  'MECHANIC',
  'ACCOUNTANT',
] as const

export type AppRole = (typeof ROLES)[number]
export type NotifyType = (typeof KNOWN_NOTIFY_TYPES)[number]
