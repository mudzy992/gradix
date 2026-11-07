import { Prisma } from '../../generated/client';

/** Real decimal.js via generated Prisma; test doubles must not reimplement it. */
export function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
