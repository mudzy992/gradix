/**
 * F9 — HSE: incident → istraga → mjere → zatvaranje, plus obuke i inspekcije.
 *
 * Pravila koja servis čuva i zašto:
 *
 *  1. **Incident je činjenica.** Izmjena vrste/težine/vremena/opisa/povrijeđenog pada (i ovdje i u
 *     trigeru). Dopuna ide u `hse_incident_updates` — drugi svjedok je nova izjava, ne prepravka
 *     prve (spec §1.8/36).
 *  2. **`reportable_to_authority` pravi OBAVEZU, ne podsjetnik** (spec §1.3/16): prijava inspekciji
 *     je zakonski rok i živi u Modulu 2 (`HSE_REPORT`, podsjetnici `{3,1}`). Drugi poziv ne pravi
 *     drugu obavezu — veza je `report_obligation_id`.
 *  3. **`PROHIBITION` je odmah CRITICAL obavještenje vlasniku** (spec §1.5/25) i ostaje istaknut dok
 *     se zabrana izričito ne podigne.
 *  4. **Prisustvo je potpis**, ne checkbox (§1.4/19, 22). Certifikacijska obuka jednim pozivom
 *     obnavlja certifikacijsku obavezu iz Modula 2 (§1.4/21) — ali samo `CERTIFICATION`.
 *  5. **`OVERDUE` se računa** (`due_on < danas AND status='OPEN'`), nikad ne čuva (§1.3/15).
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  canCloseIncident,
  hseActionIsOverdue,
  hseOnTimeRate,
  isActiveProhibition,
  ltifr,
  nearMissCount,
  needsHseReportObligation,
  totalLostDays,
  trainingCanRenewCertificate,
  validToolboxInput,
  type HseActionRow,
  type HseIncidentKind,
  type HseIncidentRow,
  type HseSeverity,
} from "@gradix/domain";
import { writeAudit } from "./audit";
import { companyToday } from "./project-service";
import { notify } from "./notification-service";
import type { DiaryActor } from "./diary-service";

export type HseOutcome =
  | { outcome: "OK"; id: string; version?: number; obligationId?: string | null }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "NOT_FOUND"; code: string; message: string };

const NOT_FOUND: HseOutcome = { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Incident ne postoji." };

const id = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

/* ------------------------------------------------------------------ incidenti */

export type IncidentInput = {
  /** Klijentski id iz offline prijave — sync ga koristi kao `id`, pa ponovni push ne pravi novi red. */
  id?: string;
  kind: string;
  severity: string;
  occurredAt: string;
  projectId?: string | null;
  locationText?: string | null;
  lat?: string | null;
  lng?: string | null;
  description: string;
  immediateAction?: string | null;
  reporterWorkerId?: string | null;
  injuredWorkerId?: string | null;
  involvedWorkers?: { workerId: string; injured: boolean }[];
  lostDays?: number;
  reportableToAuthority?: boolean;
  clientLocalId?: string | null;
};

/**
 * Prijava incidenta.
 *
 * Obaveza `HSE_REPORT` se pravi u ISTOJ transakciji kao incident: ako bi se pravila kasnije (u
 * worker poslu), prijava bi mogla postojati bez zakonskog roka, a rok bez prijave. Veza je
 * `report_obligation_id`, pa ponovni poziv vidi da obaveza postoji.
 */
export async function reportIncident(pool: Pool, actor: DiaryActor, input: IncidentInput): Promise<HseOutcome> {
  return withCompany(pool, toCompanyId(actor.companyId), (client) => reportIncidentTx(client, actor, input));
}

/**
 * Isto kao `reportIncident`, ali UNUTAR transakcije pozivaoca. Sync push obrađuje stavku u svojoj
 * transakciji (zajedno sa receipt-om i kursorom), pa mu treba jezgro bez svog `withCompany`.
 */
export async function reportIncidentTx(
  client: PoolClient,
  actor: DiaryActor,
  input: IncidentInput,
): Promise<HseOutcome> {
  if (!input.description || input.description.trim().length < 5) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Opis incidenta je obavezan." };
  }
  const participants = input.involvedWorkers ?? [];
  if (!Array.isArray(participants) || participants.length > 100 || participants.some((p) => !p ||
      typeof p.workerId !== "string" || !p.workerId.trim() || p.workerId.length > 128 || typeof p.injured !== "boolean") ||
      new Set(participants.map((p) => p.workerId)).size !== participants.length ||
      (input.injuredWorkerId && input.involvedWorkers !== undefined && !participants.some((p) => p.workerId === input.injuredWorkerId && p.injured))) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Spisak učesnika nije ispravan." };
  }
  const allParticipants = [...participants];
  if (input.injuredWorkerId && !allParticipants.some((p) => p.workerId === input.injuredWorkerId)) {
    allParticipants.push({ workerId: input.injuredWorkerId, injured: true });
  }
  const firstInjured = input.injuredWorkerId ?? allParticipants.find((p) => p.injured)?.workerId ?? null;
  const lostDays = input.lostDays ?? 0;
  if (input.kind === "NEAR_MISS" && (lostDays > 0 || firstInjured)) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "VALIDATION_FAILED",
      message: "Neposredna opasnost (NEAR_MISS) ne može imati izgubljene dane ni povrijeđenog — to je onda nesreća.",
    };
  }
  {
    if (input.projectId) {
      const project = await client.query("SELECT 1 FROM public.projects WHERE company_id = $1 AND id = $2", [
        actor.companyId, input.projectId,
      ]);
      if (!project.rows[0]) {
        return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Projekat ne postoji." } as HseOutcome;
      }
    }
    if (allParticipants.length) {
      const workers = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.workers WHERE company_id = $1 AND id = ANY($2::text[])",
        [actor.companyId, allParticipants.map((p) => p.workerId)],
      );
      if (Number(workers.rows[0]?.count ?? 0) !== allParticipants.length) {
        return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Neki od radnika ne postoji u ovoj firmi." };
      }
    }
    /* Offline prijava: isti telefonski `localId` drugi put vraća POSTOJEĆI incident, ne drugi. */
    if (input.clientLocalId) {
      const duplicate = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM public.hse_incidents WHERE company_id = $1 AND client_local_id = $2",
        [actor.companyId, input.clientLocalId],
      );
      if (duplicate.rows[0]) {
        return {
          outcome: "CONFLICT",
          code: "HSE_INCIDENT_DUPLICATE",
          message: `Incident je već prijavljen (${duplicate.rows[0].id}).`,
        } as HseOutcome;
      }
    }

    const incidentId = input.id ?? id("hsi");
    /* Ime polja iz sync ugovora je `incidentId`; server ga čuva kao `id`, pa ponovni push sa
       istim klijentskim id-om pada na PRIMARY KEY i vraća DUPLICATE, ne drugi incident. */
    await client.query(
      `INSERT INTO public.hse_incidents
         (id, company_id, project_id, kind, severity, occurred_at, location_text, lat, lng,
          description, immediate_action, reporter_worker_id, reporter_user_id, injured_worker_id,
          lost_days, reportable_to_authority, client_local_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::numeric,$9::numeric,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
      [
        incidentId, actor.companyId, input.projectId ?? null, input.kind, input.severity,
        input.occurredAt, input.locationText ?? null, input.lat ?? null, input.lng ?? null,
        input.description.trim(), input.immediateAction ?? null, input.reporterWorkerId ?? null,
        actor.userId, firstInjured, lostDays,
        input.reportableToAuthority === true, input.clientLocalId ?? null, actor.userId,
      ],
    );

    for (const participant of allParticipants) {
      await client.query(
        `INSERT INTO public.hse_incident_workers (id, company_id, incident_id, worker_id, injured)
         VALUES ($1,$2,$3,$4,$5)`,
        [id("hiw"), actor.companyId, incidentId, participant.workerId, participant.injured],
      );
    }

    const obligationId = input.reportableToAuthority === true
      ? await ensureHseReportObligation(client, actor.companyId, incidentId, input.occurredAt)
      : null;

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "hse.incident_reported",
      entityType: "hse_incident",
      entityId: incidentId,
      metadata: { kind: input.kind, severity: input.severity, reportable: input.reportableToAuthority === true },
      retentionClass: "ACCESS",
    });

    /* Težak incident je odmah stvar vlasnika; `NEAR_MISS` NE ide noću u telefon — to bi obučilo
       ljude da ne prijavljuju. */
    if (input.severity === "SEVERE" || input.severity === "FATAL") {
      await notify(client, actor.companyId, {
        kind: "system",
        title: `Težak incident: ${input.kind === "ACCIDENT" ? "nesreća" : input.kind}`,
        body: input.description.trim().slice(0, 300),
        href: `/ured/hse/${incidentId}`,
        severity: "CRITICAL",
        roleTarget: "OWNER",
        sourceType: "hse_incident",
        sourceId: incidentId,
        dedupeKey: `hse.severe:${incidentId}`,
      });
    }

    return { outcome: "OK", id: incidentId, obligationId };
  }
}

/**
 * `HSE_REPORT` obaveza (spec §1.3/16). Tip se dopunjava ako firma još nema (stare firme), pa se
 * obaveza pravi i kad šifarnik nije bio osvježen — isto pravilo kao `ensureCostCategories`.
 *
 * Rok je `occurredAt + 3 dana` sa podsjetnicima `{3,1}` iz tipa: prijava inspekciji ima zakonski
 * rok, a ne „rok koji neko odredi“.
 */
async function ensureHseReportObligation(
  client: PoolClient,
  companyId: string,
  incidentId: string,
  occurredAt: string,
): Promise<string | null> {
  const existing = await client.query<{ report_obligation_id: string | null }>(
    "SELECT report_obligation_id FROM public.hse_incidents WHERE company_id = $1 AND id = $2",
    [companyId, incidentId],
  );
  if (existing.rows[0]?.report_obligation_id) return existing.rows[0].report_obligation_id;

  await client.query(
    `INSERT INTO public.obligation_types
       (id, company_id, code, label, entity_kind, default_reminder_days, requires_attachment,
        sort_order, blocks_assignment)
     VALUES ($1,$2,'HSE_REPORT','Prijava inspekciji rada','COMPANY','{3,1}',true,50,false)
     ON CONFLICT (company_id, code) DO NOTHING`,
    [`${companyId}_obt_hse_report`, companyId],
  );
  const type = await client.query<{ id: string }>(
    "SELECT id FROM public.obligation_types WHERE company_id = $1 AND code = 'HSE_REPORT'",
    [companyId],
  );
  const typeId = type.rows[0]?.id;
  if (!typeId) return null;

  const obligationId = id("obl");
  const reportDueOn = new Date(Date.parse(occurredAt) + 3 * 86_400_000).toISOString();
  await client.query(
    `INSERT INTO public.obligations
       (id, company_id, type_id, scope_company, note, created_by, expires_at, review_at, reminder_days)
     VALUES ($1,$2,$3,true,$4,$5,$6::timestamptz,$6::timestamptz,'{3,1}')`,
    [
      obligationId, companyId, typeId,
      `Prijava inspekciji rada za incident ${incidentId} (spec 10 §1.3/16).`,
      null, reportDueOn,
    ],
  );
  await client.query(
    "UPDATE public.hse_incidents SET report_obligation_id = $3 WHERE company_id = $1 AND id = $2",
    [companyId, incidentId, obligationId],
  );
  return obligationId;
}

export type IncidentUpdateInput = { body: string; authorWorkerId?: string | null; clientLocalId?: string | null };

/** Dopuna incidenta — append-only. Nikad ne mijenja incident, samo dodaje izjavu. */
export async function addIncidentUpdate(
  pool: Pool,
  actor: DiaryActor,
  incidentId: string,
  input: IncidentUpdateInput,
): Promise<HseOutcome> {
  return withCompany(pool, toCompanyId(actor.companyId), (client) =>
    addIncidentUpdateTx(client, actor, incidentId, input),
  );
}

/** Isto kao `addIncidentUpdate`, unutar transakcije pozivaoca (sync dopuna). */
export async function addIncidentUpdateTx(
  client: PoolClient,
  actor: DiaryActor,
  incidentId: string,
  input: IncidentUpdateInput,
): Promise<HseOutcome> {
  if (!input.body || input.body.trim().length < 1) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Dopuna ne može biti prazna." };
  }
  {
    const incident = await client.query("SELECT 1 FROM public.hse_incidents WHERE company_id = $1 AND id = $2", [
      actor.companyId, incidentId,
    ]);
    if (!incident.rows[0]) return NOT_FOUND;
    if (input.clientLocalId) {
      const duplicate = await client.query<{ id: string }>(
        "SELECT id FROM public.hse_incident_updates WHERE company_id = $1 AND client_local_id = $2",
        [actor.companyId, input.clientLocalId],
      );
      if (duplicate.rows[0]) {
        return { outcome: "CONFLICT", code: "HSE_INCIDENT_DUPLICATE", message: "Ta dopuna je već primljena." } as HseOutcome;
      }
    }
    const updateId = id("hiu");
    await client.query(
      `INSERT INTO public.hse_incident_updates (id, company_id, incident_id, author_id, author_worker_id, body, client_local_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [updateId, actor.companyId, incidentId, actor.userId, input.authorWorkerId ?? null,
        input.body.trim(), input.clientLocalId ?? null],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "hse.incident_updated",
      entityType: "hse_incident",
      entityId: incidentId,
      metadata: { updateId },
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: updateId };
  }
}

export type InvestigationInput = {
  rootCause: string;
  method?: "FIVE_WHY" | "FISHBONE" | "OTHER";
  findings?: string | null;
  completed?: boolean;
};

/** Istraga: jedna po incidentu (`upsert`), jer bi druga značila dva uzroka i dvije istine. */
export async function saveInvestigation(
  pool: Pool,
  actor: DiaryActor,
  incidentId: string,
  input: InvestigationInput,
): Promise<HseOutcome> {
  if (!input.rootCause || input.rootCause.trim().length < 5) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Uzrok je obavezan (bar 5 znakova)." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const incident = await client.query<{ status: string }>(
      "SELECT status FROM public.hse_incidents WHERE company_id = $1 AND id = $2",
      [actor.companyId, incidentId],
    );
    if (!incident.rows[0]) return NOT_FOUND;
    const investigationId = id("hin");
    await client.query(
      `INSERT INTO public.hse_investigations
         (id, company_id, incident_id, root_cause, method, findings, investigator_user_id, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)
       ON CONFLICT (company_id, incident_id) DO UPDATE SET
         root_cause = EXCLUDED.root_cause,
         method = EXCLUDED.method,
         findings = EXCLUDED.findings,
         completed_at = EXCLUDED.completed_at,
         updated_at = clock_timestamp()`,
      [
        investigationId, actor.companyId, incidentId, input.rootCause.trim(),
        input.method ?? "FIVE_WHY", input.findings ?? null, actor.userId,
        input.completed ? new Date().toISOString() : null,
      ],
    );
    if (input.completed && incident.rows[0].status === "REPORTED") {
      await client.query(
        "UPDATE public.hse_incidents SET status = 'INVESTIGATING', updated_by = $3, updated_at = clock_timestamp() WHERE company_id = $1 AND id = $2",
        [actor.companyId, incidentId, actor.userId],
      );
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "hse.investigation_saved",
      entityType: "hse_incident",
      entityId: incidentId,
      metadata: { method: input.method ?? "FIVE_WHY", completed: input.completed === true },
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: incidentId };
  });
}

/**
 * Zatvaranje incidenta: traži završenu istragu i nijednu otvorenu mjeru. Odluka je u domeni
 * (`canCloseIncident`), servis je samo provodi — pa ekran, test i API ne mogu imati tri pravila.
 */
export async function closeIncident(pool: Pool, actor: DiaryActor, incidentId: string): Promise<HseOutcome> {
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const incident = await client.query<{ status: string }>(
      "SELECT status FROM public.hse_incidents WHERE company_id = $1 AND id = $2",
      [actor.companyId, incidentId],
    );
    if (!incident.rows[0]) return NOT_FOUND;
    const investigation = await client.query<{ completed_at: string | null }>(
      "SELECT completed_at FROM public.hse_investigations WHERE company_id = $1 AND incident_id = $2",
      [actor.companyId, incidentId],
    );
    const actions = await client.query<{ status: HseActionRow["status"]; due_on: string; done_at: string | null }>(
      "SELECT status, due_on::text, done_at::text FROM public.hse_actions WHERE company_id = $1 AND incident_id = $2",
      [actor.companyId, incidentId],
    );
    const check = canCloseIncident({
      investigationCompleted: Boolean(investigation.rows[0]?.completed_at),
      actions: actions.rows.map((row) => ({ status: row.status, dueOn: row.due_on, doneOn: row.done_at })),
    });
    if (!check.ok) {
      return {
        outcome: "CONFLICT",
        code: check.code,
        message: check.code === "HSE_INVESTIGATION_REQUIRED"
          ? "Incident se zatvara tek poslije završene istrage."
          : "Postoji otvorena mjera: incident se ne može zatvoriti dok se ne završi ili otkaže.",
      } as HseOutcome;
    }
    await client.query(
      `UPDATE public.hse_incidents
          SET status = 'CLOSED', closed_at = clock_timestamp(), closed_by = $3,
              updated_by = $3, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, incidentId, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "hse.incident_closed",
      entityType: "hse_incident",
      entityId: incidentId,
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: incidentId };
  });
}

/* ------------------------------------------------------------------ mjere */

export type ActionInput = {
  /** Klijentski id (offline mjera). */
  id?: string;
  incidentId?: string | null;
  inspectionId?: string | null;
  description: string;
  responsibleWorkerId: string;
  dueOn: string;
  clientLocalId?: string | null;
};

/** Mjera bez odgovornog ili roka se odbija (§1.3/15) — i u servisu, i u domeni, i u bazi. */
export async function createAction(pool: Pool, actor: DiaryActor, input: ActionInput): Promise<HseOutcome> {
  return withCompany(pool, toCompanyId(actor.companyId), (client) => createActionTx(client, actor, input));
}

/** Isto kao `createAction`, unutar transakcije pozivaoca (sync). */
export async function createActionTx(
  client: PoolClient,
  actor: DiaryActor,
  input: ActionInput,
): Promise<HseOutcome> {
  const hasIncident = Boolean(input.incidentId);
  const hasInspection = Boolean(input.inspectionId);
  if (hasIncident === hasInspection) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "VALIDATION_FAILED",
      message: "Mjera pripada tačno jednom izvoru: incidentu ili inspekciji.",
    };
  }
  if (!input.responsibleWorkerId) {
    return { outcome: "VALIDATION_FAILED", code: "HSE_ACTION_RESPONSIBLE_REQUIRED", message: "Mjera traži odgovornu osobu." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) {
    return { outcome: "VALIDATION_FAILED", code: "HSE_ACTION_DUE_REQUIRED", message: "Mjera traži rok (datum)." };
  }
  {
    const worker = await client.query("SELECT 1 FROM public.workers WHERE company_id = $1 AND id = $2 AND is_active", [
      actor.companyId, input.responsibleWorkerId,
    ]);
    if (!worker.rows[0]) {
      return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Odgovorni radnik ne postoji ili nije aktivan." } as HseOutcome;
    }
    if (input.clientLocalId) {
      const duplicate = await client.query<{ id: string }>(
        "SELECT id FROM public.hse_actions WHERE company_id = $1 AND client_local_id = $2",
        [actor.companyId, input.clientLocalId],
      );
      if (duplicate.rows[0]) {
        return { outcome: "CONFLICT", code: "HSE_ACTION_DUPLICATE", message: "Ta mjera je već otvorena." } as HseOutcome;
      }
    }
    const actionId = input.id ?? id("hsa");
    await client.query(
      `INSERT INTO public.hse_actions
         (id, company_id, incident_id, inspection_id, description, responsible_worker_id, due_on, client_local_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9)`,
      [actionId, actor.companyId, input.incidentId ?? null, input.inspectionId ?? null,
        input.description.trim(), input.responsibleWorkerId, input.dueOn, input.clientLocalId ?? null, actor.userId],
    );
    /* Incident dobija `ACTIONS_OPEN` čim ima otvorenu mjeru — status koji govori istinu o poslu. */
    if (input.incidentId) {
      await client.query(
        `UPDATE public.hse_incidents SET status = 'ACTIONS_OPEN', updated_by = $3, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2 AND status IN ('REPORTED', 'INVESTIGATING')`,
        [actor.companyId, input.incidentId, actor.userId],
      );
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "hse.action_created",
      entityType: "hse_action",
      entityId: actionId,
      metadata: { dueOn: input.dueOn, incidentId: input.incidentId ?? null, inspectionId: input.inspectionId ?? null },
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: actionId };
  }
}

/** Završetak mjere. `done_at` je vrijeme radnje, ne datum roka — iz razlike se računa „na vrijeme“. */
export async function completeAction(
  pool: Pool,
  actor: DiaryActor,
  actionId: string,
  note?: string | null,
): Promise<HseOutcome> {
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const action = await client.query<{ status: string }>(
      "SELECT status FROM public.hse_actions WHERE company_id = $1 AND id = $2",
      [actor.companyId, actionId],
    );
    const row = action.rows[0];
    if (!row) return { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Mjera ne postoji." } as HseOutcome;
    if (row.status !== "OPEN") {
      return { outcome: "CONFLICT", code: "SERVICE_INVALID_STATUS", message: "Mjera je već zatvorena." } as HseOutcome;
    }
    await client.query(
      `UPDATE public.hse_actions
          SET status = 'DONE', done_at = clock_timestamp(), done_by = $3,
              description = CASE WHEN $4::text IS NULL THEN description
                                 ELSE description || E'\n' || $4::text END,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, actionId, actor.userId, note ?? null],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "hse.action_done",
      entityType: "hse_action",
      entityId: actionId,
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: actionId };
  });
}

export async function cancelAction(pool: Pool, actor: DiaryActor, actionId: string, reason: string): Promise<HseOutcome> {
  if (reason.trim().length < 5) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Otkazivanje mjere traži razlog." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const updated = await client.query(
      `UPDATE public.hse_actions
          SET status = 'CANCELLED',
              description = description || E'\n[otkazano] ' || $3,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2 AND status = 'OPEN'`,
      [actor.companyId, actionId, reason.trim()],
    );
    if (updated.rowCount === 0) {
      return { outcome: "CONFLICT", code: "SERVICE_INVALID_STATUS", message: "Mjera ne postoji ili nije otvorena." } as HseOutcome;
    }
    return { outcome: "OK", id: actionId };
  });
}

/* ------------------------------------------------------------------ inspekcije */

export type InspectionInput = {
  kind: "INTERNAL" | "EXTERNAL" | "AUTHORITY";
  authorityName?: string | null;
  inspectedAt: string;
  inspectorName?: string | null;
  summary?: string | null;
  result: "PASS" | "MINOR_FINDINGS" | "MAJOR_FINDINGS" | "PROHIBITION";
  projectId?: string | null;
};

/**
 * Inspekcija. `PROHIBITION` odmah šalje CRITICAL obavještenje vlasniku (§1.5/25) — zabrana rada je
 * jedini nalaz koji zaustavlja gradilište, pa ne smije čekati da neko otvori ekran.
 */
export async function recordInspection(
  pool: Pool,
  actor: DiaryActor,
  input: InspectionInput,
): Promise<HseOutcome> {
  if (input.kind === "AUTHORITY" && (!input.authorityName || input.authorityName.trim().length < 2)) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "VALIDATION_FAILED",
      message: "Inspekcija državnog organa traži naziv organa.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const inspectionId = id("hsp");
    await client.query(
      `INSERT INTO public.hse_inspections
         (id, company_id, project_id, kind, authority_name, inspected_at, inspector_name, summary, result, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10)`,
      [
        inspectionId, actor.companyId, input.projectId ?? null, input.kind,
        input.authorityName?.trim() ?? null, input.inspectedAt, input.inspectorName?.trim() ?? null,
        input.summary ?? null, input.result, actor.userId,
      ],
    );
    if (input.result === "PROHIBITION") {
      await notify(client, actor.companyId, {
        kind: "system",
        title: "ZABRANA RADA — inspekcijski nalaz",
        body: `${input.authorityName?.trim() ?? "Inspekcija"}: ${input.summary?.slice(0, 300) ?? "zabrana rada na gradilištu"}`,
        href: `/ured/hse/inspekcije`,
        severity: "CRITICAL",
        roleTarget: "OWNER",
        sourceType: "hse_inspection",
        sourceId: inspectionId,
        dedupeKey: `hse.prohibition:${inspectionId}`,
      });
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "hse.inspection_recorded",
      entityType: "hse_inspection",
      entityId: inspectionId,
      metadata: { kind: input.kind, result: input.result },
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: inspectionId };
  });
}

/** Podizanje zabrane rada — jedini način da nalaz prestane da bude aktivan. */
export async function liftProhibition(
  pool: Pool,
  actor: DiaryActor,
  inspectionId: string,
  note: string,
): Promise<HseOutcome> {
  if (note.trim().length < 5) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Podizanje zabrane traži razlog." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const updated = await client.query(
      `UPDATE public.hse_inspections
          SET prohibition_lifted_at = clock_timestamp(),
              summary = coalesce(summary || E'\n', '') || '[zabrana podignuta] ' || $3,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2 AND result = 'PROHIBITION' AND prohibition_lifted_at IS NULL`,
      [actor.companyId, inspectionId, note.trim()],
    );
    if (updated.rowCount === 0) {
      return {
        outcome: "CONFLICT",
        code: "SERVICE_INVALID_STATUS",
        message: "Nalaz ne postoji ili zabrana nije aktivna.",
      } as HseOutcome;
    }
    return { outcome: "OK", id: inspectionId };
  });
}

/* ------------------------------------------------------------------ obuke */

export type TrainingInput = {
  /** Klijentski id (offline toolbox). */
  id?: string;
  kind: "INDUCTION" | "TOOLBOX" | "TASK_INSTRUCTION" | "CERTIFICATION" | "DRILL";
  title: string;
  topic?: string | null;
  heldAt: string;
  projectId?: string | null;
  location?: string | null;
  durationMinutes?: number | null;
  heldByWorkerId?: string | null;
  attendees: { workerId: string; signatureName: string; signedAt: string }[];
  clientLocalId?: string | null;
  /** Za `CERTIFICATION`: obaveza (Modul 2) koja se obnavlja ovom obukom. */
  renewObligationId?: string | null;
};

/**
 * Evidencija održane obuke.
 *
 * Prisustvo je POTPIS (§1.4/19): `signature_name` + `signed_at` po radniku. Provjera je u domeni
 * (`validToolboxInput` za toolbox), pa telefon i web ne mogu poslati različito „ispravno“.
 */
export async function createTraining(pool: Pool, actor: DiaryActor, input: TrainingInput): Promise<HseOutcome> {
  return withCompany(pool, toCompanyId(actor.companyId), (client) => createTrainingTx(client, actor, input));
}

/** Isto kao `createTraining`, unutar transakcije pozivaoca (sync). */
export async function createTrainingTx(
  client: PoolClient,
  actor: DiaryActor,
  input: TrainingInput,
): Promise<HseOutcome> {
  if (input.kind === "TOOLBOX") {
    if (!validToolboxInput({ topic: input.topic ?? input.title, attendees: input.attendees.map((a) => a.workerId), durationMinutes: input.durationMinutes })) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "VALIDATION_FAILED",
        message: "Toolbox traži temu (bar 3 znaka), bar jednog prisutnog bez duplikata i trajanje do 600 minuta.",
      };
    }
  }
  if (input.attendees.length === 0) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Obuka bez prisutnih ne dokazuje ništa." };
  }
  {
    if (input.clientLocalId) {
      const duplicate = await client.query<{ id: string }>(
        "SELECT id FROM public.hse_trainings WHERE company_id = $1 AND client_local_id = $2",
        [actor.companyId, input.clientLocalId],
      );
      if (duplicate.rows[0]) {
        return { outcome: "CONFLICT", code: "HSE_TRAINING_DUPLICATE", message: "Ta obuka je već evidentirana." } as HseOutcome;
      }
    }
    const workerIds = input.attendees.map((attendee) => attendee.workerId);
    const workers = await client.query<{ id: string }>(
      "SELECT id FROM public.workers WHERE company_id = $1 AND id = ANY($2::text[])",
      [actor.companyId, workerIds],
    );
    if (workers.rowCount !== new Set(workerIds).size) {
      return {
        outcome: "NOT_FOUND",
        code: "NOT_FOUND",
        message: "Neki od prisutnih radnika ne postoje u firmi.",
      } as HseOutcome;
    }

    const trainingId = input.id ?? id("hst");
    await client.query(
      `INSERT INTO public.hse_trainings
         (id, company_id, project_id, kind, title, topic, held_at, held_by_worker_id, held_by_user_id,
          location, duration_minutes, client_local_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13)`,
      [
        trainingId, actor.companyId, input.projectId ?? null, input.kind, input.title.trim(),
        input.topic?.trim() ?? null, input.heldAt, input.heldByWorkerId ?? null, actor.userId,
        input.location?.trim() ?? null, input.durationMinutes ?? null, input.clientLocalId ?? null, actor.userId,
      ],
    );
    for (const attendee of input.attendees) {
      await client.query(
        `INSERT INTO public.hse_training_attendees (id, company_id, training_id, worker_id, signature_name, signed_at)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz)`,
        [id("hta"), actor.companyId, trainingId, attendee.workerId, attendee.signatureName.trim(), attendee.signedAt],
      );
    }

    /* Certifikacijska obuka obnavlja obavezu iz Modula 2 (§1.4/21) — samo ona i samo uz prisutne. */
    let renewed = false;
    if (input.renewObligationId && trainingCanRenewCertificate(input.kind, input.attendees.length)) {
      const obligation = await client.query<{ id: string }>(
        `UPDATE public.obligations
            SET reviewed_at = clock_timestamp(), reviewed_by = $3, review_state = 'reviewed',
                updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2
          RETURNING id`,
        [actor.companyId, input.renewObligationId, actor.userId],
      );
      renewed = Boolean(obligation.rows[0]);
      if (renewed) {
        await writeAudit(client, {
          companyId: actor.companyId,
          actorId: actor.userId,
          actorEmail: null,
          action: "hse.certificate_renewed",
          entityType: "obligation",
          entityId: input.renewObligationId!,
          metadata: { trainingId },
          retentionClass: "ACCESS",
        });
      }
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "hse.training_created",
      entityType: "hse_training",
      entityId: trainingId,
      metadata: { kind: input.kind, attendees: input.attendees.length, renewed,
        signatures: input.attendees.map(({ workerId, signedAt }) => ({ workerId, signedAt })) },
      retentionClass: "ACCESS",
    });
    return { outcome: "OK", id: trainingId };
  }
}

/* ------------------------------------------------------------------ čitanje i statistika */

export type IncidentListItem = {
  id: string;
  kind: string;
  severity: string;
  status: string;
  occurredAt: string;
  projectId: string | null;
  projectName: string | null;
  description: string;
  lostDays: number;
  reportableToAuthority: boolean;
  reportObligationId: string | null;
  openActions: number;
  overdueActions: number;
};

export async function listIncidents(
  pool: Pool,
  actor: DiaryActor,
  filter: { status?: string; kind?: string; projectId?: string; limit?: number } = {},
): Promise<IncidentListItem[]> {
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const today = await companyToday(client, toCompanyId(actor.companyId));
    const conditions = ["i.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`i.status = $${params.length}`);
    }
    if (filter.kind) {
      params.push(filter.kind);
      conditions.push(`i.kind = $${params.length}`);
    }
    if (filter.projectId) {
      params.push(filter.projectId);
      conditions.push(`i.project_id = $${params.length}`);
    }
    params.push(today);
    const todayParam = params.length;
    params.push(Math.min(Math.max(filter.limit ?? 200, 1), 500));
    const result = await client.query<{
      id: string; kind: string; severity: string; status: string; occurred_at: string;
      project_id: string | null; project_name: string | null; description: string; lost_days: number;
      reportable_to_authority: boolean; report_obligation_id: string | null;
      open_actions: string; overdue_actions: string;
    }>(
      `SELECT i.id, i.kind, i.severity, i.status, i.occurred_at::text, i.project_id,
              p.name AS project_name, i.description, i.lost_days, i.reportable_to_authority,
              i.report_obligation_id,
              (SELECT count(*)::text FROM public.hse_actions a
                WHERE a.company_id = i.company_id AND a.incident_id = i.id AND a.status = 'OPEN') AS open_actions,
              (SELECT count(*)::text FROM public.hse_actions a
                WHERE a.company_id = i.company_id AND a.incident_id = i.id
                  AND a.status = 'OPEN' AND a.due_on < $${todayParam}::date) AS overdue_actions
         FROM public.hse_incidents i
         LEFT JOIN public.projects p ON p.company_id = i.company_id AND p.id = i.project_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY (i.status <> 'CLOSED') DESC, i.occurred_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      status: row.status,
      occurredAt: row.occurred_at,
      projectId: row.project_id,
      projectName: row.project_name,
      description: row.description,
      lostDays: row.lost_days,
      reportableToAuthority: row.reportable_to_authority,
      reportObligationId: row.report_obligation_id,
      openActions: Number(row.open_actions),
      overdueActions: Number(row.overdue_actions),
    }));
  });
}

export type HseStats = {
  from: string;
  to: string;
  workedHours: number;
  incidents: number;
  bySeverity: Record<string, number>;
  byKind: Record<string, number>;
  nearMisses: number;
  lostDays: number;
  ltifr: number | null;
  actions: { open: number; overdue: number; onTimeRate: number | null };
  trainings: { count: number; toolbox: number; attendees: number };
  /** Zabrana rada koja još traje; `null` kad je nema. */
  activeProhibition: { id: string; inspectedAt: string; authorityName: string | null } | null;
};

/**
 * Statistika za period. Sati dolaze iz Modula 3 (`work_entries`), ne iz broja radnika — LTIFR je
 * stopa na odrađene sate, pa imenilac mora biti stvarni rad, a ne glave.
 */
export async function hseStats(
  pool: Pool,
  actor: DiaryActor,
  filter: { from: string; to: string; projectId?: string },
): Promise<HseStats> {
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const today = await companyToday(client, toCompanyId(actor.companyId));
    const hoursResult = await client.query<{ minutes: string }>(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (coalesce(we.ended_at, we.started_at) - we.started_at)) / 60), 0)::text AS minutes
         FROM public.work_entries we
        WHERE we.company_id = $1
          AND we.kind = 'WORK'
          AND we.resolution_state = 'ACTIVE'
          AND ($4::text IS NULL OR we.project_id = $4)
          AND (we.started_at AT TIME ZONE (SELECT timezone FROM public.companies WHERE id = $1))::date BETWEEN $2::date AND $3::date`,
      [actor.companyId, filter.from, filter.to, filter.projectId ?? null],
    );
    const workedHours = Math.round((Number(hoursResult.rows[0]?.minutes ?? 0) / 60) * 100) / 100;

    const incidentRows = await client.query<{
      kind: string; severity: string; lost_days: number; occurred_at: string; status: string;
    }>(
      `SELECT kind, severity, lost_days, occurred_at::text, status
         FROM public.hse_incidents
        WHERE company_id = $1
          AND ($2::text IS NULL OR project_id = $2)
          AND (occurred_at AT TIME ZONE (SELECT timezone FROM public.companies WHERE id = $1))::date BETWEEN $3::date AND $4::date`,
      [actor.companyId, filter.projectId ?? null, filter.from, filter.to],
    );
    const incidents: HseIncidentRow[] = incidentRows.rows.map((row) => ({
      kind: row.kind as HseIncidentRow["kind"],
      severity: row.severity as HseIncidentRow["severity"],
      lostDays: row.lost_days,
      occurredAt: row.occurred_at,
      status: row.status as HseIncidentRow["status"],
    }));

    const actionRows = await client.query<{ status: HseActionRow["status"]; due_on: string; done_at: string | null }>(
      `SELECT status, due_on::text, done_at::text FROM public.hse_actions
        WHERE company_id = $1 AND due_on BETWEEN $2::date AND $3::date`,
      [actor.companyId, filter.from, filter.to],
    );
    const actions: HseActionRow[] = actionRows.rows.map((row) => ({
      status: row.status,
      dueOn: row.due_on,
      doneOn: row.done_at,
    }));

    const trainingRows = await client.query<{ trainings: string; toolbox: string; attendees: string }>(
      `SELECT count(DISTINCT t.id)::text AS trainings,
              count(DISTINCT t.id) FILTER (WHERE t.kind = 'TOOLBOX')::text AS toolbox,
              (SELECT count(*)::text FROM public.hse_training_attendees a
                 JOIN public.hse_trainings tt ON tt.company_id = a.company_id AND tt.id = a.training_id
                WHERE a.company_id = $1 AND tt.held_at::date BETWEEN $2::date AND $3::date) AS attendees
         FROM public.hse_trainings t
        WHERE t.company_id = $1 AND t.held_at::date BETWEEN $2::date AND $3::date`,
      [actor.companyId, filter.from, filter.to],
    );

    const prohibition = await client.query<{
      id: string; inspected_at: string; authority_name: string | null; result: string; lifted: string | null;
    }>(
      `SELECT id, inspected_at::text, authority_name, result, prohibition_lifted_at::text AS lifted
         FROM public.hse_inspections
        WHERE company_id = $1 AND result = 'PROHIBITION' AND prohibition_lifted_at IS NULL
        ORDER BY inspected_at DESC LIMIT 1`,
      [actor.companyId],
    );
    const activeProhibition = prohibition.rows[0] && isActiveProhibition({
      result: prohibition.rows[0].result,
      prohibitionLiftedAt: prohibition.rows[0].lifted,
    })
      ? {
        id: prohibition.rows[0].id,
        inspectedAt: prohibition.rows[0].inspected_at,
        authorityName: prohibition.rows[0].authority_name,
      }
      : null;

    const bySeverity: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const incident of incidents) {
      bySeverity[incident.severity] = (bySeverity[incident.severity] ?? 0) + 1;
      byKind[incident.kind] = (byKind[incident.kind] ?? 0) + 1;
    }

    return {
      from: filter.from,
      to: filter.to,
      workedHours,
      incidents: incidents.length,
      bySeverity,
      byKind,
      nearMisses: nearMissCount(incidents),
      lostDays: totalLostDays(incidents),
      ltifr: ltifr(incidents, workedHours),
      actions: {
        open: actions.filter((action) => action.status === "OPEN").length,
        overdue: actions.filter((action) => hseActionIsOverdue(action, today)).length,
        onTimeRate: hseOnTimeRate(actions),
      },
      trainings: {
        count: Number(trainingRows.rows[0]?.trainings ?? 0),
        toolbox: Number(trainingRows.rows[0]?.toolbox ?? 0),
        attendees: Number(trainingRows.rows[0]?.attendees ?? 0),
      },
      activeProhibition,
    };
  });
}

/**
 * „Šta traži pažnju“ za Pregled (spec §4): mjere koje kasne, otvoreni incidenti, aktivna zabrana
 * rada i dnevnik bez potpisa stariji od 2 dana. Vraća `null` bez `hse.view` — prazna kartica bi
 * tvrdila da problema nema.
 */
export type HseAttention = {
  overdueActions: number;
  openIncidents: number;
  prohibition: { id: string; inspectedAt: string; authorityName: string | null } | null;
  unsignedDiaries: number;
};

export async function hseAttention(
  client: PoolClient,
  actor: { userId: string; companyId: string; roles: readonly string[] },
): Promise<HseAttention | null> {
  const today = await companyToday(client, toCompanyId(actor.companyId));
  const counts = await client.query<{ overdue: string; open_incidents: string; unsigned: string }>(
    `SELECT
        (SELECT count(*)::text FROM public.hse_actions a
          WHERE a.company_id = $1 AND a.status = 'OPEN' AND a.due_on < $2::date) AS overdue,
        (SELECT count(*)::text FROM public.hse_incidents i
          WHERE i.company_id = $1 AND i.status <> 'CLOSED') AS open_incidents,
        (SELECT count(*)::text FROM public.site_diaries d
          WHERE d.company_id = $1 AND d.status = 'DRAFT' AND d.diary_date <= $2::date - INTERVAL '2 days') AS unsigned`,
    [actor.companyId, today],
  );
  const prohibition = await client.query<{ id: string; inspected_at: string; authority_name: string | null }>(
    `SELECT id, inspected_at::text, authority_name FROM public.hse_inspections
      WHERE company_id = $1 AND result = 'PROHIBITION' AND prohibition_lifted_at IS NULL
      ORDER BY inspected_at DESC LIMIT 1`,
    [actor.companyId],
  );
  const row = counts.rows[0];
  return {
    overdueActions: Number(row?.overdue ?? 0),
    openIncidents: Number(row?.open_incidents ?? 0),
    prohibition: prohibition.rows[0]
      ? {
        id: prohibition.rows[0].id,
        inspectedAt: prohibition.rows[0].inspected_at,
        authorityName: prohibition.rows[0].authority_name,
      }
      : null,
    unsignedDiaries: Number(row?.unsigned ?? 0),
  };
}

/** Detalj incidenta: zaglavlje, dopune, istraga, mjere, prilozi. */
export async function getIncident(pool: Pool, actor: DiaryActor, incidentId: string) {
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const today = await companyToday(client, toCompanyId(actor.companyId));
    const header = await client.query<Record<string, never> & {
      id: string; company_id: string; project_id: string | null; project_name: string | null;
      kind: HseIncidentKind; severity: HseSeverity; status: HseIncidentRow["status"];
      occurred_at: string; location_text: string | null;
      lat: string | null; lng: string | null; description: string; immediate_action: string | null;
      reporter_worker_id: string | null; reporter_name: string | null; injured_worker_id: string | null;
      injured_name: string | null; lost_days: number; reportable_to_authority: boolean;
      report_obligation_id: string | null; authority_reported_at: string | null;
      closed_at: string | null; created_at: string;
    }>(
      `SELECT i.id, i.company_id, i.project_id, p.name AS project_name, i.kind, i.severity, i.status,
              i.occurred_at::text, i.location_text, i.lat::text, i.lng::text, i.description,
              i.immediate_action, i.reporter_worker_id,
              btrim(rw.first_name || ' ' || coalesce(rw.last_name, '')) AS reporter_name,
              i.injured_worker_id,
              btrim(iw.first_name || ' ' || coalesce(iw.last_name, '')) AS injured_name,
              i.lost_days, i.reportable_to_authority, i.report_obligation_id,
              i.authority_reported_at::text, i.closed_at::text, i.created_at::text
         FROM public.hse_incidents i
         LEFT JOIN public.projects p ON p.company_id = i.company_id AND p.id = i.project_id
         LEFT JOIN public.workers rw ON rw.company_id = i.company_id AND rw.id = i.reporter_worker_id
         LEFT JOIN public.workers iw ON iw.company_id = i.company_id AND iw.id = i.injured_worker_id
        WHERE i.company_id = $1 AND i.id = $2`,
      [actor.companyId, incidentId],
    );
    const row = header.rows[0];
    if (!row) return null;

    const participants = await client.query<{ worker_id: string; name: string; injured: boolean }>(
      `SELECT p.worker_id, btrim(w.first_name || ' ' || coalesce(w.last_name, '')) AS name, p.injured
         FROM public.hse_incident_workers p JOIN public.workers w ON w.company_id = p.company_id AND w.id = p.worker_id
        WHERE p.company_id = $1 AND p.incident_id = $2 ORDER BY name, p.worker_id`,
      [actor.companyId, incidentId],
    );
    const updates = await client.query<{ id: string; body: string; author_name: string; created_at: string }>(
      `SELECT u.id, u.body, coalesce(btrim(w.first_name || ' ' || coalesce(w.last_name, '')), 'sistem') AS author_name,
              u.created_at::text
         FROM public.hse_incident_updates u
         LEFT JOIN public.workers w ON w.company_id = u.company_id AND w.id = u.author_worker_id
        WHERE u.company_id = $1 AND u.incident_id = $2
        ORDER BY u.created_at`,
      [actor.companyId, incidentId],
    );
    const investigation = await client.query<{
      id: string; root_cause: string; method: string; findings: string | null; completed_at: string | null;
    }>(
      "SELECT id, root_cause, method, findings, completed_at::text FROM public.hse_investigations WHERE company_id = $1 AND incident_id = $2",
      [actor.companyId, incidentId],
    );
    const actions = await client.query<{
      id: string; description: string; due_on: string; status: HseActionRow["status"];
      done_at: string | null; responsible_name: string | null;
    }>(
      `SELECT a.id, a.description, a.due_on::text, a.status, a.done_at::text,
              btrim(w.first_name || ' ' || coalesce(w.last_name, '')) AS responsible_name
         FROM public.hse_actions a
         LEFT JOIN public.workers w ON w.company_id = a.company_id AND w.id = a.responsible_worker_id
        WHERE a.company_id = $1 AND a.incident_id = $2
        ORDER BY a.due_on`,
      [actor.companyId, incidentId],
    );
    const attachments = await client.query<{ id: string; file_name: string; content_type: string; status: string; sha256: string }>(
      "SELECT id, file_name, content_type, status, sha256 FROM public.hse_attachments WHERE company_id = $1 AND entity_type = 'INCIDENT' AND entity_id = $2",
      [actor.companyId, incidentId],
    );

    return {
      incident: {
        id: row.id,
        projectId: row.project_id,
        projectName: row.project_name,
        kind: row.kind,
        severity: row.severity,
        status: row.status,
        occurredAt: row.occurred_at,
        locationText: row.location_text,
        lat: row.lat,
        lng: row.lng,
        description: row.description,
        immediateAction: row.immediate_action,
        reporterWorkerId: row.reporter_worker_id,
        reporterName: row.reporter_name,
        injuredWorkerId: row.injured_worker_id,
        injuredName: row.injured_name,
        lostDays: row.lost_days,
        reportableToAuthority: row.reportable_to_authority,
        reportObligationId: row.report_obligation_id,
        authorityReportedAt: row.authority_reported_at,
        closedAt: row.closed_at,
        createdAt: row.created_at,
      },
      involvedWorkers: participants.rows.map((participant) => ({ workerId: participant.worker_id, name: participant.name, injured: participant.injured })),
      updates: updates.rows.map((update) => ({
        id: update.id, body: update.body, authorName: update.author_name, createdAt: update.created_at,
      })),
      investigation: investigation.rows[0]
        ? {
          id: investigation.rows[0].id,
          rootCause: investigation.rows[0].root_cause,
          method: investigation.rows[0].method,
          findings: investigation.rows[0].findings,
          completedAt: investigation.rows[0].completed_at,
        }
        : null,
      actions: actions.rows.map((action) => ({
        id: action.id,
        description: action.description,
        dueOn: action.due_on,
        status: action.status,
        doneOn: action.done_at,
        responsibleName: action.responsible_name,
        overdue: hseActionIsOverdue(
          { status: action.status as HseActionRow["status"], dueOn: action.due_on, doneOn: action.done_at },
          today,
        ),
      })),
      attachments: attachments.rows,
      needsReportObligation: needsHseReportObligation({
        reportableToAuthority: row.reportable_to_authority,
        reportObligationId: row.report_obligation_id,
      }),
    };
  });
}
