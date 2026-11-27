/**
 * F8 — zajedničke oznake i tipovi za ekrane servisa.
 *
 * Jedan izvor za nazive stanja, prioriteta i porijekla: lista radionice, detalj naloga i kartica
 * mašine moraju zvati isto stanje istim imenom. Da svaki ekran ima svoj `switch`, „WAITING_PARTS“
 * bi na jednom mjestu bio „Čeka dijelove“, a na drugom „Na čekanju“ — i korisnik ne bi znao da je
 * to isto stanje.
 */
export { SERVICE_STATUS_NAMES as STATUS_LABEL } from "@/lib/labels";

export const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "muted"> = {
  PLANNED: "muted",
  APPROVED: "ok",
  IN_PROGRESS: "ok",
  WAITING_PARTS: "warn",
  DONE: "muted",
  CANCELLED: "danger",
};

export const PRIORITY_LABEL: Record<string, string> = {
  LOW: "Nizak",
  MEDIUM: "Srednji",
  HIGH: "Visok",
  CRITICAL: "Kritičan",
};

export const ORIGIN_LABEL: Record<string, string> = {
  FAULT: "Kvar",
  PREVENTIVE: "Preventiva",
  MANUAL: "Ručno",
  INSPECTION: "Pregled",
};

export const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  OK: "U roku",
  DUE_SOON: "Blizu roka",
  OVERDUE: "Pređen rok",
  NO_DATA: "Bez podatka",
};

export const MAINTENANCE_STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "muted"> = {
  OK: "ok",
  DUE_SOON: "warn",
  OVERDUE: "danger",
  NO_DATA: "muted",
};

export const BASIS_LABEL: Record<string, string> = {
  HOURS: "sati rada",
  KM: "kilometri",
  DAYS: "dani",
};

/** Trajanje zastoja u čitljivom obliku: „2 h 15 min“, „45 min“, „—“. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Iznos sa valutom: „125,50 KM“. Bez valute iznos ne znači ništa. */
export function money(amount: string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return `${amount.replace(".", ",")} ${currency ?? "BAM"}`;
}
