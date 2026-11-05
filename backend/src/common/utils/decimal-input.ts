import { Prisma } from '../../../generated/client';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export function parseDecimal(value: string, field: string): Prisma.Decimal {
  try {
    const parsed = new Prisma.Decimal(value);
    if (!parsed.isFinite()) {
      throw new Error('non-finite decimal');
    }
    return parsed;
  } catch {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must be a decimal`,
      400,
    );
  }
}

export function parsePositiveDecimal(
  value: string,
  field: string,
): Prisma.Decimal {
  const parsed = parseDecimal(value, field);
  if (parsed.lte(0)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must be > 0`,
      400,
    );
  }
  return parsed;
}

export function parseNonNegativeDecimal(
  value: string,
  field: string,
): Prisma.Decimal {
  const parsed = parseDecimal(value, field);
  if (parsed.lt(0)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must be >= 0`,
      400,
    );
  }
  return parsed;
}

export function parseNonZeroDecimal(
  value: string,
  field: string,
): Prisma.Decimal {
  const parsed = parseDecimal(value, field);
  if (parsed.eq(0)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must not be 0`,
      400,
    );
  }
  return parsed;
}

/** Amount supplied to a numeric(12,2) column, without implicit rounding or underflow. */
export function parseNonNegativeMoney(
  value: string,
  field: string,
): Prisma.Decimal {
  const parsed = parseNonNegativeDecimal(value, field);
  // Decimal.js underflows extreme exponents to signed zero. Detect a non-zero
  // original significand, including the base-prefixed syntax Decimal.js accepts.
  const unsigned = value.replace(/^[+-]/, '');
  const isBasePrefixed = /^0[xob]/i.test(unsigned);
  const significand = isBasePrefixed
    ? unsigned.slice(2).split(/p/i)[0]
    : unsigned.split(/e/i)[0];
  const underflow =
    parsed.isZero() &&
    (isBasePrefixed ? /[1-9a-f]/i : /[1-9]/).test(significand);
  if (underflow || parsed.decimalPlaces() > 2 || parsed.gte('10000000000')) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must fit nonnegative numeric(12,2) without rounding`,
      400,
    );
  }
  return parsed;
}
