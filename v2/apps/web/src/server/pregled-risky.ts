/**
 * F5 (Modul 6 §1.7.28): top 5 rizičnih projekata + broj troškova bez cijene.
 *
 * „Rizičan“ ima TRI imenovana uzroka, i svaki se vidi na ekranu:
 *   - `NEGATIVE_MARGIN`  — marža ispod nule (vrijednost sa aneksima < POSTED trošak),
 *   - `OVER_BUDGET`      — POSTED trošak ≥ aktivni budžet,
 *   - `PENDING_COSTS`    — ima zapisa bez cijene (rizik, ne trošak — §1.8.29).
 *
 * Čemu služi: vlasnik na `/pregled` treba da vidi pet projekata koji gube novac, a ne pet najvećih
 * po trošku. Rangiranje je po težini gubitka (negativna marža u centima), pa se najgori vidi prvi.
 */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency, toAmountString, type Currency } from "@gradix/domain";
import { can } from "./permissions";
import type { RiskyProjectRow, RiskyProjectsResult, ServiceError } from "./risky-projects-types";

type DbRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  currency_code: string | null;
  contract_value_cents: string | null;
  amendments_cents: string | null;
  posted_cents: string | null;
  budget_cents: string | null;
  pending_count: string;
  progress_pct: string | null;
};

export async function listRiskyProjects(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  limit = 5,
): Promise<RiskyProjectsResult | ServiceError> {
  if (!can(actor.roles, "dashboard.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda dashboarda." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query<DbRow>(
      `SELECT p.id, p.code, p.name, p.status,
              coalesce(p.currency_code, 'BAM') AS currency_code,
              p.contract_value_cents::text,
              (SELECT coalesce(sum(a.amount_cents), 0)::text FROM public.project_amendments a
                WHERE a.company_id = p.company_id AND a.project_id = p.id
                  AND a.status = 'APPROVED') AS amendments_cents,
              (SELECT coalesce(sum(e.amount_cents), 0)::text FROM public.cost_entries e
                WHERE e.company_id = p.company_id AND e.project_id = p.id
                  AND e.status = 'POSTED') AS posted_cents,
              (SELECT sum(b.amount_cents)::text FROM public.project_budget_lines b
                WHERE b.company_id = p.company_id AND b.project_id = p.id
                  AND b.revision = (SELECT max(revision) FROM public.project_budget_lines
                                     WHERE company_id = p.company_id AND project_id = p.id)) AS budget_cents,
              (SELECT count(*)::text FROM public.cost_entries e
                WHERE e.company_id = p.company_id AND e.project_id = p.id
                  AND e.status = 'PENDING') AS pending_count,
              (SELECT CASE WHEN sum(weight) = 0 THEN NULL
                           ELSE round(sum(progress_pct * weight)::numeric / sum(weight), 2)::text END
                 FROM public.project_phases ph
                WHERE ph.company_id = p.company_id AND ph.project_id = p.id
                  AND ph.status <> 'CANCELLED') AS progress_pct
         FROM public.projects p
        WHERE p.company_id = $1 AND p.is_active AND p.status <> 'CANCELLED'
        ORDER BY p.created_at DESC`,
      [actor.companyId],
    );

    const projects: RiskyProjectRow[] = [];
    let totalPending = 0;
    for (const row of result.rows) {
      const currency: Currency = isCurrency(row.currency_code) ? row.currency_code : "BAM";
      const posted = BigInt(row.posted_cents ?? "0");
      const amendment = BigInt(row.amendments_cents ?? "0");
      const budget = row.budget_cents === null ? null : BigInt(row.budget_cents);
      const pending = Number(row.pending_count ?? "0");
      totalPending += pending;
      const contract =
        row.contract_value_cents === null ? null : BigInt(row.contract_value_cents) + amendment;
      const margin = contract === null ? null : contract - posted;
      const marginPct =
        contract !== null && contract > 0n && margin !== null
          ? Math.round(Number((margin * 100_00n) / contract)) / 100
          : null;
      const budgetUsedPct =
        budget !== null && budget > 0n ? Math.round(Number((posted * 100_00n) / budget)) / 100 : null;
      const risks: RiskyProjectRow["risks"] = [];
      if (margin !== null && margin < 0n) risks.push("NEGATIVE_MARGIN");
      if (budget !== null && budget > 0n && posted >= budget) risks.push("OVER_BUDGET");
      if (pending > 0) risks.push("PENDING_COSTS");
      if (risks.length === 0) continue;
      projects.push({
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status as RiskyProjectRow["status"],
        margin: margin === null ? null : toAmountString({ cents: margin, currency }),
        margin_pct: marginPct,
        budget_used_pct: budgetUsedPct,
        progress_pct: row.progress_pct === null ? null : Number(row.progress_pct),
        risks,
        pending_cost_count: pending,
        // Za rangiranje: koliko je novca „u minusu“. Nije dio ugovora odgovora, interno.
        _severity: margin !== null && margin < 0n ? -margin : 0n,
      } as RiskyProjectRow & { _severity: bigint });
    }

    projects.sort((a, b) => {
      const aSeverity = (a as RiskyProjectRow & { _severity: bigint })._severity;
      const bSeverity = (b as RiskyProjectRow & { _severity: bigint })._severity;
      if (aSeverity !== bSeverity) return aSeverity > bSeverity ? -1 : 1;
      // Bez negativne marže rangira prekoračenje budžeta, pa broj zapisa bez cijene.
      const aUsed = a.budget_used_pct ?? 0;
      const bUsed = b.budget_used_pct ?? 0;
      if (aUsed !== bUsed) return bUsed - aUsed;
      return b.pending_cost_count - a.pending_cost_count;
    });

    return {
      projects: projects.slice(0, limit).map(({ ...rest }) => {
        const copy = { ...rest } as Record<string, unknown>;
        delete copy._severity;
        return copy as unknown as RiskyProjectRow;
      }),
      pending_cost_count: totalPending,
    };
  });
}
