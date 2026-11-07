import { Tender, TenderAttachment } from '../../../generated/client';

export function serializeTender(
  row: Tender & { attachments?: TenderAttachment[] },
  avgCompletedSpend: string | null,
) {
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    client: row.client,
    submittedValue: row.submittedValue?.toString() ?? null,
    submittedAt: row.submittedAt,
    status: row.status,
    notes: row.notes,
    convertedProjectId: row.convertedProjectId,
    comparison: avgCompletedSpend,
    attachments: (row.attachments ?? []).map((item) => ({
      id: item.id,
      path: item.path,
      fileName: item.fileName,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
