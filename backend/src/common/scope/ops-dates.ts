import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';
import {
  GEOFENCE_RADIUS_MAX,
  GEOFENCE_RADIUS_MIN,
  PROJECT_CODE_PATTERN,
} from '../constants';

export function assertPlannedRange(
  start?: Date | null,
  end?: Date | null,
): void {
  if (start && end && end < start) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'plannedEnd must be >= plannedStart',
      400,
    );
  }
}

export function assertGeofenceRadius(radius: number): void {
  if (radius < GEOFENCE_RADIUS_MIN || radius > GEOFENCE_RADIUS_MAX) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'geofenceRadius must be 10–5000',
      400,
    );
  }
}

export function normalizeProjectCode(code?: string | null): string | null {
  if (!code || code.trim() === '') {
    return null;
  }
  const value = code.trim().toUpperCase();
  if (!PROJECT_CODE_PATTERN.test(value)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Invalid project code',
      400,
    );
  }
  return value;
}

export function normalizeMachineCode(code?: string | null): string | null {
  if (!code || code.trim() === '') {
    return null;
  }
  const value = code.trim().toUpperCase();
  if (!PROJECT_CODE_PATTERN.test(value)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Invalid machine code',
      400,
    );
  }
  return value;
}

export function parseOptionalDate(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid date', 400);
  }
  return parsed;
}
