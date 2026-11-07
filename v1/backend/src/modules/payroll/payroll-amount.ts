import { Prisma } from '../../../generated/client';

export function payrollAmount(
  durationMinutes: number,
  hourlyRate: Prisma.Decimal | null,
): Prisma.Decimal {
  if (!hourlyRate) {
    return new Prisma.Decimal(0);
  }
  return hourlyRate.mul(durationMinutes).div(60).toDecimalPlaces(2);
}

export type RateSource = {
  hourlyRateSnapshot: Prisma.Decimal | null;
  user: { hourlyRate: Prisma.Decimal | null };
};

/**
 * BE-14 (B12): mjerodavna satnica je **snapshot iz trenutka zatvaranja sesije**.
 * Fallback na trenutnu satnicu korisnika postoji samo za sesije zatvorene prije
 * uvođenja kolone (i za ručno unijete redove u testovima/seed-u).
 */
export function payrollRate(row: RateSource): Prisma.Decimal | null {
  return row.hourlyRateSnapshot ?? row.user.hourlyRate;
}
