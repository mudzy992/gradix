import type { NextRequest } from "next/server";
import { PartnerRoleInput, PartnerRolePatchInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { partnerRoles } from "@/server/partner-role-service";
import type { Role } from "@/server/permissions";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function handle(request: NextRequest, context: Context, method: "GET" | "POST" | "PATCH"): Promise<Response> {
  try {
    const auth = await guard(request, "partners.manage");
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    let change: Parameters<typeof partnerRoles>[3];
    if (method !== "GET") {
      const body: unknown = await request.json().catch(() => null);
      if (method === "POST") {
        const parsed = PartnerRoleInput.safeParse(body);
        if (!parsed.success) return fail("VALIDATION_FAILED", "Uloga nije validna.");
        change = { role: parsed.data.role, isActive: true, mustExist: false };
      } else {
        const parsed = PartnerRolePatchInput.safeParse(body);
        if (!parsed.success) return fail("VALIDATION_FAILED", "Uloga ili status nisu validni.");
        change = { ...parsed.data, mustExist: true };
      }
    }
    const outcome = await partnerRoles(await getVerifiedPool(), {
      userId: auth.ctx.userId, companyId: auth.ctx.companyId, roles: auth.ctx.roles as Role[],
    }, id, change);
    if (outcome.outcome !== "OK") return fail(outcome.outcome, outcome.message);
    return ok({ roles: outcome.roles });
  } catch (error) {
    return internal(error, "partners.roles");
  }
}
export async function GET(request: NextRequest, context: Context): Promise<Response> {
  return handle(request, context, "GET");
}
export async function POST(request: NextRequest, context: Context): Promise<Response> {
  return handle(request, context, "POST");
}
export async function PATCH(request: NextRequest, context: Context): Promise<Response> {
  return handle(request, context, "PATCH");
}
