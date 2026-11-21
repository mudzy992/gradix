/**
 * R6.1: trošak mašine — sati iz intervala i iznos = sati × stopa (Money centi).
 */
import { MoneyError, roundToCents, type Currency, type Money } from "./money";

const MS_PER_HOUR_THOUSANDTH = 3_600;

/** Trajanje u satima na 3 decimale (NUMERIC(12,3)). */
export function computeHoursFromInterval(startedAt: Date, endedAt: Date): number {
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
    throw new MoneyError("Neispravan početak intervala");
  }
  if (!(endedAt instanceof Date) || Number.isNaN(endedAt.getTime())) {
    throw new MoneyError("Neispravan kraj intervala");
  }
  const ms = endedAt.getTime() - startedAt.getTime();
  if (ms <= 0) throw new MoneyError("Interval mora biti pozitivan");
  return Math.round(ms / MS_PER_HOUR_THOUSANDTH) / 1000;
}

/** Iznos = sati × stopa (centi/h), zaokruženo preko roundToCents. */
export function computeCostAmount(
  hours: number,
  rateCents: bigint,
  currency: Currency,
): Money {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new MoneyError("Sati moraju biti pozitivni");
  }
  if (rateCents < 0n) throw new MoneyError("Stopa ne smije biti negativna");
  const hoursMilli = BigInt(Math.round(hours * 1000));
  if (hoursMilli <= 0n) throw new MoneyError("Sati moraju biti pozitivni");
  return roundToCents(rateCents * hoursMilli, 1000n, currency);
}
