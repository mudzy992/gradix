/** R7.3 → F0.2: prilozi tendera kroz zajednički `attachment-service`. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import type { TenderActor } from "./tender-service";
import {
  isTenderAttachmentError,
  toTenderAttachmentRow,
  type TenderAttachmentError,
  type TenderAttachmentRequest,
  type TenderAttachmentRow,
} from "./tender-attachment-types";
import {
  attachmentDownloadUrl as attachmentDownloadUrlShared,
  confirmAttachment as confirmAttachmentShared,
  isAttachmentServiceError,
  listAttachments,
  registerAttachment as registerAttachmentShared,
} from "./attachment-service";

export type { TenderAttachmentRow, TenderAttachmentRequest };
export { isTenderAttachmentError };

export async function listTenderAttachments(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<TenderAttachmentRow[] | TenderAttachmentError> {
  if (!can(actor.roles, "tenders.view")) return { code: "FORBIDDEN", message: "Nemate pravo pregleda." };
  const exists = await withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tender = await client.query(`SELECT 1 FROM public.tenders WHERE id = $1 AND company_id = $2`, [
      tenderId,
      actor.companyId,
    ]);
    return tender.rowCount !== 0;
  });
  if (!exists) return { code: "NOT_FOUND", message: "Tender nije pronađen." };
  const rows = await listAttachments(pool, actor.companyId, "TENDER", tenderId);
  return rows.map(toTenderAttachmentRow);
}

export async function registerTenderAttachment(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: TenderAttachmentRequest,
): Promise<{ attachment: TenderAttachmentRow; uploadUrl: string; uploadExpiresAt: string } | TenderAttachmentError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo unosa priloga." };
  }
  const exists = await withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tender = await client.query(`SELECT 1 FROM public.tenders WHERE id = $1 AND company_id = $2`, [
      tenderId,
      actor.companyId,
    ]);
    return tender.rowCount !== 0;
  });
  if (!exists) return { code: "NOT_FOUND", message: "Tender nije pronađen." };

  const result = await registerAttachmentShared(
    pool,
    actor.companyId,
    { userId: actor.userId },
    "TENDER",
    tenderId,
    input,
  );
  if (isAttachmentServiceError(result)) return result;
  return {
    attachment: toTenderAttachmentRow(result.attachment as unknown as Record<string, unknown>),
    uploadUrl: result.uploadUrl,
    uploadExpiresAt: result.uploadExpiresAt,
  };
}

async function belongsToTender(pool: Pool, companyId: string, tenderId: string, attachmentId: string) {
  return withCompany(pool, toCompanyId(companyId), async (client) => {
    const found = await client.query(
      `SELECT 1 FROM public.attachments
        WHERE id = $1 AND company_id = $2 AND entity_type = 'TENDER' AND entity_id = $3`,
      [attachmentId, companyId, tenderId],
    );
    return found.rowCount !== 0;
  });
}

export async function confirmTenderAttachment(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  attachmentId: string,
): Promise<{ attachment: TenderAttachmentRow } | TenderAttachmentError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo potvrde priloga." };
  }
  if (!(await belongsToTender(pool, actor.companyId, tenderId, attachmentId))) {
    return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  }
  const result = await confirmAttachmentShared(
    pool,
    actor.companyId,
    { userId: actor.userId },
    attachmentId,
    { action: "tender.attachment.registered", entityType: "tender", entityId: tenderId },
  );
  if (isAttachmentServiceError(result)) return result;
  return { attachment: toTenderAttachmentRow(result.attachment as unknown as Record<string, unknown>) };
}

export async function tenderAttachmentDownloadUrl(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  attachmentId: string,
): Promise<{ url: string; expiresAt: string } | TenderAttachmentError> {
  if (!can(actor.roles, "tenders.view")) return { code: "FORBIDDEN", message: "Nemate pravo pregleda." };
  if (!(await belongsToTender(pool, actor.companyId, tenderId, attachmentId))) {
    return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  }
  const result = await attachmentDownloadUrlShared(pool, actor.companyId, attachmentId);
  if (isAttachmentServiceError(result)) return result;
  return result;
}
