/**
 * PATCH /api/users/:id/membership — dodjela rola i opsega.
 *
 * Pravila su u servisu (`changeMembership`), ne ovdje: ruta prevodi kodove i piše audit u
 * istoj transakciji kao izmjenu.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, internal, ok, type ErrorCode } from "@/server/api";
import { changeMembership } from "@/server/rbac-service";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  roles: z.array(z.string()).min(1).max(5),
  scope: z.enum(["COMPANY", "SELF"]),
});

const CODE_MAP: Record<string, ErrorCode> = {
  FORBIDDEN: "USERS_TARGET_PROTECTED",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  CONFLICT: "CONFLICT",
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "users.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Provjerite role i opseg.");

    const { id } = await context.params;
    const result = await changeMembership(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      { roles: parsed.data.roles, scope: parsed.data.scope, ip: clientIp(request) },
    );

    if ("code" in result) return fail(CODE_MAP[result.code] ?? "INTERNAL", result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "users.membership");
  }
}
