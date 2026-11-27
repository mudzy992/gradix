/** R5.1 sync payload types for machine work logs (kept out of r4-sync.ts for file size). */
import { isOffsetDateTime } from "./r4-sync-time";

export type R4MachineWorkLogMode = "WORK" | "IDLE" | "BREAKDOWN";

export type R4MachineWorkLogPayload = {
  machineId: string;
  projectId: string | null;
  startedAt: string;
  endedAt: string;
  mode: R4MachineWorkLogMode;
  meterEnd: number | null;
  note: string | null;
};

export type R4MachineWorkLogPushItem = {
  localId: string;
  entityType: "machine_work_log";
  workLogId: string;
  deviceSentAt: string;
  log: R4MachineWorkLogPayload;
};

export function validMachineWorkLogPayload(log: R4MachineWorkLogPayload): boolean {
  if (!log || typeof log !== "object") return false;
  if (log.mode !== "WORK" && log.mode !== "IDLE" && log.mode !== "BREAKDOWN") return false;
  if (typeof log.machineId !== "string" || log.machineId.length < 1 || log.machineId.length > 128) return false;
  if (log.projectId !== null && (typeof log.projectId !== "string" || log.projectId.length < 1 || log.projectId.length > 128)) {
    return false;
  }
  if (!isOffsetDateTime(log.startedAt) || !isOffsetDateTime(log.endedAt)) return false;
  if (Date.parse(log.endedAt) <= Date.parse(log.startedAt)) return false;
  if (log.meterEnd !== null && (typeof log.meterEnd !== "number" || !Number.isFinite(log.meterEnd) || log.meterEnd < 0)) {
    return false;
  }
  if (log.note !== null && (typeof log.note !== "string" || log.note.length > 2000)) return false;
  return true;
}
