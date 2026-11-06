import { Prisma } from '../../../generated/client';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export function parseDecimal(
  value: string,
  field: string,
  scale?: number,
): Prisma.Decimal {
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(value);
    if (!parsed.isFinite()) {
      throw new Error('non-finite decimal');
    }
    // Decimal.js can underflow a nonzero input to signed zero. Check the
    // original significand, not the exponent, for all supported bases.
    const unsigned = value.replace(/^[+-]/, '');
    const isBasePrefixed = /^0[xob]/i.test(unsigned);
    const significand = isBasePrefixed
      ? unsigned.slice(2).split(/p/i)[0]
      : unsigned.split(/e/i)[0];
    if (
      parsed.isZero() &&
      (isBasePrefixed ? /[1-9a-f]/i : /[1-9]/).test(significand)
    ) {
      throw new Error('decimal underflow');
    }
  } catch {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must be a decimal`,
      400,
    );
  }
  return scale === undefined
    ? parsed
    : assertDecimalScale(parsed, field, scale);
}

export function assertDecimalScale(
  value: Prisma.Decimal,
  field: string,
  scale: number,
): Prisma.Decimal {
  if (value.decimalPlaces() > scale) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must have at most ${scale} decimal places`,
      400,
    );
  }
  return value;
}

export function parsePositiveDecimal(
  value: string,
  field: string,
  scale?: number,
): Prisma.Decimal {
  const parsed = parseDecimal(value, field, scale);
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
  scale?: number,
): Prisma.Decimal {
  const parsed = parseDecimal(value, field, scale);
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
  scale?: number,
): Prisma.Decimal {
  const parsed = parseDecimal(value, field, scale);
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
  if (parsed.decimalPlaces() > 2 || parsed.gte('10000000000')) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must fit nonnegative numeric(12,2) without rounding`,
      400,
    );
  }
  return parsed;
}

/** Positive amount supplied to numeric(12,3), with no implicit rounding. */
export function parsePositiveQuantity(
  value: string,
  field: string,
): Prisma.Decimal {
  const parsed = parsePositiveDecimal(value, field);
  if (parsed.decimalPlaces() > 3 || parsed.gte('1000000000')) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must fit positive numeric(12,3) without rounding`,
      400,
    );
  }
  return parsed;
}
