/**
 * GET/PATCH /api/workers/:id/profile — kartica radnika.
 *
 * Osjetljiva polja se traže dozvolom `workers.sensitive.view`, a NE dozvolom rute: ruta traži
 * `workers.view`, pa bi inače šef gradilišta dobio lične podatke samo zato što smije otvoriti
 * karticu.
 */
import type { NextRequest } from "next/server";
import { WorkerProfilePatch } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { getWorkerProfile, patchWorkerProfile } from "@/server/worker-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.view");
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const result = await getWorkerProfile(
      await getVerifiedPool(),
      guardResult.ctx,
      id,
      { canSeeSensitive: can(guardResult.ctx.roles, "workers.sensitive.view") },
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ worker: result.worker });
  } catch (error) {
    return internal(error, "workers.profile.get");
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkerProfilePatch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const { id } = await context.params;
    const result = await patchWorkerProfile(
      await getVerifiedPool(),
      guardResult.ctx,
      id,
      parsed.data as Record<string, unknown>,
      { canEditSensitive: can(guardResult.ctx.roles, "workers.sensitive.view") },
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ worker: result.worker });
  } catch (error) {
    return internal(error, "workers.profile.patch");
  }
}
