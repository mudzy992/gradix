import { isValidFixedDecimal } from './decimal-input'

/** Nonzero quantity exactly representable by PostgreSQL numeric(12,3). */
export function isValidStockQuantity(value: string): boolean {
  return isValidFixedDecimal(value, 9, 3, false, true)
}
