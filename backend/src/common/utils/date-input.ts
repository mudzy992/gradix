import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

/**
 * BE-15 (F-06): `new Date('nije-datum')` ne pada — daje `Invalid Date`, a Prisma to
 * pretvori u `500`. Datum koji dolazi iz klijenta mora biti ili `YYYY-MM-DD` ili
 * puni ISO-8601; sve ostalo je `400`, nikad tiho `undefined` (jer bi npr. datum
 * isteka dokumenta tiho nestao i compliance prikaz bi lagao).
 */
export function parseIsoDateTime(value: string, field: string): Date {
  const text = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const dateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text);
  if (!dateOnly && !dateTime) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} must be an ISO date`,
      400,
    );
  }
  const parsed = new Date(dateOnly ? `${text}T00:00:00.000Z` : text);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid date', 400);
  }
  if (dateOnly && parsed.toISOString().slice(0, 10) !== text) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid date', 400);
  }
  return parsed;
}
