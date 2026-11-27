/**
 * POST /api/obligations/import/apply — upis uvoza (§11).
 *
 * Fajl se šalje PONOVO, a ne id pregleda: pregled ne čuva stanje (nema fajl-servisa ni reda u
 * bazi), a i da čuva, između pregleda i primjene podaci se mijenjaju. Servis zato sam ponovo
 * parsira i provjeri — uvoz nikad ne vjeruje klijentu koji tvrdi „pregled je bio čist“.
 *
 * `replaceExisting=1` znači: gdje postoji aktivna obaveza istog tipa, označi je zamijenjenom i
 * upiši novu. Bez toga se takvi redovi preskaču i prijavljuju.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { MAX_BYTES } from "@/server/import-parser";
import { applyImport } from "@/server/obligation-import-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return fail("VALIDATION_FAILED", "Priložite fajl (Excel ili CSV) u polju „file“.");
    }
    if (file.size > MAX_BYTES) {
      return fail("VALIDATION_FAILED", "Fajl je veći od 5 MB.");
    }

    const result = await applyImport(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      Buffer.from(await file.arrayBuffer()),
      file.name,
      {
        // Form polja su uvijek stringovi: `"1"` je jedina istinita vrijednost.
        replaceExisting: form?.get("replaceExisting") === "1",
      },
      guardResult.ctx,
    );
    if ("code" in result) {
      if (result.code === "EMPTY_FILE") return fail("OBLIGATION_IMPORT_INVALID", "Fajl je prazan.");
      return fail("OBLIGATION_IMPORT_INVALID", result.parse.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.import.apply");
  }
}
