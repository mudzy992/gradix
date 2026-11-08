/**
 * Rate limit prijave koji radi i sa više replika (za razliku od `Map` u memoriji iz R0).
 *
 * Model (docs/PLAN-R1.md): brojač živi u tabeli `login_attempts`, ali tabela NEMA čitljiv
 * identitet — samo `email_hash` i `ip_hash` (SHA-256 sa `AUTH_SECRET` kao pepperom). Aplikacija
 * nema pravo direktnog SELECT-a na tabelu; smije samo kroz tri funkcije.
 *
 * Zašto pepper: bez njega bi hash emaila bio pogađiv (napadač zna listu emailova i izračuna
 * hash). Sa pepperom iz okruženja, dump baze sam po sebi ne otkriva ko je pokušavao.
 */
import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { loadConfig } from "./config";

export const LOGIN_WINDOW_SECONDS = Number(process.env.AUTH_LOGIN_WINDOW_MS ?? 60_000) / 1000;
export const LOGIN_MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_LIMIT ?? 5);

function pepper(): string {
  return loadConfig().AUTH_SECRET;
}

export function identifierHash(value: string): string {
  return createHmac("sha256", pepper()).update(value.toLowerCase(), "utf8").digest("hex");
}

/** Koliko je nedavnih promašaja za ovaj email. */
export async function countAttempts(pool: Pool, email: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT login_attempt_count($1, $2) AS count",
    [identifierHash(email), Math.round(LOGIN_WINDOW_SECONDS)],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Zabilježi promašaj i vrati novi broj u prozoru. */
export async function recordAttempt(pool: Pool, email: string, ip: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT login_attempt_record($1, $2, $3) AS count",
    [identifierHash(email), identifierHash(`ip:${ip}`), Math.round(LOGIN_WINDOW_SECONDS)],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Koliko još sekundi prozor drži ovaj email (0 = slobodno). */
export async function retryAfterSeconds(pool: Pool, email: string): Promise<number> {
  const result = await pool.query<{ seconds: number }>(
    "SELECT login_attempt_retry_after($1, $2) AS seconds",
    [identifierHash(email), Math.round(LOGIN_WINDOW_SECONDS)],
  );
  return Number(result.rows[0]?.seconds ?? 0);
}

/** Uspješna prijava briše promašaje za taj email. */
export async function clearAttempts(pool: Pool, email: string): Promise<void> {
  await pool.query("SELECT login_attempt_clear($1)", [identifierHash(email)]);
}

/**
 * Fail-closed odluka: ako brojač ne može da se pročita (baza nedostupna), prijava se
 * odbija kao `RATE_LIMITED`? Ne — tada bi pad baze izgledao kao napad. Umjesto toga se
 * greška propagira i ruta vraća `INTERNAL`, jer prijava i onako ne može bez baze.
 *
 * Vraća 0 kad prozor nije blokiran, inače broj sekundi do prvog slobodnog pokušaja.
 * Ruta taj broj stavlja u poruku i u `retryAfterSeconds`, da „sačekajte minutu" ne bude
 * fiksna laž kad se prozor otvara za pet sekundi.
 */
export async function rateLimitWait(pool: Pool, email: string): Promise<number> {
  if ((await countAttempts(pool, email)) < LOGIN_MAX_ATTEMPTS) return 0;
  // `count` je već rekao da je blokirano; kad bi retry_after iz nekog razloga vratio 0,
  // poruka bez broja je bolja od „sačekajte 0 sekundi".
  return Math.max(1, await retryAfterSeconds(pool, email));
}
