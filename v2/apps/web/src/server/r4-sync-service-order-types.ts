/** Zajednički tipovi za `service_order_action` sync (F8). */
import type { PoolClient } from "pg";
import type { R4SyncPushItem, R4SyncPushItemResult } from "@gradix/domain";
import type { SyncEntityType, SyncPushActor } from "./r4-sync-fault-types";

type SyncReservation = { cursor_seq: string; reservation_token: string; already_committed: boolean };

/**
 * Isti `helpers` oblik kao kod ostalih sync entiteta — namjerno se ne uvodi novi interfejs, jer
 * bi dvije definicije „kako se stavka odbija“ mogle dati različite ishode za istu grešku.
 */
export type SyncOrderActionDeps = {
  actor: SyncPushActor;
  requestHash: string;
  reservation: SyncReservation;
  helpers: {
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
    publishEvent: (
      client: PoolClient,
      actor: SyncPushActor,
      reservation: SyncReservation,
      requestHash: string,
      entityType: SyncEntityType,
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
