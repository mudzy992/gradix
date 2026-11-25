/**
 * F9 — offline push HSE: prijava incidenta, korektivna mjera, obuka/toolbox.
 *
 * Najvažnije pravilo modula: **konflikt na incidentu ne postoji** (§1.8/36). Ako telefon pošalje
 * prijavu za događaj koji server već zna, to nije neslaganje verzija — to je drugi svjedok. Zato
 * ovaj handler nikad ne otvara `sync_conflicts` za incident: novi tekst ide u
 * `hse_incident_updates` (dopuna), a odgovor je `APPLIED` sa `DUPLICATE` semantikom preko
 * `entityId` postojećeg incidenta.
 *
 * Mjera i obuka konflikt imaju: ista mjera sa drugim rokom ili ista obuka sa drugim prisutnima je
 * stvarno neslaganje dva telefona i mora se vidjeti u uredu.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  R4HseActionPushItem,
  R4HseIncidentPushItem,
  R4HseTrainingPushItem,
  R4SyncPushItemResult,
} from "@gradix/domain";
import { encodeSyncCursor } from "./sync-cursor";
import { addIncidentUpdateTx, createActionTx, createTrainingTx, reportIncidentTx } from "./hse-service";
import type { SyncDiaryHseApplyDeps } from "./r6-sync-diary-hse-types";

export type { SyncDiaryHseApplyDeps } from "./r6-sync-diary-hse-types";

export async function applyHseIncidentSyncItem(
  client: PoolClient,
  deps: SyncDiaryHseApplyDeps,
  item: R4HseIncidentPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  const workDate = await helpers.businessDate(client, item.incident.occurredAt);
  if (!workDate) return reject();

  /* Incident je već na serveru (isti klijentski id): ta prijava je DRUGI SVJEDOK, ne sukob. */
  const existing = await client.query<{ id: string; status: string }>(
    "SELECT id, status FROM public.hse_incidents WHERE company_id = $1 AND id = $2",
    [actor.companyId, item.incidentId],
  );
  const current = existing.rows[0];
  if (current) {
    const body = item.incident.updateBody ?? item.incident.description;
    if (body.trim().length > 0) {
      const added = await addIncidentUpdateTx(
        client,
        { userId: actor.userId, companyId: actor.companyId, roles: actor.roles },
        current.id,
        { body, authorWorkerId: worker.id, clientLocalId: item.localId },
      );
      if (added.outcome === "OK") {
        return finish(client, deps, item, current.id, 1, workDate, {
          duplicateOf: current.id,
          updateId: added.id,
          supplement: true,
        });
      }
    }
    /* Bez teksta nema šta dodati — prijava je primljena ranije i to je tačan odgovor. */
    const duplicate: R4SyncPushItemResult = {
      localId: item.localId,
      status: "DUPLICATE",
      entityId: current.id,
      version: 1,
      cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
    };
    await helpers.saveReceipt(client, actor, item, requestHash, duplicate);
    return duplicate;
  }

  const created = await reportIncidentTx(client, { userId: actor.userId, companyId: actor.companyId, roles: actor.roles }, {
    id: item.incidentId,
    kind: item.incident.kind,
    severity: item.incident.severity,
    occurredAt: item.incident.occurredAt,
    projectId: item.incident.projectId,
    locationText: item.incident.locationText,
    lat: item.incident.lat,
    lng: item.incident.lng,
    description: item.incident.description,
    immediateAction: item.incident.immediateAction,
    reporterWorkerId: worker.id,
    injuredWorkerId: item.incident.injuredWorkerId,
    lostDays: item.incident.lostDays,
    reportableToAuthority: item.incident.reportableToAuthority,
    clientLocalId: item.localId,
  });
  if (created.outcome === "CONFLICT") {
    /* `client_local_id` je bio zauzet, a id nije — isti telefon, druga generacija reda. */
    return reject({ ...helpers.invalidItem(item, "HSE_INCIDENT_DUPLICATE") });
  }
  if (created.outcome !== "OK") {
    return reject(helpers.invalidItem(item, created.outcome === "NOT_FOUND" ? "NOT_FOUND" : "SYNC_ITEM_REJECTED"));
  }

  /* Fotografije: imena i šačevi su u prijavi, sam upload nastavlja `attachment-service` po
     povratku mreže. Registracija `pending` redova ovdje čuva vezu čim prijava postoji. */
  for (const photo of item.incident.photos) {
    await client.query(
      `INSERT INTO public.hse_attachments
         (id, company_id, entity_type, entity_id, object_key, file_name, content_type, size_bytes, sha256, status, created_by)
       VALUES ($1,$2,'INCIDENT',$3,$4,$5,$6,$7,$8,'pending',$9)
       ON CONFLICT (entity_type, entity_id, sha256) DO NOTHING`,
      [
        `hsa_${randomUUID()}`, actor.companyId, created.id,
        `gx2/${actor.companyId}/hse-incident/${created.id}/${photo.sha256}`,
        photo.fileName, photo.contentType, photo.sizeBytes, photo.sha256, actor.userId,
      ],
    );
  }

  return finish(client, deps, item, created.id, 1, workDate, {
    obligationId: created.obligationId ?? null,
    photos: item.incident.photos.length,
  });
}

export async function applyHseActionSyncItem(
  client: PoolClient,
  deps: SyncDiaryHseApplyDeps,
  item: R4HseActionPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  const workDate = await helpers.businessDate(client, item.deviceSentAt);
  if (!workDate) return reject();

  const existing = await client.query<{ id: string; due_on: string; status: string }>(
    "SELECT id, due_on::text, status FROM public.hse_actions WHERE company_id = $1 AND id = $2",
    [actor.companyId, item.actionId],
  );
  const current = existing.rows[0];
  if (current) {
    if (current.due_on === item.action.dueOn) {
      const duplicate: R4SyncPushItemResult = {
        localId: item.localId, status: "DUPLICATE", entityId: current.id, version: 1,
        cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
      };
      await helpers.saveReceipt(client, actor, item, requestHash, duplicate);
      return duplicate;
    }
    return helpers.createConflict(
      client, actor, worker, item, workDate, requestHash, reservation,
      null, null, "HSE_ACTION_EXISTS",
    );
  }

  const created = await createActionTx(
    client,
    { userId: actor.userId, companyId: actor.companyId, roles: actor.roles },
    {
      id: item.actionId,
      incidentId: item.action.incidentId,
      inspectionId: item.action.inspectionId,
      description: item.action.description,
      responsibleWorkerId: item.action.responsibleWorkerId,
      dueOn: item.action.dueOn,
      clientLocalId: item.localId,
    },
  );
  if (created.outcome !== "OK") {
    return reject(helpers.invalidItem(item, created.code));
  }
  return finish(client, deps, item, created.id, 1, workDate, {
    dueOn: item.action.dueOn,
    incidentId: item.action.incidentId,
    inspectionId: item.action.inspectionId,
  });
}

export async function applyHseTrainingSyncItem(
  client: PoolClient,
  deps: SyncDiaryHseApplyDeps,
  item: R4HseTrainingPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  const workDate = await helpers.businessDate(client, item.training.heldAt);
  if (!workDate) return reject();

  const existing = await client.query<{ id: string; held_at: string }>(
    "SELECT id, held_at::text FROM public.hse_trainings WHERE company_id = $1 AND id = $2",
    [actor.companyId, item.trainingId],
  );
  if (existing.rows[0]) {
    return helpers.createConflict(
      client, actor, worker, item, workDate, requestHash, reservation,
      null, null, "HSE_TRAINING_EXISTS",
    );
  }

  const created = await createTrainingTx(
    client,
    { userId: actor.userId, companyId: actor.companyId, roles: actor.roles },
    {
      id: item.trainingId,
      kind: item.training.kind,
      title: item.training.title,
      topic: item.training.topic,
      heldAt: item.training.heldAt,
      projectId: item.training.projectId,
      location: item.training.location,
      durationMinutes: item.training.durationMinutes,
      heldByWorkerId: worker.id,
      attendees: item.training.attendees,
      clientLocalId: item.localId,
    },
  );
  if (created.outcome !== "OK") {
    return reject(helpers.invalidItem(item, created.code));
  }
  return finish(client, deps, item, created.id, 1, workDate, {
    kind: item.training.kind,
    attendees: item.training.attendees.length,
    durationMinutes: item.training.durationMinutes,
  });
}

async function finish(
  client: PoolClient,
  deps: SyncDiaryHseApplyDeps,
  item: R4HseIncidentPushItem | R4HseActionPushItem | R4HseTrainingPushItem,
  entityId: string,
  version: number,
  workDate: string,
  extra: Record<string, unknown>,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const entityType = item.entityType === "hse_incident"
    ? "hse_incident"
    : item.entityType === "hse_action"
      ? "hse_action"
      : "hse_training";
  await helpers.publishEvent(client, actor, reservation, requestHash, entityType, entityId, version, {
    id: entityId,
    workDate,
    reportedByWorkerId: worker.id,
    clientLocalId: item.localId,
    ...extra,
  });
  const result: R4SyncPushItemResult = {
    localId: item.localId,
    status: "APPLIED",
    entityId,
    version,
    cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
  };
  await helpers.saveReceipt(client, actor, item, requestHash, result);
  return result;
}
