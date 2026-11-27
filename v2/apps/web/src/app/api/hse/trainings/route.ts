import { hseScope } from "@/server/hse-scope";
/** GET/POST /api/hse/trainings — evidencija održanih obuka i toolbox razgovora (§1.4). */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createTraining, type TrainingInput } from "@/server/hse-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.training.view");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const params = request.nextUrl.searchParams;
    const trainings = await withCompany(await getVerifiedPool(), ctx.companyId, async (client) => {
      const scopeParams: unknown[] = [ctx.companyId, params.get("kind") ?? null, params.get("project") ?? null];
      const scopeSql = hseScope(ctx, scopeParams, "t", "training");
      const result = await client.query<{
        id: string; kind: string; title: string; topic: string | null; held_at: string;
        duration_minutes: number | null; location: string | null; project_name: string | null;
        attendees: string;
      }>(
        `SELECT t.id, t.kind, t.title, t.topic, t.held_at::text, t.duration_minutes, t.location,
                p.name AS project_name,
                (SELECT count(*)::text FROM public.hse_training_attendees a
                  WHERE a.company_id = t.company_id AND a.training_id = t.id) AS attendees
           FROM public.hse_trainings t
           LEFT JOIN public.projects p ON p.company_id = t.company_id AND p.id = t.project_id
          WHERE t.company_id = $1 AND ${scopeSql}
            AND ($2::text IS NULL OR t.kind = $2)
            AND ($3::text IS NULL OR t.project_id = $3)
          ORDER BY t.held_at DESC
          LIMIT 300`,
        scopeParams,
      );
      return result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        topic: row.topic,
        heldAt: row.held_at,
        durationMinutes: row.duration_minutes,
        location: row.location,
        projectName: row.project_name,
        attendees: Number(row.attendees),
      }));
    });
    return ok({ trainings });
  } catch (error) {
    return internal(error, "hse.trainings.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.training.manage");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as TrainingInput | null;
    if (!body?.kind || !body.title || !body.heldAt || !Array.isArray(body.attendees)) {
      return fail("VALIDATION_FAILED", "kind, title, heldAt i attendees su obavezni.");
    }
    const outcome = await createTraining(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
        scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
      },
      body,
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "hse.trainings.create");
  }
}
