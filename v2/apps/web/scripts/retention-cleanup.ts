/**
 * Administratorska naredba: tehničko čišćenje kratkoživućih redova
 * (bez ličnih podataka): istekle sesije, pokušaji prijave i istekli tokeni
 * pozivnica/resetovanja — brisanje 30 dana nakon isteka (razvojna
 * pretpostavka retencije, vidi docs/COOLIFY.md §11).
 *
 * Podrazumijevano je DRY-RUN: samo ispisuje koliko bi se redova obrisalo.
 * Brisanje traži izričit `--primijeni`. Ništa se ne briše automatski.
 *
 * Pokretanje (pod administratorskom rolom baze, nikad iz aplikacije):
 *   DATABASE_ADMIN_URL=... pnpm --filter @gradix/web exec tsx scripts/retention-cleanup.ts --dry-run
 *   DATABASE_ADMIN_URL=... pnpm --filter @gradix/web exec tsx scripts/retention-cleanup.ts --primijeni
 */
import { Pool } from "pg";
import { pathToFileURL } from "node:url";

/** Razvojne pretpostavke retencije (dana); potvrđuje pravnik/računovođa prije produkcije. */
export const RETENTION_DAYS = {
  sessionsAfterExpiry: 30,
  loginAttempts: 30,
  invitationTokensAfterExpiry: 30,
  passwordResetTokensAfterExpiry: 30,
} as const;

/**
 * Tačan popis tabela koje ova naredba smije dirati. Sve ostalo — radni dani,
 * sukobi, audit, korisnici, radnici, obaveze — naredba ne dotiče; test
 * `retention.integration.test.ts` to provjerava i statički (izvor naredbe)
 * i ponašanjem (brojevi redova poslovnih tabela prije/poslije primjene).
 */
export const RETENTION_TABLES = ["sessions", "login_attempts", "invitations", "password_resets"] as const;

export type RetentionCounts = {
  sessions: number;
  loginAttempts: number;
  invitations: number;
  passwordResets: number;
};

const QUERIES: { key: keyof RetentionCounts; count: string; remove: string }[] = [
  {
    key: "sessions",
    count: `SELECT count(*)::int AS n FROM public.sessions
             WHERE expires_at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.sessionsAfterExpiry})`,
    remove: `DELETE FROM public.sessions
              WHERE expires_at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.sessionsAfterExpiry})`,
  },
  {
    key: "loginAttempts",
    count: `SELECT count(*)::int AS n FROM public.login_attempts
             WHERE at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.loginAttempts})`,
    remove: `DELETE FROM public.login_attempts
              WHERE at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.loginAttempts})`,
  },
  {
    key: "invitations",
    count: `SELECT count(*)::int AS n FROM public.invitations
             WHERE expires_at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.invitationTokensAfterExpiry})`,
    remove: `DELETE FROM public.invitations
              WHERE expires_at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.invitationTokensAfterExpiry})`,
  },
  {
    key: "passwordResets",
    count: `SELECT count(*)::int AS n FROM public.password_resets
             WHERE expires_at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.passwordResetTokensAfterExpiry})`,
    remove: `DELETE FROM public.password_resets
              WHERE expires_at < clock_timestamp() - make_interval(days => ${RETENTION_DAYS.passwordResetTokensAfterExpiry})`,
  },
];

export async function retentionCleanup(
  pool: Pool,
  apply: boolean,
): Promise<{ counts: RetentionCounts; applied: boolean }> {
  const counts: RetentionCounts = { sessions: 0, loginAttempts: 0, invitations: 0, passwordResets: 0 };
  const client = await pool.connect();
  try {
    if (apply) await client.query("BEGIN");
    for (const query of QUERIES) {
      const result = await client.query<{ n: number }>(query.count);
      counts[query.key] = result.rows[0]?.n ?? 0;
      if (apply && counts[query.key] > 0) await client.query(query.remove);
    }
    if (apply) await client.query("COMMIT");
    return { counts, applied: apply };
  } catch (error) {
    if (apply) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("Potreban DATABASE_ADMIN_URL");
  const apply = process.argv.includes("--primijeni");
  const pool = new Pool({ connectionString: adminUrl });
  try {
    const { counts } = await retentionCleanup(pool, apply);
    console.log(apply ? "Retencija — OBRISANO:" : "Retencija — DRY-RUN (ništa nije obrisano):");
    console.log(`  sesije (istekle prije ${RETENTION_DAYS.sessionsAfterExpiry} d): ${counts.sessions}`);
    console.log(`  pokušaji prijave (stariji od ${RETENTION_DAYS.loginAttempts} d): ${counts.loginAttempts}`);
    console.log(`  tokeni pozivnica (istekli prije ${RETENTION_DAYS.invitationTokensAfterExpiry} d): ${counts.invitations}`);
    console.log(`  tokeni resetovanja (istekli prije ${RETENTION_DAYS.passwordResetTokensAfterExpiry} d): ${counts.passwordResets}`);
    if (!apply) console.log("Za brisanje dodajte --primijeni.");
  } finally {
    await pool.end();
  }
}
