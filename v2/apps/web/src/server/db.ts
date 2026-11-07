/**
 * Jedan pool za proces. Aplikacija se konektuje kao `gradix_app` (ADR 0003):
 * NOSUPERUSER / NOBYPASSRLS / nije vlasnik tabela — inače RLS ne štiti ništa.
 *
 * Ne izvozi se `query` bez tenanta: svi poslovni upiti idu kroz `withCompany`.
 */
import { Pool } from "pg";
import { loadConfig } from "./config";

let pool: Pool | null = null;

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
    // Greška na idle konekciji ne smije srušiti proces (pool je zamijeni).
    pool.on("error", (error) => {
      console.error(JSON.stringify({ level: "error", msg: "pg pool error", error: error.message }));
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
