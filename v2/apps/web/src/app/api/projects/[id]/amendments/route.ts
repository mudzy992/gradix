/**
 * GET  /api/projects/{id}/amendments — aneksi; zbir samo ODOBRENIH.
 * POST /api/projects/{id}/amendments — novi aneks (DRAFT) ili izmjena nacrta.
 */
import type { NextRequest } from "next/server";
import { ProjectAmendmentInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { isServiceError, listAmendments, saveAmendment } from "@/server/project-finance-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const result = await listAmendments(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    if ("code" in result) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "project-amendments.list");
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProjectAmendmentInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos aneksa.");
    const { id } = await params;
    const result = await saveAmendment(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data,
    );
    if (isServiceError(result)) {
      if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
      if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
      if (result.code === "CONFLICT") return fail("CONFLICT", result.message);
      return fail("VALIDATION_FAILED", result.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "project-amendments.save");
  }
}
