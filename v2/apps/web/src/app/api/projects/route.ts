/**
 * GET  /api/projects — projekti koje osoba vidi (`projects.view`).
 * POST /api/projects — novi projekat (`projects.manage`).
 *
 * Opseg se NE čita iz zahtjeva: dolazi iz sesije (`ctx.scope`, `ctx.projectIds`). Da se čitao iz
 * upita, čovjek bi sam sebi proširio vidno polje jednim parametrom.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { ProjectInput, hasControlChars } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { createProject, isServiceError, listProjects } from "@/server/project-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;

    const params = request.nextUrl.searchParams;
    // A1: kontrolni znakovi (npr. NUL) u filteru nisu nikad legitiman unos — odbijaju se
    // na granici, da ne stignu do baze (Postgres odbija NUL u string parametru).
    for (const value of params.values()) {
      if (hasControlChars(value)) {
        return fail("VALIDATION_FAILED", "Filter sadrži nedozvoljene kontrolne znakove.");
      }
    }
    const projects = await listProjects(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        userId: guardResult.ctx.userId,
        roles: guardResult.ctx.roles,
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      {
        status: params.get("status") ?? undefined,
        includeInactive: params.get("includeInactive") === "1",
        // `mine=1` je za mobilni: samo projekti na kojima je ta osoba. Opseg ostaje na snazi.
        workerUserId: params.get("mine") === "1" ? guardResult.ctx.userId : undefined,
      },
    );
    return ok({ projects });
  } catch (error) {
    return internal(error, "projects.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = ProjectInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const result = await createProject(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        userId: guardResult.ctx.userId,
        roles: guardResult.ctx.roles,
        scope: guardResult.ctx.scope,
        projectIds: guardResult.ctx.projectIds,
      },
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ project: result });
  } catch (error) {
    return internal(error, "projects.create");
  }
}
