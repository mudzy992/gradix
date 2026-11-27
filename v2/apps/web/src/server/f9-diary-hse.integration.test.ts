/**
 * F9 (Modul 10) — dnevnik građenja i HSE kroz PRAVE rute i PRAVU bazu.
 *
 * Testovi iz spec 10 koje ovaj fajl dokazuje:
 *   1. jedan dnevnik po `(projekt, dan)` — drugi POST vraća ISTI dan (`DIARY_EXISTS`), ne drugi red;
 *   2. nacrt se mijenja, ali POTPIS traži ime (`DIARY_SIGNATURE_REQUIRED`, 422) i zamrzava podatke;
 *   3. `LOCKED` odbija izmjenu i potpis; revizija traži razlog (`DIARY_REASON_REQUIRED`);
 *   4. količina ulazi u dnevnik, zastoj > 24 h se odbija, ispravan zastoj prolazi;
 *   5. incident: `NEAR_MISS` sa izgubljenim danima je odbijen; prijava bez teksta takođe;
 *   6. `reportableToAuthority` pravi obavezu `HSE_REPORT` u ISTOJ transakciji;
 *   7. dopuna je nova izjava — činjenice se ne daju prepisati (nema rute za to, triger brani);
 *   8. mjera bez odgovornog / bez roka je 422 sa svojim kodom; sa oba se otvara;
 *   9. zatvaranje traži završenu istragu i nijednu otvorenu mjeru;
 *  10. `PROHIBITION` zabrana rada: vidi se u `hseAttention`, podizanje traži razlog;
 *  11. statistika: `NEAR_MISS` odvojeno, LTIFR `null` bez sati (ne nula);
 *  12. izolacija: firma B ne vidi dnevnik ni incident firme A.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { issueAccessToken, ACCESS_COOKIE } from "./session";
import { GET as diariesGet, POST as diariesPost } from "@/app/api/site-diaries/route";
import { GET as diaryGet, PATCH as diaryPatch } from "@/app/api/site-diaries/[id]/route";
import { POST as signPost } from "@/app/api/site-diaries/[id]/sign/route";
import { POST as lockPost } from "@/app/api/site-diaries/[id]/lock/route";
import { POST as revisePost } from "@/app/api/site-diaries/[id]/revise/route";
import { POST as itemsPost } from "@/app/api/site-diaries/[id]/items/route";
import { DELETE as itemDelete } from "@/app/api/site-diaries/[id]/items/[itemId]/route";
import { GET as diaryPdf } from "@/app/api/site-diaries/[id]/pdf/route";
import { POST as delaysPost } from "@/app/api/site-diaries/[id]/delays/route";
import { GET as incidentsGet, POST as incidentsPost } from "@/app/api/hse/incidents/route";
import { GET as incidentGet } from "@/app/api/hse/incidents/[id]/route";
import { POST as closePost } from "@/app/api/hse/incidents/[id]/close/route";
import { PUT as investigationPut } from "@/app/api/hse/incidents/[id]/investigation/route";
import { POST as updatesPost } from "@/app/api/hse/incidents/[id]/updates/route";
import { POST as actionCreatePost } from "@/app/api/hse/actions/create/route";
import { PATCH as actionsPatch } from "@/app/api/hse/actions/route";
import { POST as inspectionsPost, PATCH as inspectionsPatch } from "@/app/api/hse/inspections/route";
import { GET as statsGet } from "@/app/api/hse/stats/route";
import { hseAttention } from "./hse-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const CO_A = `cmp_f9a_${RUN}`;
const CO_B = `cmp_f9b_${RUN}`;
const USER_OWNER = `usr_f9_own_${RUN}`;
const USER_SUP = `usr_f9_sup_${RUN}`;
const USER_WORKER = `usr_f9_wrk_${RUN}`;
const USER_B = `usr_f9_b_${RUN}`;
const WORKER_SUP = `wrk_f9_sup_${RUN}`;
const WORKER_INJURED = `wrk_f9_inj_${RUN}`;
const PROJECT = `prj_f9_${RUN}`;
const PROJECT_B = `prj_f9b_${RUN}`;

const COOKIES = { owner: "", sup: "", worker: "", b: "" };
type CookieKey = keyof typeof COOKIES;

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

function jsonRequest(url: string, cookie: string, body?: unknown, method = "POST"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type Json = { data?: Record<string, unknown>; error?: { code: string; message: string } };

async function bodyOf(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

const ctx = (diaryId: string) => ({ params: Promise.resolve({ id: diaryId }) });

describeDb("F9 dnevnik i HSE — integraciono", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 3 });

  /**
   * Otvara dan i vraća njegov ID. POST je idempotentan po `(projekt, dan)`, ali `CONFLICT` ne nosi
   * `id` — zato se poslije njega ID traži LISTOM, istim putem kojim bi ga tražio i ekran.
   */
  async function ensureDiary(cookie: string, diaryDate: string): Promise<string> {
    const created = await bodyOf(await diariesPost(jsonRequest("http://t/api/site-diaries", cookie, {
      projectId: PROJECT,
      diaryDate,
    })));
    const direct = String(created.data?.id ?? "");
    if (direct) return direct;
    const list = await bodyOf(await diariesGet(new NextRequest(
      `http://t/api/site-diaries?project=${PROJECT}&from=${diaryDate}&to=${diaryDate}`,
      { headers: { cookie } },
    )));
    const rows = (list.data?.diaries ?? []) as { id: string; diaryDate: string }[];
    return rows.find((row) => row.diaryDate === diaryDate)?.id ?? "";
  }

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1,'F9 A',$2), ($3,'F9 B',$4)`, [
      CO_A, `f9a-${RUN}`, CO_B, `f9b-${RUN}`,
    ]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1,$2,'V','Lasnik','x',false), ($3,$4,'S','Šef','x',false),
              ($5,$6,'R','Radnik','x',false), ($7,$8,'B','Firma','x',false)`,
      [
        USER_OWNER, `owner-f9-${RUN}@test.example`,
        USER_SUP, `sef-f9-${RUN}@test.example`,
        USER_WORKER, `radnik-f9-${RUN}@test.example`,
        USER_B, `b-f9-${RUN}@test.example`,
      ],
    );
    await withCompany(admin, companyId(CO_A), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY'),
                ($4,$5,$3,ARRAY['SITE_SUPERVISOR']::"Role"[],'COMPANY'),
                ($6,$7,$3,ARRAY['WORKER']::"Role"[],'COMPANY')`,
        [
          `mem_f9o_${RUN}`, USER_OWNER, CO_A,
          `mem_f9s_${RUN}`, USER_SUP,
          `mem_f9w_${RUN}`, USER_WORKER,
        ],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1,$2,'S','Šef','2024-01-01'::date,$3), ($4,$2,'P','Povrijeđeni','2024-01-01'::date,NULL)`,
        [WORKER_SUP, CO_A, USER_SUP, WORKER_INJURED],
      );
      await client.query(
        "INSERT INTO projects (id, company_id, code, name) VALUES ($1,$2,'F9-1','F9 gradilište')",
        [PROJECT, CO_A],
      );
    });
    await withCompany(admin, companyId(CO_B), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY')`,
        [`mem_f9b_${RUN}`, USER_B, CO_B],
      );
      await client.query(
        "INSERT INTO projects (id, company_id, code, name) VALUES ($1,$2,'F9-B','F9 B gradilište')",
        [PROJECT_B, CO_B],
      );
    });
    await signIn(admin, USER_OWNER, CO_A, "owner");
    await signIn(admin, USER_SUP, CO_A, "sup");
    await signIn(admin, USER_WORKER, CO_A, "worker");
    await signIn(admin, USER_B, CO_B, "b");
  }, 60_000);

  afterAll(async () => {
    for (const company of [CO_A, CO_B]) {
      await withCompany(admin, companyId(company), async (client) => {
        /* Red po FK-ovima: djeca prvo. Append-only tabele (`*_revisions`, `*_updates`,
           `audit_log`) se čiste uz isključene korisničke trigere — isto kao `cost_entries` u F8. */
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM hse_training_attendees WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_trainings WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_actions WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_inspections WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_investigations WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_incident_updates WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_incident_workers WHERE company_id = $1", [company]);
        await client.query("DELETE FROM hse_incidents WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diary_revisions WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diary_delays WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diary_items WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diaries WHERE company_id = $1", [company]);
        await client.query("DELETE FROM site_diary_templates WHERE company_id = $1", [company]);
        await client.query("DELETE FROM notification_deliveries WHERE company_id = $1", [company]);
        await client.query("DELETE FROM notifications WHERE company_id = $1", [company]);
        await client.query("DELETE FROM audit_events WHERE company_id = $1", [company]);
        await client.query("DELETE FROM obligations WHERE company_id = $1", [company]);
        await client.query("DELETE FROM obligation_types WHERE company_id = $1", [company]);
        await client.query("DELETE FROM sessions WHERE company_id = $1", [company]);
        await client.query("DELETE FROM project_assignments WHERE company_id = $1", [company]);
        await client.query("DELETE FROM projects WHERE company_id = $1", [company]);
        await client.query("DELETE FROM workers WHERE company_id = $1", [company]);
        await client.query("DELETE FROM memberships WHERE company_id = $1", [company]);
      });
    }
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[CO_A, CO_B]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_OWNER, USER_SUP, USER_WORKER, USER_B]]);
    await admin.end();
  }, 60_000);

  describe("dnevnik", () => {
    it("PROJECTS i SELF scope se provode na listi, kreiranju, detalju, PDF-u i svim izmjenama", async () => {
      const otherProject = `prj_f9_other_${RUN}`;
      const assignment = `pas_f9_${RUN}`;
      await withCompany(admin, companyId(CO_A), async (client) => {
        await client.query("INSERT INTO projects (id, company_id, code, name) VALUES ($1,$2,'F9-2','Drugi projekat')", [otherProject, CO_A]);
        await client.query(`INSERT INTO project_assignments (id,company_id,project_id,worker_id,from_date)
          VALUES ($1,$2,$3,$4,'2020-01-01')`, [assignment, CO_A, PROJECT, WORKER_SUP]);
      });
      const ownId = await ensureDiary(COOKIES.owner, "2026-08-10");
      const otherResponse = await diariesPost(jsonRequest("http://t/api/site-diaries", COOKIES.owner, {
        projectId: otherProject, diaryDate: "2026-08-10",
      }));
      const otherId = String((await bodyOf(otherResponse)).data?.id ?? "");
      expect(otherId).not.toBe("");
      try {
        await withCompany(admin, companyId(CO_A), (client) => client.query(
          "UPDATE memberships SET scope='PROJECTS' WHERE company_id=$1 AND user_id=$2", [CO_A, USER_SUP],
        ));
        const cookie = COOKIES.sup;
        const list = await bodyOf(await diariesGet(new NextRequest("http://t/api/site-diaries", { headers: { cookie } })));
        const ids = (list.data?.diaries as { id: string }[]).map((entry) => entry.id);
        expect(ids).toContain(ownId);
        expect(ids).not.toContain(otherId);
        expect((await diariesPost(jsonRequest("http://t/api/site-diaries", cookie, { projectId: otherProject, diaryDate: "2026-08-11" }))).status).toBe(404);
        expect((await diaryGet(new NextRequest(`http://t/api/site-diaries/${otherId}`, { headers: { cookie } }), ctx(otherId))).status).toBe(404);
        expect((await diaryPdf(new NextRequest(`http://t/api/site-diaries/${otherId}/pdf`, { headers: { cookie } }), ctx(otherId))).status).toBe(404);
        expect((await diaryPatch(jsonRequest(`http://t/api/site-diaries/${otherId}`, cookie, { description: "nedozvoljeno" }, "PATCH"), ctx(otherId))).status).toBe(404);
        expect((await itemsPost(jsonRequest(`http://t/api/site-diaries/${otherId}/items`, cookie, { description: "test", unit: "m", quantity: "1" }), ctx(otherId))).status).toBe(404);
        expect((await itemDelete(new NextRequest(`http://t/api/site-diaries/${otherId}/items/none`, { method: "DELETE", headers: { cookie } }), { params: Promise.resolve({ id: otherId, itemId: "none" }) })).status).toBe(404);
        expect((await delaysPost(jsonRequest(`http://t/api/site-diaries/${otherId}/delays`, cookie, { kind: "WEATHER", fromAt: "2026-08-10T08:00:00Z", toAt: "2026-08-10T09:00:00Z", hours: "1" }), ctx(otherId))).status).toBe(404);
        expect((await signPost(jsonRequest(`http://t/api/site-diaries/${otherId}/sign`, cookie, { signedName: "Test Osoba" }), ctx(otherId))).status).toBe(404);
        expect((await lockPost(new NextRequest(`http://t/api/site-diaries/${otherId}/lock`, { method: "POST", headers: { cookie } }), ctx(otherId))).status).toBe(404);
        expect((await revisePost(jsonRequest(`http://t/api/site-diaries/${otherId}/revise`, cookie, { reason: "Dovoljno dugačak razlog" }), ctx(otherId))).status).toBe(404);
        expect((await diaryPatch(jsonRequest(`http://t/api/site-diaries/${ownId}`, cookie, { description: "Dozvoljeno" }, "PATCH"), ctx(ownId))).status).toBe(200);
        await withCompany(admin, companyId(CO_A), (client) => client.query(
          "UPDATE memberships SET scope='SELF' WHERE company_id=$1 AND user_id=$2", [CO_A, USER_SUP],
        ));
        const selfList = await bodyOf(await diariesGet(new NextRequest("http://t/api/site-diaries", { headers: { cookie } })));
        expect(selfList.data?.diaries).toEqual([]);
        expect((await diaryGet(new NextRequest(`http://t/api/site-diaries/${ownId}`, { headers: { cookie } }), ctx(ownId))).status).toBe(404);
      } finally {
        await withCompany(admin, companyId(CO_A), (client) => client.query(
          "UPDATE memberships SET scope='COMPANY' WHERE company_id=$1 AND user_id=$2", [CO_A, USER_SUP],
        ));
      }
    });
    it("isti dan se ne otvara dvaput, a susjedni dan jeste novi red", async () => {
      const firstDate = "2026-09-14";
      const secondDate = "2026-09-15";
      const firstId = await ensureDiary(COOKIES.sup, firstDate);
      expect(firstId).not.toBe("");

      /* Ponovni POST istog dana: 200 sa `DIARY_EXISTS` i ISTIM id-em — šef nastavlja isti dan. */
      const again = await diariesPost(jsonRequest("http://t/api/site-diaries", COOKIES.sup, {
        projectId: PROJECT,
        diaryDate: firstDate,
      }));
      expect(again.status).toBe(200);
      expect((await bodyOf(again)).data?.code).toBe("DIARY_EXISTS");

      const secondId = await ensureDiary(COOKIES.sup, secondDate);
      expect(secondId).not.toBe(firstId);

      const list = await bodyOf(await diariesGet(new NextRequest(
        `http://t/api/site-diaries?project=${PROJECT}&from=${firstDate}&to=${secondDate}`,
        { headers: { cookie: COOKIES.sup } },
      )));
      const diaries = list.data?.diaries as { diaryDate: string }[];
      /* Najnoviji dan prvi — lista je „šta je zadnje urađeno“, ne arhiva. */
      expect(diaries.map((entry) => entry.diaryDate)).toEqual([secondDate, firstDate]);
    });

    it("nacrt se mijenja, potpis traži ime, poslije potpisa izmjena je odbijena", async () => {
      const diaryId = await ensureDiary(COOKIES.sup, "2026-09-16");

      const patched = await diaryPatch(
        jsonRequest(`http://t/api/site-diaries/${diaryId}`, COOKIES.sup, {
          description: "Iskop temelja, 320 m3",
          workedHours: "8.00",
        }, "PATCH"),
        ctx(diaryId),
      );
      expect(patched.status).toBe(200);

      /* Potpis bez imena: `DIARY_SIGNATURE_REQUIRED` (422), a ne generički `VALIDATION_FAILED`. */
      const noName = await signPost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/sign`, COOKIES.sup, {}),
        ctx(diaryId),
      );
      expect(noName.status).toBe(422);
      expect((await bodyOf(noName)).error?.code).toBe("DIARY_SIGNATURE_REQUIRED");

      const signed = await signPost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/sign`, COOKIES.sup, { signedName: "S. Šef" }),
        ctx(diaryId),
      );
      expect(signed.status).toBe(200);

      /* Poslije potpisa dnevnik je zaključan za izmjenu (§1.1/5); ispravka ide kroz reviziju. */
      const after = await diaryPatch(
        jsonRequest(`http://t/api/site-diaries/${diaryId}`, COOKIES.sup, { description: "prepravka" }, "PATCH"),
        ctx(diaryId),
      );
      expect(after.status).toBe(409);
      expect((await bodyOf(after)).error?.code).toBe("CONFLICT");

      const detail = await bodyOf(await diaryGet(
        new NextRequest(`http://t/api/site-diaries/${diaryId}`, { headers: { cookie: COOKIES.sup } }),
        ctx(diaryId),
      ));
      const diary = detail.data?.diary as { status: string; signedName: string | null; description: string };
      expect(diary.status).toBe("SIGNED");
      expect(diary.signedName).toBe("S. Šef");
      expect(diary.description).toContain("Iskop temelja");
    });

    it("zaključavanje traži potpis, a revizija traži razlog i ostaje zabilježena", async () => {
      const diaryId = await ensureDiary(COOKIES.sup, "2026-09-17");

      /* Bez potpisa nema zaključavanja — zaključan dan bez imena nije dokaz. */
      const early = await lockPost(
        new NextRequest(`http://t/api/site-diaries/${diaryId}/lock`, { method: "POST", headers: { cookie: COOKIES.owner } }),
        ctx(diaryId),
      );
      expect(early.status).toBe(409);

      await signPost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/sign`, COOKIES.sup, { signedName: "S. Šef" }),
        ctx(diaryId),
      );
      const locked = await lockPost(
        new NextRequest(`http://t/api/site-diaries/${diaryId}/lock`, { method: "POST", headers: { cookie: COOKIES.owner } }),
        ctx(diaryId),
      );
      expect(locked.status).toBe(200);

      /* Zaključan dnevnik ne prima ni stavku ni zastoj. */
      const item = await itemsPost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/items`, COOKIES.sup, {
          description: "Naknadna količina",
          unit: "m3",
          quantity: "1.000",
        }),
        ctx(diaryId),
      );
      expect(item.status).toBe(409);

      const noReason = await revisePost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/revise`, COOKIES.owner, { description: "novo" }),
        ctx(diaryId),
      );
      expect(noReason.status).toBe(422);
      expect((await bodyOf(noReason)).error?.code).toBe("DIARY_REASON_REQUIRED");

      const revised = await revisePost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/revise`, COOKIES.owner, {
          description: "Ispravka: 300 m3",
          reason: "Pogrešno prepisano iz terenske bilješke.",
        }),
        ctx(diaryId),
      );
      expect(revised.status).toBe(200);

      const detail = await bodyOf(await diaryGet(
        new NextRequest(`http://t/api/site-diaries/${diaryId}`, { headers: { cookie: COOKIES.owner } }),
        ctx(diaryId),
      ));
      const revisions = detail.data?.revisions as { reason: string }[];
      expect(revisions).toHaveLength(1);
      expect(revisions[0]?.reason).toContain("Pogrešno prepisano");
      expect((detail.data?.diary as { description: string }).description).toContain("300 m3");
    });

    it("količina ulazi u dnevnik, zastoj preko 24 h se odbija, ispravan zastoj prolazi", async () => {
      const diaryId = await ensureDiary(COOKIES.sup, "2026-09-18");

      const item = await itemsPost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/items`, COOKIES.sup, {
          description: "Beton C25/30",
          unit: "m3",
          quantity: "12.500",
        }),
        ctx(diaryId),
      );
      expect(item.status).toBe(200);

      /* Zastoj je dokaz za produženje roka — 30 h u jednom danu nije zastoj, to je greška unosa. */
      const tooLong = await delaysPost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/delays`, COOKIES.sup, {
          kind: "RAIN",
          fromAt: "2026-09-18T06:00:00.000Z",
          toAt: "2026-09-19T12:00:00.000Z",
          hours: "30",
        }),
        ctx(diaryId),
      );
      expect(tooLong.status).toBe(400);

      const okDelay = await delaysPost(
        jsonRequest(`http://t/api/site-diaries/${diaryId}/delays`, COOKIES.sup, {
          kind: "RAIN",
          fromAt: "2026-09-18T06:00:00.000Z",
          toAt: "2026-09-18T09:30:00.000Z",
          hours: "3.50",
        }),
        ctx(diaryId),
      );
      expect(okDelay.status).toBe(200);

      const detail = await bodyOf(await diaryGet(
        new NextRequest(`http://t/api/site-diaries/${diaryId}`, { headers: { cookie: COOKIES.sup } }),
        ctx(diaryId),
      ));
      expect((detail.data?.items as unknown[]).length).toBe(1);
      expect((detail.data?.delays as unknown[]).length).toBe(1);
      expect(detail.data?.delayHoursTotal).toBe("3.50");
    });

    it("firma B ne vidi ni ne otvara dnevnik firme A", async () => {
      const diaryId = await ensureDiary(COOKIES.sup, "2026-09-14");

      const read = await diaryGet(
        new NextRequest(`http://t/api/site-diaries/${diaryId}`, { headers: { cookie: COOKIES.b } }),
        ctx(diaryId),
      );
      expect(read.status).toBe(404);

      const create = await diariesPost(jsonRequest("http://t/api/site-diaries", COOKIES.b, {
        projectId: PROJECT,
        diaryDate: "2026-09-20",
      }));
      expect(create.status).toBe(404);
    });
  });

  describe("HSE", () => {
    let incidentId = "";

    it("NEAR_MISS sa izgubljenim danima i prijava bez teksta su odbijeni", async () => {
      const nearMiss = await incidentsPost(jsonRequest("http://t/api/hse/incidents", COOKIES.sup, {
        kind: "NEAR_MISS",
        severity: "MINOR",
        occurredAt: "2026-09-14T08:00:00.000Z",
        description: "Pad materijala pored radnika, bez povrede.",
        lostDays: 3,
      }));
      expect(nearMiss.status).toBe(400);

      const noText = await incidentsPost(jsonRequest("http://t/api/hse/incidents", COOKIES.sup, {
        kind: "ACCIDENT",
        severity: "MINOR",
        occurredAt: "2026-09-14T08:00:00.000Z",
        description: "",
      }));
      expect(noText.status).toBe(400);
    });

    it("prijava pravi obavezu HSE_REPORT u istoj transakciji", async () => {
      const response = await incidentsPost(jsonRequest("http://t/api/hse/incidents", COOKIES.sup, {
        kind: "ACCIDENT",
        severity: "SEVERE",
        occurredAt: "2026-09-14T08:00:00.000Z",
        projectId: PROJECT,
        locationText: "Kota 2, sjeverna fasada",
        description: "Radnik pao sa skele visine 2 m, prelom podlaktice.",
        immediateAction: "Prva pomoć i prevoz u ambulantu; skela obustavljena.",
        injuredWorkerId: WORKER_INJURED,
        lostDays: 21,
        reportableToAuthority: true,
      }));
      expect(response.status).toBe(200);
      const body = await bodyOf(response);
      incidentId = String(body.data?.id ?? "");
      expect(incidentId).not.toBe("");
      const obligationId = body.data?.obligationId;
      expect(typeof obligationId).toBe("string");

      const row = await withCompany(admin, companyId(CO_A), async (client) =>
        client.query<{ report_obligation_id: string | null; kind: string; lost_days: number }>(
          "SELECT report_obligation_id, kind, lost_days FROM hse_incidents WHERE company_id = $1 AND id = $2",
          [CO_A, incidentId],
        ));
      expect(row.rows[0]?.report_obligation_id).toBe(obligationId);
      expect(row.rows[0]?.kind).toBe("ACCIDENT");
      expect(row.rows[0]?.lost_days).toBe(21);
    });

    it("dopuna je nova izjava, a činjenice ostaju kakve su prijavljene", async () => {
      const update = await updatesPost(
        jsonRequest(`http://t/api/hse/incidents/${incidentId}/updates`, COOKIES.sup, {
          body: "Svjedok: skela nije bila vezana uz fasadu.",
        }),
        ctx(incidentId),
      );
      expect(update.status).toBe(200);

      /* Činjenice se ne prepisuju ni na nivou baze: triger `hse_incidents_facts_guard` odbija
         UPDATE opisa. Test to dokazuje direktno, jer ruta za izmjenu opisa NE postoji — što je
         i samo po sebi dio ugovora (§1.8/36). */
      await expect(withCompany(admin, companyId(CO_A), async (client) =>
        client.query(
          "UPDATE hse_incidents SET description = 'prepisano' WHERE company_id = $1 AND id = $2",
          [CO_A, incidentId],
        ))).rejects.toThrow(/HSE_INCIDENT_IMMUTABLE/);

      const detail = await bodyOf(await incidentGet(
        new NextRequest(`http://t/api/hse/incidents/${incidentId}`, { headers: { cookie: COOKIES.sup } }),
        ctx(incidentId),
      ));
      const updates = detail.data?.updates as { body: string }[];
      expect(updates).toHaveLength(1);
      expect((detail.data?.incident as { description: string }).description).toContain("prelom podlaktice");
    });

    it("mjera bez odgovornog ili roka je odbijena sa svojim kodom, sa oba se otvara", async () => {
      const noResponsible = await actionCreatePost(jsonRequest("http://t/api/hse/actions/create", COOKIES.sup, {
        incidentId,
        description: "Uvezati skelu za fasadu",
        dueOn: "2026-09-20",
      }));
      expect(noResponsible.status).toBe(422);
      expect((await bodyOf(noResponsible)).error?.code).toBe("HSE_ACTION_RESPONSIBLE_REQUIRED");

      const noDue = await actionCreatePost(jsonRequest("http://t/api/hse/actions/create", COOKIES.sup, {
        incidentId,
        description: "Uvezati skelu za fasadu",
        responsibleWorkerId: WORKER_SUP,
      }));
      expect(noDue.status).toBe(422);
      expect((await bodyOf(noDue)).error?.code).toBe("HSE_ACTION_DUE_REQUIRED");

      const okAction = await actionCreatePost(jsonRequest("http://t/api/hse/actions/create", COOKIES.sup, {
        incidentId,
        description: "Uvezati skelu za fasadu",
        responsibleWorkerId: WORKER_SUP,
        dueOn: "2026-09-20",
      }));
      expect(okAction.status).toBe(200);
    });

    it("zatvaranje traži završenu istragu i nijednu otvorenu mjeru", async () => {
      const early = await closePost(
        new NextRequest(`http://t/api/hse/incidents/${incidentId}/close`, { method: "POST", headers: { cookie: COOKIES.owner } }),
        ctx(incidentId),
      );
      expect(early.status).toBe(409);

      const investigation = await investigationPut(
        jsonRequest(`http://t/api/hse/incidents/${incidentId}/investigation`, COOKIES.sup, {
          rootCause: "Skela nije bila vezana; kontrola prije rada preskočena.",
          method: "FIVE_WHY",
          findings: "Nedostaje popis provjere za skele.",
          completed: true,
        }, "PUT"),
        ctx(incidentId),
      );
      expect(investigation.status).toBe(200);

      /* Mjera je još otvorena — zatvaranje i dalje pada, istim kodom kao i bez istrage. */
      const stillOpen = await closePost(
        new NextRequest(`http://t/api/hse/incidents/${incidentId}/close`, { method: "POST", headers: { cookie: COOKIES.owner } }),
        ctx(incidentId),
      );
      expect(stillOpen.status).toBe(409);

      const detail = await bodyOf(await incidentGet(
        new NextRequest(`http://t/api/hse/incidents/${incidentId}`, { headers: { cookie: COOKIES.sup } }),
        ctx(incidentId),
      ));
      const actionId = (detail.data?.actions as { id: string }[])[0]?.id ?? "";
      const done = await actionsPatch(jsonRequest("http://t/api/hse/actions", COOKIES.sup, {
        id: actionId,
        kind: "DONE",
      }, "PATCH"));
      expect(done.status).toBe(200);

      const closed = await closePost(
        new NextRequest(`http://t/api/hse/incidents/${incidentId}/close`, { method: "POST", headers: { cookie: COOKIES.owner } }),
        ctx(incidentId),
      );
      expect(closed.status).toBe(200);

      const after = await bodyOf(await incidentGet(
        new NextRequest(`http://t/api/hse/incidents/${incidentId}`, { headers: { cookie: COOKIES.owner } }),
        ctx(incidentId),
      ));
      expect((after.data?.incident as { status: string }).status).toBe("CLOSED");
    });

    it("zabrana rada se vidi u hseAttention i podiže se samo sa razlogom", async () => {
      const recorded = await inspectionsPost(jsonRequest("http://t/api/hse/inspections", COOKIES.sup, {
        kind: "AUTHORITY",
        authorityName: "Inspektorat rada",
        inspectedAt: "2026-09-19T09:00:00.000Z",
        inspectorName: "Inspektor I.",
        summary: "Skela bez zaštitne mreže.",
        result: "PROHIBITION",
      }));
      expect(recorded.status).toBe(200);
      const inspectionId = String((await bodyOf(recorded)).data?.id ?? "");

      const attention = await withCompany(admin, companyId(CO_A), async (client) =>
        hseAttention(client, { userId: USER_OWNER, companyId: CO_A, roles: ["OWNER"], scope: "COMPANY", projectIds: null }));
      expect(attention?.prohibition?.authorityName).toBe("Inspektorat rada");

      const noReason = await inspectionsPatch(jsonRequest("http://t/api/hse/inspections", COOKIES.sup, {
        id: inspectionId,
      }, "PATCH"));
      expect(noReason.status).toBe(400);

      const lifted = await inspectionsPatch(jsonRequest("http://t/api/hse/inspections", COOKIES.sup, {
        id: inspectionId,
        note: "Mreža postavljena i pregledana.",
      }, "PATCH"));
      expect(lifted.status).toBe(200);

      const after = await withCompany(admin, companyId(CO_A), async (client) =>
        hseAttention(client, { userId: USER_OWNER, companyId: CO_A, roles: ["OWNER"], scope: "COMPANY", projectIds: null }));
      expect(after?.prohibition).toBeNull();
      expect(after?.overdueActions).toBe(0);
    });

    it("statistika broji NEAR_MISS odvojeno i vraća LTIFR `null` kad sati nema", async () => {
      await incidentsPost(jsonRequest("http://t/api/hse/incidents", COOKIES.sup, {
        kind: "NEAR_MISS",
        severity: "MINOR",
        occurredAt: "2026-09-20T08:00:00.000Z",
        projectId: PROJECT,
        description: "Kamion prošao kroz zonu bez prsluka.",
      }));

      const response = await statsGet(new NextRequest(
        "http://t/api/hse/stats?from=2026-01-01&to=2026-12-31",
        { headers: { cookie: COOKIES.sup } },
      ));
      expect(response.status).toBe(200);
      const stats = (await bodyOf(response)).data as unknown as {
        incidents: number;
        nearMisses: number;
        lostDays: number;
        workedHours: number;
        ltifr: number | null;
        actions: { open: number; overdue: number };
        trainings: { count: number };
        activeProhibition: { authorityName: string | null } | null;
      };
      expect(stats.incidents).toBe(2);
      expect(stats.nearMisses).toBe(1);
      expect(stats.lostDays).toBe(21);
      expect(stats.workedHours).toBe(0);
      /* Nula bi tvrdila „nema ozljeda na milion sati“; `null` kaže da imenilac ne postoji. */
      expect(stats.ltifr).toBeNull();
      expect(stats.actions.overdue).toBe(0);
      expect(stats.activeProhibition).toBeNull();
    });

    it("firma B ne vidi incident firme A", async () => {
      const list = await incidentsGet(new NextRequest("http://t/api/hse/incidents", { headers: { cookie: COOKIES.b } }));
      expect(list.status).toBe(200);
      expect((await bodyOf(list)).data?.incidents).toEqual([]);

      const read = await incidentGet(
        new NextRequest(`http://t/api/hse/incidents/${incidentId}`, { headers: { cookie: COOKIES.b } }),
        ctx(incidentId),
      );
      expect(read.status).toBe(404);
    });
  });
});
