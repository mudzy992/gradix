import { describe, expect, it } from 'vitest'
import { formatCompactMoney, formatDashboardDate, formatExactMoney, moneyProgress, minutesParts, toSafeNumber } from './dashboard-format'

describe('dashboard exact formatting', () => {
  it('formats large decimal strings without passing amounts through floating point', () => {
    expect(formatExactMoney('12345678901234567890.07', 'en')).toBe('12,345,678,901,234,567,890.07')
    expect(formatExactMoney('-0.01', 'en')).toBe('-0.01')
    expect(formatExactMoney('1234.50', 'bs')).toBe('1.234,50')
    expect(formatExactMoney('not money', 'en')).toBeNull()
  })
  it('compacts money without losing precision in the full amount', () => {
    expect(formatCompactMoney('1234567.89', 'en')).toBe('1.2M')
    expect(formatCompactMoney('-1234567.89', 'bs')).toBe('-1,2M')
    expect(formatCompactMoney('999.99', 'en')).toBe('999.99')
    expect(formatCompactMoney('12345678901234567890.07', 'en')).toBe('12,345,678.9T')
    expect(formatCompactMoney('invalid', 'en')).toBeNull()
  })
  it('computes percentage from integer cents and never divides by zero', () => {
    expect(moneyProgress('1.00', '3.00')).toBe(33.33)
    expect(moneyProgress('7999.99', '10000.00')).toBe(79.99)
    expect(moneyProgress('9999.99', '10000.00')).toBe(99.99)
    expect(moneyProgress('0.00', '0.00')).toBeNull()
    expect(moneyProgress('-1.00', '3.00')).toBeNull()
    expect(moneyProgress('1.001', '3.00')).toBeNull()
    expect(moneyProgress('99999999999999999999.99', '0.01')).toBeNull()
  })
  it('renders Bosnian dates numerically and uses the company timezone', () => {
    expect(formatDashboardDate('2025-01-01T23:30:00.000Z', 'bs', 'Europe/Sarajevo', true)).toBe('02.01.2025. 00:30')
    expect(formatDashboardDate('2025-01-01T00:00:00.000Z', 'bs', 'UTC')).toBe('01.01.2025.')
    expect(formatDashboardDate('2025-01-01T00:00:00.000Z', 'bs', undefined, true)).toBe('01.01.2025. 00:00 UTC')
    expect(formatDashboardDate('bad', 'bs', 'UTC')).toBe('—')
    expect(formatDashboardDate('2025-01-01T00:00:00.000Z', 'bs', 'invalid/timezone')).toBe('—')
  })
  it('keeps minutes exact and declines unsafe chart conversion', () => {
    expect(minutesParts('12345678901234567890')).toEqual({ hours: 205761315020576131n, minutes: 30 })
    expect(minutesParts('-1')).toBeNull()
    expect(toSafeNumber('9007199254740991')).toBe(9007199254740991)
    expect(toSafeNumber('9007199254740992')).toBeNull()
  })
})
