/**
 * CSV izvoz sedmičnog pregleda (spec 03 §1.5.22).
 *
 * Petlja je u vlastitom modulu jer je test provjerava bez browsera. Dvije stvari su namjerne:
 *  - brojevi idu sa zarezom kao decimalnim znakom (Excel u BiH tako očekuje),
 *  - polja sa zarezom ili navodnikom se citiraju, inače Excel razbije red na pogrešnom mjestu.
 */
import type { WeekView } from "@/server/workday-timer-service";
import { ABSENCE_KINDS, DAY_KIND_LABEL, dayName, minutesLabel, weekDays } from "./week-labels";

function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function weekCsv(week: WeekView): string {
  const days = weekDays(week.weekStart);
  const header = ["Radnik", ...days.map((day) => `${dayName(day)} ${day}`), "Ukupno (min)"];
  const lines = [header.map(cell).join(",")];

  for (const row of week.rows) {
    const values = days.map((day) => {
      const data = row.days[day];
      if (!data) return "";
      // Izostanak nosi NAZIV, ne nulu: u obračunu je to drugi pojam, ne nula sati.
      return ABSENCE_KINDS.has(data.dayKind)
        ? DAY_KIND_LABEL[data.dayKind] ?? data.dayKind
        : String(data.minutes);
    });
    lines.push([row.workerName, ...values, String(row.totalMinutes)].map(cell).join(","));
  }

  lines.push(["UKUPNO", ...days.map(() => ""), String(week.totals.minutes)].map(cell).join(","));
  return lines.join("\r\n");
}

/** Skida CSV u browseru; u testu se ne poziva (testira se `weekCsv`). */
export function downloadCsv(week: WeekView): void {
  const blob = new Blob([`\uFEFF${weekCsv(week)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `radni-dani-${week.weekStart}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Naziv sedmice za naslov; `minutesLabel` se koristi u tabeli, ne u CSV-u. */
export { minutesLabel };
