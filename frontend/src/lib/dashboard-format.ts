/** Decimal amounts remain strings/BigInt: no binary float is used for money. */
function cents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) return null
  const units = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))
  return match[1] ? -units : units
}

export function formatExactMoney(value: string, locale: string): string | null {
  const amount = cents(value)
  if (amount === null) return null
  // Chromium and Node ship different Bosnian number data; the product contract uses
  // dot grouping and comma decimals for BS in both engines.
  const numberLocale = /^bs(?:-|$)/i.test(locale) ? 'de-DE' : locale
  const negative = amount < 0n
  const magnitude = negative ? -amount : amount
  const integer = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(magnitude / 100n)
  const decimal = new Intl.NumberFormat(numberLocale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.'
  const sign = negative ? new Intl.NumberFormat(numberLocale).formatToParts(-1).find((part) => part.type === 'minusSign')?.value ?? '-' : ''
  return `${sign}${integer}${decimal}${String(magnitude % 100n).padStart(2, '0')}`
}

/** Return a dimensionless truncated percentage, or null when unsafe/undefined. */
export function moneyProgress(spend: string, budget: string): number | null {
  const used = cents(spend)
  const total = cents(budget)
  if (used === null || total === null || used < 0n || total <= 0n) return null
  const basisPoints = used * 10_000n / total
  if (basisPoints > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(basisPoints) / 100
}

export function minutesParts(value: string): { hours: bigint; minutes: number } | null {
  if (!/^\d+$/.test(value)) return null
  const minutes = BigInt(value)
  return { hours: minutes / 60n, minutes: Number(minutes % 60n) }
}

export function toSafeNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const result = BigInt(value)
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null
}

/** Company-local instants; Bosnian uses an explicit numeric date even with minimal ICU data. */
export function formatDashboardDate(value: string, locale: string, timezone?: string, time = false): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  const zone = timezone ?? 'UTC'
  try {
    if (/^bs(?:-|$)/i.test(locale)) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        ...(time ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
      }).formatToParts(date)
      const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
      return `${part('day')}.${part('month')}.${part('year')}.${time ? ` ${part('hour')}:${part('minute')}` : ''}${timezone ? '' : ' UTC'}`
    }
    return new Intl.DateTimeFormat(locale, { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date) + (timezone ? '' : ' UTC')
  } catch { return '—' }
}
