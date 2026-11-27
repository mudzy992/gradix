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

export const OBLIGATION_STATES = [
  "missing",
  "expired",
  "rejected",
  "pending_review",
  "expiring",
  "review_due",
  "valid",
  "no_expiry",
  "superseded",
] as const;
export type ObligationState = (typeof OBLIGATION_STATES)[number];

/**
 * Stanja koja BLOKIRAJU radnju (§15). `missing`, `pending_review` i `review_due` NIKAD ne
 * blokiraju: nedostatak dokumenta je stvar ureda, a ne razlog da radnik ostane bez dana.
 */
export const BLOCKING_OBLIGATION_STATES: readonly ObligationState[] = ["expired", "rejected"];

export const OBLIGATION_STATE_LABELS: Record<ObligationState, string> = {
  missing: "Nedostaje",
  expired: "Isteklo",
  rejected: "Odbijeno",
  pending_review: "Čeka provjeru",
  expiring: "Uskoro istječe",
  review_due: "Provjera dospjela",
  valid: "Važeće",
  no_expiry: "Bez roka",
  superseded: "Zamijenjeno",
};

/**
 * Redoslijed po hitnosti (§1.1 tačka 5) — lista rokova ide od najhitnijeg, ne abecedno.
 * `missing` je prvi jer je jedino stanje u kojem dokumenta NEMA.
 */
export const OBLIGATION_STATE_ORDER: Record<ObligationState, number> = {
  missing: 0,
  expired: 1,
  rejected: 2,
  pending_review: 3,
  expiring: 4,
  review_due: 5,
  valid: 6,
  no_expiry: 7,
  superseded: 8,
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

/** Stanje potvrde dokumenta (`obligations.review_state`). */
export const OBLIGATION_REVIEW_STATES = ["none", "pending_review", "rejected"] as const;
export type ObligationReviewState = (typeof OBLIGATION_REVIEW_STATES)[number];

export function obligationState(input: {
  /** Rok u obliku `YYYY-MM-DD`; `null` znači „bez roka“. */
  expiresAt: string | null;
  /** Pragovi tipa u danima, npr. `[60, 30, 15, 7]`; prazan niz = tip ne upozorava prije isteka. */
  thresholds: readonly number[];
  /** Današnji POSLOVNI datum firme (`businessDate(new Date(), timezone)`). */
  today: string;
  /** `true` kad postoji novija verzija — red je historija, ne aktuelno stanje. */
  superseded?: boolean;
  /** Datum do kojeg ured provjerava TRAJNU obavezu (`expires_at IS NULL`). */
  reviewAt?: string | null;
  /** Stanje potvrde; `rejected` blokira, `pending_review` samo upozorava. */
  reviewState?: ObligationReviewState;
}): ObligationState {
  if (input.superseded) return "superseded";
  // Odbijanje je ispred isteka: to je svježa odluka ureda. Isto kao SQL `obligation_state()`.
  if (input.reviewState === "rejected") return "rejected";

  const lastThreshold = input.thresholds.length === 0 ? 0 : Math.min(...input.thresholds);

  if (!input.expiresAt) {
    // Trajna obaveza: stanje nosi datum provjere, ne datum isteka. Bez `reviewAt` nema roka —
    // baza takav red odbija (`obligations_review_at_required_for_no_expiry`), pa je ovo samo
    // za redove iz starijih podataka.
    if (!input.reviewAt) return "no_expiry";
    const untilReview = daysBetween(input.today, input.reviewAt);
    if (Number.isNaN(untilReview)) return "no_expiry";
    if (untilReview < 0) return "expired";
    if (untilReview <= lastThreshold) return "review_due";
    return "no_expiry";
  }

  const left = daysBetween(input.today, input.expiresAt);
  if (Number.isNaN(left)) return "no_expiry";
  if (left < 0) return "expired";
  if (input.reviewState === "pending_review") return "pending_review";

  // Rok koji istječe danas ima 0 dana i uvijek je unutar zadnjeg praga (i kad pragova nema).
  if (left <= lastThreshold) return "expiring";
  return "valid";
}

/**
 * Pragovi za ovu obavezu: vlastiti `reminder_days` ako postoje, inače tipovi.
 * Vlastiti niz je „ovaj ugovor podsjeti 90 dana prije“, ne promjena politike firme.
 */
export function effectiveThresholds(
  obligationReminderDays: readonly number[] | null | undefined,
  typeReminderDays: readonly number[],
): number[] {
  if (obligationReminderDays && obligationReminderDays.length > 0) return [...obligationReminderDays];
  return [...typeReminderDays];
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

// ---------------------------------------------------------------------------
// „Nedostaje“ — obaveza koje NEMA (spec 02 §1.1 tačka 2)
// ---------------------------------------------------------------------------
/**
 * Zašto izračun, a ne red u bazi: `missing` je odsustvo reda. Da je kolona, brisanje radnika bi
 * ostavljalo redove koji tvrde da nešto nedostaje osobi koje više nema. Ovako `missing` nestaje
 * sam, bez posla za održavanje.
 *
 * Ovaj modul je čista funkcija nad podacima koje servis učita — tako ga testira jedan fajl, a
 * isti rezultat daju web, mobilni i worker.
 */

/** Entitet na koji se pravilo odnosi. Isti skup kao `obligation_requirements.entity_kind`. */
export type RequirementEntityKind = "WORKER" | "MACHINE" | "PROJECT";

/** Opseg primjene pravila. `ALL` znači „svaki entitet tog roda“. */
export type RequirementScope = "ALL" | "ENGAGEMENT" | "MACHINE_CATEGORY" | "PROJECT";

export type ObligationRequirement = {
  id: string;
  entityKind: RequirementEntityKind;
  typeId: string;
  appliesScope: RequirementScope;
  appliesValue: string | null;
  isRequired: boolean;
  isActive: boolean;
};

/** Entitet koji se provjerava. Dovoljno polje za opseg i za prikaz. */
export type RequirementSubject = {
  id: string;
  kind: RequirementEntityKind;
  /** Samo za radnike i mašine: `true` kad entitet više nije u upotrebi. */
  isActive: boolean;
  /** Za `ENGAGEMENT` opseg (radnik) — vrsta angažmana. */
  engagementKind?: string | null;
  /** Za `MACHINE_CATEGORY` opseg. */
  categoryId?: string | null;
  /** Za `PROJECT` opseg — projekat iz veze, ako postoji. */
  projectId?: string | null;
};

/** Postojeća obaveza, svedena na ono što odlučuje da li zahtjev pokriva. */
export type ExistingObligation = {
  typeId: string;
  /** `null` kad je obaveza trajna (`no_expiry`). */
  expiresAt: string | null;
  superseded: boolean;
};

export type MissingObligation = {
  entityKind: RequirementEntityKind;
  entityId: string;
  typeId: string;
  requirementId: string;
  /** Stanje je uvijek `missing` — polje postoji da red ide u istu listu kao ostale obaveze. */
  state: "missing";
};

/**
 * Da li pravilo važi za ovaj entitet.
 *
 * Deaktiviran entitet izlazi iz `missing` (§1.2 tačka 9): radnik na neplaćenom dopustu ili
 * mašina u rashodu ne treba da puni listu nedostataka — lista služi za akciju, ne za statistiku.
 */
export function requirementApplies(
  requirement: ObligationRequirement,
  subject: RequirementSubject,
): boolean {
  if (!requirement.isActive || !requirement.isRequired) return false;
  if (requirement.entityKind !== subject.kind) return false;
  if (!subject.isActive) return false;

  switch (requirement.appliesScope) {
    case "ALL":
      return true;
    case "ENGAGEMENT":
      return (subject.engagementKind ?? null) === requirement.appliesValue;
    case "MACHINE_CATEGORY":
      return (subject.categoryId ?? null) === requirement.appliesValue;
    case "PROJECT":
      // Radnik/mašina na projektu: pravilo važi kad je entitet vezan na TAJ projekat.
      return (subject.projectId ?? null) === requirement.appliesValue;
    default:
      return false;
  }
}

/**
 * Da li postojeća obaveza POKRIVA zahtjev.
 *
 * Pokriva i istekla obaveza: „nedostaje“ znači „nikad nije unesena“, a ne „treba obnoviti“.
 * Istekla obaveza se vidi u listi kao `expired` i ima svoj red za obnovu. Da je i istekla
 * „missing“, ista stvar bi se pojavila dvaput i korisnik ne bi znao šta da radi.
 *
 * Zamijenjena (`superseded`) NE pokriva: to je historija, a ako novija verzija postoji, ona je
 * ta koja pokriva.
 */
export function obligationCoversRequirement(
  existing: readonly ExistingObligation[],
  typeId: string,
): boolean {
  return existing.some((item) => item.typeId === typeId && !item.superseded);
}

/**
 * Sve obaveze koje nedostaju za jedan entitet.
 *
 * Ulaz su SVA pravila firme i SVE obaveze entiteta; filtriranje je ovdje, a ne u SQL-u, jer se
 * ista funkcija koristi i za ekran i za „Kreiraj sve nedostajuće“ i za podsjetnike.
 */
export function missingObligationsForSubject(input: {
  subject: RequirementSubject;
  requirements: readonly ObligationRequirement[];
  existing: readonly ExistingObligation[];
}): MissingObligation[] {
  const { subject, requirements, existing } = input;
  const seen = new Set<string>();
  const missing: MissingObligation[] = [];

  for (const requirement of requirements) {
    if (!requirementApplies(requirement, subject)) continue;
    // Dva pravila istog tipa (npr. `ALL` i `MACHINE_CATEGORY`) ne smiju dati dva nedostatka:
    // traži se JEDNA obaveza tog tipa, ne dvije.
    if (seen.has(requirement.typeId)) continue;
    if (obligationCoversRequirement(existing, requirement.typeId)) continue;
    seen.add(requirement.typeId);
    missing.push({
      entityKind: subject.kind,
      entityId: subject.id,
      typeId: requirement.typeId,
      requirementId: requirement.id,
      state: "missing",
    });
  }

  return missing;
}

/**
 * Grupisanje za listu: po tipu, pa po entitetu. Ekran „Nedostaje“ prikazuje „Ljekarski — 7
 * radnika“ i otvara spisak imena, a ne 7 odvojenih redova istog naslova.
 */
export function groupMissingByType(
  items: readonly MissingObligation[],
): Array<{ typeId: string; entityKind: RequirementEntityKind; count: number; ids: string[] }> {
  const map = new Map<string, { typeId: string; entityKind: RequirementEntityKind; count: number; ids: string[] }>();
  for (const item of items) {
    const key = `${item.entityKind}:${item.typeId}`;
    const entry = map.get(key);
    if (entry) {
      entry.count += 1;
      entry.ids.push(item.entityId);
    } else {
      map.set(key, { typeId: item.typeId, entityKind: item.entityKind, count: 1, ids: [item.entityId] });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.typeId.localeCompare(b.typeId));
}

/** Redoslijed liste obaveza: hitnost pa rok; `missing` nema rok, pa ide po tipu. */
export function compareObligationUrgency(
  a: { state: ObligationState; expiresAt: string | null; reviewAt?: string | null },
  b: { state: ObligationState; expiresAt: string | null; reviewAt?: string | null },
): number {
  const byState = OBLIGATION_STATE_ORDER[a.state] - OBLIGATION_STATE_ORDER[b.state];
  if (byState !== 0) return byState;
  const aDate = a.expiresAt ?? a.reviewAt ?? "9999-12-31";
  const bDate = b.expiresAt ?? b.reviewAt ?? "9999-12-31";
  return aDate.localeCompare(bDate);
}
