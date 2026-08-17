import { Machine } from '../../../generated/client';

export function serializeMachine(row: Machine) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    code: row.code,
    type: row.type,
    status: row.status,
    currentWorkingHours: row.currentWorkingHours.toString(),
    lastLat: row.lastLat?.toString() ?? null,
    lastLng: row.lastLng?.toString() ?? null,
    lastGpsAt: row.lastGpsAt,
    lastGpsSource: row.lastGpsSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
