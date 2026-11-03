import { Prisma } from '../../../generated/client';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';
import { parseDecimal } from './decimal-input';

/**
 * BE-09 — geografske koordinate iz vanjskog svijeta (IoT uređaj, telefon) moraju biti
 * unutar stvarnih granica. Ranije se `lat: "999"` prihvatao i pisao u bazu (i na mapu).
 */
export const LAT_RANGE = { min: -90, max: 90 } as const;
export const LNG_RANGE = { min: -180, max: 180 } as const;

export function assertLatLng(lat: Prisma.Decimal, lng: Prisma.Decimal): void {
  if (lat.lt(LAT_RANGE.min) || lat.gt(LAT_RANGE.max)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'lat must be between -90 and 90',
      400,
    );
  }
  if (lng.lt(LNG_RANGE.min) || lng.gt(LNG_RANGE.max)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'lng must be between -180 and 180',
      400,
    );
  }
}

export function parseLatLng(
  latRaw: string,
  lngRaw: string,
): { lat: Prisma.Decimal; lng: Prisma.Decimal } {
  const lat = parseDecimal(latRaw, 'lat');
  const lng = parseDecimal(lngRaw, 'lng');
  assertLatLng(lat, lng);
  return { lat, lng };
}
