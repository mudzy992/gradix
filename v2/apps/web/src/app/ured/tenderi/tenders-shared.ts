import type { TenderRow, TenderStatus } from "@gradix/contracts";

export const STATUS_LABEL: Record<TenderStatus, string> = {
  OPPORTUNITY: "Prilika",
  GO_NO_GO: "Odluka o učešću",
  PREPARATION: "Priprema",
  SUBMITTED: "Predano",
  EVALUATION: "Ocjenjivanje",
  WON: "Dobijeno",
  LOST: "Izgubljeno",
  WITHDRAWN: "Povučeno",
  CANCELLED: "Otkazano",
};

/** Redoslijed je TOK posla, ne abeceda — filter i kanban prate kako tender ide. */
export const STATUS_OPTIONS: TenderStatus[] = [
  "OPPORTUNITY",
  "GO_NO_GO",
  "PREPARATION",
  "SUBMITTED",
  "EVALUATION",
  "WON",
  "LOST",
  "WITHDRAWN",
  "CANCELLED",
];

export const TERMINAL_STATUSES: TenderStatus[] = ["WON", "LOST", "WITHDRAWN", "CANCELLED"];

export function formatTenderValue(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("bs-BA");
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("bs-BA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Oznaka hitnosti roka. Vraća `null` kad roka nema — prazna oznaka bi tvrdila da je rok
 * daleko, a ne da ga nema.
 */
export function deadlineTone(days: number | null): "danger" | "warn" | "ok" | null {
  if (days === null) return null;
  if (days < 0) return "danger";
  if (days <= 3) return "danger";
  if (days <= 7) return "warn";
  return "ok";
}

export function deadlineText(days: number | null, date: string | null): string {
  if (days === null || !date) return "Bez roka";
  if (days < 0) return `Rok prošao ${Math.abs(days)} ${dayWord(Math.abs(days))}`;
  if (days === 0) return "Rok je danas";
  return `${days} ${dayWord(days)} do roka`;
}

export function dayWord(days: number): string {
  const absolute = Math.abs(days);
  if (absolute % 10 === 1 && absolute % 100 !== 11) return "dan";
  return "dana";
}

export const SOURCE_LABEL: Record<string, string> = {
  PORTAL: "Portal",
  INVITATION: "Poziv naručioca",
  DIRECT: "Direktno",
  OTHER: "Ostalo",
};

export const LOST_REASON_LABEL: Record<string, string> = {
  PRICE: "Cijena",
  TECHNICAL: "Tehnička ponuda",
  DOCUMENTATION: "Dokumentacija",
  RELATIONSHIP: "Odnos sa naručiocem",
  SCOPE: "Obim posla",
  OTHER: "Ostalo",
};

export const GUARANTEE_LABEL: Record<string, string> = {
  BID: "Ponudbena",
  PERFORMANCE: "Za dobro izvršenje",
  ADVANCE: "Avansna",
  WARRANTY: "Za otklanjanje nedostataka",
};

export const RESOURCE_LABEL: Record<string, string> = {
  LABOR: "Rad",
  MACHINE: "Mašina",
  MATERIAL: "Materijal",
  SUBCONTRACTOR: "Podizvođač",
  OTHER: "Ostalo",
};

export const APPROVAL_REASON_LABEL: Record<string, string> = {
  ABOVE_CHANGE_THRESHOLD: "Promjena cijene preko 5 %",
  BELOW_MIN_MARKUP: "Marža ispod minimuma firme",
};

/** Filtering after the 500-row list limit matches table, kanban and snapshot export. */
export function filterTenderList(rows:readonly TenderRow[], status:string, urgent:boolean):TenderRow[] {
  return rows.filter(row => {
    if (status && row.status !== status) return false;
    if (urgent && (row.daysToDeadline === null || row.daysToDeadline < 0 || row.daysToDeadline > 14 || TERMINAL_STATUSES.includes(row.status))) return false;
    return true;
  });
}
