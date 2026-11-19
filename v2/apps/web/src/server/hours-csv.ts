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
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
