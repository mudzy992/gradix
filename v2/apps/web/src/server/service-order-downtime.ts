/**
 * F8 — ručna ispravka zastoja.
 *
 * Stvarni zastoj je `finished_at − started_at` (§1.6/29). Ručna korekcija postoji jer mjerenje
 * ponekad hvata pogrešan trenutak (mehaničar je počeo rad prije nego što je stigao do mašine), ali
 * je IZUZETAK: traži razlog ≥10 znakova i ostavlja događaj sa oba broja. Bez toga bi „ispravka“
 * bila način da se zastoj tiho smanji prije nego što ga neko pogleda.
 */
import type { PoolClient } from "pg";
import { writeAudit } from "./audit";

export async function recordManualDowntime(
  client: PoolClient,
  params: {
    companyId: string;
    orderId: string;
    machineId: string;
    actorId: string;
    computedMinutes: number;
    manualMinutes: number;
    reason: string | null;
  },
): Promise<{ ok: boolean; code?: string }> {
  const reason = params.reason?.trim() ?? "";
  if (params.manualMinutes === params.computedMinutes) return { ok: true };
  if (reason.length < 10) return { ok: false, code: "DOWNTIME_REASON_REQUIRED" };

  await client.query(
    `INSERT INTO public.service_order_events
       (id, company_id, service_order_id, kind, actor_id, note, payload)
     VALUES ($1,$2,$3,'FINISHED',$4,$5,$6::jsonb)`,
    [
      `soe_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      params.companyId,
      params.orderId,
      params.actorId,
      `Ručna korekcija zastoja: ${reason}`.slice(0, 1000),
      JSON.stringify({
        downtime_computed_minutes: params.computedMinutes,
        downtime_manual_minutes: params.manualMinutes,
      }),
    ],
  );

  await writeAudit(client, {
    companyId: params.companyId,
    actorId: params.actorId,
    actorEmail: null,
    action: "service.downtime_corrected",
    entityType: "service_order",
    entityId: params.orderId,
    metadata: {
      machineId: params.machineId,
      computedMinutes: params.computedMinutes,
      manualMinutes: params.manualMinutes,
      reason,
    },
    retentionClass: "STANDARD",
  });

  return { ok: true };
}
