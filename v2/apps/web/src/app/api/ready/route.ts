/**
 * Readiness: baza je obavezna zavisnost, pa njen pad daje 503.
 * Aplikacijska rola nema pristup `schema_migrations`; migrator je jedini čita tu evidenciju.
 * Redis i MinIO nisu ovdje jer se u ovom rezu ne koriste (nema mrtve konfiguracije).
 */
import { getPool } from "@/server/db";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 2000;

type Probe = { status: "ok" | "error"; latencyMs: number };

type DbInfo = {
  role: string;
  is_super: boolean;
  bypass_rls: boolean;
  /** Stvarno ime baze kojoj je pool spojen — hvata `hgsakyyni` vs `gradix` zabunu. */
  database: string;
  /** Može li rola pisati u šemu public (DDL). U modelu C to radi samo admin rola. */
  can_create: boolean;
};

async function probe(sql: string): Promise<Probe> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      getPool().query(sql),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { status: "ok", latencyMs: Date.now() - started };
  } catch {
    return { status: "error", latencyMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const postgres = await probe("SELECT 1");
  let dbRole: DbInfo | null = null;
  if (postgres.status === "ok") {
    try {
      const role = await getPool().query<DbInfo>(
        "SELECT current_user AS role, r.rolsuper AS is_super, r.rolbypassrls AS bypass_rls, " +
          "current_database() AS database, " +
          "has_schema_privilege(current_user, 'public', 'CREATE') AS can_create " +
          "FROM pg_roles r WHERE r.rolname = current_user",
      );
      dbRole = role.rows[0] ?? null;
    } catch {
      dbRole = null;
    }
  }
  const status = postgres.status === "ok" ? "ok" : "error";
  return Response.json(
    {
      status,
      checks: {
        postgres,
        // Dijagnostika; detaljni privilegiji/RLS ostaju u internom preflightu.
        databaseRole: dbRole,
      },
    },
    { status: status === "ok" ? 200 : 503 },
  );
}
