/** R7.3 shared types for tender attachments. */
export type TenderAttachmentRow = {
  id: string;
  tenderId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
};

export type TenderAttachmentRequest = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  head: Buffer;
};

export type TenderAttachmentError = {
  code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT";
  message: string;
};

export const TENDER_ATTACHMENT_COLS =
  "id, tender_id, file_name, content_type, size_bytes, status, created_at";

export function toTenderAttachmentRow(row: Record<string, unknown>): TenderAttachmentRow {
  return {
    id: String(row.id),
    tenderId: String(row.tender_id),
    fileName: String(row.file_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    status: String(row.status),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export function isTenderAttachmentError(value: unknown): value is TenderAttachmentError {
  return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}
