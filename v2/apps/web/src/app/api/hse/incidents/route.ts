/** GET/POST /api/hse/incidents — F9 lista i prijava incidenta (§1.3). */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import type { Role } from "@/server/permissions";
import { listIncidents, reportIncident, type IncidentInput } from "@/server/hse-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "hse.view");
    if (!guardResult.ok) return guardResult.response;
    const params = request.nextUrl.searchParams;
    const incidents = await listIncidents(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      {
        status: params.get("status") ?? undefined,
        kind: params.get("kind") ?? undefined,
        projectId: params.get("project") ?? params.get("projectId") ?? undefined,
      },
    );
    return ok({ incidents });
  } catch (error) {
    return internal(error, "hse.incidents.list");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    /* `hse.report` ima svaka rola: prijava opasnosti nije privilegija (§1.3/13). */
    const guardResult = await guard(request, "hse.report");
    if (!guardResult.ok) return guardResult.response;
    const body = (await request.json().catch(() => null)) as IncidentInput | null;
    if (!body?.kind || !body.severity || !body.occurredAt || !body.description) {
      return fail("VALIDATION_FAILED", "kind, severity, occurredAt i description su obavezni.");
    }
    const outcome = await reportIncident(
      await getVerifiedPool(),
      {
        userId: guardResult.ctx.userId,
        companyId: guardResult.ctx.companyId,
        roles: guardResult.ctx.roles as Role[],
      },
      body,
    );
    if (outcome.outcome === "NOT_FOUND") return fail("NOT_FOUND", outcome.message);
    if (outcome.outcome === "CONFLICT") return fail("CONFLICT", `${outcome.code}: ${outcome.message}`);
    if (outcome.outcome === "VALIDATION_FAILED") return fail(outcome.code === "VALIDATION_FAILED" ? "VALIDATION_FAILED" : "VALIDATION_FAILED", outcome.message);
    if (outcome.outcome === "FORBIDDEN") return fail("FORBIDDEN", outcome.message ?? "Nemate pravo.");
    return ok(outcome);
  } catch (error) {
    return internal(error, "hse.incidents.create");
  }
}
