/** DELETE /api/projects/:id/assignments/:assignmentId — skidanje dodjele (`projects.assign`). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { isServiceError, removeAssignment } from "@/server/project-service";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; assignmentId: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.assign");
    if (!guardResult.ok) return guardResult.response;

    const { id, assignmentId } = await context.params;
    const result = await removeAssignment(
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
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    // `scopeNotice` ide u odgovor jer UI MORA reći da je osoba ostala bez vidnog polja.
    return ok({ ok: true, scopeNotice: result.scopeNotice });
  } catch (error) {
    return internal(error, "projects.assignment.remove");
  }
}
