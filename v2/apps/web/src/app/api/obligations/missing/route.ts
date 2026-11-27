/**
 * GET /api/obligations/missing — šta NEDOSTAJE (§1.1 tačka 2, §9).
 *
 * `missing` se računa, ne čita: to je odsustvo reda, a ne stanje reda. Zato ova ruta nema
 * pandan u `obligations` listi — vraća redove koje tek treba napraviti.
 *
 * Vidno polje: `SELF` (radnik) ovdje NEMA smisla — nedostajuće obaveze su posao ureda, pa je
 * ruta vezana na `obligations.manage`. Radnik svoj nedostatak vidi kroz obaveze i blokade.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { listMissing } from "@/server/obligation-requirement-service";
import type { RequirementEntityKind } from "@gradix/domain";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;
    if (guardResult.ctx.scope !== "COMPANY") return fail("FORBIDDEN", "Ova radnja trenutno zahtijeva opseg firme.");

    const params = request.nextUrl.searchParams;
    const result = await listMissing(await getVerifiedPool(), guardResult.ctx.companyId, {
      entityKind: (params.get("entityKind") as RequirementEntityKind | null) ?? undefined,
      typeId: params.get("typeId") ?? undefined,
      entityId: params.get("entityId") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
    });
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.missing");
  }
}
