/**
 * Briše samo pilot-unose sintetičke demo firme (niskogradnja-demo).
 * Nikad: RESOLVED sukobe, firmu cmp_druga, seed ID-jeve koji su još potrebni razriješenom sukobu.
 * Poslije: pozivaoc pokreće običan seed (upsert baseline).
 *
 *   DATABASE_ADMIN_URL=... SEED_PASSWORD=... \
 *     pnpm --filter @gradix/web exec tsx scripts/seed.ts --reset-pilot
 */
import type { Pool, PoolClient } from "pg";
import { companyId, withCompany } from "@gradix/db";

export const DEMO_COMPANY_ID = "cmp_demo";

/** Izvor: seed.ts `assignments` — ne dirati ove ID-jeve. */
export const SEED_ASSIGNMENT_IDS = [
  "pas_1",
  "pas_2",
  "pas_3",
  "pas_4",
  "pas_5",
  "pas_6",
  "pas_7",
  "pas_8",
] as const;

export type ResetPilotReport = {
  deletedOpenConflicts: number;
  deletedReceipts: number;
  deletedChangeLog: number;
  deletedEntries: number;
  deletedWorkdays: number;
  deletedExtraAssignments: number;
  keptResolvedConflicts: number;
};

async function deleteInTenant(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const result = await client.query(sql, params);
  return result.rowCount ?? 0;
}

export async function resetPilotSynthetic(pool: Pool): Promise<ResetPilotReport> {
  const kept = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.sync_conflicts
      WHERE company_id = $1 AND status = 'RESOLVED'`,
    [DEMO_COMPANY_ID],
  );
  const report: ResetPilotReport = {
    deletedOpenConflicts: 0,
    deletedReceipts: 0,
    deletedChangeLog: 0,
    deletedEntries: 0,
    deletedWorkdays: 0,
    deletedExtraAssignments: 0,
    keptResolvedConflicts: Number(kept.rows[0]?.n ?? 0),
  };
  await withCompany(pool, companyId(DEMO_COMPANY_ID), async (client) => {
    report.deletedReceipts = await deleteInTenant(
      client,
      "DELETE FROM public.sync_receipts WHERE company_id = $1",
      [DEMO_COMPANY_ID],
    );
    report.deletedChangeLog = await deleteInTenant(
      client,
      "DELETE FROM public.sync_change_log WHERE company_id = $1",
      [DEMO_COMPANY_ID],
    );
    await deleteInTenant(client, "DELETE FROM public.sync_cursor_slots WHERE company_id = $1", [
      DEMO_COMPANY_ID,
    ]);
    report.deletedOpenConflicts = await deleteInTenant(
      client,
      `DELETE FROM public.sync_conflicts WHERE company_id = $1 AND status = 'OPEN'`,
      [DEMO_COMPANY_ID],
    );
    report.deletedEntries = await deleteInTenant(
      client,
      `DELETE FROM public.work_entries e
        WHERE e.company_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM public.sync_conflicts c
             WHERE c.company_id = e.company_id AND c.work_entry_id = e.id
          )`,
      [DEMO_COMPANY_ID],
    );
    report.deletedWorkdays = await deleteInTenant(
      client,
      `DELETE FROM public.workdays w
        WHERE w.company_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM public.work_entries e
             WHERE e.company_id = w.company_id AND e.workday_id = w.id
          )`,
      [DEMO_COMPANY_ID],
    );
    report.deletedExtraAssignments = await deleteInTenant(
      client,
      `DELETE FROM public.project_assignments
        WHERE company_id = $1 AND NOT (id = ANY($2::text[]))`,
      [DEMO_COMPANY_ID, [...SEED_ASSIGNMENT_IDS]],
    );
  });
  return report;
}
