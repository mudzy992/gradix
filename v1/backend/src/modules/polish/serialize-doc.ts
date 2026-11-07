import { parseIsoDateTime } from '../../common/utils/date-input';

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

/**
 * BE-15 (F-06): neispravan `expiresAt` je ranije **tiho** postao `undefined`, pa je
 * dokument bez roka izgledao kao dokument bez isteka (compliance prikaz je lagao).
 * Sada je `400`.
 */
export function parseExpires(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  return parseIsoDateTime(value, 'expiresAt');
}
