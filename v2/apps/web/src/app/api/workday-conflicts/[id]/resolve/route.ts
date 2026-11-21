/**
 * POST /api/workday-conflicts/{id}/resolve — razrješenje u jednoj transakciji.
 * Ishod VALIDATION_FAILED/FORBIDDEN se vraća kao podatak (ekran ga prikaže bez
 * rušenja), a ALREADY_RESOLVED nosi ko/kada/šta od prvog razrješenja.
 */
import type { NextRequest } from "next/server";
import { ResolveConflictInput } from "@gradix/contracts";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { resolveWorkdayConflict, type ResolveConflictInput as ServiceInput } from "@/server/workday-resolve";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request, "workdays.resolve");
    if (!guardResult.ok) return guardResult.response;
    const ctx = guardResult.ctx;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = ResolveConflictInput.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_FAILED", "Razlog je obavezan (najmanje 10 znakova) i odluka mora biti potpuna.");
    }
    const input: ServiceInput = {
      conflictId: id,
      kind: parsed.data.kind,
      reason: parsed.data.reason,
      internalNote: parsed.data.internalNote ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
      correctedTimes: parsed.data.correctedTimes,
      correctedTarget: parsed.data.correctedTarget,
    };
    const result = await resolveWorkdayConflict(await getVerifiedPool(), {
      userId: ctx.userId,
      companyId: ctx.companyId,
      roles: ctx.roles,
      email: null,
    }, input);
    if (result.outcome === "NOT_FOUND") return fail("NOT_FOUND", "Sukob nije pronađen ili nije u vašem opsegu.");
    return ok(result);
  } catch (error) {
    return internal(error, "workday-conflicts.resolve");
  }
}
