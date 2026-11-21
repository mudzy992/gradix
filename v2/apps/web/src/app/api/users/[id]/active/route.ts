/**
 * PATCH /api/users/:id/active — aktivacija/deaktivacija.
 * Deaktivacija gasi sve sesije te osobe i opoziva njene pozivnice i resetove.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, internal, ok, type ErrorCode } from "@/server/api";
import { setUserActive } from "@/server/access-service";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ active: z.boolean() });

const CODE_MAP: Record<string, ErrorCode> = {
  FORBIDDEN: "USERS_TARGET_PROTECTED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "users.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Polje „active“ je obavezno.");

    const { id } = await context.params;
    const result = await setUserActive(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      parsed.data.active,
      { ip: clientIp(request) },
    );

    if ("code" in result) return fail(CODE_MAP[result.code] ?? "INTERNAL", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "users.setActive");
  }
}

