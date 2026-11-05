/** Exact fixed-point validation without converting the coefficient to Number.
 * Accepts decimal/scientific notation, not Decimal.js-specific hex/underscores.
 */
export function isValidFixedDecimal(value: string, integerLimit: number, scale: number, allowZero: boolean, allowNegative: boolean): boolean {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value)
  if (!match) return false
  const whole = match[2] ?? ''
  const fraction = match[3] ?? match[4] ?? ''
  const digits = whole + fraction
  const first = digits.search(/[1-9]/)
  if (first < 0) return allowZero
  if (!allowNegative && match[1] === '-') return false
  const exponent = Number(match[5] ?? '0')
  if (!Number.isFinite(exponent)) return false
  const last = digits.replace(/0+$/, '').length - 1
  const integerDigits = whole.length - first + exponent
  const decimalPlaces = last + 1 - whole.length - exponent
  return integerDigits <= integerLimit && decimalPlaces <= scale
}
