/**
 * GET  /api/equipment-categories — kategorije su podaci po firmi (`equipment.view`).
 * POST /api/equipment-categories — nova kategorija (`equipment.manage`).
 *
 * Zašto tabela, a ne `enum`: firma dodaje „Tegljač“ bez migracije, a uvoz mapira tekst na
 * postojeće kategorije umjesto da ih stvara tiho (vidi docs/PLAN-R2.md §1.2).
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { CategoryInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { createCategory, isServiceError, listCategories } from "@/server/equipment-service";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.view");
    if (!guardResult.ok) return guardResult.response;
    return ok({ categories: await listCategories(await getVerifiedPool(), guardResult.ctx.companyId) });
  } catch (error) {
    return internal(error, "equipment.categories.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = CategoryInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const result = await createCategory(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ category: result });
  } catch (error) {
    return internal(error, "equipment.categories.create");
  }
}
