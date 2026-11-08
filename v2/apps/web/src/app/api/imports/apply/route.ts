/**
 * POST /api/imports/apply — potvrda uvoza u JEDNOJ transakciji.
 *
 * Tijelo nosi fajl (isti kao u pregledu) i odluke po redu. Server ponovo parsira i ponovo
 * validira: klijent ne može podmetnuti vrijednosti koje pregled nije vidio, a ni promijeniti
 * sadržaj između dva koraka.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { isServiceError } from "@/server/equipment-service";
import { guard } from "@/server/guard";
import { applyImport, type ApplyDecision, type ImportKind } from "@/server/import-service";
import { parseWorkbook } from "@/server/import-parser";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.manage");
    if (!guardResult.ok) return guardResult.response;

    const form = await request.formData().catch(() => null);
    if (!form) return fail("VALIDATION_FAILED", "Pošaljite datoteku i odluke kao multipart/form-data.");

    const kind = String(form.get("kind") ?? "") as ImportKind;
    if (kind !== "workers" && kind !== "equipment") {
      return fail("VALIDATION_FAILED", "Vrsta uvoza je „workers“ ili „equipment“.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) return fail("VALIDATION_FAILED", "Datoteka nedostaje.");

    let decisions: ApplyDecision[];
    try {
      decisions = JSON.parse(String(form.get("decisions") ?? "[]")) as ApplyDecision[];
    } catch {
      return fail("VALIDATION_FAILED", "Odluke po redu nisu ispravan JSON.");
    }
    if (!Array.isArray(decisions) || decisions.length === 0) {
      return fail("VALIDATION_FAILED", "Nema odluka — ništa nije izabrano za uvoz.");
    }

    let mapping: Record<string, string | null> = {};
    try {
      mapping = JSON.parse(String(form.get("mapping") ?? "{}")) as Record<string, string | null>;
    } catch {
      return fail("VALIDATION_FAILED", "Mapiranje kolona nije ispravan JSON.");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const parsed = await parseWorkbook(bytes, file.name);
    if ("code" in parsed) return fail("VALIDATION_FAILED", parsed.message);

    const applied = await applyImport(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      kind,
      parsed,
      mapping,
      decisions,
      file.name,
    );

    if (isServiceError(applied)) return fail(applied.code, applied.message);

    // Greška u sredini uvoza ruši cijelu transakciju, ali rezultat NOSI koje je redove stigao
    // obraditi — bez toga korisnik vidi „puklo je“ i ne zna na kom redu. Status je 409 jer
    // uvoz nije prošao, a `data` nosi izvještaj.
    if (applied.failed > 0) {
      return Response.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: `Uvoz je prekinut na redu ${applied.errors[0]?.rowNumber ?? "?"}: ${applied.errors[0]?.message ?? ""} Ništa nije uvezeno.`,
          },
          data: applied,
        },
        { status: 409 },
      );
    }

    return ok(applied);
  } catch (error) {
    return internal(error, "imports.apply");
  }
}
