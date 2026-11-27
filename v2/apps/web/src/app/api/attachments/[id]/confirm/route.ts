/**
 * POST /api/attachments/:id/confirm — potvrda uploada (`pending` → `ready`).
 *
 * Dozvola se NE čita iz tijela: servis nađe entitet iz reda priloga, pa provjeri dozvolu za
 * TAJ modul. Tako klijent ne može izabrati blažu dozvolu za tuđi prilog.
 */
import type { NextRequest } from "next/server";
import { fail, internal, ok } from "@/server/api";
import { getVerifiedPool } from "@/server/db";
import { guard } from "@/server/guard";
import { can } from "@/server/permissions";
import { ATTACHMENT_ACCESS, attachmentTarget } from "@/server/attachment-access";
import { confirmAttachment, isAttachmentServiceError } from "@/server/attachment-service";

export const dynamic = "force-dynamic";

export async function POST(
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

    const access = ATTACHMENT_ACCESS[target.entityType];
    if (!can(guardResult.ctx.roles, access.write)) {
      return fail("FORBIDDEN", "Nemate pravo za ovu radnju.");
    }

    const result = await confirmAttachment(
      pool,
      guardResult.ctx.companyId,
      guardResult.ctx,
      id,
      {
        action: "attachment.confirmed",
        entityType: target.entityType.toLowerCase(),
        entityId: target.entityId,
      },
    );
    if (isAttachmentServiceError(result)) return fail(result.code, result.message);
    return ok(result);
  } catch (error) {
    return internal(error, "attachments.confirm");
  }
}
