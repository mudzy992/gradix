import type { PoolClient } from "pg";
import { companyId as toCompanyId } from "@gradix/db";
import type { Role } from "./permissions";
import { companyToday } from "./project-service";
import { dueMaintenancePlans } from "./maintenance-service";

/**
 * F8 — „šta traži pažnju“ na Pregledu: preventivni servis koji je prešao prag i nalozi koji čekaju
 * odobrenje.
 *
 * Brojevi se NE računaju ovdje iznova: dospjeli planovi dolaze iz `dueMaintenancePlans`, iste
 * funkcije koju zove worker za podsjetnike, pa ekran i podsjetnik ne mogu reći različito „dospjelo“.
 *
 * Kartice NEMA bez `service.view` — prazna kartica bi tvrdila da servisa nema. Ako planova nema,
 * kartica se i dalje prikazuje sa nulama samo kad planovi postoje a nijedan nije dospio; inače je
 * `null` (nema šta reći).
 */
export type ServiceAttentionPlan = {
  planId: string;
  machineName: string;
  name: string;
  basis: "HOURS" | "KM" | "DAYS";
  status: "DUE_SOON" | "OVERDUE";
  due: string | null;
  openOrderId: string | null;
};

export type ServiceAttention = {
  overdue: number;
  dueSoon: number;
  awaitingApproval: number;
  waitingParts: number;
  examples: ServiceAttentionPlan[];
};

export async function serviceAttention(
  client: PoolClient,
  actor: { userId: string; companyId: string; roles: Role[] },
): Promise<ServiceAttention | null> {
  const today = await companyToday(client, toCompanyId(actor.companyId));

  const plans = await dueMaintenancePlans(client, actor.companyId, today);

  const counts = await client.query<{ waiting_parts: string; awaiting_approval: string }>(
    `SELECT
        (SELECT count(*)::text FROM public.service_orders so
          WHERE so.company_id = $1 AND so.status = 'WAITING_PARTS') AS waiting_parts,
        (SELECT count(*)::text FROM public.service_orders so
          WHERE so.company_id = $1 AND so.status = 'PLANNED') AS awaiting_approval`,
    [actor.companyId],
  );

  /* `dueMaintenancePlans` vraća i DUE_SOON i OVERDUE zajedno, ali ne nosi stanje — pa se ono
     izvodi iz istog pravila kao u domeni: pređen rok = OVERDUE. */
  const rows: ServiceAttentionPlan[] = plans.map((plan) => {
    const overdue = plan.planned_for < today && plan.open_order_id === null;
    return {
      planId: plan.plan_id,
      machineName: plan.machine_name,
      name: plan.name,
      basis: plan.basis,
      status: overdue ? "OVERDUE" : "DUE_SOON",
      due: plan.planned_for,
      openOrderId: plan.open_order_id,
    };
  });

  const countsRow = counts.rows[0];
  const overdue = rows.filter((row) => row.status === "OVERDUE").length;
  const dueSoon = rows.length - overdue;

  return {
    overdue,
    dueSoon,
    awaitingApproval: Number(countsRow?.awaiting_approval ?? "0"),
    waitingParts: Number(countsRow?.waiting_parts ?? "0"),
    /* Primjeri: prvo pređeni rok, pa najbliži — redoslijed je hitnost, ne kategorija. */
    examples: [...rows]
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "OVERDUE" ? -1 : 1))
      .slice(0, 3),
  };
}
