/**
 * Readiness: baza je obavezna zavisnost, pa njen pad daje 503.
 * Broj primijenjenih migracija se PRIJAVLJUJE, ali u R0 ne obara readiness —
 * strogo gate-ovanje migracija dolazi u Fazi 2 uz pravi deploy pipeline.
 * Redis i MinIO nisu ovdje jer se u ovom rezu ne koriste (nema mrtve konfiguracije).
 */
import { getPool } from "@/server/db";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 2000;

type Probe = { status: "ok" | "error"; latencyMs: number };

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
  let applied = 0;
  if (postgres.status === "ok") {
    try {
      const result = await getPool().query<{ count: string }>(
        "SELECT count(*)::text AS count FROM schema_migrations",
      );
      applied = Number(result.rows[0]?.count ?? 0);
    } catch {
      applied = 0;
    }
  }
  const status = postgres.status === "ok" ? "ok" : "error";
  return Response.json(
    { status, checks: { postgres, migrations: { applied } } },
    { status: status === "ok" ? 200 : 503 },
  );
}
