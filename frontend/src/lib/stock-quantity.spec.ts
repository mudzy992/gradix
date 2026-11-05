import { describe, expect, it } from 'vitest'
import { isValidStockQuantity } from './stock-quantity'

describe('stock quantity', () => {
  it.each([
    '0.001', '-0.001', '0.001000', '+001.0000', '.5', '1.',
    '1e-3', '-1E-3', '1000e-6', '0.00001e2',
    '999999999.999', '-999999999.999', '999999999.9990', '999999999999e-3',
  ])('accepts exactly representable nonzero decimal %s', (value) => {
    expect(isValidStockQuantity(value)).toBe(true)
  })

  it.each([
    '', '0', '-0.000', '0e999', 'NaN', 'Infinity', '-Infinity', 'abc',
    '1,2', ' 1 ', '0x10', '1_000', '1e', '1e+', '--1',
    '0.0001', '-0.0005', '1e-4', '999999999.9999',
    '1000000000', '-1000000000', '1e9999999999999999999999',
    '1e-9999999999999999999999',
  ])('rejects invalid, zero, rounded or overflowing decimal %s', (value) => {
    expect(isValidStockQuantity(value)).toBe(false)
  })
})
