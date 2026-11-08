/**
 * Prikaz vrijednosti na ekranu — JEDNO mjesto za datume, brojeve i nazive.
 *
 * Zašto ne `Intl` / `toLocaleString`: `bs-BA` u Chromiumu daje „2026 M11 7“, a u Node-u nešto
 * treće, pa bi isti podatak izgledao različito u tabeli, u PDF-u i u testu. Ovdje je format
 * fiksan i isti na svakom pregledniku, a test ga može tvrditi tačno.
 *
 * Vremenska zona: poslovni datumi (`hiredAt`, `endedAt`) su `DATE`, ne trenutak — ne diraju se.
 * Trenuci (`meterUpdatedAt`, `createdAt`) se prikazuju u zoni firme; neispravna zona se zamjenjuje
 * podrazumijevanom kroz `safeTimezone`, da loš podatak u bazi ne sruši ekran.
 */

import { DEFAULT_TIMEZONE, safeTimezone } from "@gradix/domain";

/** `2026-11-07` → `7. 11. 2026.` Datum je već poslovni (`DATE`), pa se ne pomjera kroz zone. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match as unknown as [string, string, string, string];
  return `${Number(day)}. ${Number(month)}. ${year}.`;
}

/**
 * Trenutak → `7. 11. 2026. u 14:05` u zoni firme.
 *
 * Zona se NIKAD ne uzima sirova: `safeTimezone` vraća podrazumijevanu kad je postavka neispravna
 * (`Intl` bi inače bacio `RangeError` i srušio ekran zbog pogrešnog podatka u bazi).
 */
export function formatDateTime(value: string | null | undefined, timezone?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTimezone(timezone ?? DEFAULT_TIMEZONE),
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  // Dan i mjesec bez vodeće nule („7. 11.“, ne „07. 11.“), sat i minuta sa njom („09:05“).
  return `${Number(get("day"))}. ${Number(get("month"))}. ${get("year")}. u ${get("hour")}:${get("minute")}`;
}

/**
 * Broj sa decimalnim zarezom i tačkom za hiljade: `1234.5` → `1.234,5`.
 * Brojila (sati, kilometri) se čitaju kao na tabli mašine, a ne kao u JSON-u.
 */
export function formatNumber(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined) return "—";
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = value < 0 ? "-" : "";
  return fraction && Number(fraction) !== 0 ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`;
}

/** Jedinica brojila kako se govori na gradilištu, ne kao šifra iz baze. */
export function meterUnit(meter: string): string {
  return meter === "KM" ? "km" : "sati";
}

const ENGAGEMENT_BS: Record<string, string> = {
  PERMANENT: "Stalno",
  FIXED_TERM: "Određeno",
  SEASONAL: "Sezonski",
  CONTRACT: "Ugovor",
};

const OWNERSHIP_BS: Record<string, string> = {
  OWN: "Svoje",
  RENT: "Najam",
};

export function engagementLabel(value: string): string {
  return ENGAGEMENT_BS[value] ?? value;
}

export function ownershipLabel(value: string): string {
  return OWNERSHIP_BS[value] ?? value;
}

/** Inicijali za avatar: „Amina Karić“ → „AK“. */
export function initialsOf(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}
