import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api-types'
import { errorMessage } from '@/lib/error-message'

/**
 * FE-15 — jedina funkcija kroz koju sve greške stižu do korisnika. Drži: preveden kod se prikazuje na
 * izabranom jeziku, nepoznat kod zadržava poruku servera (bolje i engleski nego „errors.XXX“), a
 * mrežni prekid više nije „Failed to fetch“ nego jasna bosanska rečenica.
 */
describe('errorMessage', () => {
  it('poznat kod greške prevodi (bs je podrazumijevani jezik)', () => {
    expect(errorMessage(new ApiError('FORBIDDEN', 'Forbidden', 403))).toBe('Nemate dozvolu.')
  })

  it('mrežni prekid ima svoj prijevod, ne tehničku poruku `fetch`-a', () => {
    const message = errorMessage(new ApiError('NETWORK_ERROR', 'Failed to fetch', 0))

    expect(message).not.toContain('Failed to fetch')
    expect(message).toContain('veze sa serverom')
  })

  it('nepoznat kod vraća poruku servera (bez sirovog ključa u UI-u)', () => {
    expect(errorMessage(new ApiError('NEPOZNAT_KOD', 'Server kaže nešto', 400))).toBe('Server kaže nešto')
  })

  it('obična greška vraća svoju poruku', () => {
    expect(errorMessage(new Error('puklo lokalno'))).toBe('puklo lokalno')
  })

  it('ne-greška daje generičku poruku', () => {
    expect(errorMessage('nešto')).toBe('Interna greška.')
    expect(errorMessage(undefined)).toBe('Interna greška.')
  })
})
