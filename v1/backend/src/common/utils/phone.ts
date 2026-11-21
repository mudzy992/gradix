import { E164_PATTERN } from '../constants';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export function normalizePhone(
  phone: string | null | undefined,
): string | null {
  if (phone === undefined || phone === null || phone === '') {
    return null;
  }
  if (!E164_PATTERN.test(phone)) {
    throw new AppError(
      ERROR_CODES.AUTH_PHONE_INVALID,
      'Phone must be E.164',
      400,
    );
  }
  return phone;
}
