/**
 * POST /api/obligations/missing/create — „Kreiraj sve nedostajuće“ (§1.2 tačka 11).
 *
 * Tijelo nosi SAMO datum provjere i (opciono) odgovornu osobu — koji entiteti i tipovi su
 * nedostajući se ne šalje iz klijenta, nego se ponovo izračuna. Klijent koji pošalje spisak
 * mogao bi upisati obaveze za tuđe radnike ili za tipove koji više nisu obavezni.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { createMissingObligations } from "@/server/obligation-requirement-service";
import type { RequirementEntityKind } from "@gradix/domain";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;
    if (guardResult.ctx.scope !== "COMPANY") return fail("FORBIDDEN", "Ova radnja trenutno zahtijeva opseg firme.");

    const body = (await request.json().catch(() => null)) as {
      reviewAt?: unknown;
      responsibleUserId?: unknown;
      entityKind?: unknown;
      typeId?: unknown;
      projectId?: unknown;
    } | null;
    if (!body) return fail("VALIDATION_FAILED", "Nedostaje tijelo zahtjeva.");

    // Datum provjere je obavezan: nove obaveze nemaju rok (`expires_at NULL`), pa bi bez njega
    // red bio „trajan i neprovjeren“ — tiho, a to je stanje koje baza odbija.
    if (typeof body.reviewAt !== "string" || !DATE_RE.test(body.reviewAt)) {
      return fail("VALIDATION_FAILED", "Datum provjere je obavezan (YYYY-MM-DD).");
    }

    const result = await createMissingObligations(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      {
        reviewAt: body.reviewAt,
        responsibleUserId: typeof body.responsibleUserId === "string" ? body.responsibleUserId : null,
        entityKind: (body.entityKind as RequirementEntityKind | undefined) ?? undefined,
        typeId: typeof body.typeId === "string" ? body.typeId : undefined,
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      },
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
    );
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.missing.create");
  }
}
