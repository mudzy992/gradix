/**
 * GET  /api/equipment — mašine i vozila iz JEDNE tabele (`equipment.view`).
 * POST /api/equipment — nova mašina ili vozilo (`equipment.manage`).
 *
 * Vozilo se razlikuje samo po kategoriji i vrsti brojila (sati ili kilometri). Registracija i
 * tehnički pregled nisu kolone — to su obaveze iz R2b.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { MachineInput } from "@gradix/contracts";
import { getVerifiedPool } from "@/server/db";
import { createMachine, isServiceError, listMachines } from "@/server/equipment-service";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.view");
    if (!guardResult.ok) return guardResult.response;
    return ok({ machines: await listMachines(await getVerifiedPool(), guardResult.ctx.companyId) });
  } catch (error) {
    return internal(error, "equipment.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = MachineInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");
    const input = parsed.data;
    const result = await createMachine(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      input,
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok({ machine: result });
  } catch (error) {
    return internal(error, "equipment.create");
  }
}
