import { SLUG_PATTERN } from '../constants';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

export function assertSlug(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError(
      ERROR_CODES.TENANT_SLUG_INVALID,
      'Slug must match [a-z0-9-]{3,40}',
      400,
    );
  }
  return slug;
}
