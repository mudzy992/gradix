/**
 * Stanje obaveze — JEDNA funkcija za cijeli sistem.
 *
 * Isti odgovor mora dati baza (`obligation_state()` u migraciji R2b) i ekran. Zato je formula
 * ovdje zapisana tačno kako je u SQL-u, a test `obligations.test.ts` je poredi sa tabelom
 * slučajeva iz kapije R2b. Ako se pravilo promijeni na jednom mjestu, padne test — što je i
 * cilj: dva različita odgovora na „da li je isteklo“ su gori od jednog pogrešnog.
 *
 * Pravilo (docs/PLAN-R2.md §3.4):
 *   superseded  → postoji novija verzija, ovaj red je historija
 *   no_expiry   → nema roka (npr. garancija bez datuma)
 *   expired     → rok je PRIJE današnjeg poslovnog dana; dan isteka NIJE istekao
 *   expiring    → preostalo dana ≤ ZADNJI prag (najmanji), npr. 7 za {60,30,15,7}
 *   valid       → ostalo
 *
 * Zašto zadnji, a ne prvi prag: pragovi su „podsjeti me 60, 30, 15 i 7 dana prije“. Rok za 20
 * dana nije „uskoro istječe“ nego „važeće“ sa podsjetnikom koji je već prošao. Tako i kapija
 * R2b glasi: 20 dana → važeće, 5 dana → uskoro istječe, juče → isteklo.
 */

export const OBLIGATION_STATES = ["valid", "expiring", "expired", "superseded", "no_expiry"] as const;
export type ObligationState = (typeof OBLIGATION_STATES)[number];

export const OBLIGATION_STATE_LABELS: Record<ObligationState, string> = {
  valid: "Važeće",
  expiring: "Uskoro istječe",
  expired: "Isteklo",
  superseded: "Zamijenjeno",
  no_expiry: "Bez roka",
};

/** Redoslijed po hitnosti — lista rokova ide od najhitnijeg, ne abecedno. */
export const OBLIGATION_STATE_ORDER: Record<ObligationState, number> = {
  expired: 0,
  expiring: 1,
  valid: 2,
  no_expiry: 3,
  superseded: 4,
};

export function isObligationState(value: unknown): value is ObligationState {
  return typeof value === "string" && (OBLIGATION_STATES as readonly string[]).includes(value);
}

/**
 * Razlika u danima između dva poslovna datuma (`YYYY-MM-DD`).
 *
 * Računa se preko UTC ponoći, a ne preko `Date.now()`: poslovni datum je kalendar, ne trenutak,
 * pa ljetnje/zimsko vrijeme ne smije pomjeriti rezultat za jedan dan.
 */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

export function obligationState(input: {
  /** Rok u obliku `YYYY-MM-DD`; `null` znači „bez roka“. */
  expiresAt: string | null;
  /** Pragovi tipa u danima, npr. `[60, 30, 15, 7]`; prazan niz = tip ne upozorava prije isteka. */
  thresholds: readonly number[];
  /** Današnji POSLOVNI datum firme (`businessDate(new Date(), timezone)`). */
  today: string;
  /** `true` kad postoji novija verzija — red je historija, ne aktuelno stanje. */
  superseded?: boolean;
}): ObligationState {
  if (input.superseded) return "superseded";
  if (!input.expiresAt) return "no_expiry";

  const daysLeft = daysBetween(input.today, input.expiresAt);
  if (Number.isNaN(daysLeft)) return "no_expiry";
  if (daysLeft < 0) return "expired";

  const lastThreshold = input.thresholds.length === 0 ? 0 : Math.min(...input.thresholds);
  // Rok koji istječe danas ima 0 dana i uvijek je unutar zadnjeg praga (i kad pragova nema).
  if (daysLeft <= lastThreshold) return "expiring";
  return "valid";
}

/**
 * Koliko dana ostaje do roka, za prikaz („za 5 dana“, „prije 3 dana“).
 * Vraća `null` kad roka nema — bolje prazno nego izmišljen broj.
 */
export function daysLeft(today: string, expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const value = daysBetween(today, expiresAt);
  return Number.isNaN(value) ? null : value;
}

/** Pragovi iz baze stižu kao `{60,30,15,7}` (pg `INT[]`); ovdje se čitaju u niz brojeva. */
export function parseThresholds(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((day) => Number.isFinite(day) && day >= 0);
  if (typeof value !== "string") return [];
  const inner = value.replace(/^\{|\}$/g, "");
  if (inner.trim() === "") return [];
  return inner
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isFinite(day) && day >= 0);
}
