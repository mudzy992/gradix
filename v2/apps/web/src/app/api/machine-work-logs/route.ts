/** GET/POST /api/machine-work-logs — R5.1 ured lista i unos sati mašine. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import {
  listMachineWorkLogs,
  createMachineWorkLog,
  type CreateInput,
} from "@/server/machine-work-log-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.work_log.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const rows = await listMachineWorkLogs(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[], scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    }, {
      machineId: params.get("machineId") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    return ok({ logs: rows });
  } catch (error) {
    return internal(error, "machine-work-logs.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.work_log.create");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as CreateInput | null;
    if (!body?.machineId || !body.startedAt || !body.endedAt || !body.mode) {
      return fail("VALIDATION_FAILED", "machineId, startedAt, endedAt i mode su obavezni.");
    }
    const result = await createMachineWorkLog(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[], scope: guardResult.ctx.scope, projectIds: guardResult.ctx.projectIds,
    }, body);
    if (result.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", result.message ?? "Nemate pravo unosa.");
    }
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "machine-work-logs.create");
  }
}
