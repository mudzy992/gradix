/** R5.2 Money helpers for fuel entries (cents + unit price consistency). */
import { compare, money, roundToCents, type Currency, type Money } from "@gradix/domain";

export function parseFuelMoney(amount: string, currency: Currency): Money {
  return money(amount, currency);
}

export function litersToMilli(liters: number): bigint {
  const scaled = Math.round(liters * 1000);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new Error("FUEL_LITERS_INVALID");
  return BigInt(scaled);
}

export function assertUnitPriceConsistent(
  total: Money,
  liters: number,
  unitPriceCents: bigint | null,
): boolean {
  if (unitPriceCents === null) return true;
  const milli = litersToMilli(liters);
  const expected = roundToCents(unitPriceCents * milli, 1000n, total.currency);
  return compare(expected, total) === 0;
}