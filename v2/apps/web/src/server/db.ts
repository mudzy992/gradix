/**
 * Jedan pool za proces. Aplikacija se konektuje kao `gradix_app` (ADR 0003).
 *
 * RLS ne štiti ništa ako je aplikacijska rola SUPERUSER ili ima BYPASSRLS —
 * takva rola vidi sve firme bez obzira na politike. Zato se to provjerava pri prvom
 * korištenju pool-a i greška je GLASNA (fail-closed), a ne tihi gubitak izolacije.
 * U DB-u se provjera izvršava jednom po procesu.
 */
import { Pool } from "pg";
import { loadConfig } from "./config";

let pool: Pool | null = null;
let verified = false;

export class TenantSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantSecurityError";
  }
}

/** Provjera da rola pod kojom aplikacija radi ne može zaobići RLS. */
export async function assertRlsEnforceable(client: {
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<void> {
  const result = await client.query(
    "SELECT current_user AS role, r.rolsuper AS is_super, r.rolbypassrls AS bypass_rls " +
      "FROM pg_roles r WHERE r.rolname = current_user",
  );
  const row = result.rows[0];
  if (!row) throw new TenantSecurityError("Nije moguće očitati rolu baze.");
  if (row.is_super === true) {
    throw new TenantSecurityError(
      `Rola "${String(row.role)}" je SUPERUSER — RLS je za nju isključen. ` +
        "Aplikacija mora raditi kao NOSUPERUSER rola (ADR 0003).",
    );
  }
  if (row.bypass_rls === true) {
    throw new TenantSecurityError(
      `Rola "${String(row.role)}" ima BYPASSRLS — izolacija firmi nije zajamčena (ADR 0003).`,
    );
  }
}

export function getPool(): Pool {
  if (!pool) {
    const config = loadConfig();
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "gradix-web",
    });
    pool.on("error", (error) => {
      console.error(JSON.stringify({ level: "error", msg: "pg pool error", error: error.message }));
    });
  }
  return pool;
}

/**
 * Pool sa provjerenom rolom. Koristi se u rutama koje diraju poslovne podatke.
 * Provjera je keširana po procesu — jedan dodatni upit na startu, ne po zahtjevu.
 */
export async function getVerifiedPool(): Promise<Pool> {
  const current = getPool();
  if (!verified) {
    await assertRlsEnforceable(current);
    verified = true;
  }
  return current;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    verified = false;
  }
}
