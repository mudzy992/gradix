/** R6.2: OWNER/PM/ACCOUNTANT dashboard numbers for /pregled Sažetak. */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, periodTotals, withCompany } from "@gradix/db";
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
  const projects = await client.query<{ n: number }>(
    scoped
      ? `SELECT count(*)::int AS n FROM public.projects p
          WHERE p.company_id = $1 AND p.is_active AND p.id = ANY($2::text[])`
      : `SELECT count(*)::int AS n FROM public.projects p
          WHERE p.company_id = $1 AND p.is_active`,
    scoped ? [actor.companyId, projectIds] : [actor.companyId],
  );
  const totals = await periodTotals(client, actor.companyId, from, today, projectIds);
  return {
    activeProjects: projects.rows[0]?.n ?? 0,
    bookedCostsAmount: toAmountString({ cents: BigInt(totals.cents), currency }),
    bookedCostsCurrency: currency,
    hoursInPeriod: totals.hours,
    periodFrom: from,
    periodTo: today,
  };
}
