import { describe, expect, it } from 'vitest'
import { formatDateTime } from '@/lib/format-date'

/**
 * FE-15 — funkcija se zove u renderu (zvono, dnevnik) i prije je na neispravan zapis ili nepoznatu
 * vremensku zonu bacala `RangeError`, što je rušilo cijeli ekran. Sada vraća `—`.
 */
describe('formatDateTime', () => {
  it('formatira po zoni i formatu iz postavki', () => {
    expect(formatDateTime('2026-11-04T10:30:00Z', 'Europe/Sarajevo', 'dd.MM.yyyy')).toBe('04.11.2026 11:30')
    expect(formatDateTime('2026-11-04T10:30:00Z', 'UTC', 'yyyy-MM-dd')).toBe('2026-11-04 10:30')
  })

  it('neispravan datum daje `—`, ne izuzetak', () => {
    expect(formatDateTime('nije-datum', 'Europe/Sarajevo', 'dd.MM.yyyy')).toBe('—')
    expect(formatDateTime('', 'UTC', 'dd.MM.yyyy')).toBe('—')
  })

  it('nevalidna vremenska zona daje `—`, ne `RangeError`', () => {
    expect(() => formatDateTime('2026-11-04T10:30:00Z', 'GMT+1', 'dd.MM.yyyy')).not.toThrow()
    expect(formatDateTime('2026-11-04T10:30:00Z', 'GMT+1', 'dd.MM.yyyy')).toBe('—')
  })

  it('nepoznat token u formatu ostaje doslovan (bez skrivenog gubitka datuma)', () => {
    expect(formatDateTime('2026-11-04T10:30:00Z', 'UTC', 'dd/MM/yy')).toBe('04/11/yy 10:30')
  })
})
