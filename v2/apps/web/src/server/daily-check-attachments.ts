/** R5.4 → F0.2: prilozi pregleda mašine kroz zajednički `attachment-service`. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany, type CompanyId } from "@gradix/db";
import { can } from "./permissions";
import { activityRecordAllowed } from "./equipment-scope";
import type { DailyCheckActor, DailyCheckAttachmentRow } from "./daily-check-types";
import { attachmentObjectKey, isAttachmentServiceError, listAttachments, registerAttachment } from "./attachment-service";

export type { AttachmentRequest } from "./daily-check-attachment-helpers";
export { isAttachmentServiceError } from "./daily-check-attachment-helpers";
export {
  confirmDailyCheckAttachment,
  dailyCheckAttachmentDownloadUrl,
} from "./daily-check-attachment-confirm";

function toRow(row: {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
}): DailyCheckAttachmentRow {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    // Zajednički servis koristi `ready`; ekran pregleda prikazuje `confirmed`.
    status: row.status === "ready" ? "confirmed" : (row.status as "pending" | "confirmed"),
    createdAt: row.createdAt,
  };
}

export async function listDailyCheckAttachments(
  pool: Pool,
  actor: DailyCheckActor,
  checkId: string,
): Promise<DailyCheckAttachmentRow[] | ReturnType<typeof fail>> {
  if (!can(actor.roles, "machines.check.view")) {
    return fail("FORBIDDEN", "Nemate pravo pregleda.");
  }
  const exists = await withCompany(pool, toCompanyId(actor.companyId), client => activityRecordAllowed(client, actor, "check", checkId));
  if (!exists) return fail("NOT_FOUND", "Pregled nije pronađen.");
  const rows = await listAttachments(pool, actor.companyId, "MACHINE_DAILY_CHECK", checkId);
  return rows.map(toRow);
}

export async function registerDailyCheckAttachment(
  pool: Pool,
  companyIdValue: CompanyId,
  actor: DailyCheckActor,
  checkId: string,
  input: { fileName: string; sizeBytes: number; sha256: string; head: Uint8Array },
): Promise<
  { attachment: DailyCheckAttachmentRow; uploadUrl: string; uploadExpiresAt: string }
  | ReturnType<typeof fail>
> {
  if (!can(actor.roles, "machines.check.create")) {
    return fail("FORBIDDEN", "Nemate pravo unosa priloga.");
  }
  if (companyIdValue !== actor.companyId) return fail("NOT_FOUND", "Pregled nije pronađen.");
  const exists = await withCompany(pool, companyIdValue, client => activityRecordAllowed(client, actor, "check", checkId));
  if (!exists) return fail("NOT_FOUND", "Pregled nije pronađen.");

  const result = await registerAttachment(
    pool,
    companyIdValue,
    { userId: actor.userId },
    "MACHINE_DAILY_CHECK",
    checkId,
    input,
  );
  if (isAttachmentServiceError(result)) return result;
  return {
    attachment: toRow(result.attachment),
    uploadUrl: result.uploadUrl,
    uploadExpiresAt: result.uploadExpiresAt,
  };
}

function fail(code: "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT" | "FORBIDDEN", message: string) {
  return { code, message };
}

export { attachmentObjectKey };
