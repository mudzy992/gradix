/**
 * GET  /api/projects/:id/assignments — tim i mašine na projektu (`projects.view`).
 * POST /api/projects/:id/assignments — dodjela (`projects.assign`).
 *
 * `projects.assign` je NAMJERNO odvojeno od `users.manage` (odluka vlasnika): dodjela projekta i
 * promjena role su dvije radnje koje se daju odvojeno.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import {
  createAssignment,
  isServiceError,
  listAssignments,
  type AssignmentInput,
} from "@/server/project-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const result = await listAssignments(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        userId: guardResult.ctx.userId,
        roles: guardResult.ctx.roles,
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      id,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ assignments: result.assignments, today: result.today });
  } catch (error) {
    return internal(error, "projects.assignments");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.assign");
    if (!guardResult.ok) return guardResult.response;

    const input = (await request.json().catch(() => null)) as AssignmentInput | null;
    if (!input) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    const { id } = await context.params;
    const result = await createAssignment(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        userId: guardResult.ctx.userId,
        roles: guardResult.ctx.roles,
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      id,
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ assignment: result });
  } catch (error) {
    return internal(error, "projects.assign");
  }
}
