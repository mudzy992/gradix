/** PATCH /api/payroll/components/{id} — izmjena komponente (gašenje kroz `is_active`). */
import type { NextRequest } from "next/server";
import { PayrollComponentPatch } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { isPayrollError, listComponents, saveComponent } from "@/server/payroll-period-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = PayrollComponentPatch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravna izmjena komponente.");
    const { id } = await params;
    const pool = await getVerifiedPool();
    const actor = {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    };
    // PATCH je djelimičan: postojeće vrijednosti se popunjavaju iz šifarnika, da se ne pregaze.
    const current = await listComponents(pool, actor);
    if ("code" in current) return fail(current.code as never, current.message);
    const existing = current.components.find((row) => row.id === id);
    if (!existing) return fail("NOT_FOUND", "Komponenta ne postoji.");
    const result = await saveComponent(
      pool,
      actor,
      {
        code: existing.code,
        name: parsed.data.name ?? existing.name,
        kind: parsed.data.kind ?? existing.kind,
        basis: parsed.data.basis ?? existing.basis,
        category: parsed.data.category ?? existing.category,
        is_taxable: parsed.data.is_taxable ?? existing.is_taxable,
        sort_order: parsed.data.sort_order ?? existing.sort_order,
        is_active: parsed.data.is_active ?? existing.is_active,
      },
      id,
    );
    if (isPayrollError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "payroll.components.patch");
  }
}
