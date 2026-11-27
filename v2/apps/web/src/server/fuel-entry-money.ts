/** R5.2 Money helpers for fuel entries (cents + unit price consistency). */
import { compare, money, roundToCents, type Currency, type Money } from "@gradix/domain";

export function parseFuelMoney(amount: string, currency: Currency): Money {
  return money(amount, currency);
}

export type FuelAmountDecision =
  | { ok: true; cents: bigint | null; currency: Currency }
  | { ok: false; message: string };

/** Field roles omit the amount. Office must send a real amount, including a genuine zero. */
export function resolveFuelAmount(input: {
  canPrice: boolean;
  totalAmount: string | null | undefined;
  currency: Currency;
}): FuelAmountDecision {
  const raw = input.totalAmount?.trim() ?? "";
  if (!input.canPrice) {
    if (raw !== "") return { ok: false, message: "Cijenu unosi ured. Pošaljite samo litre." };
    return { ok: true, cents: null, currency: input.currency };
  }
  if (raw === "") return { ok: false, message: "Ured mora unijeti iznos. Nepoznat iznos nije 0.00." };
  try {
    const total = parseFuelMoney(raw, input.currency);
    if (total.cents < 0n) return { ok: false, message: "Iznos ne može biti negativan." };
    return { ok: true, cents: total.cents, currency: total.currency };
  } catch {
    return { ok: false, message: "Neispravan iznos." };
  }
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