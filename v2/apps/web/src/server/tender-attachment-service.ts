import { tenderRecordAllowed, tenderDenied } from "./tender-scope";
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
    if (!await tenderRecordAllowed(client, actor, tenderId)) return false;
    const tender = await client.query("SELECT 1 FROM public.tenders WHERE company_id=$1 AND id=$2", [actor.companyId, tenderId]);
    return Boolean(tender.rowCount);
  });
  if (!exists) return tenderDenied(actor);
  const rows = await listAttachments(pool, actor.companyId, "TENDER", tenderId, actor);
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
    if (!await tenderRecordAllowed(client, actor, tenderId)) return false;
    const tender = await client.query("SELECT 1 FROM public.tenders WHERE company_id=$1 AND id=$2", [actor.companyId, tenderId]);
    return Boolean(tender.rowCount);
  });
  if (!exists) return tenderDenied(actor);

  const result = await registerAttachmentShared(
    pool,
    actor.companyId,
    actor,
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

async function belongsToTender(pool: Pool, actor: TenderActor, tenderId: string, attachmentId: string) {
  const companyId = actor.companyId;
  return withCompany(pool, toCompanyId(companyId), async (client) => {
    if (!await tenderRecordAllowed(client, actor, tenderId)) return false;
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
  if (!(await belongsToTender(pool, actor, tenderId, attachmentId))) {
    return tenderDenied(actor);
  }
  const result = await confirmAttachmentShared(
    pool,
    actor.companyId,
    actor,
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
  if (!(await belongsToTender(pool, actor, tenderId, attachmentId))) {
    return tenderDenied(actor);
  }
  const result = await attachmentDownloadUrlShared(pool, actor.companyId, attachmentId, actor);
  if (isAttachmentServiceError(result)) return result;
  return result;
}
