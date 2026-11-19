/** GET/POST /api/machine-faults — R5.5 ured lista i unos kvarova. */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listMachineFaults, createMachineFault, type CreateInput } from "@/server/machine-fault-service";
import { isFaultStatus } from "@/server/machine-fault-db-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fault.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    const rows = await listMachineFaults(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, {
      machineId: params.get("machineId") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      status: status && isFaultStatus(status) ? status : undefined,
    });
    return ok({ faults: rows });
  } catch (error) {
    return internal(error, "machine-faults.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.fault.create");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as CreateInput | null;
    if (!body?.machineId || !body.reportedAt || !body.title || !body.priority) {
      return fail("VALIDATION_FAILED", "machineId, reportedAt, title i priority su obavezni.");
    }
    const outcome = await createMachineFault(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    }, body);
    if (outcome.outcome === "FORBIDDEN") {
      return fail("FORBIDDEN", outcome.message ?? "Nemate pravo unosa.");
    }
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", outcome.message);
    if (outcome.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", outcome.message);
    return ok(outcome);
  } catch (error) {
    return internal(error, "machine-faults.create");
  }
}
