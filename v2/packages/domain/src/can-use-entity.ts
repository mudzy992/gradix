/**
 * `canUseEntity` — JEDAN motor blokada, za radnike, mašine i tendere.
 *
 * Zašto jedan: do Faze 0 su blokade bile rasute (dodjele u `project-service`, ture u
 * `haul-service`, sati mašine u `machine-work-log-service`, gorivo nigdje). Isto pitanje
 * („smije li ova mašina danas raditi?“) imalo je tri odgovora i nijedan zajednički test.
 *
 * Pravilo iz spec 02 §15 i spec 05 §29:
 *
 *   | radnja          | blokira?                                  |
 *   |-----------------|-------------------------------------------|
 *   | assign          | DA  — `expired`, `rejected`               |
 *   | haul            | DA  — `expired`, `rejected`               |
 *   | machine_hours   | DA  — `expired`, `rejected`               |
 *   | tender_submit   | DA  — `expired`, `rejected`               |
 *   | fuel            | NE  — jako upozorenje                     |
 *   | workday         | NE  — crvena traka                        |
 *
 * Zašto gorivo ne blokira: mašina stoji na pumpi; ako se točenje ne evidentira, trošak i
 * litraža ostaju „u zraku“. Zašto radni dan ne blokira: radnik ne smije ostati bez
 * evidentiranog dana zbog dokumenta koji ured nije obnovio — gubi se osnov za obračun.
 *
 * `pending_review` i `missing` NIKAD ne blokiraju; to su upozorenja (spec 02 §18).
 *
 * Ovdje je samo ODLUKA, bez baze: servisni sloj (`usage-service`) puni `signals`, pa je
 * ista funkcija na webu, u mobilnom i u workeru, a test matrica je jedan fajl.
 */

/** Šta se pokušava uraditi s entitetom. */
export const USAGE_ACTIONS = ["assign", "haul", "machine_hours", "fuel", "workday", "tender_submit"] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

export const USAGE_ENTITY_KINDS = ["WORKER", "MACHINE", "TENDER"] as const;
export type UsageEntityKind = (typeof USAGE_ENTITY_KINDS)[number];

/**
 * Radnje koje BLOKIRAJU. Sve ostale samo upozoravaju — nikad ne zaustavljaju unos.
 * Ovo je jedina tabela; promjena ponašanja je promjena ovdje, ne `if` u servisu.
 */
export const BLOCKING_USAGE_ACTIONS: readonly UsageAction[] = [
  "assign",
  "haul",
  "machine_hours",
  "tender_submit",
];

export function usageBlocks(action: UsageAction): boolean {
  return BLOCKING_USAGE_ACTIONS.includes(action);
}

/** Stanje obaveze koje blokira. `expiring` je upozorenje — dan isteka je još radni. */
const BLOCKING_OBLIGATION_STATES = ["expired", "rejected"] as const;

export type UsageSignal = {
  /** Izvor: obaveza, kvar, servis, održavanje ili vozačka kategorija. */
  source: "OBLIGATION" | "FAULT" | "SERVICE" | "MAINTENANCE" | "CATEGORY";
  /** Za prikaz: `MEDICAL 2026-01-15`, `Kvar #FS-12`, … */
  label: string;
  /** Stanje iz izvora, onako kako ga izvor zove. */
  state: string;
  /** Blokira li ovaj signal kad je stanje blokirajuće (npr. `obligation_types.blocks_assignment`). */
  blocking: boolean;
  /**
   * F2: koje TAČNO radnje tip blokira (`obligation_types.blocks_actions`). Registracija mašine
   * blokira `haul` i `machine_hours`, ali ne `workday`; pa jedan signal mora reći za koju je
   * radnju blokada — inače bi `blocking: true` blokiralo i ono što spec izričito ne blokira.
   * Kad polja nema, važi `blocking` (stariji pozivaoci).
   */
  blockingActions?: readonly UsageAction[];
  /** Id za iznimku (`usage_overrides.subject_id`), kad iznimka postoji. */
  referenceId?: string | null;
};

export type UsageOverride = {
  /** Na šta se iznimka odnosi (obaveza, kvar, servis). */
  referenceId: string;
  /** Radnja za koju važi — iznimka za `assign` ne pušta `haul`. */
  action: UsageAction;
  reason: string;
  /** `YYYY-MM-DD`, važi do tog dana UKLJUČIVO. */
  validUntil: string;
};

export type UsageCause = {
  source: UsageSignal["source"];
  label: string;
  state: string;
  /** `true` kad iznimka pokriva ovaj uzrok (prikazuje se, ali ne blokira). */
  overridden: boolean;
  reason?: string;
};

export type UsageDecision = {
  /** `false` = radnja se odbija (samo za blokirajuće radnje). */
  allowed: boolean;
  /** Uzroci zbog kojih se odbija. Prazno kad je `allowed`. */
  blockers: UsageCause[];
  /** Sve što treba pokazati korisniku, i kad radnja prolazi. */
  warns: UsageCause[];
  /** Ima li iznimka koja može otključati (da UI zna ponuditi „zatraži iznimku“). */
  overrideAvailable: boolean;
};

const BLOCKING_FAULT_STATES = ["OPEN", "WAITING_APPROVAL", "APPROVED", "IN_PROGRESS"] as const;
const BLOCKING_SERVICE_STATES = ["OPEN", "SCHEDULED", "IN_PROGRESS"] as const;

function signalBlocksAction(signal: UsageSignal, action: UsageAction): boolean {
  if (signal.blockingActions) return signal.blockingActions.includes(action) && signal.blocking;
  return signal.blocking;
}

/**
 * Da li je STANJE signala takvo da blokira — bez obzira na to koju radnju pitamo.
 *
 * Odvojeno od `signalBlocksAction` namjerno: istekao ljekarski mora da se PRIKAŽE i kad se
 * evidentira gorivo (radnja koja ne blokira). Ako bi se ova dva pitanja spojila, mašina bi
 * točila gorivo bez ijednog upozorenja — tišina je gora od blokade.
 */
function isBlockingState(signal: UsageSignal): boolean {
  switch (signal.source) {
    case "OBLIGATION":
      return signal.blocking && (BLOCKING_OBLIGATION_STATES as readonly string[]).includes(signal.state);
    // Aktivan kvar NE blokira (spec 05 §22: odluka je čovjeka) — samo upozorava.
    case "FAULT":
      return false;
    // Preventivni servis blokira samo ako ga firma tako podesi (`block_on_overdue_maintenance`).
    case "SERVICE":
      return signal.blocking && signal.state === "OVERDUE";
    case "MAINTENANCE":
      return signal.blocking && signal.state === "OVERDUE";
    // Vozačka kategorija je upozorenje, ne blokada (spec 05 §30).
    case "CATEGORY":
      return false;
  }
}

function isWarningOnly(signal: UsageSignal): boolean {
  if (signal.source === "FAULT") {
    return (BLOCKING_FAULT_STATES as readonly string[]).includes(signal.state);
  }
  if (signal.source === "SERVICE") {
    return (BLOCKING_SERVICE_STATES as readonly string[]).includes(signal.state) && !isBlockingState(signal);
  }
  if (signal.source === "CATEGORY") return true;
  // Upozorenja: dokument još važi, ali treba paziti.
  //   expiring      — rok se bliži
  //   review_due    — trajna obaveza čeka provjeru ureda
  //   pending_review— dokument čeka potvrdu; NIKAD ne blokira (§18)
  //   missing       — obaveze nema; isto samo upozorenje, inače bi neuneseni dokument
  //                   zaustavio rad čija je svrha da se evidentira
  if (signal.source === "OBLIGATION") {
    return ["expiring", "pending_review", "review_due", "missing"].includes(signal.state);
  }
  return false;
}

/**
 * Odluka. Iznimka pušta SAMO kad važi za taj subjekt (signal) i TU radnju i kad ima
 * razlog ≥ 10 znakova — iznimka bez razloga je tiho gašenje pravila.
 */
export function canUseEntity(input: {
  entityKind: UsageEntityKind;
  entityId: string;
  action: UsageAction;
  /** Poslovni datum firme (`YYYY-MM-DD`) — poređenje je tekstualno, bez vremenske zone. */
  onDate: string;
  signals: readonly UsageSignal[];
  overrides?: readonly UsageOverride[];
}): UsageDecision {
  const overrides = input.overrides ?? [];
  const blockingAction = usageBlocks(input.action);
  const blockers: UsageCause[] = [];
  const warns: UsageCause[] = [];
  let overrideAvailable = false;

  for (const signal of input.signals) {
    const override = overrides.find(
      (entry) =>
        entry.referenceId === (signal.referenceId ?? "") &&
        entry.action === input.action &&
        entry.validUntil >= input.onDate &&
        entry.reason.trim().length >= 10,
    );

    if (isBlockingState(signal)) {
      /*
       * Dva razloga zašto stanje NE blokira OVU radnju, a mora se prikazati:
       *   1. radnja sama po sebi ne blokira (`fuel`, `workday`) — blokada bi zaustavila unos
       *      koji je svrha evidencije;
       *   2. tip ne blokira tu radnju (`blocks_actions`), npr. registracija blokira `haul`,
       *      ali ne `workday`.
       * U oba slučaja signal ide u `warns`, nikad se ne gubi.
       */
      if (!blockingAction || !signalBlocksAction(signal, input.action)) {
        warns.push({ source: signal.source, label: signal.label, state: signal.state, overridden: false });
        continue;
      }
      if (override) {
        warns.push({
          source: signal.source,
          label: signal.label,
          state: signal.state,
          overridden: true,
          reason: override.reason.trim(),
        });
      } else {
        blockers.push({ source: signal.source, label: signal.label, state: signal.state, overridden: false });
        overrideAvailable = true;
      }
      continue;
    }

    if (isWarningOnly(signal)) {
      warns.push({
        source: signal.source,
        label: signal.label,
        state: signal.state,
        overridden: override ? true : false,
        ...(override ? { reason: override.reason.trim() } : {}),
      });
    }
  }

  return { allowed: blockers.length === 0, blockers, warns, overrideAvailable };
}

/** Poruka za ekran i API — jedna, da web i mobilni ne pišu dvije verzije istog objašnjenja. */
export function usageBlockMessage(decision: UsageDecision): string | null {
  if (decision.allowed || decision.blockers.length === 0) return null;
  const labels = decision.blockers.map((cause) => cause.label).join(", ");
  return `Ne može se nastaviti: isteklo ili odbijeno — ${labels}. Obnovite dokument, dodajte iznimku sa razlogom ili otvorite servis.`;
}

/** Kratka traka za radnje koje ne blokiraju (gorivo, radni dan). */
export function usageWarningMessage(decision: UsageDecision): string | null {
  const real = decision.warns.filter((cause) => !cause.overridden);
  if (real.length === 0) return null;
  const labels = real.map((cause) => cause.label).join(", ");
  return `Pažnja: ${labels}. Unos je dozvoljen, ali ured mora znati.`;
}
