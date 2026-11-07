/**
 * POST /api/users/:id/reset-password — izdaje link za postavljanje lozinke.
 * Ne mijenja lozinku: to radi osoba sama preko linka (R1a nema email provajder).
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok, type ErrorCode } from "@/server/api";
import { issuePasswordReset } from "@/server/access-service";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";

export const dynamic = "force-dynamic";

const CODE_MAP: Record<string, ErrorCode> = {
  FORBIDDEN: "USERS_TARGET_PROTECTED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "users.manage");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await context.params;

    const result = await issuePasswordReset(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      { baseUrl: request.nextUrl.origin, ip: clientIp(request) },
    );

    if ("code" in result) return fail(CODE_MAP[result.code] ?? "INTERNAL", result.message);
    return ok({ id: result.id, link: result.link, expiresAt: result.expiresAt.toISOString() });
  } catch (error) {
    return internal(error, "users.resetPassword");
  }
}

