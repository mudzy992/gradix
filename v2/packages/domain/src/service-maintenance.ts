/**
 * Servis i održavanje mašina — računi (spec 09).
 *
 * Sve u ovom fajlu je ČISTA funkcija: nema baze, nema satnice iz `worker_rates`, nema upita.
 * Servisni sloj donosi brojeve (sate, satnicu, dijelove), a ovdje se dobija iznos i stanje.
 * Zato iste formule koriste web, worker i mobilni, a zlatni testovi su jedan fajl.
 *
 * Tri stvari koje se ne smiju „izgubiti“ u servisu:
 *   1. `total = labor + parts + external` — zbir je IZVEDEN; ručni unos zbiŕa je broj koji ne
 *      odgovara dijelovima naloga, a upravo taj broj ide u ledger troška.
 *   2. Zastoj je `finished_at − started_at`, ne ručni broj minuta. Ručna korekcija postoji,
 *      ali je izuzetak koji traži razlog (i audit), ne put kojim ide svaki nalog.
 *   3. MTBF je radni sati / broj kvarova. Ako nema radnih sati, MTBF NE POSTOJI — nula bi
 *      izgledala kao „mašina se kvari stalno“, a istina je „ne znamo“.
 */

export type ServiceOrderStatus =
  | "PLANNED"
  | "APPROVED"
  | "IN_PROGRESS"
  | "WAITING_PARTS"
  | "DONE"
  | "CANCELLED";

export const SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = [
  "PLANNED",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "DONE",
  "CANCELLED",
];

/**
 * Matrica prelaza (spec 09 §1.1/1).
 *
 * `WAITING_PARTS ↔ IN_PROGRESS` je dvosmjerno jer je to STVARNO stanje radionice: dio nije
 * stigao, rad staje, dio stigne, rad se nastavlja. `DONE` nema izlaz (osim storna kroz novi
 * nalog) — završen rad se ne „nastavlja“, jer bi tada zastoj i trošak bili prepisani.
 */
const TRANSITIONS: Record<ServiceOrderStatus, readonly ServiceOrderStatus[]> = {
  PLANNED: ["APPROVED", "IN_PROGRESS", "CANCELLED"],
  APPROVED: ["IN_PROGRESS", "WAITING_PARTS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_PARTS", "DONE", "CANCELLED"],
  WAITING_PARTS: ["IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

export class ServiceError extends Error {
  constructor(
    public readonly code:
      | "SERVICE_ALREADY_DONE"
      | "SERVICE_INVALID_STATUS"
      | "SERVICE_APPROVAL_REQUIRED"
      | "EXTERNAL_QUOTE_REQUIRED"
      | "WARRANTY_CLAIM_ACTIVE"
      | "MAINTENANCE_OVERDUE",
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function isServiceOrderStatus(value: unknown): value is ServiceOrderStatus {
  return typeof value === "string" && (SERVICE_ORDER_STATUSES as readonly string[]).includes(value);
}

export function isServiceTerminal(status: ServiceOrderStatus): boolean {
  return status === "DONE" || status === "CANCELLED";
}

export function nextServiceStatuses(status: ServiceOrderStatus): readonly ServiceOrderStatus[] {
  return TRANSITIONS[status];
}

/** Baca se u servisu PRIJE upisa: nedozvoljen prelaz je 409, a ne tiho zanemarena promjena. */
export function assertServiceTransition(from: ServiceOrderStatus, to: ServiceOrderStatus): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    if (isServiceTerminal(from)) {
      throw new ServiceError(
        "SERVICE_ALREADY_DONE",
        `Nalog je u stanju „${from}“ i ne mijenja se — završen rad je zapis, ne radna verzija.`,
      );
    }
    throw new ServiceError(
      "SERVICE_INVALID_STATUS",
      `Prelaz „${from}“ → „${to}“ nije dozvoljen.`,
    );
  }
}

/* ------------------------------------------------------------------ trošak */

export type ServiceCostInput = {
  /** Sati mehaničara; `0` kad je servis vanjski. */
  laborHours: string | number;
  /** Satnica mehaničara na dan rada (Modul 4/7), u centima. */
  hourlyRateCents: bigint;
  partsCostCents?: bigint;
  externalCostCents?: bigint;
};

export type ServiceCost = {
  laborCostCents: bigint;
  partsCostCents: bigint;
  externalCostCents: bigint;
  totalCostCents: bigint;
};

/**
 * Sati × satnica, zaokruženo na cent POLA-NAVIŠE.
 *
 * Zašto ne `Math.round`: `0.5` sata po 33,33 KM je 16,665 KM → 16,67 (pola-naviše), a binarni
 * `float` bi to negdje dao 16,66. Sat i satnica se zato pretvaraju u cijele brojeve (stotinke
 * sata i centi), pa je dijeljenje tačno.
 */
export function serviceCost(input: ServiceCostInput): ServiceCost {
  const hoursHundredths = toHundredths(input.laborHours);
  const laborCostCents = divideRounded(hoursHundredths * input.hourlyRateCents, 100n);
  const partsCostCents = input.partsCostCents ?? 0n;
  const externalCostCents = input.externalCostCents ?? 0n;
  if (partsCostCents < 0n || externalCostCents < 0n || laborCostCents < 0n) {
    throw new ServiceError("SERVICE_INVALID_STATUS", "Trošak servisa ne može biti negativan.");
  }
  return {
    laborCostCents,
    partsCostCents,
    externalCostCents,
    totalCostCents: laborCostCents + partsCostCents + externalCostCents,
  };
}

/** Sati kao stotinke sata: `1.25` → `125n`. Više od dvije decimale je greška unosa. */
export function toHundredths(value: string | number): bigint {
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) {
    throw new ServiceError("SERVICE_INVALID_STATUS", `Neispravan broj sati: „${String(value)}“.`);
  }
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/* --------------------------------------------------------- zastoj i vrijeme */

/**
 * Stvarni zastoj u minutama. `finished` bez `started` je greška (popravka koja nije počela ne
 * može trajati), a negativan raspon je greška sata, ne podatak.
 */
export function downtimeMinutes(startedAt: string | Date | null, finishedAt: string | Date | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const minutes = Math.round((end - start) / 60_000);
  return minutes < 0 ? null : minutes;
}

/* ------------------------------------------------------------- pouzdanost */

export type ReliabilityOrder = {
  startedAt: string | null;
  finishedAt: string | null;
  status: ServiceOrderStatus;
  /**
   * Je li nalog nastao iz KVAR-a (`origin = 'FAULT'`). Samo kvarovi ulaze u MTBF — preventivni
   * servis je planiran i ne govori ništa o pouzdanosti mašine. Bez ovog polja bi „MTBF“ pao kad
   * firma radi redovno održavanje, što je suprotno od onoga što broj treba da kaže.
   */
  isFault?: boolean;
  /** Trošak koji ULAZI u održavanje: bez garancijskog naloga (spec 09 §1.7/32). */
  totalCostCents: bigint;
  warrantyClaim: boolean;
};

export type Reliability = {
  /** Broj kvarova (završenih naloga iz kvara) u periodu. */
  faultCount: number;
  /** Završeni nalozi sa izmjerenim trajanjem. */
  finishedCount: number;
  /** Prosječno trajanje popravke u minutama; `null` kad nijedan nalog nema oba vremena. */
  mttrMinutes: number | null;
  /** Radni sati mašine / broj kvarova; `null` kad nema radnih sati ili nema kvarova. */
  mtbfHours: string | null;
  /** Σ trošak održavanja u centima (garancijski nalozi ulaze kao 0). */
  maintenanceCostCents: bigint;
  /** Σ radnih sati mašine u periodu. */
  workHours: string;
  /** Trošak održavanja po satu rada; `null` kad nema radnih sati. */
  maintenanceCostPerHour: string | null;
};

/**
 * MTTR = prosjek `finished − started`; MTBF = radni sati / kvarovi; trošak/h = Σ trošak / sati.
 *
 * `hours` je decimalni string (npr. `"1250.50"`) da izračun ostane tačan bez `float`: pretvara se
 * u stotinke sata, pa je dijeljenje cjelobrojno. Vraća `null` kad imenilac nema smisla — nula bi
 * bila tvrdnja („kvari se na svaki sat“ / „besplatan servis“) koju podaci ne podržavaju.
 */
export function machineReliability(
  orders: readonly ReliabilityOrder[],
  workHourStrings: readonly string[],
): Reliability {
  const finished = orders.filter(
    (order) => order.status === "DONE" && order.startedAt && order.finishedAt,
  );
  const durations = finished
    .map((order) => downtimeMinutes(order.startedAt, order.finishedAt))
    .filter((value): value is number => value !== null);

  const faultCount = finished.filter((order) => order.isFault !== false).length;
  const mttrMinutes =
    durations.length === 0
      ? null
      : Math.round(durations.reduce((sumValue, value) => sumValue + value, 0) / durations.length);

  const workHundredths = workHourStrings.reduce((sumValue, value) => sumValue + toHundredths(value), 0n);
  const workHours = formatHundredths(workHundredths);

  const maintenanceCostCents = orders
    .filter((order) => order.status === "DONE")
    .reduce((sumValue, order) => sumValue + (order.warrantyClaim ? 0n : order.totalCostCents), 0n);

  return {
    faultCount,
    finishedCount: finished.length,
    mttrMinutes,
    mtbfHours:
      faultCount === 0 || workHundredths === 0n
        ? null
        : formatHundredths(divideRounded(workHundredths, BigInt(faultCount))),
    maintenanceCostCents,
    workHours,
    maintenanceCostPerHour:
      workHundredths === 0n ? null : formatHundredths(divideRounded(maintenanceCostCents * 100n, workHundredths)),
  };
}

/**
 * Količina se u skladištu vodi na TRI decimale (`numeric(14,3)`) — metar, kilogram, litar.
 * Zato količine imaju svoj parser: `toHundredths` bi odbio `"10.500"` iako je to ispravna količina,
 * a `toThousandths` bi bio pogrešan za novac. Dvije jedinice, dva parsera, jedna funkcija zbira.
 */
export function toThousandths(value: string | number): bigint {
  const text = typeof value === "number" ? value.toFixed(3) : value.trim();
  if (!/^-?\d{1,9}(?:\.\d{1,3})?$/.test(text)) {
    throw new ServiceError("SERVICE_INVALID_STATUS", `Neispravna količina: „${String(value)}“.`);
  }
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const total = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  return negative ? -total : total;
}

/** `1250n` → `"1.250"` — tri decimale, kako skladište i prikazuje količinu. */
export function formatThousandths(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, "0")}`;
}

/** `125n` → `"1.25"`; znak se čuva jer storno može dati negativan izvod. */
export function formatHundredths(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/* -------------------------------------------------- preventivno održavanje */

export type MaintenanceBasis = "HOURS" | "KM" | "DAYS";

export type MaintenancePlanState = {
  basis: MaintenanceBasis;
  intervalValue: string;
  tolerancePct: string;
  nextDueAt: string | null;
  nextDueMeter: string | null;
  isActive: boolean;
};

export type MaintenanceStatus = "OK" | "DUE_SOON" | "OVERDUE" | "NO_DATA";

export type MaintenanceEvaluation = {
  status: MaintenanceStatus;
  /** Trenutna vrijednost mjerila (sati, km ili dani do roka) — za prikaz „X od Y“. */
  current: string | null;
  /** Prag na kojem servis postaje „blizu“ (`next_due − interval × tolerance`). */
  dueSoonAt: string | null;
  dueAt: string | null;
  /** Koliko je pređeno preko roka (pozitivno) ili ostalo do roka (negativno). */
  remaining: string | null;
};

/**
 * Ocjena plana. `DUE_SOON` je upozorenje PRIJE roka (tolerancija je dio plana, ne procjena
 * servisa), a `OVERDUE` je pređen rok.
 *
 * `overdueBlocks` govori samo da li firma STROGO blokira (`block_on_overdue_maintenance`);
 * funkcija ne blokira sama — odluku donosi `canUseEntity`, jer blokada važi za neke radnje
 * (dodjela, radni sati), a ne za sve (gorivo nije blokirano ni kad je blokada uključena).
 */
export function evaluateMaintenance(
  plan: MaintenancePlanState,
  reading: { meter: string | null; onDate: string },
): MaintenanceEvaluation {
  if (!plan.isActive) {
    return { status: "NO_DATA", current: null, dueSoonAt: null, dueAt: null, remaining: null };
  }
  const tolerance = toHundredths(plan.tolerancePct === "" ? "0" : plan.tolerancePct);

  if (plan.basis === "DAYS") {
    const dueAt = plan.nextDueAt;
    if (!dueAt) {
      return { status: "NO_DATA", current: null, dueSoonAt: null, dueAt: null, remaining: null };
    }
    const remainingDays = daysBetween(reading.onDate, dueAt);
    const intervalDays = Number(plan.intervalValue);
    if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
      return { status: "NO_DATA", current: null, dueSoonAt: null, dueAt, remaining: String(remainingDays) };
    }
    const dueSoonDays = Math.floor((intervalDays * Number(tolerance)) / 10_000);
    return {
      status: remainingDays < 0 ? "OVERDUE" : remainingDays <= dueSoonDays ? "DUE_SOON" : "OK",
      current: String(-remainingDays),
      dueSoonAt: addDays(dueAt, -dueSoonDays),
      dueAt,
      remaining: String(remainingDays),
    };
  }

  /* HOURS i KM su ISTI račun nad brojilom — razlika je samo koja se jedinica prikazuje. */
  const dueAt = plan.nextDueMeter;
  if (!dueAt || reading.meter === null) {
    return { status: "NO_DATA", current: reading.meter, dueSoonAt: null, dueAt, remaining: null };
  }
  const currentHundredths = toHundredths(reading.meter);
  const dueHundredths = toHundredths(dueAt);
  /* Prag = ciklus × tolerancija; `interval × tolerance/100`, u stotinkama da zaokruživanje ne
     pomjeri granicu za cijeli sat (250 h × 10 % = 25 h, ne 24 ili 26). */
  const windowHundredths = divideRounded(
    toHundredths(plan.intervalValue) * tolerance,
    10_000n,
  );
  const dueSoonHundredths = dueHundredths - windowHundredths;
  const remainingHundredths = dueHundredths - currentHundredths;
  return {
    status:
      remainingHundredths < 0n ? "OVERDUE" : currentHundredths >= dueSoonHundredths ? "DUE_SOON" : "OK",
    current: formatHundredths(currentHundredths),
    dueSoonAt: formatHundredths(dueSoonHundredths),
    dueAt: formatHundredths(dueHundredths),
    remaining: formatHundredths(remainingHundredths),
  };
}

/**
 * Sljedeći rok NAKON izvršenog servisa — računa se iz STVARNOG brojila u trenutku izvršenja
 * (spec 09 §1.2/11), ne iz plana. Iz plana bi svaki zakašnjeli servis pomjerio ciklus unazad i
 * gomilao zaostatak zauvijek.
 */
export function nextMaintenanceDue(
  plan: { basis: MaintenanceBasis; intervalValue: string },
  performed: { meter: string | null; onDate: string },
): { nextDueMeter: string | null; nextDueAt: string | null } {
  if (plan.basis === "DAYS") {
    const intervalDays = Number(plan.intervalValue);
    if (!Number.isFinite(intervalDays) || intervalDays <= 0) {
      return { nextDueMeter: null, nextDueAt: null };
    }
    return { nextDueMeter: null, nextDueAt: addDays(performed.onDate, Math.round(intervalDays)) };
  }
  if (performed.meter === null) return { nextDueMeter: null, nextDueAt: null };
  return {
    nextDueMeter: formatHundredths(
      toHundredths(performed.meter) + toHundredths(plan.intervalValue),
    ),
    nextDueAt: null,
  };
}

/* ------------------------------------------------------------- garancija */

/**
 * Je li novi kvar unutar garancije na izvedeni rad (spec 09 §1.7/32).
 *
 * Garancija je `warranty_until` NA NALOGU (rad), a ne `WARRANTY` obligacija mašine (proizvođač) —
 * to su dvije različite stvari i obje ostaju vidljive.
 */
export function isWarrantyClaim(
  newFaultDate: string,
  orders: readonly { id: string; machineId: string; warrantyUntil: string | null }[],
  machineId: string,
): { claim: boolean; sourceOrderId: string | null } {
  const active = orders
    .filter((order) => order.machineId === machineId && order.warrantyUntil !== null)
    .filter((order) => order.warrantyUntil! >= newFaultDate)
    .sort((a, b) => (a.warrantyUntil! < b.warrantyUntil! ? 1 : -1));
  const source = active[0];
  return { claim: source !== undefined, sourceOrderId: source?.id ?? null };
}

/* ------------------------------------------------------------- odobrenje */

/**
 * Treba li servisni nalog odobrenje (spec 09 §1.5/25–26).
 *
 * Planiranje je besplatno: odobrenje se traži tek prije `IN_PROGRESS`, i to po PREDRAČUNU
 * (`plannedCostCents`) kad je poznat — jer stvarni trošak postoji tek poslije rada.
 * Vanjski servis iznad praga traži i ponudu.
 */
export function serviceApprovalCheck(input: {
  kind: "INTERNAL" | "EXTERNAL";
  plannedCostCents: bigint;
  thresholdCents: bigint;
  externalQuoteCents: bigint | null;
}): { needsApproval: boolean; needsQuote: boolean } {
  const needsApproval = input.plannedCostCents > input.thresholdCents;
  const needsQuote = input.kind === "EXTERNAL" && needsApproval && input.externalQuoteCents === null;
  return { needsApproval, needsQuote };
}

/* ------------------------------------------------------- stanje dijelova */

export type StockMovementRow = {
  kind: "IN" | "OUT" | "TRANSFER" | "COUNT";
  /** Količina sa do TRI decimale (`"10.500"`). */
  quantity: string;
};

/**
 * Stanje artikla = `Σ IN − Σ OUT` (`COUNT` je popis i postavlja stanje kroz zasebnu korekciju,
 * `TRANSFER` ne mijenja ukupno stanje firme u MVP-u jer skladište još nije višekratno).
 *
 * Ovo je JEDINA formula stanja; nigdje se ne čuva `quantity` na artiklu.
 */
export function stockOnHand(movements: readonly StockMovementRow[]): string {
  let total = 0n;
  for (const movement of movements) {
    const quantity = toThousandths(movement.quantity);
    if (movement.kind === "IN") total += quantity;
    else if (movement.kind === "OUT") total -= quantity;
  }
  return formatThousandths(total);
}

/** Upozorenje, ne blokada (spec 09 §1.3/18). */
export function isBelowMinimum(onHand: string, minQuantity: string): boolean {
  return toThousandths(onHand) < toThousandths(minQuantity);
}

/* ---------------------------------------------------------------- datumi */

/** Dani između dva `YYYY-MM-DD` (b − a). Bez vremenske zone: poređenje je kalendarsko. */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) return date;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
