/**
 * F8 — radnje servisnog naloga koje poziva mobilni sync, unutar VEĆ otvorene transakcije.
 *
 * Zašto odvojeno od `service-order-actions.ts`: taj modul ima ulazne tačke koje otvaraju svoju
 * transakciju (`startServiceOrder`, `waitServiceOrderParts`, `finishServiceOrder`). Sync stavka je
 * već u transakciji batcha, pa bi poziv tih funkcija otvorio drugu — i priznanica o prijemu bi
 * završila u drugoj transakciji od radnje koju opisuje. Zato ovdje stoje tanki omotači koji rade
 * ISTE provjere (prelaz iz domene, satnica na dan rada, trošak iz domene) nad datim klijentom.
 *
 * Trošak se NE računa na telefonu i ne dolazi iz payloada: `labor_hours × satnica` na dan rada,
 * plus dijelovi, plus vanjski trošak. Isti `finishOrderInTransaction` koji koristi web.
 */
import type { PoolClient } from "pg";
import { ServiceError, assertServiceTransition, type ServiceOrderStatus } from "@gradix/domain";
import { approvalBlock, setStatus, transitionFailed } from "./service-order-actions";
import { orderStatus } from "./service-order-shared";
import { loadServiceOrder } from "./service-order-read";
import { finishOrderInTransaction } from "./service-order-transaction";
import type { ServiceOutcome } from "./service-order-types";

export type SyncActionResult = { ok: true } | { ok: false; code: string };

/**
 * Promjena stanja (početak / čekanje dijelova) iz sync-a.
 *
 * Prelaz se provjerava domenom, ne „ako je status X onda smije“: pravilo `PLANNED → IN_PROGRESS`
 * postoji na jednom mjestu i sync ga ne smije zaobići. Nepromijenjeno stanje se prijavljuje kao
 * uspjeh (idempotencija) — mehaničar koji je pritisnuo „počni“ dvaput nije napravio grešku.
 */
export async function setOrderStatusFromSync(
  client: PoolClient,
  params: {
    companyId: string;
    actorId: string;
    orderId: string;
    target: Extract<ServiceOrderStatus, "IN_PROGRESS" | "WAITING_PARTS">;
    note: string | null;
  },
): Promise<SyncActionResult> {
  const current = await orderStatus(client, params.companyId, params.orderId);
  if (!current.ok) {
    return { ok: false, code: outcomeCode(current.result) };
  }
  if (current.status === params.target) return { ok: true };
  if (current.status === "DONE" || current.status === "CANCELLED") {
    return { ok: false, code: "SERVICE_ALREADY_DONE" };
  }
  try {
    assertServiceTransition(current.status, params.target);
  } catch (error) {
    return { ok: false, code: transitionCode(error) };
  }
  /* Isti prag odobrenja kao na webu: telefon ne smije zaobići odobrenje time što je „samo“ sync. */
  const blocked = await approvalBlock(client, params.companyId, params.orderId);
  if (blocked) {
    return { ok: false, code: outcomeCode(blocked) };
  }
  await setStatus(client, {
    companyId: params.companyId,
    orderId: params.orderId,
    actorId: params.actorId,
    status: params.target,
    ...(params.target === "IN_PROGRESS" ? { extra: { startedAt: true } } : {}),
  });
  if (params.target === "WAITING_PARTS" && params.note?.trim()) {
    /* Razlog čekanja ide kao događaj, ne u `description`: opis govori o kvaru, ne o trenutnom
       stanju. Isto pravilo kao na webu. */
    await client.query(
      `INSERT INTO public.service_order_events
         (id, company_id, service_order_id, kind, actor_id, note)
       VALUES ($1,$2,$3,'PARTS_REQUESTED',$4,$5)`,
      [
        `soe_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
        params.companyId,
        params.orderId,
        params.actorId,
        params.note.trim().slice(0, 1000),
      ],
    );
  }
  return { ok: true };
}

/** Završetak: ista putanja kao web (`finishOrderInTransaction`), bez otvaranja nove transakcije. */
export async function finishOrderFromSync(
  client: PoolClient,
  params: {
    companyId: string;
    actorId: string;
    orderId: string;
    laborHours: string | null;
    externalCostAmount: string | null;
    warrantyUntil: string | null;
  },
): Promise<SyncActionResult> {
  const outcome = await finishOrderInTransaction(client, {
    companyId: params.companyId,
    actorId: params.actorId,
    orderId: params.orderId,
    laborHours: params.laborHours ?? "0",
    externalCostCents: null,
    externalInvoiceRef: null,
    warrantyUntil: params.warrantyUntil,
    downtimeMinutes: null,
    downtimeReason: null,
    externalCostAmount: params.externalCostAmount,
  });
  if (outcome.outcome === "OK") return { ok: true };
  /* `NOT_FOUND` nema `code` u tipu — vraćamo kod koji je stabilan za telefon. */
  return { ok: false, code: outcomeCode(outcome) };
}

/** Kod ishoda kao string — `OK` i `NOT_FOUND` nemaju `code`, a telefon traži stabilan kod. */
function outcomeCode(outcome: ServiceOutcome): string {
  if (outcome.outcome === "OK") return "OK";
  if (outcome.outcome === "NOT_FOUND") return "NOT_FOUND";
  return outcome.code;
}

function transitionCode(error: unknown): string {
  const mapped = transitionFailed(error);
  return mapped.outcome === "OK" ? "SERVICE_INVALID_STATUS" : mapped.code;
}

/** Nalog mora postojati u firmi; vraća `false` da pozivalac odbije stavku bez izuzetka. */
export async function syncOrderExists(
  client: PoolClient,
  companyId: string,
  orderId: string,
): Promise<boolean> {
  return (await loadServiceOrder(client, companyId, orderId)) !== null;
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
