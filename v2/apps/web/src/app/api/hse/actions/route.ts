import { hseScope } from "@/server/hse-scope";
/**
 * GET/PATCH /api/hse/actions — jedna tabela korektivnih mjera za incidente i inspekcije (§1.3/15).
 *
 * `OVERDUE` se računa pri čitanju (`due_on < danas AND status='OPEN'`), nikad ne čuva: upisano
 * stanje bi u ponedjeljak lagalo o petku.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { cancelAction, completeAction } from "@/server/hse-service";
import { companyToday } from "@/server/project-service";
import { hseActionIsOverdue, type HseActionRow } from "@gradix/domain";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.view");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const params = request.nextUrl.searchParams;
    const onlyOverdue = params.get("overdue") === "1" || params.get("overdue") === "true";
    const data = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const today = await companyToday(client, ctx.companyId);
      const scopeParams: unknown[] = [ctx.companyId, params.get("incident") ?? null, params.get("inspection") ?? null];
      const scopeSql = hseScope(ctx, scopeParams, "a", "action");
      const result = await client.query<{
        id: string; description: string; due_on: string; status: string; done_at: string | null;
        incident_id: string | null; inspection_id: string | null; responsible_name: string | null;
      }>(
        `SELECT a.id, a.description, a.due_on::text, a.status, a.done_at::text,
                a.incident_id, a.inspection_id,
                btrim(w.first_name || ' ' || coalesce(w.last_name, '')) AS responsible_name
           FROM public.hse_actions a
           LEFT JOIN public.workers w ON w.company_id = a.company_id AND w.id = a.responsible_worker_id
          WHERE a.company_id = $1 AND ${scopeSql}
            AND ($2::text IS NULL OR a.incident_id = $2)
            AND ($3::text IS NULL OR a.inspection_id = $3)
          ORDER BY (a.status = 'OPEN') DESC, a.due_on ASC
          LIMIT 500`,
        scopeParams,
      );
      const actions = result.rows
        .map((row) => ({
          id: row.id,
          description: row.description,
          dueOn: row.due_on,
          status: row.status,
          doneOn: row.done_at,
          incidentId: row.incident_id,
          inspectionId: row.inspection_id,
          responsibleName: row.responsible_name,
          overdue: hseActionIsOverdue(
            { status: row.status as HseActionRow["status"], dueOn: row.due_on, doneOn: row.done_at },
            today,
          ),
        }))
        .filter((action) => !onlyOverdue || action.overdue);
      return { today, actions };
    });
    return ok(data);
  } catch (error) {
    return internal(error, "hse.actions.list");
  }
}

type ActionPatch = { id: string; kind: "DONE" | "CANCEL"; note?: string | null; reason?: string };

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.investigate");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as ActionPatch | null;
    if (!body?.id || (body.kind !== "DONE" && body.kind !== "CANCEL")) {
      return fail("VALIDATION_FAILED", "id i kind (DONE|CANCEL) su obavezni.");
    }
    const actor = {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    };
    const outcome = body.kind === "DONE"
      ? await completeAction(await getVerifiedPool(), actor, body.id, body.note ?? null)
      : await cancelAction(await getVerifiedPool(), actor, body.id, body.reason ?? "");
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "hse.actions.patch");
  }
}
