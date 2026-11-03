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

/**
 * BE-10 — par koordinata koji je **opcion** (tura, depo). Dozvoljeno je dati oba ili nijedan;
 * jedan bez drugog je greška klijenta (tačka bez širine ili dužine nema smisla).
 */
export function parseOptionalLatLng(
  latRaw?: string,
  lngRaw?: string,
): { lat: Prisma.Decimal | null; lng: Prisma.Decimal | null } {
  const hasLat = latRaw !== undefined && latRaw !== '';
  const hasLng = lngRaw !== undefined && lngRaw !== '';
  if (!hasLat && !hasLng) {
    return { lat: null, lng: null };
  }
  if (hasLat !== hasLng) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'lat and lng must be provided together',
      400,
    );
  }
  return parseLatLng(latRaw as string, lngRaw as string);
}
