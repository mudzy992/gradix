/**
 * F9 — offline push dnevnika građenja: zaglavlje dana i količine izvedenih radova.
 *
 * Tri pravila koja ovaj handler čuva:
 *
 *  1. **Dan je `(projekt, datum)`.** Telefon šalje svoj `diaryId`, ali identitet dana je unique u
 *     bazi. Ako dan već postoji, ne pravimo drugi red (§1.1/1) — spajamo po sekcijama (§1.8/35).
 *  2. **Spajanje je po sekcijama, ne po redu.** Vrijeme, opis, posjetioci i događaji su nezavisne
 *     sekcije: ono što je telefon poslao popunjava prazno i NE gazi tuđi unos. Kad se oba razlikuju,
 *     otvara se `sync_conflicts` i oba šefa dobiju obavještenje — čovjek odlučuje, ne zadnji push.
 *  3. **`baseVersion` je ono što je šef vidio.** Ako je server dalje od toga, čovjek je radio nad
 *     zastarjelim ekranom; to je sukob i mora se vidjeti.
 *
 * Količine (`site_diary_item`) pišu `project_boq_items.quantity_executed` u ISTOJ transakciji —
 * napredak projekta ima jedan izvor (§1.2/8).
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  R4SiteDiaryItemPushItem,
  R4SiteDiaryPushItem,
  R4SyncPushItemResult,
} from "@gradix/domain";
import { encodeSyncCursor } from "./sync-cursor";
import { collectDiaryAutoData } from "./diary-service";
import { ensureDefaultDiaryTemplate } from "./diary-template-service";
import { notify } from "./notification-service";
import type { SyncDiaryHseApplyDeps } from "./r6-sync-diary-hse-types";

export type { SyncDiaryHseApplyDeps } from "./r6-sync-diary-hse-types";

const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

type DiaryRow = {
  id: string;
  status: string;
  version: number;
  weather: string | null;
  temperature_c: string | null;
  worked_hours: string | null;
  description: string | null;
  visitors: string | null;
  events: string | null;
  signed_name: string | null;
};

/** Sekcije koje se spajaju nezavisno. `null` na serveru = prazno polje koje telefon smije popuniti. */
const MERGE_FIELDS = ["weather", "temperatureC", "workedHours", "description", "visitors", "events"] as const;

export async function applySiteDiarySyncItem(
  client: PoolClient,
  deps: SyncDiaryHseApplyDeps,
  item: R4SiteDiaryPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  const project = await client.query<{ id: string }>(
    "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
    [actor.companyId, item.diary.projectId],
  );
  if (!project.rows[0]) return reject();

  /* Zaključan dan se ne dopunjava: to bi promijenilo potpisani dokument bez revizije. */
  const existing = await client.query<DiaryRow>(
    `SELECT id, status, version, weather, temperature_c::text, worked_hours::text,
            description, visitors, events, signed_name
       FROM public.site_diaries
      WHERE company_id = $1 AND project_id = $2 AND diary_date = $3::date
      FOR UPDATE`,
    [actor.companyId, item.diary.projectId, item.diary.diaryDate],
  );
  const current = existing.rows[0];
  if (current?.status === "LOCKED") {
    return reject({ ...helpers.invalidItem(item, "DIARY_ALREADY_LOCKED"), entityId: current.id, version: current.version });
  }

  /* Isti id dnevnika iz DRUGOG dana ili projekta: to je greška klijenta, ne dopuna. */
  const sameId = await client.query<{ id: string; project_id: string; diary_date: string; version: number }>(
    "SELECT id, project_id, diary_date::text, version FROM public.site_diaries WHERE company_id = $1 AND id = $2",
    [actor.companyId, item.diaryId],
  );
  if (sameId.rows[0] && sameId.rows[0].id !== current?.id) {
    return helpers.createConflict(
      client, actor, worker, item, item.diary.diaryDate, requestHash, reservation,
      null, sameId.rows[0].version, "DIARY_EXISTS",
    );
  }

  const incoming = {
    weather: item.diary.weather,
    temperatureC: item.diary.temperatureC,
    workedHours: item.diary.workedHours,
    description: item.diary.description,
    visitors: item.diary.visitors,
    events: item.diary.events,
  };

  if (!current) {
    const diaryId = item.diaryId;
    await client.query(
      `INSERT INTO public.site_diaries
         (id, company_id, project_id, diary_date, weather, temperature_c, worked_hours,
          description, visitors, events, auto_snapshot, created_by, updated_by)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$12)`,
      [
        diaryId, actor.companyId, item.diary.projectId, item.diary.diaryDate,
        incoming.weather, incoming.temperatureC, incoming.workedHours,
        incoming.description, incoming.visitors, incoming.events,
        JSON.stringify(await collectDiaryAutoData(client, actor.companyId, item.diary.projectId, item.diary.diaryDate)),
        actor.userId,
      ],
    );
    for (const delay of item.diary.delays) {
      await client.query(
        `INSERT INTO public.site_diary_delays
           (id, company_id, diary_id, kind, from_at, to_at, hours, note, created_by)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9)`,
        [newId("sdd"), actor.companyId, diaryId, delay.kind, delay.fromAt, delay.toAt, delay.hours, delay.note, actor.userId],
      );
    }
    await ensureDefaultDiaryTemplate(client, actor.companyId);
    return finish(client, deps, item, diaryId, 1, item.diary.diaryDate, incoming);
  }

  /* Starija baza od one koju je šef vidio: ekran je bio zastario, pa se odlučuje kroz sukob. */
  const stale = item.baseVersion < current.version;
  const conflicts = MERGE_FIELDS.filter((field) => {
    const serverValue = serverValueOf(current, field);
    const incomingValue = incoming[field as keyof typeof incoming];
    return incomingValue !== null && serverValue !== null && String(serverValue) !== String(incomingValue);
  });
  if (stale && conflicts.length > 0) {
    return helpers.createConflict(
      client, actor, worker, item, item.diary.diaryDate, requestHash, reservation,
      null, current.version, "DIARY_VERSION_CONFLICT",
    );
  }

  /* Dopuna: popunjava samo prazna polja; tuđi unos se ne gazi tiho. */
  const merged = {
    weather: current.weather ?? incoming.weather,
    temperatureC: current.temperature_c ?? incoming.temperatureC,
    workedHours: current.worked_hours ?? incoming.workedHours,
    description: current.description ?? incoming.description,
    visitors: current.visitors ?? incoming.visitors,
    events: current.events ?? incoming.events,
  };
  await client.query(
    `UPDATE public.site_diaries SET
       weather = $3, temperature_c = $4, worked_hours = $5, description = $6, visitors = $7, events = $8,
       version = version + 1, updated_by = $9, updated_at = clock_timestamp()
     WHERE company_id = $1 AND id = $2`,
    [
      actor.companyId, current.id, merged.weather, merged.temperatureC, merged.workedHours,
      merged.description, merged.visitors, merged.events, actor.userId,
    ],
  );
  for (const delay of item.diary.delays) {
    const duplicate = await client.query(
      `SELECT 1 FROM public.site_diary_delays
        WHERE company_id = $1 AND diary_id = $2 AND kind = $3 AND from_at = $4::timestamptz`,
      [actor.companyId, current.id, delay.kind, delay.fromAt],
    );
    if (duplicate.rows[0]) continue;
    await client.query(
      `INSERT INTO public.site_diary_delays
         (id, company_id, diary_id, kind, from_at, to_at, hours, note, created_by)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9)`,
      [newId("sdd"), actor.companyId, current.id, delay.kind, delay.fromAt, delay.toAt, delay.hours, delay.note, actor.userId],
    );
  }
  if (conflicts.length > 0) {
    /* Sukob je zabilježen, ali podaci su spojeni — oba šefa moraju znati da je neko drugi pisao. */
    await notify(client, actor.companyId, {
      kind: "system",
      title: "Dnevnik: dvije verzije istog dana",
      body: `Dan ${item.diary.diaryDate}: spojene sekcije (${conflicts.join(", ")}). Provjerite dnevnik.`,
      href: `/ured/dnevnik/${current.id}`,
      severity: "WARN",
      roleTarget: "SITE_SUPERVISOR",
      sourceType: "site_diary",
      sourceId: current.id,
      dedupeKey: `diary.merge:${current.id}:${current.version}`,
    });
  }
  return finish(client, deps, item, current.id, current.version + 1, item.diary.diaryDate, merged);
}

function serverValueOf(row: DiaryRow, field: (typeof MERGE_FIELDS)[number]): string | null {
  switch (field) {
    case "weather": return row.weather;
    case "temperatureC": return row.temperature_c;
    case "workedHours": return row.worked_hours;
    case "description": return row.description;
    case "visitors": return row.visitors;
    case "events": return row.events;
  }
}

async function finish(
  client: PoolClient,
  deps: SyncDiaryHseApplyDeps,
  item: R4SiteDiaryPushItem,
  diaryId: string,
  version: number,
  workDate: string,
  diary: Record<string, unknown>,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const payload = {
    id: diaryId,
    projectId: item.diary.projectId,
    workDate,
    status: "DRAFT",
    answeredByWorkerId: worker.id,
    diary,
    delays: item.diary.delays,
    version,
    clientLocalId: item.localId,
  };
  await helpers.publishEvent(client, actor, reservation, requestHash, "site_diary", diaryId, version, payload);
  const result: R4SyncPushItemResult = {
    localId: item.localId,
    status: "APPLIED",
    entityId: diaryId,
    version,
    cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
  };
  await helpers.saveReceipt(client, actor, item, requestHash, result);
  return result;
}

/**
 * Količina izvedenih radova sa telefona.
 *
 * Ugovor nosi `diaryItemId` (id stavke) i stavku, ali NE i `diaryId`: dan se nalazi iz stavke
 * predmjera (`project_id`) i radnog dana (`deviceSentAt`) — to je isti `(projekt, dan)` ključ po
 * kojem dnevnik i nastaje. Ako dana nema, stavka se odbija: količina bez dnevnika ne dokazuje
 * KADA je izvedena, pa ne smije ući u napredak projekta.
 */
export async function applySiteDiaryItemSyncItem(
  client: PoolClient,
  deps: SyncDiaryHseApplyDeps,
  item: R4SiteDiaryItemPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  const workDate = await helpers.businessDate(client, item.deviceSentAt);
  if (!workDate) return reject();

  let boq: { id: string; project_id: string; description: string; unit: string } | null = null;
  if (item.item.boqItemId) {
    const boqRow = await client.query<{ id: string; project_id: string; description: string; unit: string }>(
      "SELECT id, project_id, description, unit FROM public.project_boq_items WHERE company_id = $1 AND id = $2",
      [actor.companyId, item.item.boqItemId],
    );
    boq = boqRow.rows[0] ?? null;
    if (!boq) return reject();
  }
  /* Stavka bez predmjera nema iz kog projekta je — telefon je morao poslati `BOQ` stavku. */
  if (!boq) return reject(helpers.invalidItem(item, "SYNC_ITEM_INVALID"));

  const diary = await client.query<{ id: string; status: string; version: number }>(
    `SELECT id, status, version FROM public.site_diaries
      WHERE company_id = $1 AND project_id = $2 AND diary_date = $3::date
      FOR UPDATE`,
    [actor.companyId, boq.project_id, workDate],
  );
  const header = diary.rows[0];
  if (!header) return reject(helpers.invalidItem(item, "DIARY_NOT_FOUND"));
  if (header.status === "LOCKED") {
    return reject({ ...helpers.invalidItem(item, "DIARY_ALREADY_LOCKED"), entityId: header.id, version: header.version });
  }

  /* Ista BOQ stavka dva puta u istom danu je greška unosa, ne dvije količine (§1.2/10). */
  const duplicate = await client.query<{ id: string }>(
    "SELECT id FROM public.site_diary_items WHERE company_id = $1 AND diary_id = $2 AND boq_item_id = $3",
    [actor.companyId, header.id, boq.id],
  );
  if (duplicate.rows[0]) {
    return reject({
      ...helpers.invalidItem(item, "DIARY_ITEM_EXISTS"),
      entityId: duplicate.rows[0].id,
    });
  }

  const existingItem = await client.query<{ id: string }>(
    "SELECT id FROM public.site_diary_items WHERE company_id = $1 AND id = $2",
    [actor.companyId, item.diaryItemId],
  );
  if (existingItem.rows[0]) {
    return reject({ ...helpers.invalidItem(item), entityId: existingItem.rows[0].id });
  }

  await client.query(
    `INSERT INTO public.site_diary_items
       (id, company_id, diary_id, boq_item_id, description, unit, quantity, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      item.diaryItemId, actor.companyId, header.id, boq.id,
      item.item.description.trim() || boq.description, item.item.unit.trim() || boq.unit,
      item.item.quantity, "BOQ", actor.userId,
    ],
  );
  await client.query(
    `UPDATE public.project_boq_items
        SET quantity_executed = quantity_executed + $3::numeric,
            updated_at = clock_timestamp(), updated_by = $4
      WHERE company_id = $1 AND id = $2`,
    [actor.companyId, boq.id, item.item.quantity, actor.userId],
  );
  await client.query(
    `UPDATE public.site_diaries SET version = version + 1, updated_by = $3, updated_at = clock_timestamp()
      WHERE company_id = $1 AND id = $2`,
    [actor.companyId, header.id, actor.userId],
  );

  const version = header.version + 1;
  await helpers.publishEvent(client, actor, reservation, requestHash, "site_diary", header.id, version, {
    id: header.id,
    workDate,
    itemId: item.diaryItemId,
    boqItemId: boq.id,
    quantity: item.item.quantity,
    version,
    clientLocalId: item.localId,
    answeredByWorkerId: worker.id,
  });
  const result: R4SyncPushItemResult = {
    localId: item.localId,
    status: "APPLIED",
    entityId: item.diaryItemId,
    version,
    cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
  };
  await helpers.saveReceipt(client, actor, item, requestHash, result);
  return result;
}
