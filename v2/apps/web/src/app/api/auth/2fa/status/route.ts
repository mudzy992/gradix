/** GET /api/auth/2fa/status — stanje 2FA za ekran Postavke → Sigurnost. */
import type { NextRequest } from "next/server";
import { requires2fa } from "@gradix/domain";
import { internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { twoFactorStatus } from "@/server/two-factor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const status = await twoFactorStatus(await getVerifiedPool(), auth.ctx.companyId, auth.ctx.userId);
    return ok({
      ...status,
      required: requires2fa(auth.ctx.roles),
      // Klijent mora znati da je ovo sesija SAMO za uparivanje — inače bi izgledalo kao
      // obična prijava u kojoj „ne rade" svi ostali ekrani.
      enrollmentPending: auth.ctx.enrollmentPending,
    });
  } catch (error) {
    return internal(error, "auth.2fa.status");
  }
}
