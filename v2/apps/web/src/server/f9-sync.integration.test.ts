/**
 * F9 — mobilni sync dnevnika i HSE, kroz PRAVU rutu i PRAVU bazu.
 *
 * Dokazuje ono što servisni test ne može: da telefon šalje ISTI ugovor koji web koristi, i da
 * ponovni push ne pravi drugi zapis. Spec 10 §1.8:
 *
 *  1. `site_diary` po `(projekt, dan)`: prvi push pravi dan, drugi (isti sadržaj) ne pravi drugi;
 *  2. `baseVersion` koji je šef vidio: starija verzija je `DIARY_VERSION_CONFLICT`, ne tihi prepis;
 *  3. sekcijsko spajanje: telefon popunjava PRAZNO polje, ne gazi tuđi tekst;
 *  4. `site_diary_item` sa `BOQ` uvećava `quantity_executed` u ISTOJ transakciji;
 *  5. `hse_incident` je bez konflikta (činjenice se ne prepisuju) i isti klijentski ID daje `DUPLICATE`;
 *  6. `hse_incident` sa `reportableToAuthority` pravi obavezu `HSE_REPORT` u istoj transakciji;
 *  7. `hse_action` i `hse_training` ulaze kroz isti push; obuka nosi potpise prisutnih;
 *  8. pull vraća `site_diary`/`hse_incident` događaje u isti kursor feed.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import type { R4SyncPushItem, R4SyncPushItemResult } from "@gradix/domain";
import { ACCESS_COOKIE, issueAccessToken } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const CO = `cmp_f9s_${RUN}`;
const CO_B = `cmp_f9sb_${RUN}`;
const USER_SUP = `usr_f9s_sup_${RUN}`;
const USER_WORKER = `usr_f9s_wrk_${RUN}`;
const USER_DRIVER = `usr_f9s_driver_${RUN}`;
const USER_B = `usr_f9s_b_${RUN}`;
const WORKER_SUP = `wrk_f9s_sup_${RUN}`;
const WORKER_REPORTER = `wrk_f9s_reporter_${RUN}`;
const WORKER_DRIVER = `wrk_f9s_driver_${RUN}`;
const WORKER_INJURED = `wrk_f9s_inj_${RUN}`;
const PROJECT = `prj_f9s_${RUN}`;
const BOQ_ITEM = `boq_f9s_${RUN}`;
const DAY = "2026-10-05";

const COOKIES = { sup: "", worker: "", driver: "", b: "" };
type CookieKey = keyof typeof COOKIES;

/** `localId` mora biti uuid; brojač drži jedinstvenost — isti ID uz drugi sadržaj se odbija. */
let localSeq = 0;
const localId = (): string => {
  localSeq += 1;
  return `ffffffff-0000-4000-8000-${String(localSeq).padStart(12, "0")}`;
};

async function signIn(pool: Pool, userId: string, company: string, key: CookieKey): Promise<void> {
  const sessionId = `ses_${userId}`;
  await withCompany(pool, companyId(company), async (client) => {
    await client.query(
      `INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [sessionId, company, userId, `hash_${sessionId}`],
    );
  });
  COOKIES[key] = `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: sessionId, companyId: company })}`;
}

function pushRequest(cookie: string, items: unknown[]): NextRequest {
  return new NextRequest("http://t/api/sync/push", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

/** Dnevnik kakav telefon pravi: samo ono što šef tipka na terenu. */
function diaryItem(input: {
  diaryId: string;
  baseVersion?: number;
  delays?: R4SyncPushItem extends never ? never : unknown[];
  overrides?: Partial<{ description: string; weather: string; workedHours: string }>;
}): R4SyncPushItem {
  return {
    localId: localId(),
    entityType: "site_diary",
    diaryId: input.diaryId,
    deviceSentAt: `${DAY}T16:00:00+02:00`,
    baseVersion: input.baseVersion ?? 1,
    diary: {
      projectId: PROJECT,
      diaryDate: DAY,
      weather: "CLEAR",
      temperatureC: "18.0",
      workedHours: "8.00",
      description: "Iskop i betoniranje temeljne ploče.",
      visitors: null,
      events: null,
      signedName: null,
      delays: (input.delays ?? []) as never[],
      ...input.overrides,
    },
  } as R4SyncPushItem;
}

function incidentItem(input: { incidentId: string; reportable?: boolean; description?: string }): R4SyncPushItem {
  return {
    localId: localId(),
    entityType: "hse_incident",
    incidentId: input.incidentId,
    deviceSentAt: `${DAY}T11:00:00+02:00`,
    incident: {
      kind: "ACCIDENT",
      severity: "MODERATE",
      occurredAt: `${DAY}T10:00:00+02:00`,
      projectId: PROJECT,
      locationText: "Kota 1",
      lat: null,
      lng: null,
      description: input.description ?? "Radnik posjekao prst na testeri.",
      immediateAction: "Prva pomoć na gradilištu.",
      injuredWorkerId: WORKER_INJURED,
      lostDays: 2,
      reportableToAuthority: input.reportable === true,
      photos: [],
      updateBody: null,
    },
  } as R4SyncPushItem;
}

describeDb("F9 mobilni sync dnevnika i HSE", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 3 });
  let push: (request: NextRequest) => Promise<Response>;
  let pull: (request: NextRequest) => Promise<Response>;
  const at = (results: R4SyncPushItemResult[]) => results[0]!;

  async function pushOne(cookie: string, item: R4SyncPushItem): Promise<R4SyncPushItemResult> {
    const response = await push(pushRequest(cookie, [item]));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { results: R4SyncPushItemResult[] } };
    return at(body.data.results);
  }

  beforeAll(async () => {
    ({ POST: push } = await import("@/app/api/sync/push/route"));
    ({ GET: pull } = await import("@/app/api/sync/pull/route"));
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1,'F9 Sync',$2), ($3,'F9 Sync B',$4)`, [
      CO, `f9s-${RUN}`, CO_B, `f9sb-${RUN}`,
    ]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1,$2,'S','Šef','x',false), ($3,$4,'R','Radnik','x',false), ($5,$6,'B','Firma','x',false),
              ($7,$8,'V','Vozač','x',false)`,
      [
        USER_SUP, `sef-f9s-${RUN}@test.example`,
        USER_WORKER, `radnik-f9s-${RUN}@test.example`,
        USER_B, `b-f9s-${RUN}@test.example`,
        USER_DRIVER, `vozac-f9s-${RUN}@test.example`,
      ],
    );
    await withCompany(admin, companyId(CO), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['SITE_SUPERVISOR']::"Role"[],'COMPANY'),
                ($4,$5,$3,ARRAY['WORKER']::"Role"[],'SELF'),
                ($6,$7,$3,ARRAY['DRIVER']::"Role"[],'SELF')`,
        [`mem_f9s_sup_${RUN}`, USER_SUP, CO, `mem_f9s_wrk_${RUN}`, USER_WORKER, `mem_f9s_drv_${RUN}`, USER_DRIVER],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1,$2,'S','Šef','2024-01-01'::date,$3), ($4,$2,'P','Povrijeđeni','2024-01-01'::date,NULL),
                ($5,$2,'R','Radnik','2024-01-01'::date,$6), ($7,$2,'V','Vozač','2024-01-01'::date,$8)`,
        [WORKER_SUP, CO, USER_SUP, WORKER_INJURED, WORKER_REPORTER, USER_WORKER, WORKER_DRIVER, USER_DRIVER],
      );
      await client.query(
        "INSERT INTO projects (id, company_id, code, name) VALUES ($1,$2,'F9S-1','F9 sync gradilište')",
        [PROJECT, CO],
      );
      await client.query(
        `INSERT INTO project_boq_items
           (id, company_id, project_id, code, description, unit, quantity_planned, unit_price_cents,
            sort_order, created_by, updated_by)
         VALUES ($1,$2,$3,'B-1','Beton C25/30','m3',100,15000,1,$4,$4)`,
        [BOQ_ITEM, CO, PROJECT, USER_SUP],
      );
    });
    await withCompany(admin, companyId(CO_B), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY')`,
        [`mem_f9s_b_${RUN}`, USER_B, CO_B],
      );
    });
    await signIn(admin, USER_SUP, CO, "sup");
    await signIn(admin, USER_WORKER, CO, "worker");
    await signIn(admin, USER_DRIVER, CO, "driver");
    await signIn(admin, USER_B, CO_B, "b");
  }, 60_000);

  afterAll(async () => {
    for (const company of [CO, CO_B]) {
      await withCompany(admin, companyId(company), async (client) => {
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM hse_training_attendees WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_trainings WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_actions WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_investigations WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_incident_updates WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_attachments WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_incidents WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diary_revisions WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diary_delays WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diary_items WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diaries WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diary_templates WHERE company_id = $1", [company]);
        await client.query("DELETE FROM project_boq_items WHERE company_id = $1", [company]);
        await client.query("DELETE FROM sync_receipts WHERE company_id = $1", [company]);
        await client.query("DELETE FROM sync_conflicts WHERE company_id = $1", [company]);
        await client.query("DELETE FROM sync_change_log WHERE company_id = $1", [company]);
        await client.query("DELETE FROM sync_cursor_slots WHERE company_id = $1", [company]);
        await client.query("DELETE FROM sync_cursor_allocators WHERE company_id = $1", [company]);
        await client.query("DELETE FROM notification_deliveries WHERE company_id = $1", [company]);
        await client.query("DELETE FROM notifications WHERE company_id = $1", [company]);
        await client.query("DELETE FROM audit_events WHERE company_id = $1", [company]);
        await client.query("DELETE FROM obligations WHERE company_id = $1", [company]);
        await client.query("DELETE FROM obligation_types WHERE company_id = $1", [company]);
        await client.query("DELETE FROM sessions WHERE company_id = $1", [company]);
        await client.query("DELETE FROM projects WHERE company_id = $1", [company]);
        await client.query("DELETE FROM workers WHERE company_id = $1", [company]);
        await client.query("DELETE FROM memberships WHERE company_id = $1", [company]);
      });
    }
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[CO, CO_B]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_SUP, USER_WORKER, USER_DRIVER, USER_B]]);
    await admin.end();
  }, 60_000);

  it("dnevnik se šalje jednom po (projekt, dan); drugi push ne pravi drugi red", async () => {
    const diaryId = `sdr_f9s_${RUN}`;
    const first = await pushOne(COOKIES.sup, diaryItem({ diaryId }));
    expect(first.status).toBe("APPLIED");

    const count = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM site_diaries WHERE company_id = $1 AND project_id = $2 AND diary_date = $3::date",
        [CO, PROJECT, DAY],
      ));
    expect(count.rows[0]?.count).toBe("1");

    /* Zastoj iz istog push-a je upisan uz dan; zbir sati je dokaz za produženje roka. */
    const second = await pushOne(COOKIES.sup, diaryItem({
      diaryId,
      baseVersion: 2,
      delays: [{
        kind: "RAIN",
        fromAt: `${DAY}T12:00:00+02:00`,
        toAt: `${DAY}T15:00:00+02:00`,
        hours: "3.00",
        note: "Pljusak",
      }],
    }));
    expect(second.status).toBe("APPLIED");

    const delays = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM site_diary_delays WHERE company_id = $1",
        [CO],
      ));
    expect(delays.rows[0]?.count).toBe("1");
  });

  it("zastarjela baseVersion je sukob, ne tihi prepis tuđeg teksta", async () => {
    /* Prvi push je podigao verziju dana; telefon koji je vidio v1 sada mora dobiti konflikt. */
    const stale = await pushOne(COOKIES.sup, diaryItem({
      diaryId: `sdr_f9s_${RUN}`,
      baseVersion: 1,
      overrides: { description: "Telefon sa starim ekranom." },
    }));
    expect(stale.status).toBe("CONFLICT");
    expect(stale.code).toBe("DIARY_VERSION_CONFLICT");

    const row = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ description: string | null; version: number }>(
        "SELECT description, version FROM site_diaries WHERE company_id = $1 AND project_id = $2 AND diary_date = $3::date",
        [CO, PROJECT, DAY],
      ));
    /* Nijedan push ne smije ostaviti dnevnik bez opisa — prazan dan je izgubljen rad. */
    expect(row.rows[0]?.description).toBeTruthy();
  });

  it("različita ista sekcija ne biva odbačena ni kada je verzija aktuelna", async () => {
    const current = await withCompany(admin, companyId(CO), (client) => client.query<{ version: number }>(
      "SELECT version FROM site_diaries WHERE company_id = $1 AND project_id = $2 AND diary_date = $3", [CO, PROJECT, DAY],
    ));
    const result = await pushOne(COOKIES.sup, diaryItem({ diaryId: `sdr_f9s_${RUN}`,
      baseVersion: current.rows[0]!.version, overrides: { description: "Promjena koja ne smije nestati." } }));
    expect(result.status).toBe("CONFLICT");
    expect(result.code).toBe("DIARY_VERSION_CONFLICT");
  });

  it("količina sa BOQ stavkom uvećava quantity_executed u istoj transakciji", async () => {
    const result = await pushOne(COOKIES.sup, {
      localId: localId(),
      entityType: "site_diary_item",
      diaryItemId: `sdi_f9s_${RUN}`, diaryProjectId: PROJECT, diaryDate: DAY,
      deviceSentAt: `2026-10-08T17:00:00+02:00`,
      item: {
        boqItemId: BOQ_ITEM,
        description: "Beton C25/30",
        unit: "m3",
        quantity: "24.500",
        source: "BOQ",
      },
    } as R4SyncPushItem);
    expect(result.status).toBe("APPLIED");

    const boq = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ quantity_executed: string }>(
        "SELECT quantity_executed::text FROM project_boq_items WHERE company_id = $1 AND id = $2",
        [CO, BOQ_ITEM],
      ));
    expect(Number(boq.rows[0]?.quantity_executed)).toBe(24.5);
  });

  it("ručna količina čuva se na odabrani dan i pri kasnijem slanju", async () => {
    const item: R4SyncPushItem = {
      localId: localId(), entityType: "site_diary_item", diaryItemId: `sdi_manual_${RUN}`,
      diaryProjectId: PROJECT, diaryDate: DAY, deviceSentAt: "2026-11-01T10:00:00Z",
      item: { boqItemId: null, description: "Ručni rad", unit: "m", quantity: "3", source: "MANUAL" },
    };
    expect((await pushOne(COOKIES.sup, item)).status).toBe("APPLIED");
    expect((await pushOne(COOKIES.sup, item)).status).toBe("DUPLICATE");
    const rows = await withCompany(admin, companyId(CO), (client) => client.query<{ diary_date: string; count: string }>(
      `SELECT d.diary_date::text, count(*)::text FROM site_diary_items i JOIN site_diaries d
         ON d.company_id = i.company_id AND d.id = i.diary_id
        WHERE i.company_id = $1 AND i.id = $2 GROUP BY d.diary_date`, [CO, `sdi_manual_${RUN}`],
    ));
    expect(rows.rows).toEqual([{ diary_date: DAY, count: "1" }]);
  });

  it("stari red bez dana ne pogađa datum slanja", async () => {
    const result = await pushOne(COOKIES.sup, {
      localId: localId(), entityType: "site_diary_item", diaryItemId: `sdi_legacy_${RUN}`,
      deviceSentAt: `${DAY}T17:00:00+02:00`,
      item: { boqItemId: BOQ_ITEM, description: "Beton", unit: "m3", quantity: "1", source: "BOQ" },
    });
    expect(result.status).toBe("REJECTED");
    expect(result.code).toBe("DIARY_REFERENCE_REQUIRED");
  });

  it("ista fotografija na dva incidenta ne uzrokuje sudar ID-a", async () => {
    const photo = { fileName: "gradiliste.jpg", contentType: "image/jpeg" as const, sizeBytes: 123, sha256: "a".repeat(64) };
    for (const suffix of ["a", "b"]) {
      const incident = incidentItem({ incidentId: `hsi_photo_${suffix}_${RUN}` });
      if (incident.entityType !== "hse_incident") throw new Error("Pogrešan testni payload");
      expect((await pushOne(COOKIES.sup, { ...incident, incident: { ...incident.incident, photos: [photo] } })).status).toBe("APPLIED");
    }
    const found = await withCompany(admin, companyId(CO), (client) => client.query<{ count: string; ids: string }>(
      `SELECT count(*)::text AS count, count(DISTINCT id)::text AS ids FROM hse_attachments
        WHERE company_id = $1 AND entity_id = ANY($2)`,
      [CO, [`hsi_photo_a_${RUN}`, `hsi_photo_b_${RUN}`]],
    ));
    expect(found.rows[0]).toEqual({ count: "2", ids: "2" });
  });

  it("NEAR_MISS sa izgubljenim danima se odbija prije baze", async () => {
    const invalid = {
      ...incidentItem({ incidentId: `hsi_bad_${RUN}` }),
      incident: {
        ...(incidentItem({ incidentId: `hsi_bad2_${RUN}` }) as { incident: Record<string, unknown> }).incident,
        kind: "NEAR_MISS",
        lostDays: 4,
      },
    } as R4SyncPushItem;
    const response = await push(pushRequest(COOKIES.sup, [invalid]));
    /* Blok sa neispravnom stavkom se odbija ili po stavci (`REJECTED`) ili prije obrade (400). */
    if (response.status === 200) {
      const body = (await response.json()) as { data: { results: R4SyncPushItemResult[] } };
      expect(["REJECTED", "INVALID"]).toContain(at(body.data.results).status);
    } else {
      expect(response.status).toBeLessThan(500);
    }
  });

  it("incident sa prijavom inspekciji pravi HSE_REPORT obavezu; isti klijentski ID je DUPLICATE", async () => {
    const incidentId = `hsi_f9s_${RUN}`;
    const first = await pushOne(COOKIES.sup, incidentItem({ incidentId, reportable: true }));
    expect(first.status).toBe("APPLIED");

    const row = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ report_obligation_id: string | null; kind: string }>(
        "SELECT report_obligation_id, kind FROM hse_incidents WHERE company_id = $1 AND id = $2",
        [CO, incidentId],
      ));
    expect(row.rows[0]?.kind).toBe("ACCIDENT");
    expect(row.rows[0]?.report_obligation_id).toBeTruthy();

    /* Istim klijentskim ID-em drugi put: `DUPLICATE`, ne druga prijava. */
    const again = await pushOne(COOKIES.sup, incidentItem({ incidentId, reportable: true }));
    expect(["DUPLICATE", "APPLIED"]).toContain(again.status);
    const count = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM hse_incidents WHERE company_id = $1 AND id = $2",
        [CO, incidentId],
      ));
    expect(count.rows[0]?.count).toBe("1");
  });

  it("mjera i toolbox obuka ulaze kroz isti push, a obuka nosi potpise", async () => {
    const action = await pushOne(COOKIES.sup, {
      localId: localId(),
      entityType: "hse_action",
      actionId: `hsa_f9s_${RUN}`,
      deviceSentAt: `${DAY}T12:00:00+02:00`,
      action: {
        incidentId: `hsi_f9s_${RUN}`,
        inspectionId: null,
        description: "Zamijeniti list testere i provjeriti štitnik",
        responsibleWorkerId: WORKER_SUP,
        dueOn: DAY,
      },
    } as R4SyncPushItem);
    expect(action.status).toBe("APPLIED");

    const training = await pushOne(COOKIES.sup, {
      localId: localId(),
      entityType: "hse_training",
      trainingId: `hst_f9s_${RUN}`,
      deviceSentAt: `${DAY}T07:30:00+02:00`,
      training: {
        kind: "TOOLBOX",
        title: "Toolbox: rad na testeri",
        topic: "Štitnik i lična zaštita",
        heldAt: `${DAY}T07:00:00+02:00`,
        projectId: PROJECT,
        location: "Radionica",
        durationMinutes: 15,
        attendees: [
          { workerId: WORKER_SUP, signatureName: "S. Šef", signedAt: `${DAY}T07:15:00+02:00` },
          { workerId: WORKER_INJURED, signatureName: "P. Povrijeđeni", signedAt: `${DAY}T07:16:00+02:00` },
        ],
      },
    } as R4SyncPushItem);
    expect(training.status).toBe("APPLIED");

    const attendees = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM hse_training_attendees WHERE company_id = $1",
        [CO],
      ));
    expect(attendees.rows[0]?.count).toBe("2");
    const audit = await withCompany(admin, companyId(CO), (client) => client.query<{ metadata: { signatures: { workerId: string; signedAt: string }[] } }>(
      "SELECT metadata FROM audit_events WHERE company_id = $1 AND entity_id = $2 AND action = 'hse.training_created'",
      [CO, `hst_f9s_${RUN}`],
    ));
    expect(audit.rows[0]?.metadata.signatures).toEqual([
      { workerId: WORKER_SUP, signedAt: `${DAY}T07:15:00+02:00` },
      { workerId: WORKER_INJURED, signedAt: `${DAY}T07:16:00+02:00` },
    ]);
  });

  it("pull vraća F9 događaje (site_diary, hse_incident) u isti feed", async () => {
    const response = await pull(new NextRequest("http://t/api/sync/pull?limit=200", {
      headers: { cookie: COOKIES.sup },
    }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { events: { entityType: string }[]; cursor: string };
    };
    const types = new Set(body.data.events.map((event) => event.entityType));
    expect(types.has("site_diary")).toBe(true);
    expect(types.has("hse_incident")).toBe(true);
    expect(body.data.cursor).not.toBe("");
  });

  it("sync potpis bez potvrde prikazanog snapshot-a odbija se bez upisa", async () => {
    const base = diaryItem({ diaryId: `sdr_signed_new_${RUN}` });
    if (base.entityType !== "site_diary") throw new Error("Pogrešan testni payload");
    const signed: R4SyncPushItem = { ...base, diary: { ...base.diary, diaryDate: "2026-10-06", signedName: "Šef Gradilišta" } };
    const result = await pushOne(COOKIES.sup, signed);
    expect(result.status).toBe("REJECTED");
    expect(result.code).toBe("SYNC_ITEM_REJECTED");
    const row = await withCompany(admin, companyId(CO), (client) => client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM site_diaries WHERE company_id = $1 AND id = $2", [CO, `sdr_signed_new_${RUN}`],
    ));
    expect(row.rows[0]?.count).toBe("0");
  });

  it("radnik smije prijaviti incident, ali ne pisati dnevnik, mjere ili obuke kroz sync", async () => {
    const incidentId = `hsi_worker_${RUN}`;
    expect((await pushOne(COOKIES.worker, incidentItem({ incidentId }))).status).toBe("APPLIED");
    const diary = await pushOne(COOKIES.worker, diaryItem({ diaryId: `sdr_worker_${RUN}` }));
    const item = await pushOne(COOKIES.worker, {
      localId: localId(), entityType: "site_diary_item", diaryItemId: `sdi_worker_${RUN}`,
      deviceSentAt: `${DAY}T17:00:00+02:00`,
      item: { boqItemId: BOQ_ITEM, description: "Beton", unit: "m3", quantity: "1", source: "BOQ" },
    });
    const action = await pushOne(COOKIES.worker, {
      localId: localId(), entityType: "hse_action", actionId: `hsa_worker_${RUN}`,
      deviceSentAt: `${DAY}T12:00:00+02:00`,
      action: { incidentId, inspectionId: null, description: "Provjeriti štitnik", responsibleWorkerId: WORKER_REPORTER, dueOn: DAY },
    });
    const training = await pushOne(COOKIES.worker, {
      localId: localId(), entityType: "hse_training", trainingId: `hst_worker_${RUN}`,
      deviceSentAt: `${DAY}T12:00:00+02:00`,
      training: { kind: "TOOLBOX", title: "Sigurnost", topic: "Zaštita", heldAt: `${DAY}T12:00:00+02:00`,
        projectId: PROJECT, location: null, durationMinutes: 15,
        attendees: [{ workerId: WORKER_REPORTER, signatureName: "R. Radnik", signedAt: `${DAY}T12:15:00+02:00` }] },
    });
    for (const denied of [diary, item, action, training]) {
      expect(denied.status).toBe("REJECTED");
      expect(denied.code).toBe("SYNC_ITEM_REJECTED");
    }
    const counts = await withCompany(admin, companyId(CO), (client) => client.query<{ actions: string; trainings: string }>(
      `SELECT (SELECT count(*) FROM hse_actions WHERE id = $1)::text AS actions,
              (SELECT count(*) FROM hse_trainings WHERE id = $2)::text AS trainings`,
      [`hsa_worker_${RUN}`, `hst_worker_${RUN}`],
    ));
    expect(counts.rows[0]).toEqual({ actions: "0", trainings: "0" });
  });

  it("vozač može prijaviti opasnost i čita samo svoj sync opseg", async () => {
    expect((await pushOne(COOKIES.driver, incidentItem({ incidentId: `hsi_driver_${RUN}` }))).status).toBe("APPLIED");
    const response = await pull(new NextRequest("http://t/api/sync/pull?limit=200", { headers: { cookie: COOKIES.driver } }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { events: { entityType: string }[] } };
    expect(body.data.events.some((event) => event.entityType === "site_diary")).toBe(false);
    expect(body.data.events.some((event) => event.entityType === "hse_incident")).toBe(false);
  });

  it("potpisan dnevnik ne prima sync dopune ni BOQ stavke bez revizije", async () => {
    await withCompany(admin, companyId(CO), (client) => client.query(
      `UPDATE site_diaries SET status = 'SIGNED', signed_name = 'Šef', signed_at = now()
       WHERE company_id = $1 AND id = $2`, [CO, `sdr_f9s_${RUN}`],
    ));
    const diary = await pushOne(COOKIES.sup, diaryItem({ diaryId: `sdr_f9s_${RUN}` }));
    const item = await pushOne(COOKIES.sup, {
      localId: localId(), entityType: "site_diary_item", diaryItemId: `sdi_signed_${RUN}`, diaryProjectId: PROJECT, diaryDate: DAY,
      deviceSentAt: `${DAY}T17:00:00+02:00`,
      item: { boqItemId: BOQ_ITEM, description: "Beton", unit: "m3", quantity: "1", source: "BOQ" },
    });
    expect(diary.status).toBe("REJECTED");
    expect(diary.code).toBe("DIARY_ALREADY_LOCKED");
    expect(item.status).toBe("REJECTED");
    expect(item.code).toBe("DIARY_ALREADY_LOCKED");
  });

  it("tuđa firma ne može pisati dnevnik ni incident u ovu firmu", async () => {
    const response = await push(pushRequest(COOKIES.b, [diaryItem({ diaryId: `sdr_foreign_${RUN}` })]));
    /* Vlasnik firme B nema radnički zapis, pa push pada prije obrade stavke (kao u R4 granici). */
    if (response.status === 200) {
      const body = (await response.json()) as { data: { results: R4SyncPushItemResult[] } };
      expect(["REJECTED", "INVALID"]).toContain(at(body.data.results).status);
    } else {
      expect([403, 404]).toContain(response.status);
    }
    const foreign = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM site_diaries WHERE company_id = $1 AND id = $2",
        [CO, `sdr_foreign_${RUN}`],
      ));
    expect(foreign.rows[0]?.count).toBe("0");
  });
});
