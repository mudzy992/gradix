/**
 * GET /api/attachments/:id/url — potpisan link za preuzimanje, 60 s.
 *
 * Dozvola je dozvola modula (npr. `obligations.attachments.view` za nalaz, `machines.check.view`
 * za foto pregleda). Nema trajnih javnih linkova ni listinga; RLS pušta samo svoju firmu.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { ATTACHMENT_ACCESS, attachmentTarget } from "@/server/attachment-access";
import { attachmentDownloadUrl, isAttachmentServiceError } from "@/server/attachment-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const guardResult = await guard(request);
    if (!guardResult.ok) return guardResult.response;

    const { id } = await context.params;
    const pool = await getVerifiedPool();
    const target = await attachmentTarget(pool, guardResult.ctx.companyId, id);
    // Report files require requester, scope and current-permission checks, not this generic path.
    if (!target || target.entityType === "REPORT_JOB") return fail("NOT_FOUND", "Prilog nije pronađen.");
    // Fail closed until generic attachment mutations enforce scope inside their transaction.
    if (target.entityType === "OBLIGATION" && guardResult.ctx.scope !== "COMPANY") return fail("NOT_FOUND", "Prilog nije pronađen.");

    if (!can(guardResult.ctx.roles, ATTACHMENT_ACCESS[target.entityType].read)) {
      return fail("FORBIDDEN", "Nemate pravo za ovu radnju.");
    }

    const result = await attachmentDownloadUrl(pool, guardResult.ctx.companyId, id);
    if (isAttachmentServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "attachments.url");
  }
}
