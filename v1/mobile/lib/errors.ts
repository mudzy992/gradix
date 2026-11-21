import { i18n } from '@/i18n';
import { ApiError } from '@/lib/api-types';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    if (i18n.exists(key)) {
      return i18n.t(key);
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return i18n.t('errors.INTERNAL_ERROR');
}
