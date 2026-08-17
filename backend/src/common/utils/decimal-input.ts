import { Prisma } from '../../../generated/client';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export function parseDecimal(value: string, field: string): Prisma.Decimal {
  try {
    const parsed = new Prisma.Decimal(value);
    if (parsed.isNaN()) {
      throw new Error('nan');
    }
    return parsed;
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${field} must be a decimal`, 400);
  }
}

export function parsePositiveDecimal(value: string, field: string): Prisma.Decimal {
  const parsed = parseDecimal(value, field);
  if (parsed.lte(0)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${field} must be > 0`, 400);
  }
  return parsed;
}

export function parseNonNegativeDecimal(value: string, field: string): Prisma.Decimal {
  const parsed = parseDecimal(value, field);
  if (parsed.lt(0)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${field} must be >= 0`, 400);
  }
  return parsed;
}

export function parseNonZeroDecimal(value: string, field: string): Prisma.Decimal {
  const parsed = parseDecimal(value, field);
  if (parsed.eq(0)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${field} must not be 0`, 400);
  }
  return parsed;
}
