/**
 * F5 (Modul 6): projekti kao finansijski kontejner — napredak, marža, EAC, pragovi budžeta.
 *
 * Sve što je „računica“ živi ovdje, a ne u servisu ni u ekranu: isti broj mora izaći na listi
 * projekata, u detalju, u workeru koji šalje upozorenja i u testu. Zato su funkcije čiste
 * (ulaz = redovi iz baze, izlaz = broj), bez ijednog upita.
 *
 * Novac je `bigint` centi (vidi `money.ts`). Nigdje se ne koristi `number` za iznos: 0.1 + 0.2
 * u novcu nije stvar stila.
 */
import { MoneyError, roundToCents, type Currency, type Money } from "./money";

export const PHASE_STATUSES = ["PLANNED", "ACTIVE", "DONE", "CANCELLED"] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  PLANNED: "U planu",
  ACTIVE: "U toku",
  DONE: "Završena",
  CANCELLED: "Otkazana",
};

/**
 * Izvori troška — ZATVOREN spisak, isti kao `CHECK` u bazi (spec 06 §1.3.11).
 *
 * Redoslijed nije proizvoljan: ide od najčešćeg izvora ka ručnom unosu, pa ekran sa filterom
 * nudi iste redove svaki put.
 */
export const COST_SOURCE_TYPES = [
  "WORKDAY",
  "MACHINE_WORK_LOG",
  "FUEL_ENTRY",
  "HAUL",
  "SERVICE_ORDER",
  "PURCHASE",
  "SUBCONTRACTOR",
  "MANUAL",
] as const;
export type CostSourceType = (typeof COST_SOURCE_TYPES)[number];

export const COST_SOURCE_LABELS: Record<CostSourceType, string> = {
  WORKDAY: "Dan rada",
  MACHINE_WORK_LOG: "Sati mašine",
  FUEL_ENTRY: "Gorivo",
  HAUL: "Tura",
  SERVICE_ORDER: "Servis",
  PURCHASE: "Nabavka",
  SUBCONTRACTOR: "Podizvođač",
  MANUAL: "Ručni unos",
};

/** Ključevi zadanih kategorija (§1.2.6). Firma ih može preimenovati, ali ovi ostaju. */
export const DEFAULT_COST_CATEGORIES = [
  { code: "RAD", name: "Rad", sortOrder: 10, sourceType: "WORKDAY" },
  { code: "MEHANIZACIJA", name: "Mehanizacija", sortOrder: 20, sourceType: "MACHINE_WORK_LOG" },
  { code: "GORIVO", name: "Gorivo", sortOrder: 30, sourceType: "FUEL_ENTRY" },
  { code: "MATERIJAL", name: "Materijal", sortOrder: 40, sourceType: "PURCHASE" },
  { code: "PODIZVOĐAČI", name: "Podizvođači", sortOrder: 50, sourceType: "SUBCONTRACTOR" },
  { code: "TRANSPORT", name: "Transport", sortOrder: 60, sourceType: "HAUL" },
  { code: "OSTALO", name: "Ostalo", sortOrder: 99, sourceType: null },
] as const satisfies readonly {
  code: string;
  name: string;
  sortOrder: number;
  sourceType: CostSourceType | null;
}[];

/** Kategorija u koju ide izvor bez mapiranja (§1.3.14). */
export const FALLBACK_COST_CATEGORY_CODE = "OSTALO";

export const COST_ENTRY_STATUSES = ["POSTED", "PENDING", "REVERSED"] as const;
export type CostEntryStatus = (typeof COST_ENTRY_STATUSES)[number];

export const COST_ENTRY_STATUS_LABELS: Record<CostEntryStatus, string> = {
  POSTED: "Proknjiženo",
  PENDING: "Čeka cijenu",
  REVERSED: "Stornirano",
};

export const PROGRESS_SOURCES = ["MANUAL", "BOQ"] as const;
export type ProgressSource = (typeof PROGRESS_SOURCES)[number];

export const BUDGET_THRESHOLD_PCTS = [80, 100] as const;
export type BudgetThresholdPct = (typeof BUDGET_THRESHOLD_PCTS)[number];

export type PhaseProgressInput = {
  /** Težina faze; `null` je greška za dio posla (vidi `projectProgress`). */
  weight: number | null;
  progressPct: number;
  status?: PhaseStatus;
};

/**
 * Ukupni napredak projekta = `Σ(progress × weight) / Σweight` (§1.1.2).
 *
 * Otkazane faze se NE broje: faza koja je otkazana nije „0 % urađeno“, ona nije posao. Da se
 * broji, otkazivanje bi trajno spustilo napredak projekta bez ijednog stvarnog sata manje.
 *
 * `null` težina nije nula: težina je obavezna (§1.1.2), a tiha zamjena nulom bi dala dijeljenje
 * s nulom ili lažni napredak. Zato baca — pozivalac mora odlučiti (validacija prije upisa).
 */
export function projectProgress(phases: readonly PhaseProgressInput[]): number | null {
  const counted = phases.filter((phase) => phase.status !== "CANCELLED");
  if (counted.length === 0) return null;
  let weightSum = 0;
  let weighted = 0;
  for (const phase of counted) {
    if (phase.weight === null || !Number.isFinite(phase.weight) || phase.weight <= 0) {
      throw new MoneyError("Faza bez težine ne može ući u ukupni napredak.");
    }
    if (!Number.isFinite(phase.progressPct) || phase.progressPct < 0 || phase.progressPct > 100) {
      throw new MoneyError("Napredak faze mora biti između 0 i 100.");
    }
    weightSum += phase.weight;
    weighted += phase.progressPct * phase.weight;
  }
  if (weightSum <= 0) return null;
  return Math.round((weighted / weightSum) * 100) / 100;
}

export type BoqItemProgressInput = {
  quantityPlanned: number;
  quantityExecuted: number;
  unitPriceCents: bigint;
};

/**
 * Napredak iz predmjera (§1.4.19): `Σ(izvedeno × cijena) / Σ(planirano × cijena)`.
 *
 * Vrijednosno, a ne količinski: 100 m³ betona i 1000 m² oplate nisu jednaki dio posla. Stavka
 * bez planirane količine se preskače — nije 0 %, nego stavka koja još nema plan.
 */
export function boqProgress(items: readonly BoqItemProgressInput[]): number | null {
  let planned = 0n;
  let executed = 0n;
  for (const item of items) {
    if (!(item.quantityPlanned > 0) || item.unitPriceCents <= 0n) continue;
    const plannedValue = BigInt(Math.round(item.quantityPlanned * 1000)) * item.unitPriceCents;
    planned += plannedValue;
    const executedQty = Math.min(Math.max(item.quantityExecuted, 0), item.quantityPlanned);
    executed += BigInt(Math.round(executedQty * 1000)) * item.unitPriceCents;
  }
  if (planned <= 0n) return null;
  if (executed >= planned) return 100;
  // Dvije decimale bez float-a: (executed / planned) × 100 → zaokruženo na 2 mjesta.
  const scaled = (executed * 100_00n) / planned;
  return Number(scaled) / 100;
}

export type MarginInput = {
  contractValueCents: bigint | null;
  /** Zbir ODOBRENIH aneksa; `DRAFT` ne ulazi (§1.5.21). */
  approvedAmendmentCents: bigint;
  /** Samo `POSTED` trošak; `PENDING` nije trošak (§1.8.29). */
  postedCostCents: bigint;
  currency: Currency;
};

export type MarginResult = {
  /** Vrijednost sa aneksima, ili `null` kad ugovorena vrijednost nije unesena. */
  contractWithAmendments: Money | null;
  /** `null` kad nema ugovorene vrijednosti — marža bez prihoda nije „100 %“. */
  margin: Money | null;
  marginPct: number | null;
  cost: Money;
};

/**
 * Marža = vrijednost sa aneksima − `POSTED` trošak (§1.8.29).
 *
 * `PENDING` trošak se NE oduzima: on nije poznat iznos, a marža sa izmišljenom nulom bi bila
 * lažno dobra. Zato ekran `PENDING` prikazuje odvojeno kao rizik.
 */
export function projectMargin(input: MarginInput): MarginResult {
  const cost: Money = { cents: input.postedCostCents, currency: input.currency };
  if (input.contractValueCents === null) {
    return { contractWithAmendments: null, margin: null, marginPct: null, cost };
  }
  const total = input.contractValueCents + input.approvedAmendmentCents;
  const margin: Money = { cents: total - input.postedCostCents, currency: input.currency };
  const marginPct = total > 0n ? Number((margin.cents * 100_00n) / total) / 100 : null;
  return {
    contractWithAmendments: { cents: total, currency: input.currency },
    margin,
    marginPct,
    cost,
  };
}

export type EacInput = {
  postedCostCents: bigint;
  /** Ukupni napredak projekta (0–100); `null` = nema faza. */
  progressPct: number | null;
  currency: Currency;
};

export type EacResult = {
  /**
   * Uvijek `ESTIMATE`, nikad uknjižen iznos (§1.8.30). Klijent po ovome zna da broj nije
   * knjigovodstveni.
   */
  kind: "EAC_ESTIMATE";
  /** `null` kad napredak nije poznat ili je 0 — nema dijeljenja nulom. */
  amount: Money | null;
  reason: "NO_PROGRESS" | null;
};

/**
 * EAC = `POSTED trošak do sada / ostvareni %` (§1.8.30) — **procjena**, jasno označena.
 *
 * Pri `progress_pct = 0` (ili bez faza) vraća `amount: null`: projektovati konačan trošak iz
 * nula procenata bi značilo dijeljenje nulom, a svaka zamjena (npr. „ostatak budžeta“) je druga
 * formula koja se ne zove EAC.
 */
export function estimateAtCompletion(input: EacInput): EacResult {
  if (!input.progressPct || input.progressPct <= 0) {
    return { kind: "EAC_ESTIMATE", amount: null, reason: "NO_PROGRESS" };
  }
  const pctMilli = BigInt(Math.round(input.progressPct * 1000));
  if (pctMilli <= 0n) {
    return { kind: "EAC_ESTIMATE", amount: null, reason: "NO_PROGRESS" };
  }
  // cost / (pct/100) = cost × 100 / pct; pct je u hiljaditim dijelovima procenta.
  const amount = roundToCents(input.postedCostCents * 100_000n, pctMilli, input.currency);
  return { kind: "EAC_ESTIMATE", amount, reason: null };
}

export type BudgetThresholdInput = {
  budgetCents: bigint;
  /** `POSTED` trošak u opsegu (ukupno ili kategorija). */
  spentCents: bigint;
  /** Revizija budžeta na koju se prag odnosi; dio je `dedupe_key`. */
  revision: number;
};

export type BudgetThresholdCrossing = {
  thresholdPct: BudgetThresholdPct;
  /** Stvarni procenat potrošnje, za tekst poruke. */
  usedPct: number;
};

/**
 * Koji su pragovi pređeni (§1.7.26).
 *
 * Vraća NAJVIŠI pređeni prag, ne sve: prelazak na 95 % znači da je 80 % odavno prošlo i da ne
 * treba dva obavještenja. Prag 100 % se šalje i kad je tačno 100 (potrošeno = budžet) — to je
 * „budžet je potrošen“, a ne „skoro potrošen“.
 *
 * Budžet 0 ili negativan nema prag: bez budžeta nema ni procenta.
 */
export function crossedBudgetThreshold(
  input: BudgetThresholdInput,
): BudgetThresholdCrossing | null {
  if (input.budgetCents <= 0n) return null;
  const usedPct = Number((input.spentCents * 100_00n) / input.budgetCents) / 100;
  if (input.spentCents >= input.budgetCents) return { thresholdPct: 100, usedPct };
  if (input.spentCents * 100n >= input.budgetCents * 80n) return { thresholdPct: 80, usedPct };
  return null;
}

/** `dedupe_key` upozorenja: projekat + revizija + opseg + prag (§1.7.27). */
export function budgetAlertDedupeKey(params: {
  projectId: string;
  revision: number;
  /** `TOTAL` ili šifra kategorije. */
  scope: string;
  thresholdPct: number;
}): string {
  return `${params.projectId}:${params.revision}:${params.scope}:${params.thresholdPct}`;
}

export type CloseChecklistItem = {
  key: "ASSIGNMENTS" | "FAULTS" | "OBLIGATIONS" | "PENDING_COSTS" | "PHASES";
  label: string;
  ok: boolean;
  /** Koliko je otvorenih stavki; 0 kad je `ok`. */
  count: number;
  /** Za `PENDING_COSTS`: eksplicitno prihvaćanje uz razlog ga pretvara u zeleno. */
  acceptable?: boolean;
};

export type CloseChecklist = {
  items: CloseChecklistItem[];
  /** Sve stavke zelene (ili prihvaćene) — tek tada zatvaranje prolazi. */
  complete: boolean;
  blockers: string[];
};

/**
 * Kontrolna lista pri zatvaranju (§1.8.31).
 *
 * `PENDING` trošak je blokada, ali se može **svjesno prihvatiti** uz razlog: inače bi jedan
 * račun koji nije stigao držao projekat otvoren mjesecima, a ljudi bi zaobilazili zatvaranje.
 * Zato je prihvaćanje dio ulaza, a ne poseban prečac.
 */
export function closeChecklist(input: {
  openAssignments: number;
  openFaults: number;
  openObligations: number;
  pendingCosts: number;
  pendingAcceptedReason?: string | null;
  openPhases?: number;
}): CloseChecklist {
  const pendingAccepted =
    input.pendingCosts > 0 && (input.pendingAcceptedReason ?? "").trim().length >= 10;
  const items: CloseChecklistItem[] = [
    {
      key: "ASSIGNMENTS",
      label: "Sve dodjele zatvorene",
      ok: input.openAssignments === 0,
      count: input.openAssignments,
    },
    {
      key: "FAULTS",
      label: "Nema otvorenih zastoja mašina",
      ok: input.openFaults === 0,
      count: input.openFaults,
    },
    {
      key: "OBLIGATIONS",
      label: "Otvorene obaveze arhivirane",
      ok: input.openObligations === 0,
      count: input.openObligations,
    },
    {
      key: "PENDING_COSTS",
      label: "Nema troškova bez cijene",
      ok: input.pendingCosts === 0 || pendingAccepted,
      count: input.pendingCosts,
      acceptable: true,
    },
  ];
  if (input.openPhases !== undefined) {
    items.push({
      key: "PHASES",
      label: "Sve faze završene ili otkazane",
      ok: input.openPhases === 0,
      count: input.openPhases,
    });
  }
  const blockers = items.filter((item) => !item.ok).map((item) => item.key);
  return { items, complete: blockers.length === 0, blockers };
}

/** Pragovi po kategoriji i ukupno — jedan oblik za servis, worker i ekran. */
export type BudgetScopeTotals = {
  scope: string;
  budgetCents: bigint;
  spentCents: bigint;
};
