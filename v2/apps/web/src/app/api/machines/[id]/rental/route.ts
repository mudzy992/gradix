/** POST /api/machines/{id}/rental — najam: partner, stopa, osnova, period (+ komponenta RENTAL). */
import type { NextRequest } from "next/server";
import { MachineRentalInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listMachines } from "@/server/equipment-service";
import { setMachineRental } from "@/server/machine-availability-service";
import { companyId as toCompanyId } from "@gradix/db";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "equipment.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const parsed = MachineRentalInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos najma.");
    const pool = await getVerifiedPool();
    const result = await setMachineRental(
      pool,
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    // Odgovor nosi osvježenu mašinu: ekran poslije najma mora vidjeti `ownership = RENTED`.
    return ok({ machines: await listMachines(pool, toCompanyId(guardResult.ctx.companyId)) });
  } catch (error) {
    return internal(error, "machine-rental.set");
  }
}
