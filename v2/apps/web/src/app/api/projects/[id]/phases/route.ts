/**
 * GET   /api/projects/{id}/phases — faze i ukupni napredak.
 * POST  /api/projects/{id}/phases — nova faza (težina obavezna).
 * PATCH /api/projects/{id}/phases — izmjena faze.
 *
 * Zavisnost koja još nije završena vraća `dependency_warnings` uz USPJEŠAN odgovor: upozorenje,
 * nikad blokada (spec 06 §1.1.4).
 */
import type { NextRequest } from "next/server";
import { ProjectPhaseInput, ProjectPhasePatch } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { createPhase, listPhases, updatePhase } from "@/server/project-phase-service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function errorResponse(result: { code: string; message: string }): Response {
  if (result.code === "FORBIDDEN") return fail("FORBIDDEN", result.message);
  if (result.code === "NOT_FOUND") return fail("NOT_FOUND", result.message);
  if (result.code === "CONFLICT") return fail("CONFLICT", result.message);
  if (result.code === "PHASE_WEIGHT_REQUIRED") return fail("PHASE_WEIGHT_REQUIRED", result.message);
  return fail("VALIDATION_FAILED", result.message);
}

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.view");
    if (!guardResult.ok) return guardResult.response;
    const { id } = await params;
    const result = await listPhases(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
    );
    if ("code" in result) return errorResponse(result);
    return ok(result);
  } catch (error) {
    return internal(error, "project-phases.list");
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProjectPhaseInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravan unos faze.");
    const { id } = await params;
    const result = await createPhase(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data,
    );
    if ("code" in result) return errorResponse(result);
    return ok(result);
  } catch (error) {
    return internal(error, "project-phases.create");
  }
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<Response> {
  try {
    const guardResult = await guard(request, "projects.manage");
    if (!guardResult.ok) return guardResult.response;
    const parsed = ProjectPhasePatch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("VALIDATION_FAILED", "Neispravna izmjena faze.");
    const { id } = await params;
    const result = await updatePhase(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      id,
      parsed.data,
    );
    if ("code" in result) return errorResponse(result);
    return ok(result);
  } catch (error) {
    return internal(error, "project-phases.update");
  }
}
