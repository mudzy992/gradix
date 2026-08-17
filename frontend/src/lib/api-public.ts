import { apiBase } from '@/lib/api-client'
import { ApiError, type Envelope, type EnvelopeError } from '@/lib/api-types'

export type PublicCompany = {
  slug: string
  name: string
  tagline: string
  city: string | null
  address: string | null
  phone: string | null
  logoAssetId: string | null
  contact: string
}

export type PublicProject = {
  id: string
  name: string
  locality: string | null
  status: string
  coverAssetId: string | null
}

export function publicAssetUrl(id: string): string {
  const base = apiBase()
  return `${base}/api/public/assets/${id}`
}

export async function getPublicCompany(slug: string) {
  return publicJson<PublicCompany>(`/api/public/${slug}`)
}

export async function listPublicProjects(slug: string) {
  return publicJson<PublicProject[]>(`/api/public/${slug}/projects`)
}

async function publicJson<T>(path: string): Promise<{
  data: T
  meta?: { page: number; limit: number; total: number }
}> {
  const base = apiBase()
  const url = base ? `${base}${path}` : path
  const response = await fetch(url)
  const body = (await response.json()) as Envelope<T> | EnvelopeError
  if (!response.ok || !body.success) {
    const error = !body.success
      ? body.error
      : { code: 'NOT_FOUND', message: 'Not found' }
    throw new ApiError(error.code, error.message, response.status)
  }
  return { data: body.data, meta: body.meta }
}
