import { describe, expect, it } from 'vitest'
import { dash } from '@/lib/dash'

/**
 * FE-05 — `dash()` je jedina tačka gdje se vrijednost kartice pretvara u tekst, pa se ovdje
 * provjerava ono što je prije FE-04 pravilo razliku između „nema podataka“ i „nula“:
 * `null`/`undefined`/prazan string → `—`, a `0` **ostaje** `0` (nula je stvarna vrijednost).
 */
describe('dash()', () => {
  it('prazne vrijednosti pretvara u crticu', () => {
    expect(dash(null)).toBe('—')
    expect(dash(undefined)).toBe('—')
    expect(dash('')).toBe('—')
  })

  it('nulu i brojeve prikazuje kao tekst (nula nije „nema podataka“)', () => {
    expect(dash(0)).toBe('0')
    expect(dash(7)).toBe('7')
  })

  it('tekstualne vrijednosti (npr. „12.500 / 40.000“) propušta nepromijenjene', () => {
    expect(dash('12.500 / 40.000')).toBe('12.500 / 40.000')
  })
})
