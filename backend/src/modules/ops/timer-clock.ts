import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { TIMER_STARTED_AT_FUTURE_SLACK_MS } from '../../common/constants';

export function rejectOnlineClientClock(dto: {
  startedAt?: unknown;
  durationMinutes?: unknown;
}): void {
  if (dto.startedAt !== undefined || dto.durationMinutes !== undefined) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'startedAt and durationMinutes are not allowed',
      400,
    );
  }
}

export function parseOfflineStartedAt(
  raw: unknown,
  now: Date,
  maxOpenHours: number,
): Date {
  const startedAt = parseIsoDate(raw, 'startedAt');
  if (startedAt.getTime() > now.getTime() + TIMER_STARTED_AT_FUTURE_SLACK_MS) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'startedAt is in the future',
      400,
    );
  }
  const oldestMs = now.getTime() - maxOpenHours * 60 * 60 * 1000;
  if (startedAt.getTime() < oldestMs) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'startedAt is older than timer.maxOpenHours',
      400,
    );
  }
  return startedAt;
}

export function parseOptionalClosedAt(
  raw: unknown,
  startedAt: Date,
  now: Date,
): Date {
  if (raw === undefined || raw === null) {
    return now;
  }
  const closedAt = parseIsoDate(raw, 'closedAt');
  if (closedAt.getTime() > now.getTime() + TIMER_STARTED_AT_FUTURE_SLACK_MS) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'closedAt is in the future',
      400,
    );
  }
  if (closedAt.getTime() < startedAt.getTime()) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'closedAt is before startedAt',
      400,
    );
  }
  return closedAt;
}

function parseIsoDate(raw: unknown, field: string): Date {
  if (typeof raw !== 'string') {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} is required`,
      400,
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `${field} is invalid`,
      400,
    );
  }
  return parsed;
}
