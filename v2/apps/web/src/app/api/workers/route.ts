/**
 * GET  /api/workers — lista radnika firme (`workers.view`).
 * POST /api/workers — novi radnik (`workers.manage`). **Ne pravi nalog**: radnik bez naloga je
 * uobičajen slučaj, a nalog se pravi pozivnicom (`/api/users/invitations`) i veže posebno.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { WorkerInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { createWorker, isServiceError, listWorkers } from "@/server/equipment-service";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.view");
    if (!guardResult.ok) return guardResult.response;
    const workers = await listWorkers(await getVerifiedPool(), guardResult.ctx.companyId);
    return ok({ workers });
  } catch (error) {
    return internal(error, "workers.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const result = await createWorker(await getVerifiedPool(), guardResult.ctx.companyId, {
      userId: guardResult.ctx.userId,
      roles: guardResult.ctx.roles,
    }, input);

    if (isServiceError(result)) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "CONFLICT" ? 409 : 400;
      return Response.json({ success: false, error: result }, { status });
    }
    return ok({ worker: result });
  } catch (error) {
    return internal(error, "workers.create");
  }
}
