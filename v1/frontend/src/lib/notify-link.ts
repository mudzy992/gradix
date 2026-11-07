export function notifyPath(type: string, data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return type === 'HSE_CREATED' ? '/hse' : null
  }
  const rec = data as Record<string, unknown>
  if (typeof rec.taskId === 'string') {
    return `/tasks/${rec.taskId}`
  }
  if (typeof rec.tripId === 'string') {
    return `/logistics`
  }
  if (type === 'DIARY_CONFLICT' && typeof rec.projectId === 'string') {
    return `/diary?projectId=${rec.projectId}`
  }
  if (type === 'HSE_CREATED') {
    return '/hse'
  }
  if (type === 'SERVICE_DUE') {
    return '/services'
  }
  if (type === 'DOCUMENT_EXPIRING') {
    return '/documents'
  }
  if (type === 'FUEL_ANOMALY') {
    return '/reports'
  }
  if (typeof rec.projectId === 'string') {
    return `/projects/${rec.projectId}`
  }
  return null
}
