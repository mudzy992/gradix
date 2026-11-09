/**
 * R2b na PRAVOJ bazi: obaveze, verzije, stanje i izolacija.
 *
 * Dokazuje ono što se ne vidi iz koda:
 *  1. **stanje se računa isto kao u bazi** — TS funkcija i `obligation_state()` daju isti string
 *     za iste ulaze. To je jedina odbrana od toga da ekran pokaže „važeće“ za isteklu obavezu.
 *  2. **„danas“ je poslovni datum firme** — obaveza koja istječe danas NIJE istekla; provjera ide
 *     preko zone firme, a ne UTC-a.
 *  3. **obnova ne prepisuje** — stara verzija ostaje, keš u `obligations` prati najnoviju (trigger),
 *     a ruta ne može upisati rok drugačije od verzije.
 *  4. **ispravka samo u 24 h** — poslije toga ista izmjena ide kroz novu verziju.
 *  5. **izolacija** — obaveza firme A se ne vidi iz firme B, ni kroz listu ni kroz jednu obavezu.
 *  6. **prilog**: `.exe` preimenovan u `.pdf` se odbija po sadržaju; bez MINIO varijabli upload
 *     se odbija jasnom porukom umjesto tihe greške.
 *
 * Traži `DATABASE_URL` i `DATABASE_ADMIN_URL`; bez njih se PRESKAČE.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { obligationState } from "@gradix/domain";
import { GET as obligationsRoute, POST as createObligationRoute } from "@/app/api/obligations/route";
import { DELETE as deleteRoute, GET as obligationRoute } from "@/app/api/obligations/[id]/route";
import { POST as renewRoute } from "@/app/api/obligations/[id]/renew/route";
import { POST as correctRoute } from "@/app/api/obligations/[id]/correct/route";
import { POST as attachmentRoute } from "@/app/api/obligations/[id]/attachments/route";
import { GET as typesRoute } from "@/app/api/obligation-types/route";
import { detectContentType, objectKey, presignDownload, presignUpload, sanitiseFileName, sha256Hex, storageConfig } from "./storage";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_r2b_a";
const OTHER = "cmp_r2b_b";
const USER = "usr_r2b_admin";
const USER_OTHER = "usr_r2b_other";
const WORKER = "wrk_r2b_amina";
/** G3: dva radnika u ISTOJ firmi — A ne smije vidjeti B-ove rokove. */
const RADNIK_A = "usr_r2b_radnik_a";
const RADNIK_B = "usr_r2b_radnik_b";
const WRK_A = "wrk_r2b_a";
const WRK_B = "wrk_r2b_b";
const MACHINE = "mch_r2b_bager";

const get = (url: string, cookie?: string) => new NextRequest(url, { headers: cookie ? { cookie } : {} });

async function signIn(userId: string, companyId: string): Promise<string> {
  const { withCompany, companyId: cid } = await import("@gradix/db");
  const sessionId = `ses_${userId}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await withCompany(admin, cid(companyId), async (client) => {
    await client.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  });
  await admin.end();
  const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await withCompany(app, cid(companyId), async (client) => {
    await client.query(
      "INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + interval '1 day')",
      [sessionId, companyId, userId, `hash_${sessionId}`],
    );
  });
  await app.end();
  return `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: sessionId, companyId })}`;
}

/** Zahtjev sa cookiejem — tijelo se postavlja odmah, jer `NextRequest` ne mijenja se poslije. */
const authed = (url: string, init: { method?: string; body?: unknown } = {}, cookie = "") =>
  new NextRequest(url, {
    method: init.method ?? "GET",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: { "content-type": "application/json", cookie },
  });

describeDb("R2b (integracija na pravoj bazi)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  let cookieA = "";
  let cookieB = "";
  let cookieRadnikA = "";

  let medicalTypeId = "";
  let registrationTypeId = "";
  let machineId = "";

  beforeAll(async () => {
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[COMPANY, OTHER]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER, USER_OTHER, RADNIK_A, RADNIK_B]]);
    await admin.query(
      "INSERT INTO companies (id, name, slug) VALUES ($1, 'R2b Firma A', 'r2b-firma-a'), ($2, 'R2b Firma B', 'r2b-firma-b')",
      [COMPANY, OTHER],
    );
    await admin.query(
      // `must_change_password` mora biti false: inače svaka ruta vraća 403 prije provjere dozvole
      // (pravilo iz R1a: dok je privremena lozinka, smije se samo promijeniti lozinka).
      `INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'r2b-admin@test.example', 'x', 'Admin', 'A', false),
              ($2, 'r2b-other@test.example', 'x', 'Admin', 'B', false),
              ($3, 'r2b-radnik-a@test.example', 'x', 'Radnik', 'A', false),
              ($4, 'r2b-radnik-b@test.example', 'x', 'Radnik', 'B', false)`,
      [USER, USER_OTHER, RADNIK_A, RADNIK_B],
    );

    const { withCompany, companyId } = await import("@gradix/db");
    const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    for (const [company, memberId, userId, role, scope] of [
      [COMPANY, "mem_r2b_a", USER, "ADMIN", "COMPANY"],
      [OTHER, "mem_r2b_b", USER_OTHER, "OWNER", "COMPANY"],
      /*
       * Radnici ovdje eksplicitno dobijaju `SELF`, iako je novi DEFAULT sada `SELF`: test mora
       * jasno postaviti granicu koju provjerava, ne zavisiti od DEFAULT-a. Opseg `COMPANY` bi
       * radniku otvorio cijelu firmu; `obligations.view` sama po sebi NE ograničava redove.
       */
      [COMPANY, "mem_r2b_ra", RADNIK_A, "WORKER", "SELF"],
      [COMPANY, "mem_r2b_rb", RADNIK_B, "WORKER", "SELF"],
    ] as const) {
      await withCompany(app, companyId(company), async (client) => {
        await client.query(
          `INSERT INTO memberships (id, user_id, company_id, roles, scope)
           VALUES ($1, $2, $3, ARRAY[$4]::"Role"[], $5)`,
          [memberId, userId, company, role, scope],
        );
      });
    }
    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id) VALUES
           ($1, $2, 'Amina', 'Karić', '2025-03-01', NULL),
           ($3, $2, 'Radnik', 'A', '2025-01-01', $4),
           ($5, $2, 'Radnik', 'B', '2025-01-01', $6)`,
        [WORKER, COMPANY, WRK_A, RADNIK_A, WRK_B, RADNIK_B],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ('mch_r2b_bager', $1, 'BAG-01', 'Bager CAT 320', $1 || '_cat_excavator')`,
        [COMPANY],
      );
    });
    await app.end();

    cookieA = await signIn(USER, COMPANY);
    cookieB = await signIn(USER_OTHER, OTHER);
    cookieRadnikA = await signIn(RADNIK_A, COMPANY);
    // Nalog radnika B se koristi u testu; njegov cookie nije potreban — B-ove rokove gleda A.
    await signIn(RADNIK_B, COMPANY);

    const types = (await (await typesRoute(get("http://interni/api/obligation-types", cookieA))).json()) as {
      data: { types: { id: string; code: string; entityKind: string; defaultReminderDays: number[] }[] };
    };
    medicalTypeId = types.data.types.find((type) => type.code === "MEDICAL")!.id;
    registrationTypeId = types.data.types.find((type) => type.code === "REGISTRATION")!.id;
    machineId = MACHINE;
  });

  it("nova firma dobija zadane tipove sa pragovima po tipu (ljekarski 60/30/15/7, registracija 30/15/7)", async () => {
    const response = await typesRoute(get("http://interni/api/obligation-types", cookieA));
    const body = (await response.json()) as {
      data: { types: { code: string; defaultReminderDays: number[]; entityKind: string; requiresAttachment: boolean }[] };
    };
    const medical = body.data.types.find((type) => type.code === "MEDICAL")!;
    const registration = body.data.types.find((type) => type.code === "REGISTRATION")!;
    expect(medical.defaultReminderDays).toEqual([60, 30, 15, 7]);
    expect(medical.entityKind).toBe("WORKER");
    expect(medical.requiresAttachment).toBe(true);
    expect(registration.defaultReminderDays).toEqual([30, 15, 7]);
    expect(registration.entityKind).toBe("MACHINE");
    // Garancija nema rok, pa ni pragove — tip to mora da dozvoli.
    expect(body.data.types.find((type) => type.code === "WARRANTY")!.defaultReminderDays).toEqual([]);
  });

  it("TS stanje i SQL funkcija daju ISTI odgovor za iste ulaze", async () => {
      const today = "2026-11-07";
    const cases: [string | null, number[]][] = [
      ["2026-11-27", [60, 30, 15, 7]],
      ["2026-11-12", [60, 30, 15, 7]],
      ["2026-11-06", [60, 30, 15, 7]],
      ["2026-11-07", [60, 30, 15, 7]],
      ["2026-11-20", []],
      ["2026-11-07", []],
      ["2027-01-04", [7]],
      [null, [60]],
    ];

    for (const [expiresAt, thresholds] of cases) {
      const sqlRow = (
        await admin.query<{ state: string }>(`SELECT obligation_state($1::date, $2::int[], $3::date) AS state`, [
          expiresAt,
          thresholds,
          today,
        ])
      ).rows[0]!;
      expect(obligationState({ expiresAt, thresholds, today })).toBe(sqlRow.state);
    }
  });

  /**
   * Jedan tip + jedan entitet = najviše jedna AKTIVNA obaveza (indeks u bazi). Testovi koji
   * prave novu obavezu istog tipa prvo sklanjaju prethodnu — to je i pravilo proizvoda: druga
   * ljekarska se ne „dodaje“, nego se prva obnavlja.
   */
  const clearMedical = () =>
    admin.query("DELETE FROM obligations WHERE company_id = $1 AND worker_id = $2 AND superseded_by IS NULL", [
      COMPANY,
      WORKER,
    ]);

  it("obaveza sa rokom za 20 dana je „važeće“, za 5 dana „uskoro“, jučerašnji rok „isteklo“", async () => {
    const create = async (expiresAt: string) => {
      const response = await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt, number: `L-${expiresAt}` } },
          cookieA,
        ),
      );
      return (await response.json()) as { data: { obligation: { id: string; state: string; daysLeft: number } } };
    };

    /*
     * „Danas" dolazi iz ZONE FIRME, ne iz Node sata.
     *
     * Bilo je `new Date()`: u 23h UTC firma (UTC+1) već je sutra, pa je „rok istječe danas" padao na
     * „isteklo" — test je zavisio od doba dana u kojem se pušta. Datum firme je jedini datum koji
     * `obligation_state` i koristi.
     */
    const danas = (await (
      await obligationsRoute(get("http://interni/api/obligations", cookieA))
    ).json()) as { data: { today: string } };
    const today = new Date(`${danas.data.today}T00:00:00Z`);
    const iso = (offset: number) => {
      const date = new Date(today.getTime() + offset * 86_400_000);
      return date.toISOString().slice(0, 10);
    };

    // Jedan tip, jedan radnik = jedna aktivna obaveza, pa se prethodna briše prije sljedeće.
    for (const [offset, expected] of [
      [20, "valid"],
      [5, "expiring"],
      [-1, "expired"],
      [0, "expiring"],
    ] as const) {
      const created = await create(iso(offset));
      const row = await admin.query<{ state: string }>(
        "SELECT obligation_state(expires_at, '{60,30,15,7}'::int[], $2::date) AS state FROM obligations WHERE id = $1",
        [created.data.obligation.id, iso(0)],
      );
      expect(created.data.obligation.state).toBe(expected);
      // Ista vrijednost iz baze — ekran i baza se ne mogu razići.
      expect(row.rows[0]!.state).toBe(expected);
      await admin.query("DELETE FROM obligations WHERE id = $1", [created.data.obligation.id]);
    }
  });

  it("obnova dodaje verziju: stara ostaje, keš prati novu, broj verzija se vidi", async () => {
    await clearMedical();
    const created = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2026-12-01", number: "L-1" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string; currentVersion: number; expiresAt: string } } };

    const renewed = await renewRoute(
      authed(
        `http://interni/api/obligations/${created.data.obligation.id}/renew`,
        { method: "POST", body: { expiresAt: "2027-12-01", number: "L-2", issuer: "Dom zdravlja" } },
        cookieA,
      ),
      { params: Promise.resolve({ id: created.data.obligation.id }) },
    );
    expect(renewed.status).toBe(200);

    const body = (await renewed.json()) as {
      data: { obligation: { currentVersion: number; expiresAt: string; number: string }; versions: { version: number; expiresAt: string }[] };
    };
    expect(body.data.obligation.currentVersion).toBe(2);
    expect(body.data.obligation.expiresAt).toBe("2027-12-01");
    expect(body.data.versions.map((entry) => entry.version)).toEqual([2, 1]);
    // Stara verzija NIJE prepisana — to je poenta obnove.
    expect(body.data.versions[1]!.expiresAt).toBe("2026-12-01");

    // Trigger drži keš: direktan upit u bazu vidi isti rok.
    const row = await admin.query<{ expires_at: Date; current_version: number }>(
      "SELECT expires_at, current_version FROM obligations WHERE id = $1",
      [created.data.obligation.id],
    );
    expect(row.rows[0]!.expires_at.toISOString().slice(0, 10)).toBe("2027-12-01");
    expect(row.rows[0]!.current_version).toBe(2);

    await admin.query("DELETE FROM obligations WHERE id = $1", [created.data.obligation.id]);
  });

  it("„obnova“ sa starijim ili istim rokom se odbija — to je ispravka, ne obnova", async () => {
    await clearMedical();
    const created = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2027-06-01" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string } } };

    const same = await renewRoute(
      authed(
        `http://interni/api/obligations/${created.data.obligation.id}/renew`,
        { method: "POST", body: { expiresAt: "2027-06-01" } },
        cookieA,
      ),
      { params: Promise.resolve({ id: created.data.obligation.id }) },
    );
    expect(same.status).toBe(409);
    const body = (await same.json()) as { error: { message: string } };
    expect(body.error.message).toContain("ispravka");

    await admin.query("DELETE FROM obligations WHERE id = $1", [created.data.obligation.id]);
  });

  it("ispravka mijenja trenutnu verziju i bilježi staru i novu vrijednost u tragu", async () => {
    await clearMedical();
    const created = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2027-03-15" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string; currentVersion: number } } };

    const corrected = await correctRoute(
      authed(
        `http://interni/api/obligations/${created.data.obligation.id}/correct`,
        { method: "POST", body: { expiresAt: "2027-03-25" } },
        cookieA,
      ),
      { params: Promise.resolve({ id: created.data.obligation.id }) },
    );
    expect(corrected.status).toBe(200);
    const body = (await corrected.json()) as { data: { obligation: { expiresAt: string; currentVersion: number } } };
    expect(body.data.obligation.expiresAt).toBe("2027-03-25");
    // Ispravka NE pravi novu verziju — inače bi historija bila šum.
    expect(body.data.obligation.currentVersion).toBe(1);

    const audit = await admin.query<{ metadata: { from: string; to: string } }>(
      "SELECT metadata FROM audit_events WHERE entity_id = $1 AND action = 'obligation.corrected'",
      [created.data.obligation.id],
    );
    expect(audit.rows[0]!.metadata).toMatchObject({ from: "2027-03-15", to: "2027-03-25" });

    await admin.query("DELETE FROM obligations WHERE id = $1", [created.data.obligation.id]);
  });

  it("ispravka poslije 24 h se odbija i upućuje na obnovu", async () => {
    await clearMedical();
    const created = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2027-04-01" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string } } };

    // Vrijeme se pomjera u bazi, ne u kodu: ista provjera, stvarni podatak.
    await admin.query(
      "UPDATE obligation_versions SET created_at = now() - interval '25 hours' WHERE obligation_id = $1",
      [created.data.obligation.id],
    );

    const corrected = await correctRoute(
      authed(
        `http://interni/api/obligations/${created.data.obligation.id}/correct`,
        { method: "POST", body: { expiresAt: "2027-04-10" } },
        cookieA,
      ),
      { params: Promise.resolve({ id: created.data.obligation.id }) },
    );
    expect(corrected.status).toBe(409);
    const body = (await corrected.json()) as { error: { message: string } };
    expect(body.error.message).toContain("24 h");

    await admin.query("DELETE FROM obligations WHERE id = $1", [created.data.obligation.id]);
  });

  it("tip mora da odgovara entitetu: ljekarski na mašini se odbija", async () => {
    const response = await createObligationRoute(
      authed(
        "http://interni/api/obligations",
        { method: "POST", body: { typeId: medicalTypeId, machineId } },
        cookieA,
      ),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("ne odgovara");
  });

  it("obaveza mora visi na TAČNO jednom entitetu — ni na dva, ni na nijedan", async () => {
    const both = await createObligationRoute(
      authed(
        "http://interni/api/obligations",
        { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, machineId } },
        cookieA,
      ),
    );
    expect(both.status).toBe(400);

    const none = await createObligationRoute(
      authed("http://interni/api/obligations", { method: "POST", body: { typeId: medicalTypeId } }, cookieA),
    );
    expect(none.status).toBe(400);
  });

  it("mašina dobija registraciju, a rok je u listi sa stanjem", async () => {
    const response = await createObligationRoute(
      authed(
        "http://interni/api/obligations",
        { method: "POST", body: { typeId: registrationTypeId, machineId, expiresAt: "2030-01-31" } },
        cookieA,
      ),
    );
    expect(response.status).toBe(200);

    const list = (await (await obligationsRoute(get("http://interni/api/obligations", cookieA))).json()) as {
      data: {
        obligations: { machineCode: string | null; typeCode: string; state: string }[];
        counts: { all: number; valid: number };
        today: string;
      };
    };
    const registration = list.data.obligations.find((row) => row.typeCode === "REGISTRATION")!;
    expect(registration.machineCode).toBe("BAG-01");
    expect(registration.state).toBe("valid");
    // Poslovni datum firme je dio odgovora — ekran zna po kojoj se zoni računa.
    expect(list.data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("druga firma ne vidi ni obavezu ni tipove firme A", async () => {
    await clearMedical();
    const created = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2028-05-05" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string } } };

    // Kroz listu: tuđa obaveza se ne pojavljuje.
    const listB = (await (await obligationsRoute(get("http://interni/api/obligations", cookieB))).json()) as {
      data: { obligations: { id: string }[]; counts: { all: number } };
    };
    expect(listB.data.obligations.some((row) => row.id === created.data.obligation.id)).toBe(false);

    // Kroz jednu obavezu: 404, ne 403 — ne otkriva ni da postoji.
    const single = await obligationRoute(
      authed(`http://interni/api/obligations/${created.data.obligation.id}`, {}, cookieB),
      { params: Promise.resolve({ id: created.data.obligation.id }) },
    );
    expect(single.status).toBe(404);

    // Tipovi su po firmi: firma B ima svoje, sa istim oznakama i svojim id-jevima.
    const typesB = (await (await typesRoute(get("http://interni/api/obligation-types", cookieB))).json()) as {
      data: { types: { id: string; code: string }[] };
    };
    const medicalB = typesB.data.types.find((type) => type.code === "MEDICAL")!;
    expect(medicalB.id).not.toBe(medicalTypeId);

    await admin.query("DELETE FROM obligations WHERE id = $1", [created.data.obligation.id]);
  });

  it("brisanje: pogrešan unos u prvih 24 h prolazi, obnovljena obaveza ne", async () => {
    await clearMedical();
    const created = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2027-07-07" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string } } };

    const deleted = await deleteRoute(
      authed(`http://interni/api/obligations/${created.data.obligation.id}`, { method: "DELETE" }, cookieA),
      { params: Promise.resolve({ id: created.data.obligation.id }) },
    );
    expect(deleted.status).toBe(200);

    // Obnovljena obaveza: dvije verzije = historija, brisanje se odbija.
    const renewed = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2027-08-08" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string } } };
    await renewRoute(
      authed(
        `http://interni/api/obligations/${renewed.data.obligation.id}/renew`,
        { method: "POST", body: { expiresAt: "2028-08-08" } },
        cookieA,
      ),
      { params: Promise.resolve({ id: renewed.data.obligation.id }) },
    );
    const blocked = await deleteRoute(
      authed(`http://interni/api/obligations/${renewed.data.obligation.id}`, { method: "DELETE" }, cookieA),
      { params: Promise.resolve({ id: renewed.data.obligation.id }) },
    );
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as { error: { message: string } };
    expect(body.error.message).toContain("historija");

    await admin.query("DELETE FROM obligations WHERE id = $1", [renewed.data.obligation.id]);
  });

  it("prilog: .exe preimenovan u .pdf se odbija PO SADRŽAJU, ne po imenu", async () => {
    await clearMedical();
    const created = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2027-09-09" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string } } };

    // "MZ" na početku = Windows izvršni fajl, bez obzira što se zove ljekarski.pdf.
    const disguised = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const response = await attachmentRoute(
      authed(
        `http://interni/api/obligations/${created.data.obligation.id}/attachments`,
        {
          method: "POST",
          body: {
            fileName: "ljekarski.pdf",
            sizeBytes: disguised.length,
            sha256: sha256Hex(disguised),
            headBase64: disguised.toString("base64"),
          },
        },
        cookieA,
      ),
      { params: Promise.resolve({ id: created.data.obligation.id }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("nije PDF ni slika");

    await admin.query("DELETE FROM obligations WHERE id = $1", [created.data.obligation.id]);
  });

  it("prilog: bez MINIO varijabli upload se odbija JASNOM porukom, a obaveza ostaje", async () => {
    await clearMedical();
    const created = (await (
      await createObligationRoute(
        authed(
          "http://interni/api/obligations",
          { method: "POST", body: { typeId: medicalTypeId, workerId: WORKER, expiresAt: "2027-10-10" } },
          cookieA,
        ),
      )
    ).json()) as { data: { obligation: { id: string } } };

    const pdf = Buffer.from("%PDF-1.7\n", "utf8");
    const response = await attachmentRoute(
      authed(
        `http://interni/api/obligations/${created.data.obligation.id}/attachments`,
        {
          method: "POST",
          body: { fileName: "rjesenje.pdf", sizeBytes: 500_000, sha256: sha256Hex(pdf), headBase64: pdf.toString("base64") },
        },
        cookieA,
      ),
      { params: Promise.resolve({ id: created.data.obligation.id }) },
    );

    // U CI-ju MINIO nije podešen: poruka kaže šta treba, umjesto tihe greške.
    if (!storageConfig().configured) {
      expect(response.status).toBe(409);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain("MINIO");
    }

    await admin.query("DELETE FROM obligations WHERE id = $1", [created.data.obligation.id]);
  });

  /* ------------------------------------------- G3: radnik vidi SAMO svoje */

  it("radnik A vidi SVOJ rok, a rok radnika B u ISTOJ firmi mu je nevidljiv", async () => {
    // Rukovodilac upisuje po jedan rok svakom radniku.
    for (const [wrk, broj] of [[WRK_A, "LK-A-1"], [WRK_B, "LK-B-1"]] as const) {
      const created = await createObligationRoute(
        authed("http://interni/api/obligations", {
          method: "POST",
          body: { typeId: medicalTypeId, workerId: wrk, number: broj, expiresAt: "2027-06-30" },
        }, cookieA),
      );
      expect(created.status).toBe(200);
    }

    const mine = (await (
      await obligationsRoute(get("http://interni/api/obligations?mine=1", cookieRadnikA))
    ).json()) as { data: { obligations: { workerId: string | null; number: string | null }[] } };

    // Vidi tačno svoj — i to po BROJU, jer broj je ono što čovjek prepozna.
    expect(mine.data.obligations.map((entry) => entry.number)).toEqual(["LK-A-1"]);
    expect(mine.data.obligations.every((entry) => entry.workerId === WRK_A)).toBe(true);
  });

  it("radnik NE može proširiti opseg parametrom: `?workerId=` tuđeg radnika ne mijenja ništa", async () => {
    /*
     * Ovo je test koji brani granicu od „samo ga lijepo sakrij u UI-u". Bez provjere na serveru
     * dovoljno je poslati tuđi `workerId` i vidio bi sve — pa opseg ne bi bio opseg.
     */
    const tuđi = (await (
      await obligationsRoute(get(`http://interni/api/obligations?workerId=${WRK_B}`, cookieRadnikA))
    ).json()) as { data: { obligations: { workerId: string | null }[] } };

    expect(tuđi.data.obligations).toEqual([]);
  });

  it("radnik NE vidi priloge (skenove) — samo tip, rok i stanje; ruta za prilog mu je zatvorena", async () => {
    // Jedan aktivan ljekarski po radniku (unique) — prethodni test ga je već upisao.
    await admin.query(
      "DELETE FROM obligations WHERE company_id = $1 AND worker_id = $2 AND superseded_by IS NULL",
      [COMPANY, WRK_A],
    );

    const created = (await (
      await createObligationRoute(
        authed("http://interni/api/obligations", {
          method: "POST",
          body: { typeId: medicalTypeId, workerId: WRK_A, number: "LK-A-2", expiresAt: "2027-08-31" },
        }, cookieA),
      )
    ).json()) as { data: { obligation: { id: string } } };
    const obligationId = created.data.obligation.id;

    // Prilog upisuje ured (u bazi, jer storage u testu nije podešen).
    await admin.query(
      `INSERT INTO obligation_attachments (id, company_id, obligation_id, file_name, content_type,
                                           size_bytes, status, object_key, sha256)
       VALUES ('att_r2b_nalaz', $1, $2, 'ljekarski.pdf', 'application/pdf', 1234, 'ready',
               'gx2/' || $1 || '/obligations/' || $2 || '/att_r2b_nalaz', repeat('a', 64))`,
      [COMPANY, obligationId],
    );

    // Radnik: u listi NEMA priloga, a tip/rok/stanje jesu.
    const lista = (await (
      await obligationsRoute(get("http://interni/api/obligations?mine=1", cookieRadnikA))
    ).json()) as { data: { obligations: { number: string | null; attachments: unknown[]; expiresAt: string | null; state: string }[] } };
    const svoj = lista.data.obligations.find((entry) => entry.number === "LK-A-2")!;
    expect(svoj.attachments).toEqual([]);
    expect(svoj.expiresAt).toBe("2027-08-31");
    expect(svoj.state).toBeTruthy();

    // Detalj: isto — bez priloga.
    const detaljOdgovor = await obligationRoute(get("http://interni/api/obligations/x", cookieRadnikA), {
      params: Promise.resolve({ id: obligationId }),
    });
    const detalj = (await detaljOdgovor.json()) as { data: { obligation: { attachments: unknown[] } } };
    expect(detalj.data.obligation.attachments).toEqual([]);

    // Ruta koja otvara SADRŽAJ priloga: radnik ne prolazi (403), ured prolazi.
    const urlRoute = (await import("@/app/api/obligations/[id]/attachments/[attachmentId]/url/route")).GET;
    const zaRadnika = await urlRoute(get("http://interni/api/obligations/x/attachments/y/url", cookieRadnikA), {
      params: Promise.resolve({ id: obligationId, attachmentId: "att_r2b_nalaz" }),
    });
    expect(zaRadnika.status).toBe(403);

    // Ured ga vidi u listi — znači prilog NIJE nestao, samo je radniku zatvoren.
    const ured = (await (
      await obligationsRoute(get("http://interni/api/obligations", cookieA))
    ).json()) as { data: { obligations: { id: string; attachments: { fileName: string }[] }[] } };
    const izUreda = ured.data.obligations.find((entry) => entry.id === obligationId)!;
    expect(izUreda.attachments.map((entry) => entry.fileName)).toEqual(["ljekarski.pdf"]);
  });

  it("radnik NE može otvoriti TUĐI rok ni ako zna njegov `id` (404, ne 403)", async () => {
    const tuđi = await admin.query<{ id: string }>(
      "SELECT id FROM obligations WHERE company_id = $1 AND worker_id = $2 LIMIT 1",
      [COMPANY, WRK_B],
    );
    const odgovor = await obligationRoute(get("http://interni/api/obligations/x", cookieRadnikA), {
      params: Promise.resolve({ id: tuđi.rows[0]!.id }),
    });
    // 404, a ne 403: radnik ne treba da zna da tuđi rok postoji.
    expect(odgovor.status).toBe(404);
  });
});

describe("prilozi — provjere koje ne trebaju bazu", () => {
  it("tip se određuje iz prvih bajtova", () => {
    expect(detectContentType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(detectContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectContentType(Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 "))).toBe("image/webp");
    expect(detectContentType(Buffer.from("\x00\x00\x00\x18ftypheic"))).toBe("image/heic");
    expect(detectContentType(Buffer.from("MZ\x90\x00\x03"))).toBeNull();
    expect(detectContentType(Buffer.from("<html>"))).toBeNull();
  });

  it("ime fajla se čisti: bez putanje i kontrolnih znakova", () => {
    expect(sanitiseFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitiseFileName("C:\\Users\\Amina\\ljekarski.pdf")).toBe("ljekarski.pdf");
    expect(sanitiseFileName("ljekarski\u0000.pdf")).toBe("ljekarski.pdf");
    expect(sanitiseFileName("   ")).toBe("prilog");
    expect(sanitiseFileName("x".repeat(300))).toHaveLength(200);
  });

  it("ključ objekta nosi firmu — tenant je u putanji, ne u metapodacima", () => {
    expect(objectKey("cmp_a", "obl_1", "att_1")).toBe("gx2/cmp_a/obligations/obl_1/att_1");
  });

  it("bez MINIO varijabli nema podrazumijevanih tajni", () => {
    const config = storageConfig({} as NodeJS.ProcessEnv);
    expect(config.configured).toBe(false);
    if (!config.configured) expect(config.reason).toContain("MINIO");
  });

  it("odbija presign ako browser endpoint nije podešen", () => {
    const config = storageConfig({
      NODE_ENV: "test",
      MINIO_ENDPOINT: "http://minio:9000",
      MINIO_ACCESS_KEY: "ci-access",
      MINIO_SECRET_KEY: "ci-secret-value",
      MINIO_BUCKET: "gradix-stg",
    } as NodeJS.ProcessEnv);
    expect(config.configured).toBe(false);
    if (!config.configured) expect(config.reason).toContain("MINIO_PUBLIC_ENDPOINT");
  });

  it("potpisuje browser link na javnom hostu, a postavlja inline i Content-Type zaglavlja", async () => {
    const config = storageConfig({
      NODE_ENV: "test",
      MINIO_ENDPOINT: "http://minio:9000",
      MINIO_PUBLIC_ENDPOINT: "https://files.gradix.ba101.top",
      MINIO_ACCESS_KEY: "ci-access",
      MINIO_SECRET_KEY: "ci-secret-value",
      MINIO_BUCKET: "gradix-stg",
      MINIO_REGION: "us-east-1",
    } as NodeJS.ProcessEnv);
    expect(config.configured).toBe(true);
    if (!config.configured) return;

    try {
      const upload = await presignUpload({ config, key: "gx2/cmp_a/obligations/obl_a/att_a", contentType: "image/png" });
      const download = await presignDownload({
        config,
        key: "gx2/cmp_a/obligations/obl_a/att_a",
        fileName: "document.png",
        contentType: "image/png",
      });
      const uploadUrl = new URL(upload.url);
      const downloadUrl = new URL(download.url);
      expect(uploadUrl.hostname).toBe("files.gradix.ba101.top");
      expect(downloadUrl.hostname).toBe("files.gradix.ba101.top");
      expect(downloadUrl.searchParams.get("response-content-disposition")).toContain("inline");
      expect(downloadUrl.searchParams.get("response-content-type")).toBe("image/png");
    } finally {
      config.client.destroy();
      if (config.presignClient !== config.client) config.presignClient.destroy();
    }
  });
});
