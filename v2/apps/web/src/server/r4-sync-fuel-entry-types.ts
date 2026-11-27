import type { Scope } from "@gradix/domain";
/** Shared types for fuel_entry sync apply. */
import type { PoolClient } from "pg";
import type { CompanyId } from "@gradix/db";
import type { R4SyncPushItem, R4SyncPushItemResult } from "@gradix/domain";

export type SyncPushActor = { userId: string; companyId: CompanyId; roles: readonly string[];
  scope: Scope; projectIds: readonly string[] | null };
export type SyncReservation = { cursor_seq: string; reservation_token: string; already_committed: boolean };
export type SyncWorker = { id: string; first_name: string; last_name: string };

export type SyncFuelEntryApplyDeps = {
  actor: SyncPushActor;
  worker: SyncWorker;
  requestHash: string;
  reservation: SyncReservation;
  helpers: {
    businessDate: (client: PoolClient, instant: string) => Promise<string | null>;
    invalidItem: (item: R4SyncPushItem, code?: string) => R4SyncPushItemResult;
    rejectInTransaction: (
      client: PoolClient,
      actor: SyncPushActor,
      item: R4SyncPushItem,
      requestHash: string,
      reservation: SyncReservation,
      result: R4SyncPushItemResult,
      additionalReservation?: SyncReservation,
    ) => Promise<R4SyncPushItemResult>;
    createConflict: (
      client: PoolClient,
      actor: SyncPushActor,
      worker: SyncWorker,
      item: R4SyncPushItem,
      workDate: string,
      requestHash: string,
      reservation: SyncReservation,
      workEntryId: string | null,
      serverVersion: number | null,
      reason: string,
      additionalReservation?: SyncReservation,
    ) => Promise<R4SyncPushItemResult>;
    publishEvent: (
      client: PoolClient,
      actor: SyncPushActor,
      reservation: SyncReservation,
      requestHash: string,
      entityType: "workday" | "work_entry" | "sync_conflict" | "machine_work_log" | "fuel_entry" | "haul" | "machine_daily_check" | "machine_fault",
      entityId: string,
      version: number,
      payload: Record<string, unknown>,
    ) => Promise<void>;
    saveReceipt: (
      client: PoolClient,
      actor: SyncPushActor,
      item: R4SyncPushItem,
      requestHash: string,
      result: R4SyncPushItemResult,
    ) => Promise<void>;
  };
};