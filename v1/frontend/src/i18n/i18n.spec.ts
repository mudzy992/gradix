import i18n from 'i18next'
import { describe, expect, it } from 'vitest'
import { bs } from '@/i18n/bs'
import { en } from '@/i18n/en'
import { opsBs } from '@/i18n/ops-bs'
import { opsEn } from '@/i18n/ops-en'

/**
 * FE-05 — mreža za i18n. `src/i18n/index.ts` spaja resurse spread operatorom
 * (`{ ...bs, ...opsBs, ...polishBs, ... }`), pa **kasniji objekat tiho pregazi isti ključ**.
 * Upravo se to dogodilo u FE-04: `dash` je dodat u `bs.ts`, a `ops-bs.ts` ga je već imao —
 * vrijednosti iz `bs.ts` nikad nisu bile vidljive. Testovi ispod drže da se to ne ponovi.
 */
const DASH_KEYS = [
  'activeProjects',
  'scopedProjects',
  'spend',
  'openTimers',
  'unread',
  'presence',
  'myTasks',
  'myTimer',
  'progress',
  'machines',
  'tripsToday',
] as const

/** Ključevi koje dashboard stvarno traži (`dashboard-page.tsx`). */
const DASHBOARD_KEYS = [
  'title',
  'welcome',
  'onSite',
  'kpi',
  'quickActions',
  'expiring',
  'expiringHint',
  'daysLeft',
  'expired',
  'today',
  'allClear',
  'nobodyOnSite',
  'presenceUnavailable',
  'loadError',
  'retry',
  'entity.company',
  'entity.worker',
  'entity.machine',
] as const

const RESOURCES = { bs: { ...bs, ...opsBs }, en: { ...en, ...opsEn } } as const

function resolve(lng: 'bs' | 'en', key: string): string {
  const parts = key.split('.')
  let node: unknown = RESOURCES[lng]
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return `__missing__:${key}`
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : `__missing__:${key}`
}

describe('i18n resursi — dashboard', () => {
  it('svaka kartica koju backend vraća ima prijevod u bs i en', () => {
    for (const lng of ['bs', 'en'] as const) {
      for (const key of DASH_KEYS) {
        expect(resolve(lng, `dash.${key}`), `${lng}: dash.${key}`).not.toMatch(/^__missing__/)
      }
    }
  })

  it('tekstovi dashboarda postoje u oba jezika', () => {
    for (const lng of ['bs', 'en'] as const) {
      for (const key of DASHBOARD_KEYS) {
        expect(resolve(lng, `dashboard.${key}`), `${lng}: dashboard.${key}`).not.toMatch(/^__missing__/)
      }
    }
  })

  it('`dash` sekcija postoji u tačno jednom modulu (spread ne smije prekriti prijevod)', () => {
    const owners = [
      ['bs.ts', 'dash' in bs],
      ['ops-bs.ts', 'dash' in opsBs],
      ['en.ts', 'dash' in en],
      ['ops-en.ts', 'dash' in opsEn],
    ] as const
    expect(owners.filter(([, has]) => has).map(([name]) => name)).toEqual(['ops-bs.ts', 'ops-en.ts'])
  })

  it('i18n vraća tekst, ne sam ključ (nema `dash.` u renderovanom labelu)', () => {
    for (const lng of ['bs', 'en'] as const) {
      for (const key of DASH_KEYS) {
        const label = i18n.t(`dash.${key}`, { lng })
        expect(label).not.toBe(`dash.${key}`)
        expect(label).not.toMatch(/^dash\./)
      }
    }
  })
})
