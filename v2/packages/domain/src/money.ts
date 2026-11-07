/**
 * Novac: jedan tip, jedno zaokruživanje, valuta uvijek uz iznos (A3.3.2).
 *
 * Iznos se drži kao cijeli broj "cents" (BigInt) — nikad float. Ulaz i izlaz su
 * decimalni stringovi, jer tako iznos putuje i kroz API (B: decimal u bazi, string u API-ju).
 * Valuta je dio tipa, pa sabiranje dvije valute ne prolazi tipski ni u runtime-u.
 */

export const SUPPORTED_CURRENCIES = ["BAM", "EUR", "USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export type Money = Readonly<{ cents: bigint; currency: Currency }>;

/** Maksimum kolone numeric(12,2): 9.999.999.999,99 */
const MAX_CENTS = 999_999_999_999n;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const MONEY_PATTERN = /^-?\d{1,10}(?:\.\d{1,2})?$/;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Parsira decimalni string u Money. Odbija: prazno, razmake, zarez kao decimalni znak,
 * više od dvije decimale, više od 10 cijelih cifara, eksponent i beskonačno.
 * Namjerno strogo: tiho zaokruživanje korisničkog unosa je izvor grešaka u novcu.
 */
export function money(amount: string, currency: Currency): Money {
  if (!isCurrency(currency)) throw new MoneyError(`Nepodržana valuta: ${String(currency)}`);
  if (typeof amount !== "string") throw new MoneyError("Iznos mora biti decimalni string");
  if (!MONEY_PATTERN.test(amount)) throw new MoneyError(`Neispravan iznos: "${amount}"`);

  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  const signed = negative ? -cents : cents;
  if (signed > MAX_CENTS || signed < -MAX_CENTS) throw new MoneyError("Iznos je izvan opsega");
  return { cents: signed, currency };
}

export function zero(currency: Currency): Money {
  return { cents: 0n, currency };
}

export function toAmountString(value: Money): string {
  const negative = value.cents < 0n;
  const abs = negative ? -value.cents : value.cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Miješane valute: ${a.currency} i ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { cents: a.cents + b.cents, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { cents: a.cents - b.cents, currency: a.currency };
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.cents < b.cents) return -1;
  if (a.cents > b.cents) return 1;
  return 0;
}

export function sum(values: readonly Money[]): Money {
  const first = values[0];
  if (!first) throw new MoneyError("Prazan zbir nema valutu");
  return values.reduce((acc, item) => add(acc, item), zero(first.currency));
}

/**
 * Množenje cijelim faktorom (količina, broj sati izražen u stotim dijelovima).
 * Za razlomljene faktore koristi `allocate` — jedno mjesto za zaokruživanje.
 */
export function multiplyByInteger(value: Money, factor: number): Money {
  if (!Number.isSafeInteger(factor)) throw new MoneyError("Faktor mora biti cijeli broj");
  return { cents: value.cents * BigInt(factor), currency: value.currency };
}

/**
 * Zaokruživanje je na jednom mjestu: pola naviše (pola odmiče od nule), na dvije decimale.
 * Koristi se za iznos koji nastaje iz razlomka (npr. satnica × sati).
 */
export function roundToCents(numerator: bigint, denominator: bigint, currency: Currency): Money {
  if (denominator === 0n) throw new MoneyError("Dijeljenje s nulom");
  const negative = numerator < 0n !== denominator < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const rounded = remainder * 2n >= absDen ? quotient + 1n : quotient;
  return { cents: negative ? -rounded : rounded, currency };
}
