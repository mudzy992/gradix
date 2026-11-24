/**
 * POST /api/auth/2fa/verify — potvrda uparivanja prvim kodom. Vraća recovery kodove JEDNOM.
 */
import type { NextRequest } from "next/server";
import { TwoFactorCodeInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { confirmEnrollment } from "@/server/two-factor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const parsed = TwoFactorCodeInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Kod ima 6 cifara.");
    const result = await confirmEnrollment(
      await getVerifiedPool(),
      { userId: auth.ctx.userId, companyId: auth.ctx.companyId, ip: clientIp(request) },
      parsed.data.code,
    );
    if ("code" in result) return fail(result.code, result.message);
    return ok({ recoveryCodes: result.recoveryCodes });
  } catch (error) {
    return internal(error, "auth.2fa.verify");
  }
}
