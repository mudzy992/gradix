/**
 * Tokeni za pozivnice i reset lozinke: generisanje, hash, provjera formata.
 *
 * Pravila (docs/PLAN-R1.md):
 *  - sirovi token postoji samo u odgovoru onome ko ga je izdao; u bazi je SAMO SHA-256,
 *  - token se nikad ne loguje i nikad ne upisuje u audit,
 *  - rok je 48 h, jednokratan je (claim ide kroz `UPDATE ... WHERE used_at IS NULL`).
 *
 * Zašto običan SHA-256, a ne Argon2: token je 32 slučajna bajta (256 bita entropije), pa
 * nema smisla trošiti 19 MiB na hash — nema šta da se pogodi. Za lozinke Argon2 ostaje.
 */
import { createHash, randomBytes } from "node:crypto";

/** Prefiks po namjeni: olakšava prepoznavanje u logovima i sprječava miješanje tokene. */
export const INVITE_PREFIX = "gxi_";
export const RESET_PREFIX = "gxr_";

export const TOKEN_TTL_HOURS = 48;
const TOKEN_BYTES = 32;

export type TokenKind = "invite" | "reset";

export function generateToken(kind: TokenKind): string {
  const prefix = kind === "invite" ? INVITE_PREFIX : RESET_PREFIX;
  return `${prefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Provjera oblika PRIJE upita u bazu. Bez ovoga bi svaki izmišljeni string radio
 * nepotreban upit; sa ovim se smeće odbija bez dodirivanja baze.
 */
export function isValidTokenFormat(token: string, kind: TokenKind): boolean {
  const prefix = kind === "invite" ? INVITE_PREFIX : RESET_PREFIX;
  if (!token.startsWith(prefix)) return false;
  // 32 bajta kao base64url = 43 znaka.
  return /^[A-Za-z0-9_-]{43}$/.test(token.slice(prefix.length));
}

export function tokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * Maske za log: ako neko ipak pokuša da loguje token, dobija `gxi_…3f2a`.
 * Ne koristi se za bazu — samo da bi slučajno logovanje bilo bezopasno.
 */
export function maskToken(token: string): string {
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
