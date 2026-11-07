import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-types'
import { getPublicCompany, listPublicProjects, publicAssetUrl } from '@/lib/api-public'

/**
 * FE-14 — javni endpointi (`/api/public/:slug`) hodaju bez prijave i bez `axios`-a, pa je obrada
 * odgovora morala biti ručno zaštićena. Prije: ne-JSON odgovor (proxy 502/504 HTML) bacao je
 * `SyntaxError`, a throttlerov 429 nije imao `error` polje → `body.error.code` je pucao na `undefined`.
 * Sada oba slučaja daju `ApiError` sa `status`-om, pa stranica može prikazati pravu poruku.
 */
const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

function stubFetch() {
  vi.stubGlobal('fetch', fetchMock)
}

describe('api-public', () => {
  it('uspješan odgovor vraća `data` i `meta`', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [], meta: { page: 1, limit: 20, total: 0 } }),
    )

    await expect(listPublicProjects('demo')).resolves.toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0 },
    })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/public/demo/projects'), {
      headers: { accept: 'application/json' },
    })
  })

  it('404 iz API-ja daje ApiError sa statusom 404 (stranica tada kaže „nije pronađeno“)', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'Nema firme' } }, 404),
    )

    await expect(getPublicCompany('nema')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('ne-JSON odgovor (proxy 502 HTML) daje ApiError, ne SyntaxError', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))

    const error = await getPublicCompany('demo').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'SERVER_ERROR', status: 502 })
  })

  it('429 bez envelope-a daje ApiError TOO_MANY_REQUESTS (throttler)', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ statusCode: 429, message: 'ThrottlerException' }, 429))

    await expect(getPublicCompany('demo')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 })
  })

  it('2xx odgovor bez `success` polja se odbija kao neispravan', async () => {
    stubFetch()
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'p1' }] }))

    await expect(getPublicCompany('demo')).rejects.toBeInstanceOf(ApiError)
  })

  it('`publicAssetUrl` poštuje bazu API-ja', () => {
    expect(publicAssetUrl('asset-1')).toContain('/api/public/assets/asset-1')
  })
})
