/**
 * POST /api/password-resets/:token — postavlja lozinku preko linka koji je izdao admin.
 * Isti ugovor kao pozivnica: token u putanji, atomski claim, gašenje svih sesija.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok, type ErrorCode } from "@/server/api";
import { ApplyPasswordResetRequest } from "@gradix/contracts";
import { setPasswordWithToken } from "@/server/access-service";
import { isValidTokenFormat } from "@/server/tokens";
import { getVerifiedPool } from "@/server/db";

export const dynamic = "force-dynamic";

const CODE_MAP: Record<string, ErrorCode> = {
  VALIDATION_FAILED: "AUTH_PASSWORD_WEAK",
  LINK_INVALID: "LINK_INVALID",
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await context.params;
    if (!isValidTokenFormat(token, "reset")) return fail("LINK_INVALID", "Link nije ispravan.");
    const parsed = ApplyPasswordResetRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Lozinka je obavezna.");

    const result = await setPasswordWithToken(await getVerifiedPool(), "reset", token, parsed.data.password, {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    });
    if ("code" in result) return fail(CODE_MAP[result.code] ?? "INTERNAL", result.message);
    return ok({ ok: true });
  } catch (error) {
    return internal(error, "passwordResets.apply");
  }
}
