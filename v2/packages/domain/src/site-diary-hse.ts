/**
 * F9 — dnevnik građenja i HSE: SVE što se može pogrešiti u brojevima i pravilima, bez baze i bez
 * React-a, pa se testira bez uređaja i bez Postgresa.
 *
 * Zašto je ovo odvojeno od servisa: LTIFR i „mjere na vrijeme“ su brojevi koje firma pokaže
 * inspektoru i na osnovu kojih se odlučuje o zaštiti ljudi. Formula koja živi u SQL-u ili u ekranu
 * ne može se testirati na fiksnom skupu, a greška u njoj je GREŠKA U IZVJEŠTAJU, ne u prikazu.
 *
 * Pravila koja domena čuva (spec 10 §1.6/26-30):
 *  1. **`NEAR_MISS` se broji ODVOJENO** — nije „manji incident“ nego preventivni signal; ako uđe u
 *     broj ozljeda, statistika prijavi manje ozljeda nego što ih je bilo (ili više nesreća).
 *  2. **LTIFR = ozljede sa izgubljenim danima × 1 000 000 / odrađeni sati.** Brojilac su OZLJEDE
 *     (incidenti sa `lost_days > 0`), ne svi incidenti; imenilac su SATI iz Modula 3, ne broj radnika.
 *  3. **Mjera je „na vrijeme“ samo ako je završena do roka** (uključujući sam rok) — `done_on <= due_on`.
 *  4. **Procenat završenosti projekta ne dolazi iz dva mjesta**: zbir dnevnih BOQ količina je jedini
 *     izvor; ako stavka nema planiranu količinu, procenat se ne izmišlja (`null`, ne 0).
 */

/* ------------------------------------------------------------------ dnevnik: količine */

export type DiaryItemSource = "MANUAL" | "HAUL" | "BOQ";

export type DiaryQuantityInput = {
  /** `boq_item_id` — NULL za rad koji nije u predmjeru. */
  boqItemId: string | null;
  quantity: number;
  source: DiaryItemSource;
};

/**
 * Zbir dnevnih količina po stavci predmjera.
 *
 * `BOQ` i `HAUL` ulaze, `MANUAL` ne: ručni red je opis posla, a ne mjerenje stavke predmjera.
 * Ako bi i ručni ulazio, isti iskop bi se sabrao dvaput (jednom iz ture, jednom kako ga je šef
 * opisao) i `quantity_executed` bi bio veći od stvarnog.
 */
export function boqQuantitiesFromDiaries(items: readonly DiaryQuantityInput[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!item.boqItemId) continue;
    if (item.source === "MANUAL") continue;
    totals.set(item.boqItemId, (totals.get(item.boqItemId) ?? 0) + item.quantity);
  }
  return totals;
}

/**
 * Procenat završenosti stavke. `null` kad planirana količina nije poznata ili je nula —
 * „0 %“ bi tvrdilo da posla nema, a „100 %“ da je gotov; oboje je izmišljotina.
 */
export function boqCompletionPercent(executed: number, planned: number | null): number | null {
  if (planned === null || planned <= 0) return null;
  return Math.round((executed / planned) * 1000) / 10;
}

/** Zbir zastoja u satima — dokaz za produženje roka (spec §1.1/4). */
export function totalDelayHours(delays: readonly { hours: number }[]): number {
  return Math.round(delays.reduce((sum, delay) => sum + delay.hours, 0) * 100) / 100;
}

/**
 * Predlog produženja roka: zaokruženo NAVIŠE na cijeli dan, jer se aneks piše u danima, a
 * 4,5 sata zastoja ne smije nestati zaokruživanjem na nulu.
 */
export function suggestedExtensionDays(delayHours: number): number {
  if (delayHours <= 0) return 0;
  return Math.ceil(delayHours / 8);
}

/* ------------------------------------------------------------------ dnevnik: tok i potpis */

export type DiaryStatus = "DRAFT" | "SIGNED" | "LOCKED";

export type DiaryTransitionOutcome =
  | { ok: true; status: DiaryStatus }
  | { ok: false; code: "DIARY_ALREADY_LOCKED" | "DIARY_SIGNATURE_REQUIRED" | "SERVICE_INVALID_STATUS" };

const DIARY_TRANSITIONS: Record<DiaryStatus, readonly DiaryStatus[]> = {
  DRAFT: ["SIGNED"],
  SIGNED: ["LOCKED"],
  LOCKED: [],
};

/**
 * Prelaz stanja dnevnika.
 *
 * `LOCKED` je konačan: izmjena ide kroz reviziju, ne kroz novo stanje. Vraćanje u `DRAFT` bi
 * značilo da potpisan dokument može postati nepotpisan — a to je upravo ono što zaključavanje brani.
 */
export function diaryTransition(from: DiaryStatus, to: DiaryStatus, hasSignature: boolean): DiaryTransitionOutcome {
  if (from === "LOCKED") return { ok: false, code: "DIARY_ALREADY_LOCKED" };
  if (!DIARY_TRANSITIONS[from].includes(to)) return { ok: false, code: "SERVICE_INVALID_STATUS" };
  if (to === "SIGNED" && !hasSignature) return { ok: false, code: "DIARY_SIGNATURE_REQUIRED" };
  return { ok: true, status: to };
}

/** Naziv potpisnika je obavezan i mora biti ime, ne prazan string sa razmacima. */
export function validDiarySignature(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 200;
}

/** Dnevnik „bez potpisa stariji od N dana“ — stavka na Pregledu (spec §4). */
export function unsignedDiaryIsOverdue(diaryDate: string, today: string, olderThanDays = 2): boolean {
  const from = Date.parse(`${diaryDate}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return Math.round((to - from) / 86_400_000) > olderThanDays;
}

/* ------------------------------------------------------------------ HSE: incident i mjere */

export type HseIncidentKind =
  | "ACCIDENT"
  | "NEAR_MISS"
  | "PROPERTY_DAMAGE"
  | "ENVIRONMENTAL"
  | "OCCUPATIONAL_ILLNESS";

export type HseSeverity = "MINOR" | "MODERATE" | "SEVERE" | "FATAL";

export type HseIncidentRow = {
  kind: HseIncidentKind;
  severity: HseSeverity;
  /** Broj izgubljenih radnih dana zbog OZLJEDE. */
  lostDays: number;
  occurredAt: string;
  status: "REPORTED" | "INVESTIGATING" | "ACTIONS_OPEN" | "CLOSED";
};

/**
 * Ozljeda sa izgubljenim danima — JEDINA kategorija koja ulazi u LTIFR.
 *
 * Zašto ne „svi sa `lost_days > 0`“: izgubljeni dani mogu nastati i zbog profesionalnog oboljenja,
 * ali LTIFR (Lost Time Injury Frequency Rate) mjeri OZLJEDE. Miješanje bi dalo broj koji ne
 * odgovara definiciji po kojoj se firma poredi sa drugima.
 */
export function isLostTimeInjury(incident: HseIncidentRow): boolean {
  return incident.kind === "ACCIDENT" && incident.lostDays > 0;
}

/** `NEAR_MISS` se broji odvojeno, nikad u isti broj sa ozljedama (spec §1.6/26). */
export function nearMissCount(incidents: readonly HseIncidentRow[]): number {
  return incidents.filter((incident) => incident.kind === "NEAR_MISS").length;
}

/**
 * LTIFR — broj ozljeda sa izgubljenim danima na milion odrađenih sati.
 *
 * Vraća `null` kad sati nisu poznati ili su nula: dijeljenje nulom bi dalo `Infinity`, a „0“
 * bi tvrdilo da je firma savršena. Bez imenioca nema stope.
 */
export function ltifr(incidents: readonly HseIncidentRow[], workedHours: number): number | null {
  if (!Number.isFinite(workedHours) || workedHours <= 0) return null;
  const injuries = incidents.filter(isLostTimeInjury).length;
  return Math.round(((injuries * 1_000_000) / workedHours) * 100) / 100;
}

/** Ukupno izgubljenih dana — zbir po incidentima, bez obzira na vrstu. */
export function totalLostDays(incidents: readonly HseIncidentRow[]): number {
  return incidents.reduce((sum, incident) => sum + Math.max(0, incident.lostDays), 0);
}

export type HseActionRow = {
  status: "OPEN" | "DONE" | "CANCELLED";
  /** `YYYY-MM-DD` ili `null` dok mjera nije završena. */
  dueOn: string;
  doneOn: string | null;
};

/**
 * `OVERDUE` se RAČUNA, ne čuva (spec §1.3/15): mjera je prekoračena ako je rok prošao, a nije
 * završena. Upisano stanje bi u ponedjeljak tvrdilo isto što i u petak.
 *
 * `CANCELLED` nije prekoračen: otkazana mjera nije obaveza.
 */
export function hseActionIsOverdue(action: HseActionRow, today: string): boolean {
  if (action.status !== "OPEN") return false;
  return action.dueOn < today;
}

/** Mjera je „na vrijeme“ ako je završena do roka, uključujući sam rok. */
export function hseActionOnTime(action: HseActionRow): boolean {
  if (action.status !== "DONE" || !action.doneOn) return false;
  return action.doneOn <= action.dueOn;
}

/**
 * Stopa mjera na vrijeme (spec §1.6/28): `DONE` na vrijeme / sve završene mjere.
 *
 * Imenilac su ZAVRŠENE, ne sve: otvorena mjera još nije ni bila na provjeri. Ako bi otvorene
 * ulazile u imenilac, firma sa puno novih mjera izgledala bi neuredna iako ništa nije propustila.
 */
export function hseOnTimeRate(actions: readonly HseActionRow[]): number | null {
  const done = actions.filter((action) => action.status === "DONE");
  if (done.length === 0) return null;
  const onTime = done.filter(hseActionOnTime).length;
  return Math.round((onTime / done.length) * 1000) / 10;
}

/** Nalaz inspekcije koji BLOKIRA rad — ističe se na Pregledu do podizanja zabrane. */
export function isActiveProhibition(inspection: {
  result: string;
  prohibitionLiftedAt: string | null;
}): boolean {
  return inspection.result === "PROHIBITION" && inspection.prohibitionLiftedAt === null;
}

/**
 * Incident koji traži obavezu `HSE_REPORT` (spec §1.3/16): prijava inspekciji je zakonski rok, a
 * ne podsjetnik. Vraća `true` samo kad je prijava potrebna i JOŠ nije vezana za obavezu —
 * drugi poziv ne pravi drugu obavezu.
 */
export function needsHseReportObligation(incident: {
  reportableToAuthority: boolean;
  reportObligationId: string | null;
}): boolean {
  return incident.reportableToAuthority && incident.reportObligationId === null;
}

/**
 * Smije li incident preći u `CLOSED`: sve mjere moraju biti završene ili otkazane, i istraga
 * mora biti završena. Zatvaranje sa otvorenom mjerom bi značilo da je nalaz „riješen“ dok radnja
 * na kojoj se zasniva još traje.
 */
export function canCloseIncident(input: {
  actions: readonly HseActionRow[];
  investigationCompleted: boolean;
}): { ok: true } | { ok: false; code: "HSE_ACTION_OPEN" | "HSE_INVESTIGATION_REQUIRED" } {
  if (!input.investigationCompleted) return { ok: false, code: "HSE_INVESTIGATION_REQUIRED" };
  if (input.actions.some((action) => action.status === "OPEN")) return { ok: false, code: "HSE_ACTION_OPEN" };
  return { ok: true };
}

/* ------------------------------------------------------------------ obuke i toolbox */

export type HseTrainingKind = "INDUCTION" | "TOOLBOX" | "TASK_INSTRUCTION" | "CERTIFICATION" | "DRILL";

/**
 * Brzi toolbox unos (spec §1.4/20): tema + prisutni + trajanje, bez tipkanja eseja.
 *
 * Validacija je ovdje, a ne u ekranu, jer isti unos dolazi i sa telefona (offline) i sa weba.
 * Prisutni su OBAVEZNI: obuka bez zapisa ko je bio ne dokazuje ništa, a upravo to dokazuje inspektoru.
 */
export function validToolboxInput(input: {
  topic: string | null | undefined;
  attendees: readonly string[];
  durationMinutes: number | null | undefined;
}): boolean {
  const topic = input.topic?.trim() ?? "";
  if (topic.length < 3 || topic.length > 1000) return false;
  if (input.attendees.length === 0) return false;
  /* Isti radnik dvaput u istoj obuci je greška unosa (baza ga odbija unikatom) — odbijamo i ovdje,
     da telefon ne pošalje stavku koja bi pala na serveru i blokirala kursor. */
  if (new Set(input.attendees).size !== input.attendees.length) return false;
  if (input.durationMinutes === null || input.durationMinutes === undefined) return true;
  return input.durationMinutes > 0 && input.durationMinutes <= 600;
}

/**
 * Ključna razlika prema Modulu 2 (spec §1.4/21): `obligation` prati VAŽENJE certifikata,
 * `hse_trainings` evidentira ODRŽANU obuku. Certifikacijska obuka može obnoviti obavezu — ali
 * samo ona, i samo ako je stvarno održana. Zato `kind` mora biti `CERTIFICATION`, a ne bilo koja
 * obuka sa sličnim imenom.
 */
export function trainingCanRenewCertificate(kind: HseTrainingKind, attendeesCount: number): boolean {
  return kind === "CERTIFICATION" && attendeesCount > 0;
}
