import { TimerSession } from '../../../generated/client';
import { computeElapsedMinutes } from './timer-math';

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

/**
 * BE-07 — odgovor za **sopstvenu** sesiju (`/timer/me`, `start`, `pause`, `resume`, `stop`).
 * Namjerno bez `companyId`, `deviceId`, `localId` i `isSynced`: klijentu ne trebaju, a
 * identifikator uređaja je podatak koji ne izlazi iz sync kanala (F-BE-07-04).
 */
export function serializeTimerSelf(row: TimerSession) {
  return {
    id: row.id,
    taskId: row.taskId,
    machineId: row.machineId,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    pausedAt: row.pausedAt,
    pauseAccumMinutes: row.pauseAccumMinutes,
    durationMinutes: row.durationMinutes,
    lat: row.lat?.toString() ?? null,
    lng: row.lng?.toString() ?? null,
    approvalStatus: row.approvalStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * BE-07 — red za nadzorni pregled otvorenih timera (`GET /timer?projectId=`).
 * Prikazuje **tuđe** sesije, pa ne sadrži `deviceId`/`localId`/`isSynced`, nego izračunato
 * trajanje (`elapsedMinutes`) koje bi klijent inače morao sam da računa (F-BE-07-04).
 */
export function serializeCrewTimer(row: TimerSession, now: Date) {
  return {
    id: row.id,
    userId: row.userId,
    taskId: row.taskId,
    machineId: row.machineId,
    startedAt: row.startedAt,
    pausedAt: row.pausedAt,
    pauseAccumMinutes: row.pauseAccumMinutes,
    elapsedMinutes: computeElapsedMinutes(row, now),
  };
}
