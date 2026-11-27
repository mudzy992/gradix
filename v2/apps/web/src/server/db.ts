/**
 * Jedan pool za proces. Aplikacija se konektuje kao `gradix_app` (ADR 0003).
 *
 * RLS ne štiti ništa ako je aplikacijska rola SUPERUSER ili ima BYPASSRLS —
 * takva rola vidi sve firme bez obzira na politike. Zato se to provjerava pri prvom
 * korištenju pool-a i greška je GLASNA (fail-closed), a ne tihi gubitak izolacije.
 * U DB-u se provjera izvršava jednom po procesu.
 */
import { existsSync } from "node:fs";
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

/**
 * `sslrootcert` u URL-u je putanja do fajla. Ako tog fajla nema (CA nije montiran),
 * `pg` puca sa ENOENT **pri parsiranju URL-a** — dakle pri svakom pokušaju konekcije,
 * a poruka izgleda kao da je baza nedostupna. Zato se u tom slučaju parametar ukloni
 * i ostane `sslmode` kakav jeste: sa `verify-full` veza će pasti sa JASNOM TLS greškom
 * (cert not trusted), a sa `require`/`disable` će raditi. Tihi fallback na „ne provjeravaj
 * certifikat“ se NE radi — to bi sakrilo pravi problem sa TLS-om.
 */
function connectionStringWithoutMissingCa(url: string): string {
  if (!url.includes("sslrootcert=")) return url;
  const match = /[?&]sslrootcert=([^&]*)/.exec(url);
  if (!match) return url;
  const caPath = decodeURIComponent(match[1] ?? "");
  if (caPath.length === 0 || existsSync(caPath)) return url;
  console.warn(
    JSON.stringify({
      level: "warn",
      msg:
        `sslrootcert putanja ne postoji (${caPath}) — uklanjam je iz konekcije. ` +
        "Provjeri mount CA u compose-u (docs/COOLIFY.md §2).",
    }),
  );
  return url
    .replace(/[?&]sslrootcert=[^&]*/g, "")
    .replace(/\?&/, "?")
    .replace(/&$/, "");
}

export function getPool(): Pool {
  if (!pool) {
    const config = loadConfig();
    pool = new Pool({
      connectionString: connectionStringWithoutMissingCa(config.DATABASE_URL),
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
