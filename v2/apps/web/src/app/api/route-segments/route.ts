/** GET/POST/PATCH /api/route-segments — šifarnik dionica sa stacionažom. */
import type { NextRequest } from "next/server";
import { RouteSegmentInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createSegment, listSegments, updateSegment } from "@/server/route-segment-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.haul.view");
    if (!guardResult.ok) return guardResult.response;
    const segments = await listSegments(await getVerifiedPool(), {
      userId: guardResult.ctx.userId,
      companyId: guardResult.ctx.companyId,
      roles: guardResult.ctx.roles as Role[],
    });
    return ok({ segments });
  } catch (error) {
    return internal(error, "route-segments.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.haul.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = RouteSegmentInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos dionice.");
    const result = await createSegment(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result.data);
  } catch (error) {
    return internal(error, "route-segments.create");
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "machines.haul.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = RouteSegmentInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos dionice.");
    const result = await updateSegment(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      parsed.data,
    );
    if (result.outcome === "FORBIDDEN") return fail("FORBIDDEN", result.message ?? "Nemate pravo.");
    if (result.outcome === "CONFLICT") return fail("CONFLICT", result.message);
    if (result.outcome === "VALIDATION_FAILED") return fail("VALIDATION_FAILED", result.message);
    return ok(result.data);
  } catch (error) {
    return internal(error, "route-segments.update");
  }
}
