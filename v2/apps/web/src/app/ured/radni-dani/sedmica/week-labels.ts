/**
 * Nazivi vrste dana i stanja provjere za sedmičnu tabelu.
 *
 * Jedan spisak, jer se isti pojmovi pojavljuju i na mobilnom i u uredu — dva spiska bi se
 * razišla u roku od jedne izmjene.
 */
export const DAY_KIND_LABEL: Record<string, string> = {
  WORK: "Rad",
  VACATION: "Godišnji",
  SICK: "Bolovanje",
  PAID_LEAVE: "Plaćeni dopust",
  UNPAID_LEAVE: "Neplaćeni dopust",
  HOLIDAY: "Praznik",
  NO_SHOW: "Nedolazak",
};

/** Izostanak se u tabeli vidi i kad nema nijedan minut — zato je oznaka, ne prazna ćelija. */
export const ABSENCE_KINDS = new Set(["VACATION", "SICK", "PAID_LEAVE", "UNPAID_LEAVE", "HOLIDAY", "NO_SHOW"]);

export function minutesLabel(minutes: number): string {
  if (minutes === 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Dani sedmice kao `YYYY-MM-DD` stringovi, od `weekStart` (ponedjeljak) do nedjelje. */
export function weekDays(weekStart: string): string[] {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

const DAY_NAME = new Intl.DateTimeFormat("bs-BA", { weekday: "short", timeZone: "UTC" });

export function dayName(date: string): string {
  return DAY_NAME.format(new Date(`${date}T00:00:00.000Z`));
}

export function dayNumber(date: string): string {
  return date.slice(8, 10).replace(/^0/, "") + ".";
}
