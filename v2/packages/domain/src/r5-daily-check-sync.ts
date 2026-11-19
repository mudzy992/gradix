/** R5.4 sync payload types for machine daily checks. */
import { isOffsetDateTime } from "./r4-sync-time";

export type R4DailyCheckResult = "PASS" | "FAIL" | "CONDITIONAL";

export type R4DailyCheckPayload = {
  machineId: string;
  projectId: string | null;
  checkedAt: string;
  result: R4DailyCheckResult;
  checklistJson: Record<string, unknown>;
  note: string | null;
};

export type R4DailyCheckPushItem = {
  localId: string;
  entityType: "machine_daily_check";
  checkId: string;
  deviceSentAt: string;
  check: R4DailyCheckPayload;
};

export function validDailyCheckPayload(check: R4DailyCheckPayload): boolean {
  if (!check || typeof check !== "object") return false;
  if (typeof check.machineId !== "string" || check.machineId.length < 1 || check.machineId.length > 128) {
    return false;
  }
  if (check.projectId !== null
    && (typeof check.projectId !== "string" || check.projectId.length < 1 || check.projectId.length > 128)) {
    return false;
  }
  if (!isOffsetDateTime(check.checkedAt)) return false;
  if (check.result !== "PASS" && check.result !== "FAIL" && check.result !== "CONDITIONAL") return false;
  if (!check.checklistJson || typeof check.checklistJson !== "object" || Array.isArray(check.checklistJson)) {
    return false;
  }
  if (check.note !== null && (typeof check.note !== "string" || check.note.length > 2000)) return false;
  return true;
}
