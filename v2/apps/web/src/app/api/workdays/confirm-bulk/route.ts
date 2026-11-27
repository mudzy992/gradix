/** POST /api/workdays/confirm-bulk — grupna potvrda šefa za projekat + datum. */
import type { NextRequest } from "next/server";
import { WorkdayBulkConfirmInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { bulkConfirm } from "@/server/workday-timer-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.confirm");
    if (!guardResult.ok) return guardResult.response;

    const parsed = WorkdayBulkConfirmInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva ili unos nije ispravan.");

    const result = await bulkConfirm(
      await getVerifiedPool(),
      guardResult.ctx,
      parsed.data,
    );
    if (!result.ok) return fail(result.code as never, result.message);
    return ok({ confirmed: result.confirmed, skipped: result.skipped });
  } catch (error) {
    return internal(error, "workdays.confirmBulk");
  }
}
