import type { Scope } from "@gradix/domain";
/**
 * F9 — zajednički tipovi za offline sync dnevnika i HSE (spec 10 §1.8).
 *
 * Handleri dijele ISTI `deps` oblik kao R5/R8 handleri (`actor`, `worker`, `requestHash`,
 * `reservation`, `helpers`), pa `r4-sync-service` ne mora znati ništa novo o njima — samo ih
 * pozove. Sukob se rješava kroz `createConflict` gdje sukob ima smisla; na incidentu NE.
 */
import type { PoolClient } from "pg";
import type { CompanyId } from "@gradix/db";
import type { R4SyncPushItem, R4SyncPushItemResult } from "@gradix/domain";

export type SyncPushActor = { userId: string; companyId: CompanyId; roles: readonly string[];
  scope: Scope; projectIds: readonly string[] | null };
export type SyncReservation = { cursor_seq: string; reservation_token: string; already_committed: boolean };
export type SyncWorker = { id: string; first_name: string; last_name: string };

/**
 * Tipovi događaja koje F9 objavljuje. `site_diary_item` NIJE događaj: stavka mijenja zaglavlje
 * dnevnika (verzija raste), pa telefon dobija jedan događaj za dan, ne tri za dan i dvije stavke.
 */
export type DiaryHseEventType = "site_diary" | "hse_incident" | "hse_action" | "hse_training";

export type SyncDiaryHseApplyDeps = {
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
      entityType: DiaryHseEventType,
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
