/**
 * GET  /api/projects/:id/override-requests — otvoreni zahtjevi za iznimku (`projects.view`).
 * POST /api/projects/:id/override-requests — PM TRAŽI iznimku (`projects.assign`).
 *
 * Zašto zahtjev, a ne odmah iznimka: iznimku odobrava `projects.override` (vlasnik/admin). PM
 * raspoređuje ljude, ali ne odlučuje da čovjek radi sa isteklom dokumentacijom.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { OverrideRequestInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import {
  isServiceError,
  listOverrideRequests,
  requestOverride,
} from "@/server/project-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const requests = await listOverrideRequests(
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
    return ok({ requests });
  } catch (error) {
    return internal(error, "projects.override_requests");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.assign");
    if (!guardResult.ok) return guardResult.response;

    const parsed = OverrideRequestInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const { id } = await context.params;
    const result = await requestOverride(
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
    return ok({ request: result });
  } catch (error) {
    return internal(error, "projects.override_request");
  }
}
