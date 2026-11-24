/**
 * Modul 5 (Faza 4) — razložen trošak mašine, iskorištenost i odstupanje goriva.
 *
 * Zlatna pravila iz `docs/specs/05-mehanizacija.md`, i zašto baš tako:
 *
 *  1. **Trošak je zbir komponenti, ne jedan broj.** `PER_HOUR` ide 1:1, `PER_MONTH` se dijeli sa
 *     `planned_hours_per_month`, `PER_KM` se preslikava po kilometru. Bez razlaganja se ne može
 *     odgovoriti „zašto je sat 38 KM", a to je jedino pitanje koje vlasnik postavi.
 *  2. **Mjesečna rata se dijeli, ne sabira.** Ista depresijacija na 160 i na 320 sati mjesečno
 *     daje dvostruko različit trošak po satu — zato je nazivnik parametar firme.
 *  3. **Snapshot se pravi pri knjiženju.** Poslije promjene komponente stari trošak MORA ostati
 *     objašnjiv; izračun pri čitanju bi ga tiho prepisao.
 *  4. **Iskorištenost ima JEDNU definiciju** (`WORK / (WORK + IDLE + BREAKDOWN)`) i drugu kolonu
 *     (`WORK / kalendarski radni sati`) — dvije brojke, dva pitanja, nikad zamjena.
 *  5. **Odstupanje goriva je prag, ne procjena.** Iznad praga upozorenje; ispod ne. `OPEN` se ne
 *     zatvara tiho — traži razlog.
 */
import { MoneyError, roundToCents, type Currency, type Money } from "./money";

export const COST_COMPONENTS = [
  "DEPRECIATION",
  "FUEL",
  "SERVICE",
  "OPERATOR",
  "INSURANCE",
  "OTHER",
  "RENTAL",
] as const;
export type CostComponent = (typeof COST_COMPONENTS)[number];

export const COST_BASES = ["PER_HOUR", "PER_MONTH", "PER_KM"] as const;
export type CostBasis = (typeof COST_BASES)[number];

/** Jedna komponenta sa periodom važenja — ono što baza vraća i što ulazi u snapshot. */
export type CostComponentRow = {
  component: CostComponent;
  basis: CostBasis;
  amountCents: bigint;
  currencyCode: string;
};

/** Default iz spec 05 §1.1.2 — 160 h/mjesec. */
export const DEFAULT_PLANNED_HOURS_PER_MONTH = 160;

export type ComputedRate = {
  /** Stopa po satu u centima, zaokružena JEDNOM, na kraju. */
  rateCents: bigint;
  /** Doprinos svake komponente — dio snapshot-a, ne UI ukras. */
  breakdown: { component: CostComponent; basis: CostBasis; centsPerHour: bigint }[];
  plannedHours: number;
};

/**
 * Izračunata stopa po satu iz komponenti.
 *
 * Zaokruživanje: svaka komponenta se zaokružuje na cent POJEDINAČNO, pa se sabira. Zašto ne
 * sabiranje pa jedno zaokruživanje: razlaganje mora da se sabere tačno u ukupnu stopu, inače
 * ekran pokaže kolone koje ne daju zbir — a korisnik tada ne vjeruje ni jednoj.
 */
export function computedRatePerHour(
  components: readonly CostComponentRow[],
  plannedHoursPerMonth: number = DEFAULT_PLANNED_HOURS_PER_MONTH,
): ComputedRate {
  if (!Number.isFinite(plannedHoursPerMonth) || plannedHoursPerMonth <= 0) {
    throw new MoneyError("Planirani sati mjesečno moraju biti pozitivni");
  }
  const breakdown: ComputedRate["breakdown"] = [];
  let total = 0n;
  for (const component of components) {
    if (component.amountCents < 0n) throw new MoneyError("Komponenta stope ne smije biti negativna");
    let centsPerHour: bigint;
    if (component.basis === "PER_HOUR") {
      centsPerHour = component.amountCents;
    } else if (component.basis === "PER_MONTH") {
      /*
       * Mjesečna rata / sati mjesečno. Dijeljenje ide u STOTIM DJELOVIMA CENTA, pa se na kraju
       * zaokruži na cent — 50000 / 160 = 312,5 → 313 (pola naviše). Bez međukoraka bi cjelobrojno
       * dijeljenje odbacilo ostatak i 312,5 postalo 312, pa bi sat bio jeftiniji nego što jeste.
       */
      const broker = component.amountCents * 100n; // stoti dio centa, da zaokruživanje bude tačno
      const sati = BigInt(Math.round(plannedHoursPerMonth));
      const stoti = (broker + sati / 2n) / sati; // zaokruženo na stoti dio centa
      centsPerHour = (stoti + 50n) / 100n; // zaokruženo na cent
    } else {
      /*
       * `PER_KM` ulazi u sat TEK kroz kilometražu; ovdje nosi nulu i to je ispravno: bez poznate
       * kilometraže po satu svaka brojka bi bila izmišljena. Kilometraža se dodaje pozivom
       * `rateWithKm`.
       */
      centsPerHour = 0n;
    }
    breakdown.push({ component: component.component, basis: component.basis, centsPerHour });
    total += centsPerHour;
  }
  return { rateCents: total, breakdown, plannedHours: plannedHoursPerMonth };
}

/**
 * Dodaje `PER_KM` komponente u stopu za konkretnu kilometražu.
 *
 * Odvojeno od `computedRatePerHour` jer kilometraža nije dio definicije stope — ista mašina ima
 * istu stopu na sat, a različit trošak po kilometru u zavisnosti od terena i relacije.
 */
export function rateWithKm(
  computed: ComputedRate,
  components: readonly CostComponentRow[],
  km: number,
): bigint {
  if (!Number.isFinite(km) || km < 0) throw new MoneyError("Kilometraža ne smije biti negativna");
  let extra = 0n;
  for (const component of components) {
    if (component.basis !== "PER_KM") continue;
    // km * centi/km, zaokruženo na cent (km može biti razlomljen: 12,4 km). Valuta dolazi iz same
    // komponente — stopa i kilometraža moraju biti u istoj valuti, inače je zbir besmislen.
    extra += roundToCents(
      component.amountCents * BigInt(Math.round(km * 1000)),
      1000n,
      component.currencyCode as Currency,
    ).cents;
  }
  return computed.rateCents + extra;
}

/* ================================================================ iskorištenost */

export type WorkLogMode = "WORK" | "IDLE" | "BREAKDOWN";

export type UtilizationRow = {
  /** Primarna kolona (spec 05 §1.2.8): `WORK / (WORK + IDLE + BREAKDOWN)`. */
  utilizationPct: number | null;
  /** Sekundarna kolona: `WORK / kalendarski radni sati` perioda. */
  calendarUtilizationPct: number | null;
  workHours: number;
  idleHours: number;
  breakdownHours: number;
};

/**
 * Iskorištenost iz zapisa rada.
 *
 * Zašto `null`, a ne `0`: mašina bez ijednog zapisa nije „0% iskorištena" — o njoj se ne zna
 * ništa. Nula bi u izvještaju izgledala kao izmjeren podatak i top/bottom lista bi je stavila na
 * dno, što je laž.
 */
export function utilization(rows: readonly { mode: WorkLogMode; hours: number }[], calendarHours: number): UtilizationRow {
  let work = 0;
  let idle = 0;
  let breakdown = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.hours) || row.hours < 0) throw new MoneyError("Sati zapisa nisu ispravni");
    if (row.mode === "WORK") work += row.hours;
    else if (row.mode === "IDLE") idle += row.hours;
    else breakdown += row.hours;
  }
  const total = work + idle + breakdown;
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    // Primarna: odnos prema VREMENU KOJE JE MAŠINA EVIDENTIRANA (bez zastoja van evidencije).
    utilizationPct: total > 0 ? round((work / total) * 100) : null,
    // Sekundarna: odnos prema kalendarskim radnim satima — koliko je od raspoloživog vremena
    // mašina radila. Nazivnik može biti 0 (praznik), pa je i tada `null`, ne beskonačno.
    calendarUtilizationPct:
      calendarHours > 0 ? round((work / calendarHours) * 100) : null,
    workHours: round(work),
    idleHours: round(idle),
    breakdownHours: round(breakdown),
  };
}

/* ================================================================ gorivo */

/**
 * Potrošnja po jedinici brojila (spec 05 §1.3.12).
 *
 * `l/h` za mašine sa brojilom sati, `l/100 km` za vozila. Vraća `null` kad je razlika brojila
 * nepoznata ili nula — dijeljenje nulom bi dalo beskonačno, a „0" bi bila lažna nula.
 */
export function fuelConsumption(input: {
  liters: number;
  meterStart: number | null;
  meterEnd: number | null;
  meter: "HOURS" | "KM";
}): { value: number; unit: "l/h" | "l/100km" } | null {
  if (!Number.isFinite(input.liters) || input.liters <= 0) return null;
  if (input.meterStart == null || input.meterEnd == null) return null;
  const delta = input.meterEnd - input.meterStart;
  if (!Number.isFinite(delta) || delta <= 0) return null;
  const round = (value: number) => Math.round(value * 100) / 100;
  return input.meter === "HOURS"
    ? { value: round(input.liters / delta), unit: "l/h" }
    : { value: round((input.liters / delta) * 100), unit: "l/100km" };
}

export type FuelDeviation = {
  /** Postotak iznad prosjeka; `null` kad nema osnova za poređenje. */
  deviationPct: number | null;
  /** Prelazi li prag firme (default 20%). */
  flagged: boolean;
};

/**
 * Odstupanje potrošnje od prosjeka (spec 05 §1.3.13).
 *
 * Zašto `>=` a ne `>`: prag je „20% iznad", pa 20,0% JESTE iznad. Test to drži — granica je
 * jedina stvar koju neko poslije „popravi" u `>` i time tiho propusti upravo slučaj sa granice.
 *
 * `baseline <= 0` daje `deviationPct: null` i `flagged: false`: bez prosjeka nema odstupanja, a
 * dijeljenje nulom bi prijavilo svako točenje kao odstupanje.
 */
export function fuelDeviation(input: {
  consumption: number;
  baseline: number;
  thresholdPct: number;
}): FuelDeviation {
  if (!Number.isFinite(input.consumption) || input.consumption < 0) {
    throw new MoneyError("Potrošnja nije ispravna");
  }
  if (!Number.isFinite(input.thresholdPct) || input.thresholdPct <= 0) {
    throw new MoneyError("Prag odstupanja mora biti pozitivan");
  }
  if (!Number.isFinite(input.baseline) || input.baseline <= 0) {
    return { deviationPct: null, flagged: false };
  }
  const pct = Math.round(((input.consumption - input.baseline) / input.baseline) * 10000) / 100;
  return { deviationPct: pct, flagged: pct >= input.thresholdPct };
}

/** Šifre razloga za zatvaranje upozorenja (spec 05 §1.3.13). */
export const FUEL_DEVIATION_REASONS = ["BREAKDOWN", "THEFT", "MISREAD", "OTHER"] as const;
export type FuelDeviationReason = (typeof FUEL_DEVIATION_REASONS)[number];

export type { Money };
