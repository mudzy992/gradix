import type { Pool } from "pg";

/** Jedini globalni lookup je lista ID-jeva. Poslovne podatke čitaj tek u tenant transakciji. */
export async function listActiveCompanyIds(pool: Pool, onlyCompanyId?: string): Promise<string[]> {
  const rows = await pool.query<{ id: string }>(
    "SELECT id FROM public.list_active_company_ids_for_worker() WHERE ($1::text IS NULL OR id = $1)",
    [onlyCompanyId ?? null],
  );
  return rows.rows.map((row) => row.id);
}
