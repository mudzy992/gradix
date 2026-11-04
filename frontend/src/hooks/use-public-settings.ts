import { useQuery } from '@tanstack/react-query'
import { getPublicSettings } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

const DEFAULT_TIME_ZONE = 'Europe/Sarajevo'
const DEFAULT_DATE_FORMAT = 'dd.MM.yyyy'
const DATE_FORMAT_TOKENS = ['dd', 'MM'] as const

function readSetting(settings: Record<string, unknown> | undefined, key: string): string | null {
  const value = settings?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Vremenska zona iz postavki mora biti **validna** za `Intl`: `formatDateTime` je prosljeđuje u
 * `Intl.DateTimeFormat`, koji na nepoznatu zonu baca `RangeError`. Pošto podešavanja piše administrator
 * kao slobodan tekst, jedna pogrešna vrijednost (npr. „Europe/Sarajevo “ ili „GMT+1“) rušila je cijeli
 * header zvona i dnevnik (FE-14). Zato: validacija + fallback na `Europe/Sarajevo`.
 */
function normalizeTimeZone(value: string | null): string {
  if (!value) {
    return DEFAULT_TIME_ZONE
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value })
    return value
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

/** Format bez `dd` i `MM` tokena bi tiho ispisao isti datum za svaki dan — zato fallback. */
function normalizeDateFormat(value: string | null): string {
  if (!value || !DATE_FORMAT_TOKENS.every((token) => value.includes(token))) {
    return DEFAULT_DATE_FORMAT
  }
  return value
}

export function usePublicSettings() {
  const slug = useAuthStore((state) => state.user?.company?.slug)
  return useQuery({
    queryKey: ['public-settings', slug],
    queryFn: async () => (await getPublicSettings(slug ?? '')).data,
    enabled: Boolean(slug),
    // Postavke se mijenjaju rijetko, a čita ih svaki ekran (zvono, dnevnik) — bez `staleTime`-a
    // svaka montaža bi pravila novi `GET`.
    staleTime: 5 * 60 * 1000,
  })
}

export function useDisplayPrefs(): { timeZone: string; dateFormat: string } {
  const settings = usePublicSettings().data
  return {
    timeZone: normalizeTimeZone(readSetting(settings, 'app.timezone')),
    dateFormat: normalizeDateFormat(readSetting(settings, 'app.dateFormat')),
  }
}
