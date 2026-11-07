/**
 * FE-15: `Intl.DateTimeFormat` baca `RangeError` i za neispravan datum (`Invalid Date`) i za nepoznatu
 * vremensku zonu — a ova funkcija se zove u renderu (zvono, dnevnik, liste), pa je jedan loš zapis rušio
 * ekran. Sada: `—` umjesto izuzetka (fallback zona je već osigurana u `useDisplayPrefs`; ovo je druga
 * linija odbrane, jer zonu može dati i pozivalac).
 */
export function formatDateTime(iso: string, timeZone: string, dateFormat: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  let parts: Record<string, string>
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    )
  } catch {
    return '—'
  }
  const formatted = dateFormat
    .replaceAll('dd', parts.day ?? '')
    .replaceAll('MM', parts.month ?? '')
    .replaceAll('yyyy', parts.year ?? '')
  return `${formatted} ${parts.hour ?? '00'}:${parts.minute ?? '00'}`
}
