/** PATCH /api/projects/:id/assignments/:assignmentId — auditan kraj ili poništavanje dodjele. */
import type { NextRequest } from "next/server";
import { AssignmentChangeInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { changeAssignment, isServiceError } from "@/server/project-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; assignmentId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.assign");
    if (!guardResult.ok) return guardResult.response;

    const parsed = AssignmentChangeInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Izaberite kraj dodjele ili poništavanje uz razlog od najmanje 10 znakova.");
    }

    const { id, assignmentId } = await context.params;
    const result = await changeAssignment(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        userId: guardResult.ctx.userId,
        roles: guardResult.ctx.roles,
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      id,
      assignmentId,
      parsed.data,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ ok: true, action: result.action, scopeNotice: result.scopeNotice });
  } catch (error) {
    return internal(error, "projects.assignment.change");
  }
}
