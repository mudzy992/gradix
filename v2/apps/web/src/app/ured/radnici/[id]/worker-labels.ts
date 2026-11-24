/**
 * Nazivi tipova cijene — jedan spisak za prikaz i za dijalog.
 *
 * Razdvojeno u svoj modul jer se koristi na dva mjesta: da se spisak ne bi razišao, mora
 * postojati samo jednom.
 */
export const RATE_KIND: Record<string, string> = {
  HOURLY: "Satnica",
  MONTHLY: "Mjesečno",
  DAILY: "Dnevno",
  COEFFICIENT: "Koeficijent",
};
