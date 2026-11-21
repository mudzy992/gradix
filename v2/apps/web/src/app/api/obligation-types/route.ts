/**
 * GET  /api/obligation-types — tipovi su podaci po firmi (`obligations.view`).
 * POST /api/obligation-types — novi tip, bez migracije (`obligations.manage`).
 *
 * Zašto tabela, a ne enum: firma dodaje „Atest skele“ sama, a pragovi (60/30/15/7) su dio tipa —
 * ljekarski i registracija nemaju iste pragove.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { ObligationTypeInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import {
  createObligationType,
  isServiceError,
  listObligationTypes,
} from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.view");
    if (!guardResult.ok) return guardResult.response;
    return ok({ types: await listObligationTypes(await getVerifiedPool(), guardResult.ctx.companyId) });
  } catch (error) {
    return internal(error, "obligation-types.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = ObligationTypeInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const result = await createObligationType(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ type: result });
  } catch (error) {
    return internal(error, "obligation-types.create");
  }
}
