/**
 * GET   /api/projects/:id — jedan projekat (`projects.view`).
 * PATCH /api/projects/:id — izmjena (`projects.manage`).
 *
 * Tuđi projekat u istoj firmi je 403 („nisi dodijeljen"), tuđa firma 404 — vidi `project-service`.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { ProjectInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { getProject, isServiceError, updateProject } from "@/server/project-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const result = await getProject(
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
    return ok({ project: result });
  } catch (error) {
    return internal(error, "projects.get");
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = ProjectInput.partial().safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const { id } = await context.params;
    const result = await updateProject(
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
    return ok({ project: result });
  } catch (error) {
    return internal(error, "projects.update");
  }
}
