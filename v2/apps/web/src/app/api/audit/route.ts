/**
 * GET /api/audit — trag sa filterima i keyset paginacijom.
 *
 * Filteri: `actorId`, `action`, `entityType`, `from`, `to`, `cursor`, `limit`.
 * Nepoznat `action` ili `entityType` se odbija (`VALIDATION_FAILED`) umjesto da vrati prazno:
 * prazna stranica za filter koji ne postoji izgleda kao „nema zapisa“, a to je laž.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { guard } from "@/server/guard";
import { getVerifiedPool } from "@/server/db";
import { listAudit } from "@/server/rbac-service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/server/audit";

export const dynamic = "force-dynamic";

function parseDate(value: string | null): Date | undefined | "invalid" {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "audit.view");
    if (!guardResult.ok) return guardResult.response;

    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? undefined;
    const entityType = params.get("entityType") ?? undefined;
    if (action && !AUDIT_ACTIONS.includes(action as (typeof AUDIT_ACTIONS)[number])) {
      return fail("VALIDATION_FAILED", "Nepoznata radnja u filteru.");
    }
    if (entityType && !AUDIT_ENTITY_TYPES.includes(entityType as (typeof AUDIT_ENTITY_TYPES)[number])) {
      return fail("VALIDATION_FAILED", "Nepoznat tip zapisa u filteru.");
    }

    const from = parseDate(params.get("from"));
    const to = parseDate(params.get("to"));
    if (from === "invalid" || to === "invalid") {
      return fail("VALIDATION_FAILED", "Datum u filteru nije ispravan.");
    }
    if (from && to && from > to) {
      return fail("VALIDATION_FAILED", "Početak perioda je poslije kraja.");
    }

    const result = await listAudit(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        actorId: params.get("actorId") ?? undefined,
        action,
        entityType,
        from,
        to,
      },
      { cursor: params.get("cursor") ?? undefined, limit: Number(params.get("limit") ?? 25) },
    );

    if ("code" in result) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "audit.list");
  }
}
