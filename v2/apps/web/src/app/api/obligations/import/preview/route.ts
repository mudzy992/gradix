/**
 * POST /api/obligations/import/preview — pregled uvoza bez upisa (§11).
 *
 * Fajl dolazi kao `multipart/form-data` (`file`). Ništa se ne upisuje: odgovor je tabela
 * „šta će biti uvezeno, šta je greška, šta je sukob“. Uvoz bez pregleda je kockanje sa 200
 * redova ličnih dokumenata.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { MAX_BYTES } from "@/server/import-parser";
import { previewImport } from "@/server/obligation-import-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;
    if (guardResult.ctx.scope !== "COMPANY") return fail("FORBIDDEN", "Ova radnja trenutno zahtijeva opseg firme.");

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return fail("VALIDATION_FAILED", "Priložite fajl (Excel ili CSV) u polju „file“.");
    }
    if (file.size > MAX_BYTES) {
      return fail("VALIDATION_FAILED", "Fajl je veći od 5 MB.");
    }

    const result = await previewImport(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      Buffer.from(await file.arrayBuffer()),
      file.name,
    );
    if ("code" in result) {
      if (result.code === "EMPTY_FILE") return fail("OBLIGATION_IMPORT_INVALID", "Fajl je prazan.");
      return fail("OBLIGATION_IMPORT_INVALID", result.parse.message);
    }
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.import.preview");
  }
}
