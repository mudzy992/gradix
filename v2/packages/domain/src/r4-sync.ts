/**
 * R4a sync protocol primitives shared by web, mobile, and deterministic simulator tests.
 * No database, React Native, or Node-only dependencies belong in this module.
 */
import { isOffsetDateTime, isR4Uuid } from "./r4-sync-time";
import {
  validMachineWorkLogPayload,
  type R4MachineWorkLogPushItem,
} from "./r5-machine-work-log-sync";
import {
  validFuelEntryPayload,
  type R4FuelEntryPushItem,
} from "./r5-fuel-entry-sync";
import {
  validHaulPayload,
  type R4HaulPushItem,
} from "./r5-haul-sync";
import {
  validDailyCheckPayload,
  type R4DailyCheckPushItem,
} from "./r5-daily-check-sync";
import {
  validFaultPayload,
  type R4FaultPushItem,
} from "./r5-fault-sync";
import {
  validServiceOrderPushItem,
  type R4ServiceOrderActionPushItem,
} from "./r5-service-order-sync";
import {
  validHseActionPushItem,
  validHseIncidentPushItem,
  validHseTrainingPushItem,
  validSiteDiaryItemPushItem,
  validSiteDiaryPushItem,
  type R4HseActionPushItem,
  type R4HseIncidentPushItem,
  type R4HseTrainingPushItem,
  type R4SiteDiaryItemPushItem,
  type R4SiteDiaryPushItem,
} from "./r6-diary-hse-sync";

export { isOffsetDateTime, isR4Uuid } from "./r4-sync-time";
export type {
  R4MachineWorkLogMode,
  R4MachineWorkLogPayload,
  R4MachineWorkLogPushItem,
} from "./r5-machine-work-log-sync";
export type { R4FuelEntryPayload, R4FuelEntryPushItem } from "./r5-fuel-entry-sync";
export type { R4HaulPayload, R4HaulPushItem, R4HaulQuantityUnit } from "./r5-haul-sync";
export type {
  R4DailyCheckPayload,
  R4DailyCheckPushItem,
  R4DailyCheckResult,
} from "./r5-daily-check-sync";
export type {
  R4FaultPayload,
  R4FaultPriority,
  R4FaultPushItem,
  R4FaultStatus,
} from "./r5-fault-sync";
/* F9 — dnevnik i HSE (spec 10 §1.8/34): pet terenskih tipova sa svojim pravilima razrješenja. */
export type {
  DiaryDelayKind,
  DiaryWeather,
  HseIncidentKindCode,
  HseSeverityCode,
  R4DiaryDelayPayload,
  R4HseActionPayload,
  R4HseActionPushItem,
  R4HseIncidentPayload,
  R4HseIncidentPushItem,
  R4HseTrainingPayload,
  R4HseTrainingPushItem,
  R4SiteDiaryItemPayload,
  R4SiteDiaryItemPushItem,
  R4SiteDiaryPayload,
  R4SiteDiaryPushItem,
} from "./r6-diary-hse-sync";
export {
  validHseActionPayload,
  validHseActionPushItem,
  validHseIncidentPayload,
  validHseIncidentPushItem,
  validHseTrainingPayload,
  validHseTrainingPushItem,
  validSiteDiaryItemPayload,
  validSiteDiaryItemPushItem,
  validSiteDiaryPayload,
  validSiteDiaryPushItem,
} from "./r6-diary-hse-sync";
export {
  FAULT_COST_APPROVAL_THRESHOLD_CENTS,
  needsFaultCostApproval,
  validFaultPayload,
} from "./r5-fault-sync";
export type {
  R4ServiceOrderActionPushItem,
  ServiceOrderActionKind,
  ServiceOrderActionPayload,
  ServiceOrderPartAction,
} from "./r5-service-order-sync";
export {
  serviceActionOutcomeLabel,
  validServiceOrderActionPayload,
  validServiceOrderPushItem,
} from "./r5-service-order-sync";

export const R4_SYNC_PUSH_MAX_ITEMS = 100;
export const R4_SYNC_PUSH_MAX_BODY_BYTES = 1024 * 1024;
export const R4_SYNC_PUSH_MAX_ITEM_BYTES = 16 * 1024;
export const R4_SYNC_PULL_MAX_ITEMS = 200;
export const R4_SYNC_PULL_MAX_PAGES_PER_RUN = 8;
export const R4_SYNC_CLOCK_SKEW_SECONDS = 5 * 60;

export type R4WorkEntryKind = "WORK" | "BREAK";
export type R4WorkEntryEndState = "OPEN" | "KNOWN_END" | "UNKNOWN_END";
export type R4WorkdayStatus = "DRAFT" | "SUBMITTED";

export type R4WorkEntryPayload = {
  kind: R4WorkEntryKind;
  startedAt: string;
  endedAt: string | null;
  endState: R4WorkEntryEndState;
  projectId: string | null;
  machineId: string | null;
  note: string | null;
};

export type R4WorkEntryPushItem = {
  localId: string;
  entityType: "work_entry";
  /** Present only for SITE_SUPERVISOR group entry; the server rechecks R3 scope on work_date. */
  workerId?: string;
  workdayId: string;
  workEntryId: string;
  /** Absent only for a new entry; updates require optimistic concurrency. */
  baseVersion?: number;
  deviceSentAt: string;
  entry: R4WorkEntryPayload;
};

export type R4WorkdayPushItem = {
  localId: string;
  entityType: "workday";
  /** Present only for SITE_SUPERVISOR group submission; the server checks assignment history. */
  workerId?: string;
  workdayId: string;
  baseVersion: number;
  deviceSentAt: string;
  status: "SUBMITTED";
};

export type R4SyncPushItem =
  | R4WorkEntryPushItem
  | R4WorkdayPushItem
  | R4MachineWorkLogPushItem
  | R4FuelEntryPushItem
  | R4HaulPushItem
  | R4DailyCheckPushItem
  | R4FaultPushItem
  /* F8: radionica sa telefona — jedna stavka, radnja je `action.kind`. */
  | R4ServiceOrderActionPushItem
  /* F9: dnevnik građenja i HSE — pet tipova, svaki sa svojim ključem idempotencije. */
  | R4SiteDiaryPushItem
  | R4SiteDiaryItemPushItem
  | R4HseIncidentPushItem
  | R4HseActionPushItem
  | R4HseTrainingPushItem;

export type R4SyncPushItemResult = {
  localId: string;
  status: "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED";
  entityId: string | null;
  version: number | null;
  cursor: string | null;
  canonicalWorkdayId?: string;
  conflictId?: string;
  code?: string;
};

export type R4SyncPushResponse = { results: R4SyncPushItemResult[] };

export type R4SyncEvent = {
  id: string;
  cursorSeq: string;
  entityType:
    | "workday"
    | "work_entry"
    | "sync_conflict"
    | "machine_work_log"
    | "fuel_entry"
    | "haul"
    | "machine_daily_check"
    | "machine_fault"
    | "service_order_action";
  entityId: string;
  entityVersion: number;
  payload: Record<string, unknown> | null;
  tombstone: boolean;
  createdAt: string;
};

export type R4SyncPullPage = {
  events: R4SyncEvent[];
  cursor: string;
  cursorFloor: string;
  hasMore: boolean;
};

export type R4SyncValidationCode =
  | "SYNC_BATCH_TOO_LARGE"
  | "SYNC_BODY_TOO_LARGE"
  | "SYNC_ITEM_TOO_LARGE"
  | "SYNC_LOCAL_ID_INVALID"
  | "SYNC_ITEM_INVALID"
  | "SYNC_CURSOR_INVALID"
  | "SYNC_CURSOR_EXPIRED"
  | "SYNC_LOCAL_ID_REUSED"
  | "SYNC_ITEM_REJECTED";

export type R4SyncValidationResult = { ok: true } | { ok: false; code: R4SyncValidationCode };

function validEntryPayload(entry: R4WorkEntryPayload): boolean {
  if (!entry || typeof entry !== "object") return false;
  if (entry.kind !== "WORK" && entry.kind !== "BREAK") return false;
  if (!isOffsetDateTime(entry.startedAt)) return false;
  if (entry.endedAt !== null && !isOffsetDateTime(entry.endedAt)) return false;
  if (entry.endState === "OPEN" || entry.endState === "UNKNOWN_END") {
    if (entry.endedAt !== null) return false;
  } else if (entry.endState === "KNOWN_END") {
    if (!entry.endedAt || Date.parse(entry.endedAt) <= Date.parse(entry.startedAt)) return false;
  } else return false;

  if (entry.kind === "WORK") {
    if (typeof entry.projectId !== "string" || entry.projectId.length < 1 || entry.projectId.length > 128) return false;
  } else if (entry.projectId !== null || entry.machineId !== null) {
    return false;
  }
  if (entry.machineId !== null && (typeof entry.machineId !== "string" || entry.machineId.length < 1 || entry.machineId.length > 128)) return false;
  if (entry.note !== null && (typeof entry.note !== "string" || entry.note.length > 2000)) return false;
  return true;
}

/**
 * Full request validation is deliberately pure and runs before any server write.
 * Byte limits are checked by the HTTP route against the actual UTF-8 request/item JSON.
 */
export function validateR4SyncPush(items: readonly R4SyncPushItem[]): R4SyncValidationResult {
  if (items.length < 1 || items.length > R4_SYNC_PUSH_MAX_ITEMS) return { ok: false, code: "SYNC_BATCH_TOO_LARGE" };
  const localIds = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object" || !isR4Uuid(item.localId) || localIds.has(item.localId)) {
      return { ok: false, code: "SYNC_LOCAL_ID_INVALID" };
    }
    localIds.add(item.localId);
    if (!isOffsetDateTime(item.deviceSentAt)) {
      return { ok: false, code: "SYNC_ITEM_INVALID" };
    }
    if (item.entityType === "machine_work_log") {
      if (typeof item.workLogId !== "string" || item.workLogId.length < 1 || item.workLogId.length > 128) {
        return { ok: false, code: "SYNC_ITEM_INVALID" };
      }
      if (!validMachineWorkLogPayload(item.log)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "fuel_entry") {
      if (typeof item.fuelEntryId !== "string" || item.fuelEntryId.length < 1 || item.fuelEntryId.length > 128) {
        return { ok: false, code: "SYNC_ITEM_INVALID" };
      }
      if (!validFuelEntryPayload(item.entry)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "haul") {
      if (typeof item.haulId !== "string" || item.haulId.length < 1 || item.haulId.length > 128) {
        return { ok: false, code: "SYNC_ITEM_INVALID" };
      }
      if (!validHaulPayload(item.haul)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "machine_daily_check") {
      if (typeof item.checkId !== "string" || item.checkId.length < 1 || item.checkId.length > 128) {
        return { ok: false, code: "SYNC_ITEM_INVALID" };
      }
      if (!validDailyCheckPayload(item.check)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "machine_fault") {
      if (typeof item.faultId !== "string" || item.faultId.length < 1 || item.faultId.length > 128) {
        return { ok: false, code: "SYNC_ITEM_INVALID" };
      }
      if (!validFaultPayload(item.fault)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "service_order_action") {
      if (!validServiceOrderPushItem(item)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "site_diary") {
      if (!validSiteDiaryPushItem(item)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "site_diary_item") {
      if (!validSiteDiaryItemPushItem(item)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "hse_incident") {
      if (!validHseIncidentPushItem(item)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "hse_action") {
      if (!validHseActionPushItem(item)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (item.entityType === "hse_training") {
      if (!validHseTrainingPushItem(item)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      continue;
    }
    if (!isR4Uuid(item.workdayId)) {
      return { ok: false, code: "SYNC_ITEM_INVALID" };
    }
    if (item.workerId !== undefined && (typeof item.workerId !== "string" || item.workerId.length < 1 || item.workerId.length > 128)) {
      return { ok: false, code: "SYNC_ITEM_INVALID" };
    }
    if (item.entityType === "work_entry") {
      if (!isR4Uuid(item.workEntryId) || !validEntryPayload(item.entry)) return { ok: false, code: "SYNC_ITEM_INVALID" };
      if (item.baseVersion !== undefined && (!Number.isInteger(item.baseVersion) || item.baseVersion < 1)) {
        return { ok: false, code: "SYNC_ITEM_INVALID" };
      }
    } else if (item.entityType === "workday") {
      if (!Number.isInteger(item.baseVersion) || item.baseVersion < 1 || item.status !== "SUBMITTED") {
        return { ok: false, code: "SYNC_ITEM_INVALID" };
      }
    } else {
      return { ok: false, code: "SYNC_ITEM_INVALID" };
    }
  }
  return { ok: true };
}

export function isValidCursorSequence(value: string): boolean {
  if (!/^(0|[1-9]\d{0,18})$/.test(value)) return false;
  const max = "9223372036854775807";
  return value.length < max.length || (value.length === max.length && value <= max);
}
