/**
 * POST /api/projects/{id}/reopen — ponovno otvaranje uz razlog ≥10 znakova.
 *
 * Snapshot zatvaranja OSTAJE: ponovno otvaranje ne briše dokaz da je projekat bio zatvoren, a
 * audit nosi razlog (spec 06 §1.8.32).
 */
import type { NextRequest } from "next/server";
import { ProjectReopenInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { reopenProject } from "@/server/project-finance-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProjectReopenInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Razlog ponovnog otvaranja mora imati najmanje 10 znakova.");
    }
    const { id } = await params;
    const result = await reopenProject(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data.reason,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      if (result.code === "CONFLICT") return fail("CONFLICT", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok({ project_id: id, ...result });
  } catch (error) {
    return internal(error, "project-reopen.post");
  }
}
