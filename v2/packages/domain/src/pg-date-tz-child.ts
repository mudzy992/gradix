import { calendarDateFromLocalDate, formatPgDate } from "./dates.ts";

const samples = ["2024-02-29", "2026-12-31", "2027-01-01", "2026-01-01", "2026-03-01"] as const;

const asPgDate = (iso: string): Date => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
};

const failures: string[] = [];
for (const iso of samples) {
  const formatted = formatPgDate(asPgDate(iso));
  if (formatted !== iso) failures.push(`${iso} -> ${formatted}`);
  if (calendarDateFromLocalDate(asPgDate(iso)) !== iso) failures.push(`local ${iso}`);
}
if (formatPgDate(null) !== null) failures.push("null");
if (formatPgDate("2027-12-01") !== "2027-12-01") failures.push("string");
const shifted = asPgDate("2024-02-29").toISOString().slice(0, 10);
const zone = process.env.TZ ?? "";
if (zone === "UTC" && shifted !== "2024-02-29") failures.push(`UTC shift ${shifted}`);
if (zone === "Europe/Sarajevo" && shifted === "2024-02-29") failures.push("Sarajevo did not shift toISOString");
if (failures.length > 0) {
  console.error(zone, failures.join("; "));
  process.exit(1);
}
process.stdout.write(`ok ${zone}\n`);
