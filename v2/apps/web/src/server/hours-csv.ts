/**
 * R6.2: RFC 4180 CSV builder for worker hours export.
 * SafeText N/A for cells — escape quotes/commas/newlines here.
 */

export type HoursCsvRow = {
  worker: string;
  date: string;
  hours: string;
  project: string;
  status: "LOCKED" | "CONFIRMED";
};

const HEADER = "radnik,datum,sati,projekat,status";
const BOM = "\uFEFF";

export function escapeCsvCell(value: string): string {
  // Quoting alone does not stop spreadsheet applications interpreting a cell as a formula.
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function buildHoursCsv(rows: readonly HoursCsvRow[]): string {
  const lines = [HEADER];
  for (const row of rows) {
    lines.push(
      [
        escapeCsvCell(row.worker),
        escapeCsvCell(row.date),
        escapeCsvCell(row.hours),
        escapeCsvCell(row.project),
        escapeCsvCell(row.status),
      ].join(","),
    );
  }
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
