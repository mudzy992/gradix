/**
 * F8 — čitanje jednog naloga: događaji, dijelovi, trošak i dozvoljeni prelazi.
 *
 * Događaji i dijelovi idu uz nalog u ISTOM zahtjevu jer se posmatraju zajedno (`/ured/servis/[id]`).
 * Dvije rute bi značile dva različita „svježa“ stanja na istom ekranu — npr. dijelovi dodani a
 * događaj još nije stigao.
 */
import type { PoolClient } from "pg";
import { formatHundredths, nextServiceStatuses } from "@gradix/domain";
import { companyToday } from "./project-service";
import { toServiceOrderRow, type DbServiceOrderRow } from "./service-order-mapper";
import type { ServiceOrderDetail, ServiceOrderRow } from "./service-order-types";
import { companyId as toCompanyId } from "@gradix/db";

/* Oblik je u `service-order-types` — klijentski ekran ne smije uvoziti modul koji dira `pg`. */
export type ServiceOrderDetailResult = ServiceOrderDetail;

export const ORDER_SELECT = `so.id, so.machine_id, m.code AS machine_code, m.name AS machine_name,
  so.fault_id, f.title AS fault_title,
  so.project_id, p.code AS project_code,
  so.partner_id, pt.name AS partner_name,
  so.origin, so.kind, so.priority, so.status, so.description,
  so.planned_for::text, so.opened_at::text, so.started_at::text, so.finished_at::text,
  so.assigned_mechanic_worker_id,
  CASE WHEN w.id IS NULL THEN NULL ELSE w.first_name || ' ' || w.last_name END AS assigned_mechanic_name,
  so.labor_hours::text, so.labor_cost_cents::text, so.parts_cost_cents::text,
  so.external_cost_cents::text, so.total_cost_cents::text, so.currency_code,
  so.amount_cents::text, so.external_quote_cents::text, so.external_invoice_ref,
  so.maintenance_plan_id, so.warranty_until::text, so.warranty_claim, so.warranty_source_order_id,
  so.cancel_reason, so.version,
  ar.id AS approval_request_id, ar.status AS approval_status
  FROM public.service_orders so
  JOIN public.machines m ON m.company_id = so.company_id AND m.id = so.machine_id
  LEFT JOIN public.machine_faults f ON f.company_id = so.company_id AND f.id = so.fault_id
  LEFT JOIN public.projects p ON p.company_id = so.company_id AND p.id = so.project_id
  LEFT JOIN public.partners pt ON pt.company_id = so.company_id AND pt.id = so.partner_id
  LEFT JOIN public.workers w ON w.company_id = so.company_id AND w.id = so.assigned_mechanic_worker_id
  LEFT JOIN public.approval_requests ar
    ON ar.company_id = so.company_id AND ar.subject_type = 'service_order' AND ar.subject_id = so.id`;

export async function loadServiceOrder(
  client: PoolClient,
  companyId: string,
  orderId: string,
): Promise<ServiceOrderRow | null> {
  const result = await client.query<DbServiceOrderRow>(
    `SELECT ${ORDER_SELECT} WHERE so.company_id = $1 AND so.id = $2`,
    [companyId, orderId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const today = await companyToday(client, toCompanyId(companyId));
  return toServiceOrderRow(row, today);
}

export async function serviceOrderDetail(
  client: PoolClient,
  companyId: string,
  orderId: string,
): Promise<ServiceOrderDetailResult | null> {
  const order = await loadServiceOrder(client, companyId, orderId);
  if (!order) return null;

  const events = await client.query<{
    id: string;
    kind: string;
    at: string;
    actor_name: string | null;
    note: string | null;
  }>(
    `SELECT e.id, e.kind, e.at::text,
            CASE WHEN u.id IS NULL THEN NULL
                 ELSE btrim(u.first_name || ' ' || u.last_name) END AS actor_name,
            e.note
       FROM public.service_order_events e
       LEFT JOIN public.users u ON u.id = e.actor_id
      WHERE e.company_id = $1 AND e.service_order_id = $2
      ORDER BY e.at ASC, e.id ASC`,
    [companyId, orderId],
  );

  const parts = await client.query<{
    id: string;
    item_id: string;
    item_code: string;
    item_name: string;
    unit: string;
    quantity: string;
    unit_cost_cents: string;
    stock_movement_id: string | null;
    total_cents: string;
    note: string | null;
  }>(
    `SELECT sp.id, sp.item_id, si.code AS item_code, si.name AS item_name, si.unit,
            sp.quantity::text, sp.unit_cost_cents::text, sp.stock_movement_id, sp.note,
            COALESCE(sm.amount_cents, round(sp.quantity * sp.unit_cost_cents))::text AS total_cents
       FROM public.service_order_parts sp
       LEFT JOIN public.stock_movements sm ON sm.company_id=sp.company_id AND sm.id=sp.stock_movement_id
       JOIN public.stock_items si ON si.company_id = sp.company_id AND si.id = sp.item_id
      WHERE sp.company_id = $1 AND sp.service_order_id = $2
      ORDER BY sp.created_at ASC, sp.id ASC`,
    [companyId, orderId],
  );

  const cost = await client.query<{
    id: string;
    amount_cents: string | null;
    status: string;
    project_id: string | null;
  }>(
    `SELECT id, amount_cents::text, status, project_id
       FROM public.cost_entries
      WHERE company_id = $1 AND source_type = 'SERVICE_ORDER' AND source_id = $2
        AND status <> 'REVERSED'
      LIMIT 1`,
    [companyId, orderId],
  );
  const costRow = cost.rows[0];

  return {
    order,
    events: events.rows,
    parts: parts.rows.map((row) => ({
      id: row.id,
      item_id: row.item_id,
      item_code: row.item_code,
      item_name: row.item_name,
      unit: row.unit,
      quantity: row.quantity,
      unit_cost_amount: formatHundredths(BigInt(row.unit_cost_cents)),
      total_cost_amount: formatHundredths(BigInt(row.total_cents)),
      stock_movement_id: row.stock_movement_id,
      note: row.note,
    })),
    costEntry: costRow
      ? {
          id: costRow.id,
          amount_amount: costRow.amount_cents === null ? null : formatHundredths(BigInt(costRow.amount_cents)),
          status: costRow.status,
          project_id: costRow.project_id,
        }
      : null,
    nextStatuses: [...nextServiceStatuses(order.status)],
  };
}
