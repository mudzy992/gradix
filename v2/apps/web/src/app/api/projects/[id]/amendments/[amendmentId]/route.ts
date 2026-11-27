/** PATCH /api/projects/{id}/amendments/{amendmentId} — SUBMIT / APPROVE / REJECT aneksa. */
import type { NextRequest } from "next/server";
import { AmendmentDecisionInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { decideAmendment } from "@/server/project-finance-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; amendmentId: string }> };

export async function PATCH(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = AmendmentDecisionInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravna odluka o aneksu.");
    const { id, amendmentId } = await params;
    const result = await decideAmendment(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      amendmentId,
      parsed.data.action,
      parsed.data.reason ?? null,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      if (result.code === "CONFLICT") return fail("CONFLICT", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "project-amendments.decide");
  }
}
