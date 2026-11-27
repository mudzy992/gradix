/**
 * POST /api/users/:id/2fa/reset — reset 2FA (izgubljen telefon), uz OBAVEZAN razlog.
 *
 * Efekat: tajna i recovery kodovi se brišu, sve sesije tog korisnika se gase, a pri sljedećoj
 * prijavi mora ponovo upariti. Rola koja zahtijeva 2FA ne može ući bez uparivanja — zato je
 * reset siguran: ne otvara pristup, nego vraća na početak.
 */
import type { NextRequest } from "next/server";
import { TwoFactorResetInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { resetTwoFactor } from "@/server/two-factor";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const auth = await guard(request, "users.manage");
    if (!auth.ok) return auth.response;
    const parsed = TwoFactorResetInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Razlog je obavezan (najmanje 10 znakova).");
    }
    const { id } = await context.params;
    const result = await resetTwoFactor(
      await getVerifiedPool(),
      {
        userId: auth.ctx.userId,
        companyId: auth.ctx.companyId,
        actorEmail: null,
        ip: clientIp(request),
      },
      id,
      parsed.data.reason,
    );
    if ("code" in result) return fail(result.code, result.message);
    return ok({ ok: true });
  } catch (error) {
    return internal(error, "users.2fa.reset");
  }
}
