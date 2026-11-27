/**
 * POST /api/auth/2fa/disable — isključivanje. Dozvoljeno SAMO rolama kojima 2FA nije obavezna.
 *
 * Traži i lozinku i tekući kod: isključivanje 2FA je najosjetljivija radnja u ovom modulu —
 * ako je neko ukrao sesiju, ne smije moći sam sebi skloniti drugi faktor.
 */
import type { NextRequest } from "next/server";
import { TwoFactorDisableInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";
import { verifyPassword } from "@/server/password";
import { disableTwoFactor } from "@/server/two-factor";
import { withCompany } from "@gradix/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const parsed = TwoFactorDisableInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Lozinka i kod su obavezni.");

    const pool = await getVerifiedPool();
    const hash = await withCompany(pool, auth.ctx.companyId, async (client) => {
      const row = await client.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [
        auth.ctx.userId,
      ]);
      return row.rows[0]?.password_hash ?? null;
    });
    const passwordOk = hash ? await verifyPassword(hash, parsed.data.password) : false;

    const result = await disableTwoFactor(
      pool,
      { userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles, ip: clientIp(request) },
      { passwordOk, code: parsed.data.code },
    );
    if ("code" in result) return fail(result.code, result.message);
    return ok({ ok: true });
  } catch (error) {
    return internal(error, "auth.2fa.disable");
  }
}
