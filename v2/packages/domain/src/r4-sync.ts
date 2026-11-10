/**
 * R4a sync protocol primitives shared by web, mobile, and deterministic simulator tests.
 * No database, React Native, or Node-only dependencies belong in this module.
 */
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

export type R4SyncPushItem = R4WorkEntryPushItem | R4WorkdayPushItem;

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
  entityType: "workday" | "work_entry" | "sync_conflict";
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

export function isR4Uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isOffsetDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = OFFSET_DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 23 || offsetMinute > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > (daysInMonth[month - 1] ?? 0)) return false;
  return Number.isFinite(Date.parse(value));
}

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
    if (!isR4Uuid(item.workdayId) || !isOffsetDateTime(item.deviceSentAt)) {
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
