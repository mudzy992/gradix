/**
 * PUT /api/projects/{id}/progress — ručni % po fazi.
 *
 * `PUT`, a ne `PATCH`: tijelo je POTPUNO stanje napretka (sve faze koje se mijenjaju odjednom),
 * pa djelimična izmjena ne bi bila tačan opis radnje. Kod `progress_source='BOQ'` ruta odbija
 * unos — napredak tada dolazi iz količina.
 */
import type { NextRequest } from "next/server";
import { PhaseProgressInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { setPhaseProgress } from "@/server/project-phase-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = PhaseProgressInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos napretka.");
    const { id } = await params;
    const result = await setPhaseProgress(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data.phases,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "project-progress.put");
  }
}
