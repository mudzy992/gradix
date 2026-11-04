import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { bs } from '@/i18n/bs'
import { en } from '@/i18n/en'
import { opsBs } from '@/i18n/ops-bs'
import { opsEn } from '@/i18n/ops-en'
import { polishBs } from '@/i18n/polish-bs'
import { polishEn } from '@/i18n/polish-en'
import { publicBs } from '@/i18n/public-bs'
import { publicEn } from '@/i18n/public-en'
import { payrollBs } from '@/i18n/payroll-bs'
import { payrollEn } from '@/i18n/payroll-en'
import { erpBs } from '@/i18n/erp-bs'
import { erpEn } from '@/i18n/erp-en'

/**
 * FE-15 — globalni paritet prijevoda.
 *
 * `i18n/index.ts` spaja module **spread** operatorom (`{ ...bs, ...opsBs, … }`), pa kasniji modul
 * **cijelu sekciju** tiho pregazi. Do sada je samo `dash` sekcija bila pod stražom (`i18n.spec.ts`), a
 * paritet bs/en nigdje nije provjeravan — nedostajući prijevod se u BS interfejsu vidi kao engleski
 * ključ ili tehnički kod (`RATE_LIMITED`). Ovaj test drži tri stvari:
 *
 *  1. `bs` i `en` imaju **isti skup ključeva** (652 danas — svaki novi ključ u oba jezika),
 *  2. nijedna top-level sekcija ne postoji u dva modula istog jezika (spread bi je pregazio),
 *  3. svaki kod greške sa backenda (`ERROR_CODES`) ima prijevod u oba jezika.
 */
type Tree = Record<string, unknown>

const BS_MODULES: Record<string, Tree> = {
  'bs.ts': bs,
  'ops-bs.ts': opsBs,
  'polish-bs.ts': polishBs,
  'public-bs.ts': publicBs,
  'payroll-bs.ts': payrollBs,
  'erp-bs.ts': erpBs,
}

const EN_MODULES: Record<string, Tree> = {
  'en.ts': en,
  'ops-en.ts': opsEn,
  'polish-en.ts': polishEn,
  'public-en.ts': publicEn,
  'payroll-en.ts': payrollEn,
  'erp-en.ts': erpEn,
}

function flatten(tree: Tree, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [key, value] of Object.entries(tree)) {
    const next = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      flatten(value as Tree, next, out)
    } else {
      out[next] = value
    }
  }
  return out
}

function merge(modules: Record<string, Tree>): Tree {
  return Object.assign({}, ...Object.values(modules)) as Tree
}

const bsFlat = flatten(merge(BS_MODULES))
const enFlat = flatten(merge(EN_MODULES))

describe('i18n paritet bs/en', () => {
  it('oba jezika imaju isti skup ključeva', () => {
    const onlyBs = Object.keys(bsFlat).filter((key) => !(key in enFlat)).sort()
    const onlyEn = Object.keys(enFlat).filter((key) => !(key in bsFlat)).sort()

    expect(onlyBs, `samo u bs: ${onlyBs.slice(0, 10).join(', ')}`).toEqual([])
    expect(onlyEn, `samo u en: ${onlyEn.slice(0, 10).join(', ')}`).toEqual([])
  })

  it('nijedna top-level sekcija ne postoji u dva modula (spread bi je pregazio)', () => {
    for (const [lng, modules] of [
      ['bs', BS_MODULES],
      ['en', EN_MODULES],
    ] as const) {
      const owners = new Map<string, string[]>()
      for (const [name, tree] of Object.entries(modules)) {
        for (const section of Object.keys(tree)) {
          owners.set(section, [...(owners.get(section) ?? []), name])
        }
      }
      const clashes = [...owners.entries()].filter(([, names]) => names.length > 1)
      expect(clashes, `${lng}: ${clashes.map(([s, n]) => `${s} u ${n.join(' + ')}`).join('; ')}`).toEqual([])
    }
  })

  it('nema praznih prijevoda (prazan string se u UI-u vidi kao „ništa“)', () => {
    const empties = Object.entries({ ...bsFlat, ...enFlat })
      .filter(([, value]) => typeof value === 'string' && value.trim() === '')
      .map(([key]) => key)

    expect(empties).toEqual([])
  })

  it('svaki kod greške sa backenda ima prijevod u bs i en', () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../../../backend/src/common/errors/error-codes.ts'),
      'utf8',
    )
    const codes = [...source.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1])
    expect(codes.length).toBeGreaterThan(20)

    const missing = codes.filter((code) => !(`errors.${code}` in bsFlat) || !(`errors.${code}` in enFlat))
    expect(missing, `bez prijevoda: ${missing.join(', ')}`).toEqual([])
  })

  it('kodovi koje dodaje klijent (mreža, ne-JSON odgovor) su takođe prevedeni', () => {
    for (const code of ['NETWORK_ERROR', 'RATE_LIMITED', 'REPORT_UNKNOWN', 'INTERNAL_ERROR', 'HTTP_ERROR']) {
      expect(bsFlat[`errors.${code}`], `bs: ${code}`).toBeTruthy()
      expect(enFlat[`errors.${code}`], `en: ${code}`).toBeTruthy()
    }
  })
})
