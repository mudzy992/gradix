/** GET/POST /api/workers/{id}/advances — akontacije i pozajmice. */
import type { NextRequest } from "next/server";
import { WorkerAdvanceInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createAdvance, listAdvances } from "@/server/payroll-period-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const result = await listAdvances(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    if ("code" in result) return fail(result.code as never, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "workers.advances.list");
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "payroll.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = WorkerAdvanceInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravna akontacija.");
    const { id } = await params;
    // Putanja je izvor identiteta radnika; tijelo ne smije pokazati na drugoga.
    if (parsed.data.worker_id !== id) {
      return fail("VALIDATION_FAILED", "Radnik u tijelu mora odgovarati radniku u putanji.");
    }
    const result = await createAdvance(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        workerId: id,
        kind: parsed.data.kind,
        amount: parsed.data.amount,
        issuedOn: parsed.data.issued_on,
        installment: parsed.data.installment ?? null,
        note: parsed.data.note,
      },
    );
    if ("code" in result) return fail(result.code as never, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "workers.advances.create");
  }
}
