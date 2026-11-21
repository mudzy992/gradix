/**
 * POST /api/users/invitations — izdaje pozivnicu i vraća link TAČNO JEDNOM.
 *
 * Token se ne loguje i ne upisuje u audit (docs/PLAN-R1.md). Ako klijent izgubi odgovor,
 * jedini put je nova pozivnica — prethodna se opoziva u istoj transakciji.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok, type ErrorCode } from "@/server/api";
import { InviteRequest } from "@gradix/contracts";
import { issueInvitation, type Role, type Scope } from "@/server/access-service";
import { getVerifiedPool } from "@/server/db";
import { clientIp, guard } from "@/server/guard";

export const dynamic = "force-dynamic";

const CODE_MAP: Record<string, ErrorCode> = {
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
};

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "users.manage");
    if (!guardResult.ok) return guardResult.response;

    const parsed = InviteRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Provjerite email i rolu.");

    const result = await issueInvitation(await getVerifiedPool(), guardResult.ctx.companyId, {
      userId: guardResult.ctx.userId,
      roles: guardResult.ctx.roles,
    }, {
      email: parsed.data.email,
      roles: parsed.data.roles as Role[],
      scope: parsed.data.scope as Scope,
      baseUrl: request.nextUrl.origin,
      ip: clientIp(request),
    });

    if ("code" in result) return fail(CODE_MAP[result.code] ?? "INTERNAL", result.message);
    return ok({
      id: result.id,
      email: result.email,
      // Jedini put da token postoji van baze.
      link: result.link,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    return internal(error, "users.invitations.create");
  }
}

