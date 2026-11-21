/**
 * FE-13 — ključevi registra postavki koje backend poznaje (`backend/src/common/settings/registry.ts`).
 *
 * Zašto ovdje: ekran postavki prikazuje **tehničke ključeve** iz API-ja (`app.currency`,
 * `timer.maxOpenHours`…). Opisi sa backenda su na engleskom, pa je bosanski interfejs imao engleske
 * opise i golu ključ kao labelu. Prijevod se traži kao `settings.keys.<ključ>.label/.description`, a
 * ovaj spisak drži da nijedan ključ ne ostane bez prijevoda (test u `settings-page.spec.tsx`).
 *
 * Kad backend doda novi ključ: dodaj ga ovdje **i** u `src/i18n/{bs,en}.ts`; dok se ne doda, UI
 * prikazuje ključ i opis sa backenda (ništa se ne skriva).
 */
export const SETTINGS_KEYS = [
  'app.currency',
  'app.timezone',
  'app.dateFormat',
  'features.email',
  'features.push',
  'privacy.gpsNotice',
  'public.companyName',
  'public.tagline',
  'public.contact',
  'timer.maxOpenHours',
  'geofence.defaultRadiusM',
  'erp.allowNegativeStock',
] as const

export type SettingKey = (typeof SETTINGS_KEYS)[number]
