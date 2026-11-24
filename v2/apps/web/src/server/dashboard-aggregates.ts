/** R6.2: OWNER/PM/ACCOUNTANT dashboard numbers for /pregled Sažetak. */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  isCurrency,
  toAmountString,
  visibleProjectIds,
  type Currency,
  type Scope,
} from "@gradix/domain";
import { can, type Role } from "./permissions";

export type DashboardActor = {
  userId: string;
  companyId: string;
  roles: readonly Role[] | readonly string[];
  scope: Scope | string;
  projectIds: readonly string[] | null;
};

export type DashboardAggregates = {
  activeProjects: number;
  bookedCostsAmount: string;
  bookedCostsCurrency: string;
  hoursInPeriod: string;
  periodFrom: string;
  periodTo: string;
};

function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

export async function loadDashboardAggregates(
  pool: Pool,
  actor: DashboardActor,
): Promise<DashboardAggregates | null> {
  if (!can(actor.roles, "dashboard.view")) return null;
  return withCompany(pool, toCompanyId(actor.companyId), (client) =>
    computeDashboardAggregates(client, actor),
  );
}

/** Za poziv unutar postojećeg withCompany (npr. buildPregled). */
export async function computeDashboardAggregates(
  client: PoolClient,
  actor: DashboardActor,
): Promise<DashboardAggregates | null> {
  if (!can(actor.roles, "dashboard.view")) return null;
  return buildDashboard(client, actor);
}

async function buildDashboard(
  client: PoolClient,
  actor: DashboardActor,
): Promise<DashboardAggregates> {
  const company = await client.query<{ today: string; currency: string }>(
    `SELECT (clock_timestamp() AT TIME ZONE c.timezone)::date::text AS today, c.currency
       FROM public.companies c WHERE c.id = $1`,
    [actor.companyId],
  );
  const today = company.rows[0]!.today;
  const currencyRaw = company.rows[0]!.currency;
  const currency = (isCurrency(currencyRaw) ? currencyRaw : "BAM") as Currency;
  const from = monthStart(today);
  const projectIds = visibleProjectIds({
    userId: actor.userId,
    scope: actor.scope as Scope,
    projectIds: actor.projectIds ?? [],
  });
  const scoped = projectIds !== null;
  const params: unknown[] = scoped
    ? [actor.companyId, projectIds, from, today]
    : [actor.companyId, from, today];
  const scopePred = scoped ? "AND e.project_id = ANY($2::text[])" : "";
  const fromIdx = scoped ? "$3" : "$2";
  const toIdx = scoped ? "$4" : "$3";
  const projects = await client.query<{ n: number }>(
    scoped
      ? `SELECT count(*)::int AS n FROM public.projects p
          WHERE p.company_id = $1 AND p.is_active AND p.id = ANY($2::text[])`
      : `SELECT count(*)::int AS n FROM public.projects p
          WHERE p.company_id = $1 AND p.is_active`,
    scoped ? [actor.companyId, projectIds] : [actor.companyId],
  );
  const costs = await client.query<{ cents: string }>(
    /*
     * F5: jedan ledger (`cost_entries`). Period ide po `occurred_on` (dan događaja), a ne po
     * `booked_at`: izvještaj mjeseca govori o poslu koji se tada radio, ne o trenutku kad je
     * neko stisnuo „potvrdi“.
     */
    `SELECT coalesce(sum(e.amount_cents), 0)::text AS cents
       FROM public.cost_entries e
      WHERE e.company_id = $1
        AND e.status = 'POSTED'
        ${scopePred}
        AND e.occurred_on BETWEEN ${fromIdx}::date AND ${toIdx}::date`,
    params,
  );
  const hours = await client.query<{ hours: number }>(
    `SELECT coalesce(sum(extract(epoch FROM (e.ended_at - e.started_at)) / 3600.0), 0)::float8 AS hours
       FROM public.work_entries e
       JOIN public.workdays d ON d.company_id = e.company_id AND d.id = e.workday_id
      WHERE e.company_id = $1
        AND e.kind = 'WORK' AND e.end_state = 'KNOWN_END' AND e.ended_at IS NOT NULL
        AND d.approval_status IN ('LOCKED', 'FOREMAN_CONFIRMED')
        AND d.work_date BETWEEN ${fromIdx}::date AND ${toIdx}::date
        ${scopePred}`,
    params,
  );
  const hoursVal = Number(hours.rows[0]?.hours ?? 0);
  return {
    activeProjects: projects.rows[0]?.n ?? 0,
    bookedCostsAmount: toAmountString({ cents: BigInt(costs.rows[0]?.cents ?? "0"), currency }),
    bookedCostsCurrency: currency,
    hoursInPeriod: hoursVal.toFixed(3),
    periodFrom: from,
    periodTo: today,
  };
}
