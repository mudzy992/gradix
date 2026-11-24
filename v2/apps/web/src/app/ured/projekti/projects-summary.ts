/**
 * F5: sažetak po projektu za LISTU (marža, % napretka, rizičnost).
 *
 * Zašto se računa na serveru, a ne u klijentu: lista projekata mora pokazati maržu i procenat, a
 * to su dva skupa (ledger + faze + aneksi). Ako ih klijent dohvata po redu, lista od 40 projekata
 * radi 40 zahtjeva — isti N+1 koji je `PROJECT_SELECT` već izbjegao za brojače tima.
 */
import type { Pool } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { isCurrency, toAmountString, type Currency } from "@gradix/domain";

export type ProjectFinancialSummary = {
  project_id: string;
  margin: string | null;
  margin_pct: number | null;
  progress_pct: number | null;
  budget_used_pct: number | null;
  pending_cost_count: number;
  risky: boolean;
};

export async function projectFinancialSummaries(
  pool: Pool,
  companyId: CompanyId,
  projectIds: string[],
): Promise<Map<string, ProjectFinancialSummary>> {
  if (projectIds.length === 0) return new Map();
  return withCompany(pool, companyId, async (client) => {
    const rows = await client.query<{
      id: string;
      currency_code: string | null;
      contract_value_cents: string | null;
      amendments: string | null;
      posted: string | null;
      budget: string | null;
      pending: string;
      progress: string | null;
    }>(
      `SELECT p.id, p.currency_code, p.contract_value_cents::text,
              (SELECT coalesce(sum(a.amount_cents), 0)::text FROM public.project_amendments a
                WHERE a.company_id = p.company_id AND a.project_id = p.id
                  AND a.status = 'APPROVED') AS amendments,
              (SELECT coalesce(sum(e.amount_cents), 0)::text FROM public.cost_entries e
                WHERE e.company_id = p.company_id AND e.project_id = p.id
                  AND e.status = 'POSTED') AS posted,
              (SELECT sum(b.amount_cents)::text FROM public.project_budget_lines b
                WHERE b.company_id = p.company_id AND b.project_id = p.id
                  AND b.revision = (SELECT max(revision) FROM public.project_budget_lines
                                     WHERE company_id = p.company_id AND project_id = p.id)) AS budget,
              (SELECT count(*)::text FROM public.cost_entries e
                WHERE e.company_id = p.company_id AND e.project_id = p.id
                  AND e.status = 'PENDING') AS pending,
              (SELECT CASE WHEN sum(weight) = 0 THEN NULL
                           ELSE round(sum(progress_pct * weight)::numeric / sum(weight), 2)::text END
                 FROM public.project_phases ph
                WHERE ph.company_id = p.company_id AND ph.project_id = p.id
                  AND ph.status <> 'CANCELLED') AS progress
         FROM public.projects p
        WHERE p.company_id = $1 AND p.id = ANY($2::text[])`,
      [companyId, projectIds],
    );
    const map = new Map<string, ProjectFinancialSummary>();
    for (const row of rows.rows) {
      const currency: Currency = isCurrency(row.currency_code) ? row.currency_code : "BAM";
      const posted = BigInt(row.posted ?? "0");
      const amendments = BigInt(row.amendments ?? "0");
      const budget = row.budget === null ? null : BigInt(row.budget);
      const pending = Number(row.pending ?? "0");
      const contract =
        row.contract_value_cents === null ? null : BigInt(row.contract_value_cents) + amendments;
      const margin = contract === null ? null : contract - posted;
      const marginPct =
        contract !== null && contract > 0n && margin !== null
          ? Math.round(Number((margin * 100_00n) / contract)) / 100
          : null;
      const budgetUsedPct =
        budget !== null && budget > 0n ? Math.round(Number((posted * 100_00n) / budget)) / 100 : null;
      map.set(row.id, {
        project_id: row.id,
        margin: margin === null ? null : toAmountString({ cents: margin, currency }),
        margin_pct: marginPct,
        progress_pct: row.progress === null ? null : Number(row.progress),
        budget_used_pct: budgetUsedPct,
        pending_cost_count: pending,
        // „Rizičan“ ima imenovane uzroke (§1.7.28) — filter u listi koristi isti uslov.
        risky:
          (margin !== null && margin < 0n) ||
          (budgetUsedPct !== null && budgetUsedPct >= 100) ||
          pending > 0,
      });
    }
    return map;
  });
}
