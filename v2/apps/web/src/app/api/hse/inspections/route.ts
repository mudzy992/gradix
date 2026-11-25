/**
 * GET/POST /api/hse/inspections — inspekcije i nalazi (§1.5).
 *
 * `PROHIBITION` (zabrana rada) je jedini nalaz koji zaustavlja gradilište: servis odmah šalje
 * CRITICAL obavještenje vlasniku, a ovdje se vraća i `prohibitionLiftedAt` da ekran zna traje li.
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { liftProhibition, recordInspection, type InspectionInput } from "@/server/hse-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.view");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const params = request.nextUrl.searchParams;
    const inspections = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const result = await client.query<{
        id: string; kind: string; authority_name: string | null; inspected_at: string;
        inspector_name: string | null; summary: string | null; result: string;
        prohibition_lifted_at: string | null; project_name: string | null;
        open_actions: string;
      }>(
        `SELECT i.id, i.kind, i.authority_name, i.inspected_at::text, i.inspector_name, i.summary,
                i.result, i.prohibition_lifted_at::text, p.name AS project_name,
                (SELECT count(*)::text FROM public.hse_actions a
                  WHERE a.company_id = i.company_id AND a.inspection_id = i.id AND a.status = 'OPEN') AS open_actions
           FROM public.hse_inspections i
           LEFT JOIN public.projects p ON p.company_id = i.company_id AND p.id = i.project_id
          WHERE i.company_id = $1
            AND ($2::text IS NULL OR i.result = $2)
          ORDER BY (i.result = 'PROHIBITION' AND i.prohibition_lifted_at IS NULL) DESC,
                   i.inspected_at DESC
          LIMIT 300`,
        [ctx.companyId, params.get("result") ?? null],
      );
      return result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        authorityName: row.authority_name,
        inspectedAt: row.inspected_at,
        inspectorName: row.inspector_name,
        summary: row.summary,
        result: row.result,
        prohibitionLiftedAt: row.prohibition_lifted_at,
        projectName: row.project_name,
        openActions: Number(row.open_actions),
      }));
    });
    return ok({ inspections });
  } catch (error) {
    return internal(error, "hse.inspections.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.investigate");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as InspectionInput | null;
    if (!body?.kind || !body.inspectedAt || !body.result) {
      return fail("VALIDATION_FAILED", "kind, inspectedAt i result su obavezni.");
    }
    const outcome = await recordInspection(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      body,
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "hse.inspections.create");
  }
}

/** PATCH: podizanje zabrane rada — jedini način da nalaz prestane da bude aktivan. */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.investigate");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as { id?: string; note?: string } | null;
    if (!body?.id || !body.note) {
      return fail("VALIDATION_FAILED", "id i razlog podizanja zabrane su obavezni.");
    }
    const outcome = await liftProhibition(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      body.id,
      body.note,
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "hse.inspections.lift");
  }
}
