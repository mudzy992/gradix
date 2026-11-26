/** GET/POST /api/machine-daily-checks — R5.4 ured lista i unos dnevnih pregleda. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listDailyChecks, createDailyCheck, type CreateInput } from "@/server/daily-check-service";
import type { DailyCheckResult } from "@/server/daily-check-types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const result = params.get("result");
    const rows = await listDailyChecks(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, {
      machineId: params.get("machineId") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      result: result === "PASS" || result === "FAIL" || result === "CONDITIONAL"
        ? (result as DailyCheckResult)
        : undefined,
    });
    return ok({ checks: rows });
  } catch (error) {
    return internal(error, "machine-daily-checks.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.check.create");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as CreateInput | null;
    if (!body?.machineId || !body.checkedAt || !body.result) {
      return fail("VALIDATION_FAILED", "machineId, checkedAt i result su obavezni.");
    }
    const outcome = await createDailyCheck(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
      scope: guardResult.ctx.scope,
      projectIds: guardResult.ctx.projectIds,
    }, body);
    if (outcome.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", outcome.message ?? "Nemate pravo unosa.");
    }
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "machine-daily-checks.create");
  }
}
