/**
 * Vrijeme: UTC u bazi, kalendarski datum uz zonu firme (A3.3.3).
 * Jedan modul za sve; nijedan modul ne poziva Intl sa sirovom postavkom iz baze.
 */

export const DEFAULT_TIMEZONE = "Europe/Sarajevo";

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(timezone: string | null | undefined): string {
  if (!timezone) return DEFAULT_TIMEZONE;
  return isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
}

/** Kalendarski datum (YYYY-MM-DD) za trenutak u datoj zoni firme. */
export function businessDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Provjera da je string postojeći kalendarski datum.
 * Odbija `2026-02-31` umjesto tihog prebacivanja u mart (v1 §4.9).
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
