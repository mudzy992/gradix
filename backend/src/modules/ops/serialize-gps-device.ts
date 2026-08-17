import { GpsDevice } from '../../../generated/client';

export function serializeGpsDevice(row: GpsDevice) {
  return {
    id: row.id,
    machineId: row.machineId,
    name: row.name,
    isActive: row.isActive,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
