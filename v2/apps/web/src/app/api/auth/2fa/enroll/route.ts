/**
 * POST /api/auth/2fa/enroll — prvi korak uparivanja: tajna i `otpauth://` URI.
 *
 * Tajna se vraća TAČNO OVDJE i nikad više. Ako korisnik zatvori ekran prije potvrde,
 * ponovni poziv pravi novu tajnu (stara nije vezana ni za jedan autentikator).
 */
import type { NextRequest } from "next/server";
import { withCompany } from "@gradix/db";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { beginEnrollment } from "@/server/two-factor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await guard(request);
    if (!auth.ok) return auth.response;
    const pool = await getVerifiedPool();
    const email = await withCompany(pool, auth.ctx.companyId, async (client) => {
      const row = await client.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [auth.ctx.userId]);
      return row.rows[0]?.email ?? "";
    });
    const result = await beginEnrollment(pool, {
      userId: auth.ctx.userId,
      companyId: auth.ctx.companyId,
      email,
    });
    if ("code" in result) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "auth.2fa.enroll");
  }
}
