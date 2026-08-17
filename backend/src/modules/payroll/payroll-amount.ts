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
