/**
 * POST /api/auth/change-password — promjena vlastite lozinke.
 * Gasim sve ostale sesije; tekuća ostaje (čovjek nastavlja gdje je stao).
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok, type ErrorCode } from "@/server/api";
import { ChangePasswordRequest } from "@gradix/contracts";
import { changeOwnPassword } from "@/server/access-service";
import { getVerifiedPool } from "@/server/db";
import { authenticate } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const CODE_MAP: Record<string, ErrorCode> = {
  VALIDATION_FAILED: "AUTH_PASSWORD_WEAK",
  FORBIDDEN: "FORBIDDEN",
};

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return fail(auth.code, "Niste prijavljeni.");

    const parsed = ChangePasswordRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Sva polja su obavezna.");

    const result = await changeOwnPassword(
      await getVerifiedPool(),
      {
        userId: auth.ctx.userId,
        companyId: auth.ctx.companyId,
        sessionId: auth.ctx.sessionId,
      },
      { ...parsed.data, ip: clientIp(request) },
    );

    if ("code" in result) {
      // Pogrešna trenutna lozinka i ista nova lozinka su korisničke greške, ne sigurnosne.
      const code =
        result.code === "VALIDATION_FAILED" && result.message.includes("Trenutna")
          ? "AUTH_PASSWORD_WRONG"
          : (CODE_MAP[result.code] ?? "INTERNAL");
      return fail(code, result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "auth.changePassword");
  }
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
