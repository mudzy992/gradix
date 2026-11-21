/**
 * GET …/url — potpisan link za preuzimanje, 60 s. Nema trajnih javnih linkova ni listinga.
 * Traži `obligations.attachments.view` (radnik je nema): nalaz je lični podatak.
 * Prilog mora biti iz ISTE firme; provjeru radi servis (RLS + `obligation_id` u upitu).
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { attachmentDownloadUrl, isServiceError } from "@/server/obligation-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  try {
    /*
     * POSEBNA dozvola, ne `obligations.view`: link vodi u medicinski nalaz ili sken dokumenta.
     * Radnik ima pravo znati da mu rok istječe, ali ne i otvoriti tuđi/lični dokument sa telefona
     * (odluka vlasnika u G3).
     */
    const guardResult = await guard(request, "obligations.attachments.view");
    if (!guardResult.ok) return guardResult.response;

    const { id, attachmentId } = await context.params;
    const result = await attachmentDownloadUrl(await getVerifiedPool(), guardResult.ctx.companyId, id, attachmentId);
    if (isServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "obligations.attachments.url");
  }
}
