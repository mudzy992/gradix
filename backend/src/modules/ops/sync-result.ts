import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { SyncItemErr, SyncItemOk, SyncItemType } from './sync.dto';

export function syncOk(
  localId: string,
  type: SyncItemType,
  serverId: string,
): SyncItemOk {
  return { localId, type, ok: true, serverId };
}

export function syncErr(
  localId: string,
  type: SyncItemType,
  error: AppError,
): SyncItemErr {
  return {
    localId,
    type,
    ok: false,
    code: error.code,
    message: error.message,
    details: error.details,
  };
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} is required`,
      400,
    );
  }
  return value;
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
