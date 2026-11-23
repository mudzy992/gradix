/** Uvoz projekata (2c): pregled. Partner/klijent — samo napomena. */
import type { PoolClient } from "pg";
import type { CompanyId } from "@gradix/db";
import { hasControlChars } from "@gradix/contracts";
import type { ProjectStatus } from "./project-service";
import { toIsoDate, toText, normaliseHeader, type ParsedSheet } from "./import-parser";
import { parseProjectStatus, projectCode, type ProjectPreviewRow } from "./import-project-fields";

export { PROJECT_FIELDS, type ProjectPreviewRow } from "./import-project-fields";
export { insertProjectRow, updateProjectRow } from "./import-project-write";

const normaliseName = (value: string): string => normaliseHeader(value).replace(/\s+/g, " ");
const rowHasControlChars = (cells: Record<string, string | number | Date | null>): boolean =>
  Object.values(cells).some((cell) => typeof cell === "string" && hasControlChars(cell));

export async function previewProjects(
  client: PoolClient,
  companyId: CompanyId,
  sheet: ParsedSheet,
  mapping: Record<string, string | null>,
): Promise<ProjectPreviewRow[]> {
  const existing = await client.query<{ code: string }>(
    "SELECT code FROM projects WHERE company_id = $1",
    [companyId],
  );
  const existingCodes = new Set(existing.rows.map((row) => row.code.toUpperCase()));
  const workers = await client.query<{ id: string; first_name: string; last_name: string }>(
    "SELECT id, first_name, last_name FROM workers WHERE company_id = $1 AND is_active",
    [companyId],
  );
  const byWorkerName = new Map<string, string>();
  for (const row of workers.rows) {
    byWorkerName.set(normaliseName(`${row.first_name} ${row.last_name}`), row.id);
  }
  const seenInFile = new Map<string, number>();

  return sheet.rows.map((row) => {
    const value = (key: string) => toText(row.cells[mapping[key] ?? ""] ?? null);
    const code = projectCode(value("code"));
    const name = value("name");
    const summary = `${code ?? "?"} · ${name ?? "?"}`.trim();
    if (rowHasControlChars(row.cells)) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Red sadrži nedozvoljene kontrolne znakove.", summary };
    }
    if (!code) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Šifra je obavezna (1–40 znakova).", summary };
    }
    if (!name || name.length > 200) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Naziv je obavezan (do 200 znakova).", summary };
    }
    const statusRaw = value("status");
    let status: ProjectStatus = "ACTIVE";
    if (statusRaw) {
      const parsed = parseProjectStatus(statusRaw);
      if (!parsed) {
        return {
          rowNumber: row.rowNumber,
          outcome: "error",
          reason: `Status „${statusRaw}“ nije prepoznat (ne stvara se novi).`,
          summary,
        };
      }
      status = parsed;
    }
    const startsOn = mapping["startsOn"] ? toIsoDate(row.cells[mapping["startsOn"]!] ?? null) : null;
    if (mapping["startsOn"] && row.cells[mapping["startsOn"]!] != null && toText(row.cells[mapping["startsOn"]!] ?? null) && !startsOn) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Početak nije ispravan datum.", summary };
    }
    const endsOn = mapping["endsOn"] ? toIsoDate(row.cells[mapping["endsOn"]!] ?? null) : null;
    if (mapping["endsOn"] && row.cells[mapping["endsOn"]!] != null && toText(row.cells[mapping["endsOn"]!] ?? null) && !endsOn) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Kraj nije ispravan datum.", summary };
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Kraj ne može biti prije početka.", summary };
    }
    const siteAddress = value("siteAddress");
    if (siteAddress && siteAddress.length > 300) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Adresa je predugačka (max 300).", summary };
    }
    const sitePlace = value("sitePlace");
    if (sitePlace && sitePlace.length > 120) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Mjesto je predugačko (max 120).", summary };
    }
    const note = value("note");
    if (note && note.length > 2000) {
      return { rowNumber: row.rowNumber, outcome: "error", reason: "Napomena je predugačka (max 2000).", summary };
    }
    const managerRaw = value("manager");
    let managerWorkerId: string | null = null;
    if (managerRaw) {
      managerWorkerId = byWorkerName.get(normaliseName(managerRaw)) ?? null;
      if (!managerWorkerId) {
        return {
          rowNumber: row.rowNumber,
          outcome: "error",
          reason: `Rukovodilac „${managerRaw}“ nije pronađen među radnicima firme (ne stvara se).`,
          summary,
        };
      }
    }
    const earlier = seenInFile.get(code);
    if (earlier) {
      return {
        rowNumber: row.rowNumber,
        outcome: "error",
        reason: `Šifra ${code} se pojavljuje i u redu ${earlier}.`,
        summary,
      };
    }
    seenInFile.set(code, row.rowNumber);
    const values = { code, name, status, siteAddress, sitePlace, startsOn, endsOn, managerWorkerId, note };
    if (existingCodes.has(code)) {
      return {
        rowNumber: row.rowNumber,
        outcome: "skip",
        reason: `Šifra ${code} već postoji u firmi — preskočeno (ažuriranje nije izabrano).`,
        summary,
        values,
      };
    }
    return { rowNumber: row.rowNumber, outcome: "import", summary, values };
  });
}
