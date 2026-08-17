import { TimerSession } from '../../../generated/client';

export function serializeTimer(row: TimerSession) {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    taskId: row.taskId,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    pausedAt: row.pausedAt,
    pauseAccumMinutes: row.pauseAccumMinutes,
    durationMinutes: row.durationMinutes,
    lat: row.lat?.toString() ?? null,
    lng: row.lng?.toString() ?? null,
    machineId: row.machineId,
    localId: row.localId,
    deviceId: row.deviceId,
    isSynced: row.isSynced,
    approvalStatus: row.approvalStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
