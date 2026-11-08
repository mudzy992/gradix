/**
 * POST /api/imports/preview — uvezeni fajl → pregled redova. **Ne piše ništa u bazu.**
 *
 * Zašto multipart ovdje, a JSON za potvrdu: pregled nosi sam fajl (5 MB), a potvrda nosi samo
 * odluke po redu. Ako bi i potvrda nosila fajl, korisnik bi mogao promijeniti sadržaj između
 * pregleda i potvrde — ovako se pregled i potvrda odnose na isti sadržaj u istom zahtjevu.
 *
 * Zato potvrda prima `rows` **koje je vratio pregled** i ponovo ih validira; vrijednosti se ne
 * primaju od klijenta.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { isServiceError } from "@/server/equipment-service";
import { guard } from "@/server/guard";
import { previewImport, suggestMapping, type ImportKind } from "@/server/import-service";
import { parseWorkbook } from "@/server/import-parser";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "workers.manage");
    if (!guardResult.ok) return guardResult.response;

    const form = await request.formData().catch(() => null);
    if (!form) return fail("VALIDATION_FAILED", "Pošaljite datoteku kao multipart/form-data.");

    const kind = String(form.get("kind") ?? "") as ImportKind;
    if (kind !== "workers" && kind !== "equipment") {
      return fail("VALIDATION_FAILED", "Vrsta uvoza je „workers“ ili „equipment“.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) return fail("VALIDATION_FAILED", "Datoteka nedostaje.");

    const bytes = Buffer.from(await file.arrayBuffer());
    const parsed = await parseWorkbook(bytes, file.name);
    if ("code" in parsed) return fail("VALIDATION_FAILED", parsed.message);

    // Mapiranje: poslano (korisnik mijenjao) ili predloženo po zaglavlju.
    const mappingRaw = form.get("mapping");
    let mapping = suggestMapping(kind, parsed.headers);
    if (typeof mappingRaw === "string" && mappingRaw.trim() !== "") {
      try {
        const sent = JSON.parse(mappingRaw) as Record<string, string | null>;
        mapping = { ...mapping, ...sent };
      } catch {
        return fail("VALIDATION_FAILED", "Mapiranje kolona nije ispravan JSON.");
      }
    }

    const result = await previewImport(await getVerifiedPool(), guardResult.ctx.companyId, kind, parsed, mapping);
    if (isServiceError(result)) return fail(result.code, result.message);

    return ok({ ...result, headers: parsed.headers, fileName: file.name });
  } catch (error) {
    return internal(error, "imports.preview");
  }
}
