/**
 * R4a-2 korak 2c: ishod razrješenja sukoba na telefonu.
 *
 * Server ishod objavljuje kao `sync_conflict` događaj (status RESOLVED) kroz
 * isti pull kao sve ostalo; ovdje se taj payload prevodi u prikaz po lokalnom
 * zapisu. Interna napomena ureda u payload-u ne postoji (server je ne šalje),
 * pa ovdje nema šta ni da se sakrije — test tvrdi da ključ ne prolazi ni kad
 * bi ga neko ubacio.
 */

export type EntryTimes = { startedAt: string; endedAt: string | null; endState: string };

export type ResolutionOutcome = {
  conflictId: string;
  localId: string;
  kind: "ACCEPT_SERVER" | "ACCEPT_RECEIVED" | "CORRECTED_TIMES" | "REJECTED";
  reason: string;
  oldTimes: EntryTimes | null;
  newTimes: EntryTimes | null;
  correctedTarget: "SERVER" | "RECEIVED" | null;
};

export type ResolutionDisplay = { label: string; detail: string };

function times(value: unknown): EntryTimes | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.startedAt !== "string") return null;
  return {
    startedAt: record.startedAt,
    endedAt: typeof record.endedAt === "string" ? record.endedAt : null,
    endState: typeof record.endState === "string" ? record.endState : "KNOWN_END",
  };
}

function hhmm(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sarajevo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function timesLabel(value: EntryTimes | null): string {
  if (!value) return "—";
  return value.endState === "KNOWN_END" && value.endedAt
    ? `${hhmm(value.startedAt)}–${hhmm(value.endedAt)}`
    : `${hhmm(value.startedAt)}–${value.endState === "OPEN" ? "otvoren" : "nepoznat kraj"}`;
}

/** Samo RESOLVED događaji su ishod; sve ostalo (npr. otvoren sukob) se ignoriše. */
export function parseResolutionOutcome(payload: Record<string, unknown> | null): ResolutionOutcome | null {
  if (!payload || payload.status !== "RESOLVED") return null;
  if (typeof payload.id !== "string" || typeof payload.localId !== "string") return null;
  if (!["ACCEPT_SERVER", "ACCEPT_RECEIVED", "CORRECTED_TIMES", "REJECTED"].includes(String(payload.kind))) return null;
  if (typeof payload.reason !== "string") return null;
  return {
    conflictId: payload.id,
    localId: payload.localId,
    kind: payload.kind as ResolutionOutcome["kind"],
    reason: payload.reason,
    oldTimes: times(payload.oldTimes),
    newTimes: times(payload.newTimes),
    correctedTarget: payload.correctedTarget === "SERVER" || payload.correctedTarget === "RECEIVED"
      ? payload.correctedTarget : null,
  };
}

/**
 * Prikaz za lokalni zapis čiji je `localId` u pitanju (odobrene mobilne poruke):
 * - prihvaćen telefonski unos → „Prihvaćeno"
 * - ispravljena vremena telefonskog unosa → „Ispravljeno — Vremena je ispravio ured: bilo …, sada …"
 * - ostalo (server prihvaćen / sve odbačeno / ispravljen server unos) → „Odbačeno — razlog: …"
 */
export function resolutionDisplay(outcome: ResolutionOutcome): ResolutionDisplay {
  if (outcome.kind === "ACCEPT_RECEIVED") {
    return { label: "Prihvaćeno", detail: `Prihvaćeno — razlog ureda: ${outcome.reason}` };
  }
  if (outcome.kind === "CORRECTED_TIMES" && outcome.correctedTarget === "RECEIVED") {
    return {
      label: "Ispravljeno",
      detail: `Ispravljeno — Vremena je ispravio ured: bilo ${timesLabel(outcome.oldTimes)}, sada ${timesLabel(outcome.newTimes)}. Razlog: ${outcome.reason}`,
    };
  }
  return { label: "Odbačeno", detail: `Odbačeno — razlog: ${outcome.reason}` };
}

/** Ishodi po lokalnom zapisu iz pull događaja; isti događaj dvaput daje isti ishod (idempotentno). */
export function resolutionsByLocalId(
  events: readonly { entityType: string; payload: Record<string, unknown> | null }[],
): Map<string, ResolutionDisplay> {
  const result = new Map<string, ResolutionDisplay>();
  for (const event of events) {
    if (event.entityType !== "sync_conflict") continue;
    const outcome = parseResolutionOutcome(event.payload);
    if (outcome) result.set(outcome.localId, resolutionDisplay(outcome));
  }
  return result;
}
