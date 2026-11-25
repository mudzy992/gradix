/**
 * F8 — pouzdanost mašine: MTBF, MTTR, trošak održavanja po satu rada.
 *
 * Ništa od ovoga nije tabela (§1.6/30): sve tri brojke su IZRAČUN iz naloga i radnih sati u
 * periodu. Tabela bi bila četvrta kopija istine koja se poslije ne slaže sa nalozima.
 *
 * Formula je u domeni (`machineReliability`); ovaj fajl samo donosi podatke. `workHours` dolazi iz
 * `machine_work_logs` (`kind = 'WORK'`), jer su to stvarni sati rada mašine — brojilo je pokazatelj
 * održavanja, a ne sati rada.
 */
import type { PoolClient } from "pg";
import { formatHundredths, machineReliability } from "@gradix/domain";
import type { ServiceOrderRow } from "./service-order-types";
import { toServiceOrderRow, type DbServiceOrderRow } from "./service-order-mapper";
import { ORDER_SELECT } from "./service-order-read";
import { companyToday } from "./project-service";
import { companyId as toCompanyId } from "@gradix/db";

export type ReliabilityRow = {
  from: string;
  to: string;
  faultCount: number;
  finishedCount: number;
  mttrMinutes: number | null;
  mtbfHours: string | null;
  workHours: string;
  maintenanceCostAmount: string;
  maintenanceCostPerHourAmount: string | null;
  currencyCode: string;
};

export async function machineReliabilityFor(
  client: PoolClient,
  params: { companyId: string; machineId: string; from?: string | null; to?: string | null },
): Promise<ReliabilityRow> {
  const today = await companyToday(client, toCompanyId(params.companyId));
  const from = params.from ?? today.slice(0, 4) + "-01-01";
  const to = params.to ?? today;

  const orders = await client.query<DbServiceOrderRow>(
    `SELECT ${ORDER_SELECT}
      WHERE so.company_id = $1 AND so.machine_id = $2
        AND so.opened_at::date BETWEEN $3::date AND $4::date
      ORDER BY so.opened_at`,
    [params.companyId, params.machineId, from, to],
  );

  const hours = await client.query<{ hours: string }>(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (l.ended_at - l.started_at)) / 3600.0), 0)::text AS hours
       FROM public.machine_work_logs l
      WHERE l.company_id = $1 AND l.machine_id = $2 AND l.mode = 'WORK' AND l.ended_at IS NOT NULL
        AND l.started_at::date BETWEEN $3::date AND $4::date`,
    [params.companyId, params.machineId, from, to],
  );
  const workHours = hours.rows[0]?.hours ?? "0";

  const currency = await client.query<{ currency: string }>(
    "SELECT currency FROM public.companies WHERE id = $1",
    [params.companyId],
  );

  const reliability = machineReliability(
    orders.rows.map((row) => ({
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status as never,
      isFault: row.origin === "FAULT",
      totalCostCents: BigInt(row.total_cost_cents),
      warrantyClaim: row.warranty_claim,
    })),
    [workHours],
  );

  return {
    from,
    to,
    faultCount: reliability.faultCount,
    finishedCount: reliability.finishedCount,
    mttrMinutes: reliability.mttrMinutes,
    mtbfHours: reliability.mtbfHours,
    workHours: formatHundredths(toHundredthsSafe(workHours)),
    maintenanceCostAmount: formatHundredths(reliability.maintenanceCostCents),
    maintenanceCostPerHourAmount: reliability.maintenanceCostPerHour,
    currencyCode: currency.rows[0]?.currency ?? "BAM",
  };
}

function toHundredthsSafe(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

export async function machineMaintenanceView(
  client: PoolClient,
  params: { companyId: string; machineId: string; from?: string | null; to?: string | null },
): Promise<{ reliability: ReliabilityRow; orders: ServiceOrderRow[] }> {
  const today = await companyToday(client, toCompanyId(params.companyId));
  const orders = await client.query<DbServiceOrderRow>(
    `SELECT ${ORDER_SELECT}
      WHERE so.company_id = $1 AND so.machine_id = $2
      ORDER BY so.opened_at DESC
      LIMIT 100`,
    [params.companyId, params.machineId],
  );
  const reliability = await machineReliabilityFor(client, params);
  return {
    reliability,
    orders: orders.rows.map((row) => toServiceOrderRow(row, today)),
  };
}
