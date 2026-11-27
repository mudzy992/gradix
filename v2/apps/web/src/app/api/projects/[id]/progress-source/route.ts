/**
 * PUT /api/projects/{id}/progress-source — `MANUAL` ili `BOQ`, nikad oba (§1.4.19).
 *
 * `PUT` jer je izvor napretka JEDNA vrijednost koja u potpunosti zamjenjuje prethodnu — nema
 * djelimične izmjene.
 */
import type { NextRequest } from "next/server";
import { ProgressSourceInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { setProgressSource } from "@/server/project-finance-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProgressSourceInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan izvor napretka.");
    const { id } = await params;
    const result = await setProgressSource(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data.progressSource,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "project-progress-source.put");
  }
}
