import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api-types'
import { shouldRetry } from '@/lib/query-client'

/**
 * FE-15 — `retry: 1` je ponavljao i `403`/`404`/`429`. Ponavljanje odbijenog zahtjeva ne mijenja
 * ishod, a kod throttlera svaki retry je novi zahtjev u istom prozoru. Sada se ponavljaju samo
 * prolazne greške (mreža, 5xx) i to jednom.
 */
describe('shouldRetry', () => {
  it('mrežni prekid se ponavlja jednom', () => {
    expect(shouldRetry(0, new ApiError('NETWORK_ERROR', 'x', 0))).toBe(true)
    expect(shouldRetry(1, new ApiError('NETWORK_ERROR', 'x', 0))).toBe(false)
  })

  it('5xx se ponavlja jednom', () => {
    expect(shouldRetry(0, new ApiError('INTERNAL_ERROR', 'x', 503))).toBe(true)
    expect(shouldRetry(1, new ApiError('INTERNAL_ERROR', 'x', 503))).toBe(false)
  })

  it('4xx se ne ponavlja (403, 404, 409, 429)', () => {
    for (const status of [400, 403, 404, 409, 429]) {
      expect(shouldRetry(0, new ApiError('FORBIDDEN', 'x', status)), String(status)).toBe(false)
    }
  })

  it('nepoznata greška se ponavlja jednom (mreža van `fetch`-a)', () => {
    expect(shouldRetry(0, new Error('boom'))).toBe(true)
    expect(shouldRetry(1, new Error('boom'))).toBe(false)
  })
})
