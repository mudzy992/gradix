export function serializeDoc(row: {
  id: string;
  companyId: string;
  type: string;
  filePath: string;
  expiresAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  userId?: string;
  machineId?: string;
}) {
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type,
    filePath: row.filePath,
    expiresAt: row.expiresAt,
    note: row.note,
    userId: row.userId ?? null,
    machineId: row.machineId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function parseExpires(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
