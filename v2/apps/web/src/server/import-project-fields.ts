/** Polja i parser statusa/šifre za uvoz projekata (šema `projects`). */
import { isProjectStatus, type ProjectStatus } from "./project-service";
import { normaliseHeader } from "./import-parser";

export type ProjectFieldSpec = {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
  hint?: string;
};

export type ProjectPreviewRow = {
  rowNumber: number;
  outcome: "import" | "skip" | "error" | "duplicate";
  reason?: string;
  summary: string;
  values?: Record<string, string | number | null>;
};

export const PROJECT_FIELDS: ProjectFieldSpec[] = [
  { key: "code", label: "Šifra", required: true, aliases: ["sifra", "oznaka", "code", "projekat sifra", "broj projekta"] },
  { key: "name", label: "Naziv", required: true, aliases: ["naziv", "ime", "name", "projekat"] },
  {
    key: "status",
    label: "Status",
    required: false,
    aliases: ["status", "stanje"],
    hint: "PLANNED / ACTIVE / PAUSED / FINISHED / CANCELLED (ili bosanski natpis)",
  },
  { key: "siteAddress", label: "Adresa gradilišta", required: false, aliases: ["adresa", "adresa gradilista", "lokacija", "site address"] },
  { key: "sitePlace", label: "Mjesto", required: false, aliases: ["mjesto", "mesto", "grad", "place"] },
  { key: "startsOn", label: "Početak", required: false, aliases: ["pocetak", "datum pocetka", "starts", "start"] },
  { key: "endsOn", label: "Kraj", required: false, aliases: ["kraj", "datum kraja", "zavrsetak", "ends", "end"] },
  {
    key: "manager",
    label: "Rukovodilac",
    required: false,
    aliases: ["rukovodilac", "voditelj", "sef projekta", "manager", "nadzornik"],
    hint: "Ime i prezime postojećeg radnika u firmi",
  },
  { key: "note", label: "Napomena", required: false, aliases: ["napomena", "biljeska", "note", "opis"] },
];

const STATUS_ALIASES: Record<string, ProjectStatus> = {
  planned: "PLANNED",
  "u planu": "PLANNED",
  planiran: "PLANNED",
  active: "ACTIVE",
  aktivan: "ACTIVE",
  aktivno: "ACTIVE",
  paused: "PAUSED",
  pauziran: "PAUSED",
  pauza: "PAUSED",
  finished: "FINISHED",
  zavrsen: "FINISHED",
  completed: "FINISHED",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  otkazan: "CANCELLED",
};

export function parseProjectStatus(value: string | null | undefined): ProjectStatus | null {
  if (!value) return null;
  const raw = value.trim().toUpperCase();
  if (isProjectStatus(raw)) return raw;
  return STATUS_ALIASES[normaliseHeader(value)] ?? null;
}

export function projectCode(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (code.length < 1 || code.length > 40) return null;
  return code;
}
