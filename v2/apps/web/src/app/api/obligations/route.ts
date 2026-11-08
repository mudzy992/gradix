/**
 * GET  /api/obligations — rokova lista (`obligations.view`).
 * POST /api/obligations — nova obaveza (`obligations.manage`).
 *
 * Filteri su dio upita jer ih ekran koristi: stanje, vrsta entiteta, tip i entitet. Stanje se
 * NE čuva u bazi — računa se po poslovnom datumu firme, pa ga vraća servis uz svaki red.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import {
  createObligation,
  isServiceError,
  listObligations,
  type ObligationInput,
} from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.view");
    if (!guardResult.ok) return guardResult.response;

    const params = request.nextUrl.searchParams;
    const result = await listObligations(await getVerifiedPool(), guardResult.ctx.companyId, {
      state: params.get("state") ?? undefined,
      entityKind: params.get("entityKind") ?? undefined,
      typeId: params.get("typeId") ?? undefined,
      workerId: params.get("workerId") ?? undefined,
      machineId: params.get("machineId") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      responsibleUserId: params.get("responsibleUserId") ?? undefined,
      ofLinkedWorkerUserId: params.get("mine") === "1" ? guardResult.ctx.userId : undefined,
      includeSuperseded: params.get("includeSuperseded") === "1",
    });
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const input = (await request.json().catch(() => null)) as ObligationInput | null;
    if (!input) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    const result = await createObligation(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.create");
  }
}
