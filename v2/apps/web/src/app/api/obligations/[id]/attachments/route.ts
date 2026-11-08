/**
 * POST /api/obligations/:id/attachments — registracija priloga i potpisan PUT na 5 min.
 *
 * Klijent šalje ime, veličinu, `sha256` i PRVIH 32 BAJTA fajla. Tip se određuje iz tih bajtova,
 * a ne iz ekstenzije: `.exe` preimenovan u `.pdf` pada već ovdje. Objekat postaje vidljiv tek
 * poslije `…/confirm` — do tada je u bazi `pending`.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { isServiceError, registerAttachment } from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const guardResult = await guard(request, "obligations.manage");
    if (!guardResult.ok) return guardResult.response;

    const body = (await request.json().catch(() => null)) as
      | { fileName?: string; sizeBytes?: number; sha256?: string; headBase64?: string }
      | null;
    if (!body || typeof body.fileName !== "string" || typeof body.sha256 !== "string") {
      return fail("VALIDATION_FAILED", "Nedostaje ime, veličina ili kontrolni zbir priloga.");
    }

    const head = Buffer.from(String(body.headBase64 ?? ""), "base64");
    const { id } = await context.params;
    const result = await registerAttachment(
      await getVerifiedPool(),
      guardResult.ctx.companyId,
      { userId: guardResult.ctx.userId, roles: guardResult.ctx.roles },
      id,
      {
        fileName: body.fileName,
        sizeBytes: Number(body.sizeBytes ?? 0),
        sha256: body.sha256,
        head,
      },
    );
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.attachments.register");
  }
}
