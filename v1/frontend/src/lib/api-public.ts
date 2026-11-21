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

/** Kod za odgovor koji **nije** naš envelope (proxy 502/504 HTML, throttler 429, prazno tijelo). */
function codeForStatus(status: number): string {
  if (status === 429) {
    return 'TOO_MANY_REQUESTS'
  }
  if (status === 404) {
    return 'NOT_FOUND'
  }
  return status >= 500 ? 'SERVER_ERROR' : 'BAD_RESPONSE'
}

async function publicJson<T>(path: string): Promise<{
  data: T
  meta?: { page: number; limit: number; total: number }
}> {
  const base = apiBase()
  const url = base ? `${base}${path}` : path
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  /**
   * FE-14: `response.json()` je bio bez zaštite — kad između nas i API-ja stane proxy i vrati HTML
   * (502/504) ili throttler vrati golu poruku, bacao se `SyntaxError` iz `fetch` sloja umjesto
   * `ApiError`-a, pa stranica nije mogla razlikovati „nema firme“ od „server je pao“. Isto za 429:
   * tijelo nije naš envelope, pa je `body.error.code` pucao na `undefined`.
   */
  let body: Envelope<T> | EnvelopeError | null = null
  try {
    body = (await response.json()) as Envelope<T> | EnvelopeError
  } catch {
    body = null
  }
  if (!body) {
    throw new ApiError(codeForStatus(response.status), `Neispravan odgovor servera (${response.status})`, response.status)
  }
  if (!response.ok || !body.success) {
    const error = !body.success && body.error ? body.error : { code: codeForStatus(response.status), message: 'Request failed' }
    throw new ApiError(error.code, error.message, response.status)
  }
  return { data: body.data, meta: body.meta }
}
