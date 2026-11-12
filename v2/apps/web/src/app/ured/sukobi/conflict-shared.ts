/**
 * Zajednički prikazni helperi za listu i detalj sukoba (R4a-2/B).
 * Bez komponenti — samo formatiranje, da lista i zasebna stranica detalja
 * govore istim jezikom (HH:MM 24 h u zoni firme, nazivi ishoda).
 */
import type { WorkdayConflict } from "@gradix/contracts";

export const KIND_LABEL: Record<string, string> = {
  ACCEPT_SERVER: "prihvaćen unos sa servera",
  ACCEPT_RECEIVED: "prihvaćen unos s telefona",
  CORRECTED_TIMES: "ispravljena vremena",
  REJECTED: "svi unosi odbačeni",
};

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Sarajevo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function timesLabel(times: WorkdayConflict["serverTimes"]): string {
  if (!times) return "—";
  return times.endState === "KNOWN_END" && times.endedAt
    ? `${hhmm(times.startedAt)}–${hhmm(times.endedAt)}`
    : `${hhmm(times.startedAt)}–${times.endState === "OPEN" ? "otvoren" : "nepoznat kraj"}`;
}

/** Pomjeri trenutak tako da mu sarajevsko vrijeme bude `target` (HH:MM); datum/offset se čuvaju. */
export function shiftToHhmm(iso: string, target: string): string | null {
  const [h, m] = target.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null;
  const current = hhmm(iso).split(":").map(Number);
  const diff = (h * 60 + m) - ((current[0] ?? 0) * 60 + (current[1] ?? 0));
  return new Date(Date.parse(iso) + diff * 60_000).toISOString();
}

/** Je li tekst oblik HH:MM u 24-satnom formatu (00:00–23:59)? */
export function isHhmm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

export type ConflictFilters = {
  status: "OPEN" | "RESOLVED";
  olderOnly: boolean;
  projectId: string;
};

/** Filteri liste žive u adresi: ?stanje=OPEN&starost=stari&projekat=<id>. */
export function filtersToQuery(filters: ConflictFilters): string {
  const query = new URLSearchParams({ stanje: filters.status });
  if (filters.olderOnly) query.set("starost", "stari");
  if (filters.projectId) query.set("projekat", filters.projectId);
  return query.toString();
}

export function parseFilters(params: {
  stanje?: string | null;
  starost?: string | null;
  projekat?: string | null;
}): ConflictFilters {
  return {
    status: params.stanje === "RESOLVED" ? "RESOLVED" : "OPEN",
    olderOnly: params.starost === "stari",
    projectId: params.projekat ?? "",
  };
}
