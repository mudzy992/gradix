import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

/**
 * BE-05 — novac i količine stižu kao **string** (da se ne izgubi preciznost u JSON-u), ali su
 * DTO-i provjeravali samo `@IsString()`. Zato je `plannedQty: "abc"` stizao do Prisma `Decimal`
 * i vraćao 500. Ovaj modul pretvara takav slučaj u razumljiv `400 VALIDATION_FAILED`.
 */

const DECIMAL = /^-?\d{1,15}(\.\d{1,4})?$/;

export function parseDecimalString(value: string, field: string): string {
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must be a decimal number`,
      400,
    );
  }
  return trimmed;
}

export function parseNonNegativeDecimal(value: string, field: string): string {
  const parsed = parseDecimalString(value, field);
  if (parsed.startsWith('-')) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must not be negative`,
      400,
    );
  }
  return parsed;
}
