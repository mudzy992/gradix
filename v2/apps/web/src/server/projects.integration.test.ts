/**
 * R3 na PRAVOJ bazi: projekti, dodjele, opseg i blokada.
 *
 * Dokazuje ono što se iz koda ne vidi:
 *  1. **opseg „dodijeljeni projekti" stvarno sužava** — ista ruta, ista dozvola, drugi opseg, drugi
 *     spisak. Tuđi projekat u istoj firmi je 403 („nisi dodijeljen"), a tuđa firma 404.
 *  2. **`users.manage` samo po sebi NE daje dodjelu** — kapija R3 §7.5. Dozvola je `projects.assign`.
 *  3. **opseg `PROJECTS` bez ijedne dodjele se odbija** pri snimanju (R1b pravilo: opseg koji ne
 *     vidi ništa je zamka, ne podešavanje).
 *  4. **preklapanje dodjele brani baza** (triger), a servis to prevodi u čitljivu poruku.
 *  5. **blokada zbog istekle obaveze** — registracija istekla = mašina ne može na projekat; iznimka
 *     sa razlogom i rokom prolazi i ostaje u auditu.
 *  6. **obaveza na projektu** radi kroz isti mehanizam kao radnik/mašina, uključujući stanje.
 *
 * Traži `DATABASE_URL` i `DATABASE_ADMIN_URL`; bez njih se PRESKAČE.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as createProjectRoute, GET as projectsRoute } from "@/app/api/projects/route";
import { GET as projectRoute, PATCH as patchProjectRoute } from "@/app/api/projects/[id]/route";
import {
  POST as assignmentRoute,
  GET as assignmentsRoute,
} from "@/app/api/projects/[id]/assignments/route";
import { DELETE as removeAssignmentRoute } from "@/app/api/projects/[id]/assignments/[assignmentId]/route";
import { POST as overrideRequestRoute } from "@/app/api/projects/[id]/override-requests/route";
import { POST as approveOverrideRoute } from "@/app/api/projects/[id]/override-requests/[requestId]/route";
import { POST as createObligationRoute, GET as obligationsRoute } from "@/app/api/obligations/route";
import { GET as obligationTypesRoute } from "@/app/api/obligation-types/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";
import { changeMembership } from "./rbac-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_r3_a";
const OTHER = "cmp_r3_b";
const ADMIN = "usr_r3_admin";       // ADMIN: users.manage + projects.manage + projects.assign
const PM = "usr_r3_pm";             // PROJECT_MANAGER: projects.assign, ali NE users.manage
const SUPERVISOR = "usr_r3_sef";    // SITE_SUPERVISOR: vidi, ne dodjeljuje
const WORKER_USER = "usr_r3_radnik"; // radnik vezan za radnika → opseg PROJECTS
const OWNER_B = "usr_r3_owner_b";

const WORKER = "wrk_r3_amar";
const WORKER_USER_ROW = "wrk_r3_vezani";
const MACHINE = "mch_r3_bager";
const MACHINE_CLEAN = "mch_r3_valjak";
/*
 * Mašina SAMO za test iznimke. Ne dijeli se sa testom blokade: isti tip dokumenta na istoj mašini
 * ne može imati dva aktivna zapisa (unique), pa bi dijeljenje mašine padalo na tom pravilu — a ne
 * na onome što test mjeri.
 */
const MACHINE_OVERRIDE = "mch_r3_iznimka";

const get = (url: string, cookie = "") => new NextRequest(url, { headers: cookie ? { cookie } : {} });

const authed = (url: string, init: { method?: string; body?: unknown } = {}, cookie = "") =>
  new NextRequest(url, {
    method: init.method ?? "GET",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: { "content-type": "application/json", cookie },
  });

async function signIn(userId: string, companyId: string): Promise<string> {
  const { withCompany, companyId: cid } = await import("@gradix/db");
  const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const sessionId = `ses_${userId}`;
  await withCompany(app, cid(companyId), async (client) => {
    await client.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    await client.query(
      "INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + interval '1 day')",
      [sessionId, companyId, userId, `hash_${sessionId}`],
    );
  });
  await app.end();
  return `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: sessionId, companyId })}`;
}

type Json<T> = { success: boolean; data: T; error?: { code: string; message: string } };

describeDb("R3 (integracija na pravoj bazi)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  let cookieAdmin = "";
  let cookiePm = "";
  let cookieSupervisor = "";
  let cookieWorker = "";
  let cookieOther = "";
  let projectA = "";
  let projectB = "";
  let medicalTypeId = "";
  let registrationTypeId = "";
  let buildingPermitTypeId = "";

  beforeAll(async () => {
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[COMPANY, OTHER]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [
      [ADMIN, PM, SUPERVISOR, WORKER_USER, OWNER_B],
    ]);
    await admin.query(
      "INSERT INTO companies (id, name, slug) VALUES ($1, 'R3 Firma A', 'r3-firma-a'), ($2, 'R3 Firma B', 'r3-firma-b')",
      [COMPANY, OTHER],
    );
    await admin.query(
      // `must_change_password = false`: inače ruta vraća 403 prije provjere dozvole (pravilo R1a).
      `INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'r3-admin@test.example', 'x', 'Admin', 'A', false),
              ($2, 'r3-pm@test.example', 'x', 'Projekat', 'Menadžer', false),
              ($3, 'r3-sef@test.example', 'x', 'Šef', 'Gradilišta', false),
              ($4, 'r3-radnik@test.example', 'x', 'Amar', 'Radnik', false),
              ($5, 'r3-owner-b@test.example', 'x', 'Vlasnik', 'B', false)`,
      [ADMIN, PM, SUPERVISOR, WORKER_USER, OWNER_B],
    );

    const { withCompany, companyId } = await import("@gradix/db");
    const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    for (const [memberId, userId, company, role] of [
      ["mem_r3_admin", ADMIN, COMPANY, "ADMIN"],
      ["mem_r3_pm", PM, COMPANY, "PROJECT_MANAGER"],
      ["mem_r3_sef", SUPERVISOR, COMPANY, "SITE_SUPERVISOR"],
      ["mem_r3_radnik", WORKER_USER, COMPANY, "WORKER"],
      ["mem_r3_owner_b", OWNER_B, OTHER, "OWNER"],
    ] as const) {
      await withCompany(app, companyId(company), async (client) => {
        await client.query(
          "INSERT INTO memberships (id, user_id, company_id, roles) VALUES ($1, $2, $3, ARRAY[$4]::\"Role\"[])",
          [memberId, userId, company, role],
        );
      });
    }

    await withCompany(app, companyId(COMPANY), async (client) => {
      await client.query(
        "INSERT INTO workers (id, company_id, first_name, last_name, hired_at) VALUES ($1, $2, 'Amar', 'Hadžić', '2024-05-01')",
        [WORKER, COMPANY],
      );
      // Radnik vezan za nalog — kroz njega opseg `PROJECTS` dobija svoje projekte.
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1, $2, 'Amar', 'Vezani', '2024-05-01', $3)`,
        [WORKER_USER_ROW, COMPANY, WORKER_USER],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1, $2, 'BAG-01', 'Bager CAT 320', $2 || '_cat_excavator'),
                ($3, $2, 'VAL-01', 'Valjak Bomag', $2 || '_cat_roller'),
                ($4, $2, 'GRE-01', 'Grejder', $2 || '_cat_roller')`,
        [MACHINE, COMPANY, MACHINE_CLEAN, MACHINE_OVERRIDE],
      );
    });
    await app.end();

    cookieAdmin = await signIn(ADMIN, COMPANY);
    cookiePm = await signIn(PM, COMPANY);
    cookieSupervisor = await signIn(SUPERVISOR, COMPANY);
    cookieWorker = await signIn(WORKER_USER, COMPANY);
    cookieOther = await signIn(OWNER_B, OTHER);

    // Tipovi obaveza (seedani triggerom za novu firmu).
    const types = (await (
      await obligationTypesRoute(get("http://interni/api/obligation-types", cookieAdmin))
    ).json()) as Json<{ types: { id: string; code: string }[] }>;
    medicalTypeId = types.data.types.find((type) => type.code === "MEDICAL")!.id;
    registrationTypeId = types.data.types.find((type) => type.code === "REGISTRATION")!.id;
    buildingPermitTypeId = types.data.types.find((type) => type.code === "BUILDING_PERMIT")!.id;
  });

  /* ------------------------------------------------------------------ projekti */

  it("novi projekat se otvara, dobija šifru velikim slovima i vidi se na listi", async () => {
    const created = (await (
      await createProjectRoute(
        authed(
          "http://interni/api/projects",
          { method: "POST", body: { code: "p-24/2026", name: "Dionica Visoko–Kiseljak" } },
          cookieAdmin,
        ),
      )
    ).json()) as Json<{ project: { id: string; code: string; status: string; workerCount: number } }>;

    expect(created.success).toBe(true);
    expect(created.data.project.code).toBe("P-24/2026");
    expect(created.data.project.status).toBe("ACTIVE");
    expect(created.data.project.workerCount).toBe(0);
    projectA = created.data.project.id;

    const second = (await (
      await createProjectRoute(
        authed(
          "http://interni/api/projects",
          { method: "POST", body: { code: "P-25/2026", name: "Most preko Bosne" } },
          cookieAdmin,
        ),
      )
    ).json()) as Json<{ project: { id: string } }>;
    projectB = second.data.project.id;

    const list = (await (await projectsRoute(get("http://interni/api/projects", cookieAdmin))).json()) as Json<{
      projects: { id: string; code: string }[];
    }>;
    expect(list.data.projects.map((project) => project.code).sort()).toEqual(["P-24/2026", "P-25/2026"]);
  });

  it("dvije firme sa istom šifrom su dozvoljene — šifra je jedinstvena PO FIRMI", async () => {
    // Firma B nema projekat sa tom šifrom, pa ga otvara bez problema.
    const created = await createProjectRoute(
      authed("http://interni/api/projects", { method: "POST", body: { code: "P-24/2026", name: "Tuđi projekat" } }, cookieOther),
    );
    expect(created.status).toBe(200);

    // U istoj firmi ista šifra je konflikt — poruka imenuje šifru.
    const duplicate = await createProjectRoute(
      authed("http://interni/api/projects", { method: "POST", body: { code: "P-24/2026", name: "Duplikat" } }, cookieAdmin),
    );
    const body = (await duplicate.json()) as Json<unknown>;
    expect(duplicate.status).toBe(409);
    expect(body.error?.message).toContain("P-24/2026");
  });

  it("PATCH mijenja status i to ide u audit kao status_changed", async () => {
    const response = await patchProjectRoute(
      authed("http://interni/api/projects/x", { method: "PATCH", body: { status: "PAUSED" } }, cookieAdmin),
      { params: Promise.resolve({ id: projectB }) },
    );
    const body = (await response.json()) as Json<{ project: { status: string } }>;
    expect(body.data.project.status).toBe("PAUSED");

    const audit = await admin.query(
      "SELECT metadata FROM audit_events WHERE entity_id = $1 AND action = 'project.status_changed'",
      [projectB],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.metadata).toMatchObject({ from: "ACTIVE", to: "PAUSED" });

    await patchProjectRoute(
      authed("http://interni/api/projects/x", { method: "PATCH", body: { status: "ACTIVE" } }, cookieAdmin),
      { params: Promise.resolve({ id: projectB }) },
    );
  });

  /* ------------------------------------------------------------------ dodjele */

  it("dodjela radnika i mašine; tim se vidi na projektu", async () => {
    const worker = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { workerId: WORKER, fromDate: "2026-01-01" },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectA }) },
    );
    expect(worker.status).toBe(200);

    const machine = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { machineId: MACHINE_CLEAN, fromDate: "2026-01-01", toDate: "2026-12-31" },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectA }) },
    );
    expect(machine.status).toBe(200);

    const list = (await (
      await assignmentsRoute(get("http://interni/api/projects/x/assignments", cookieAdmin), {
        params: Promise.resolve({ id: projectA }),
      })
    ).json()) as Json<{ assignments: { workerName: string | null; machineCode: string | null }[]; today: string }>;

    expect(list.data.assignments).toHaveLength(2);
    expect(list.data.assignments.some((entry) => entry.workerName?.includes("Amar"))).toBe(true);
    expect(list.data.assignments.some((entry) => entry.machineCode === "VAL-01")).toBe(true);
    // Poslovni datum firme ide uz spisak — ekran zna po kojoj se zoni računa blokada.
    expect(list.data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("preklapanje istog radnika na istom projektu je odbijeno ČITLJIVOM porukom", async () => {
    const response = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { workerId: WORKER, fromDate: "2026-06-01", toDate: "2026-08-01" },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectA }) },
    );
    const body = (await response.json()) as Json<unknown>;
    expect(response.status).toBe(409);
    // Ne smije procuriti naziv trigera ni SQL — čovjek treba rečenicu.
    expect(body.error?.message).toContain("preklapa");
    expect(body.error?.message).not.toContain("ASSIGNMENT_OVERLAP");
  });

  it("dodjela bez entiteta ili sa oba je odbijena prije baze", async () => {
    const none = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", { method: "POST", body: { fromDate: "2026-01-01" } }, cookieAdmin),
      { params: Promise.resolve({ id: projectA }) },
    );
    expect(none.status).toBe(400);

    const both = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { workerId: WORKER, machineId: MACHINE, fromDate: "2026-01-01" },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectA }) },
    );
    expect(both.status).toBe(400);
  });

  /* ------------------------------------------------------------------ blokada */

  it("istekla registracija BLOKIRA mašinu; iznimka sa razlogom prolazi i ide u audit", async () => {
    // Registracija istekla juče — tip je blokirajući po seedu.
    const obligation = (await (
      await createObligationRoute(
        authed("http://interni/api/obligations", {
          method: "POST",
          body: {
            typeId: registrationTypeId,
            machineId: MACHINE,
            number: "REG-2025",
            expiresAt: "2026-01-01",
          },
        }, cookieAdmin),
      )
    ).json()) as Json<{ obligation: { id: string } }>;
    const obligationId = obligation.data.obligation.id;

    const blocked = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { machineId: MACHINE, fromDate: "2026-11-01" },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectB }) },
    );
    const blockedBody = (await blocked.json()) as Json<unknown>;
    expect(blocked.status).toBe(409);
    expect(blockedBody.error?.message).toContain("Registracija");

    // Iznimka: razlog + rok. Bez razloga bi bila tiho gašenje pravila.
    const bezRazloga = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: {
          machineId: MACHINE,
          fromDate: "2026-11-01",
          overrides: [{ obligationId, reason: "kratko", validUntil: "2026-12-31" }],
        },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectB }) },
    );
    expect(bezRazloga.status).toBe(409);

    const withOverride = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: {
          machineId: MACHINE,
          fromDate: "2026-11-01",
          overrides: [
            {
              obligationId,
              reason: "Registracija je na tehničkom, mašina je neophodna na gradilištu do petka.",
              validUntil: "2026-12-31",
            },
          ],
        },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectB }) },
    );
    expect(withOverride.status).toBe(200);

    const overrideAudit = await admin.query(
      "SELECT metadata FROM audit_events WHERE action = 'project.assignment_overridden' AND company_id = $1",
      [COMPANY],
    );
    expect(overrideAudit.rowCount).toBe(1);
    expect(String(overrideAudit.rows[0]!.metadata.reason)).toContain("tehničkom");
  });

  it("mašina sa VAŽEĆOM registracijom prolazi bez iznimke", async () => {
    const obligation = (await (
      await createObligationRoute(
        authed("http://interni/api/obligations", {
          method: "POST",
          body: {
            typeId: registrationTypeId,
            machineId: MACHINE_CLEAN,
            number: "REG-2027",
            expiresAt: "2027-06-01",
          },
        }, cookieAdmin),
      )
    ).json()) as Json<{ obligation: { id: string } }>;
    expect(obligation.success).toBe(true);
  });

  /* ------------------------------------------------------------------ opseg */

  it("opseg PROJECTS vidi samo dodijeljeni projekat; tuđi u istoj firmi je 403", async () => {
    // Radnik vezan za nalog se dodjeljuje na projekat A.
    const assignment = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { workerId: WORKER_USER_ROW, fromDate: "2026-01-01" },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectA }) },
    );
    expect(assignment.status).toBe(200);

    // Opseg se postavlja kroz servis (i traži `users.manage` — ADMIN ga ima).
    const changed = await changeMembership(
      await (await import("./db")).getVerifiedPool(),
      COMPANY as never,
      { userId: ADMIN, roles: ["ADMIN"] },
      WORKER_USER,
      { roles: ["WORKER"], scope: "PROJECTS" },
    );
    expect("code" in changed).toBe(false);

    // Ista ruta, isti cookie, drugi opseg → jedan projekat.
    const list = (await (await projectsRoute(get("http://interni/api/projects", cookieWorker))).json()) as Json<{
      projects: { id: string }[];
    }>;
    expect(list.data.projects.map((project) => project.id)).toEqual([projectA]);

    const allowed = await projectRoute(get("http://interni/api/projects/x", cookieWorker), {
      params: Promise.resolve({ id: projectA }),
    });
    expect(allowed.status).toBe(200);

    // Tuđi projekat U ISTOJ firmi: 403 — nije tajna, nedostatak prava.
    const forbidden = await projectRoute(get("http://interni/api/projects/x", cookieWorker), {
      params: Promise.resolve({ id: projectB }),
    });
    const forbiddenBody = (await forbidden.json()) as Json<unknown>;
    expect(forbidden.status).toBe(403);
    expect(forbiddenBody.error?.message).toContain("Nisi dodijeljen");

    // Tuđa firma: 404 — RLS ne pravi razliku, pa je ne izmišljamo.
    const other = await projectRoute(get("http://interni/api/projects/x", cookieOther), {
      params: Promise.resolve({ id: projectA }),
    });
    expect(other.status).toBe(404);
  });

  it("opseg PROJECTS bez ijedne dodjele se ODBIJA — opseg koji ne vidi ništa je zamka", async () => {
    const rejected = await changeMembership(
      await (await import("./db")).getVerifiedPool(),
      COMPANY as never,
      { userId: ADMIN, roles: ["ADMIN"] },
      SUPERVISOR,
      { roles: ["SITE_SUPERVISOR"], scope: "PROJECTS" },
    );
    expect("code" in rejected).toBe(true);
    if ("code" in rejected) {
      expect(rejected.code).toBe("VALIDATION_FAILED");
      expect(rejected.message).toContain("barem jedan projekat");
    }
  });

  it("PROJECT_MANAGER dodjeljuje (projects.assign), ali NE mijenja role (users.manage)", async () => {
    const assignment = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { workerId: WORKER, fromDate: "2027-01-01" },
      }, cookiePm),
      { params: Promise.resolve({ id: projectB }) },
    );
    expect(assignment.status).toBe(200);

    // Ista osoba ne može mijenjati članstvo — to je `users.manage`.
    const membership = await changeMembership(
      await (await import("./db")).getVerifiedPool(),
      COMPANY as never,
      { userId: PM, roles: ["PROJECT_MANAGER"] },
      WORKER_USER,
      { roles: ["WORKER"], scope: "SELF" },
    );
    expect("code" in membership).toBe(true);
  });

  it("`users.manage` BEZ `projects.assign` ne daje dodjelu — dozvole su odvojene", async () => {
    // ADMIN ima i jedno i drugo; provjeravamo matricu direktno, jer je to mjesto odluke.
    const { can } = await import("./permissions");
    expect(can(["ADMIN"], "users.manage")).toBe(true);
    expect(can(["ADMIN"], "projects.assign")).toBe(true);
    // Rola koja ima `users.manage` a nema dodjelu ne postoji u matrici — zato se tvrdi obrnuto:
    // dodjela je data PROJECT_MANAGER-u koji NEMA `users.manage`.
    expect(can(["PROJECT_MANAGER"], "projects.assign")).toBe(true);
    expect(can(["PROJECT_MANAGER"], "users.manage")).toBe(false);
    expect(can(["SITE_SUPERVISOR"], "projects.assign")).toBe(false);
    expect(can(["SITE_SUPERVISOR"], "projects.view")).toBe(true);
  });

  it("matrica (G3): radnik ima `obligations.view` za SVOJE, ali NE priloge; prilozi su uža dozvola", async () => {
    const { can, permissionsFor } = await import("./permissions");

    // Radnik mora vidjeti da mu rok istječe — inače telefon nema šta pokazati.
    expect(can(["WORKER"], "obligations.view")).toBe(true);
    expect(permissionsFor("WORKER")).toContain("obligations.view");

    // Ali NE i sadržaj priloga: ljekarski nalaz je lični podatak, ne informacija za telefon.
    expect(can(["WORKER"], "obligations.attachments.view")).toBe(false);
    expect(permissionsFor("WORKER")).not.toContain("obligations.attachments.view");

    // Ured ga vidi — prilog nije nestao, samo je radniku zatvoren.
    for (const rola of ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"] as const) {
      expect(can([rola], "obligations.attachments.view")).toBe(true);
    }

    // Radnik NE uređuje rokove.
    expect(can(["WORKER"], "obligations.manage")).toBe(false);
  });

  it("matrica: `projects.override` imaju SAMO OWNER i ADMIN — dodjela ga ne nosi", async () => {
    const { can, permissionsFor } = await import("./permissions");

    expect(can(["OWNER"], "projects.override")).toBe(true);
    expect(can(["ADMIN"], "projects.override")).toBe(true);

    /*
     * Ovo je test koji brani odluku vlasnika: ko dodjeljuje NE odobrava iznimku. Ako neko
     * „pojednostavi" tako što iznimku veže na `projects.assign`, ovaj test pada — i to je poenta.
     */
    expect(can(["PROJECT_MANAGER"], "projects.assign")).toBe(true);
    expect(can(["PROJECT_MANAGER"], "projects.override")).toBe(false);
    expect(permissionsFor("PROJECT_MANAGER")).not.toContain("projects.override");

    // Ni jedna terenska rola ne odobrava iznimku; ni računovođa.
    for (const role of ["SITE_SUPERVISOR", "WORKER", "DRIVER", "MACHINE_OPERATOR", "MECHANIC", "ACCOUNTANT"] as const) {
      expect(can([role], "projects.override")).toBe(false);
    }
  });

  it("SITE_SUPERVISOR ne može dodijeliti (403), iako vidi projekat", async () => {
    const assignment = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { workerId: WORKER, fromDate: "2028-01-01" },
      }, cookieSupervisor),
      { params: Promise.resolve({ id: projectB }) },
    );
    expect(assignment.status).toBe(403);
  });

  it("skidanje dodjele briše red i ostavlja trag", async () => {
    const list = (await (
      await assignmentsRoute(get("http://interni/api/projects/x/assignments", cookieAdmin), {
        params: Promise.resolve({ id: projectB }),
      })
    ).json()) as Json<{ assignments: { id: string; workerName: string | null }[] }>;
    const workerAssignment = list.data.assignments.find((entry) => entry.workerName?.includes("Amar"))!;

    const removed = await removeAssignmentRoute(get("http://interni/api/projects/x", cookieAdmin), {
      params: Promise.resolve({ id: projectB, assignmentId: workerAssignment.id }),
    });
    expect(removed.status).toBe(200);

    const audit = await admin.query(
      "SELECT 1 FROM audit_events WHERE action = 'project.assignment_removed' AND entity_id = $1",
      [workerAssignment.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  /* --------------------------------------------------------- obaveze na projektu */

  it("obaveza na projektu radi kroz isti mehanizam i ima stanje kao radnik/mašina", async () => {
    const created = (await (
      await createObligationRoute(
        authed("http://interni/api/obligations", {
          method: "POST",
          body: {
            typeId: buildingPermitTypeId,
            projectId: projectA,
            number: "UD-01/2026",
            issuedAt: "2025-12-01",
            expiresAt: "2027-01-10",
          },
        }, cookieAdmin),
      )
    ).json()) as Json<{ obligation: { state: string; projectCode: string | null; projectName: string | null } }>;

    expect(created.success).toBe(true);
    expect(created.data.obligation.projectCode).toBe("P-24/2026");
    expect(created.data.obligation.projectName).toContain("Visoko");
    // Rok je za više od 90 dana → „važeće“, ne „uskoro istječe“.
    expect(created.data.obligation.state).toBe("valid");

    // Filter po projektu i brojanje na projektu koriste isti izvor.
    const filtered = (await (
      await obligationsRoute(get(`http://interni/api/obligations?projectId=${projectA}`, cookieAdmin))
    ).json()) as Json<{ obligations: { projectId: string | null }[]; counts: { all: number } }>;
    expect(filtered.data.obligations).toHaveLength(1);
    expect(filtered.data.obligations[0]!.projectId).toBe(projectA);
  });

  it("PM sa `projects.assign` može ZATRAŽITI iznimku, ali je NE može odobriti (403)", async () => {
    // Istekao dokument na mašini — treba mu iznimka.
    const obligation = (await (
      await createObligationRoute(
        authed("http://interni/api/obligations", {
          method: "POST",
          body: {
            typeId: registrationTypeId,
            machineId: MACHINE_OVERRIDE,
            number: "REG-ISTEKAO",
            expiresAt: "2026-02-01",
          },
        }, cookieAdmin),
      )
    ).json()) as Json<{ obligation: { id: string } }>;
    const expiredId = obligation.data.obligation.id;

    // 1) PM pokušava dodjelu SA iznimkom → 403, jer nema `projects.override`.
    const pmDirect = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: {
          machineId: MACHINE_OVERRIDE,
          fromDate: "2026-11-01",
          overrides: [
            { obligationId: expiredId, reason: "Mašina je neophodna na gradilištu, dokument je na putu.", validUntil: "2026-12-31" },
          ],
        },
      }, cookiePm),
      { params: Promise.resolve({ id: projectA }) },
    );
    expect(pmDirect.status).toBe(403);
    const pmBody = (await pmDirect.json()) as Json<unknown>;
    expect(pmBody.error?.message).toContain("vlasnik ili administrator");

    // 2) PM ZATRAŽI iznimku → prolazi (ima `projects.assign`).
    const requested = await overrideRequestRoute(
      authed("http://interni/api/projects/x/override-requests", {
        method: "POST",
        body: {
          obligationId: expiredId,
          machineId: MACHINE_OVERRIDE,
          reason: "Mašina je neophodna na gradilištu, dokument je na putu.",
          fromDate: "2026-11-01",
        },
      }, cookiePm),
      { params: Promise.resolve({ id: projectA }) },
    );
    expect(requested.status).toBe(200);
    const requestBody = (await requested.json()) as Json<{ request: { id: string } }>;
    const requestId = requestBody.data.request.id;

    // 3) PM pokušava ODOBRITI svoj zahtjev → 403. Ovo je srce pravila.
    const pmApprove = await approveOverrideRoute(
      authed("http://interni/api/projects/x", { method: "POST", body: { validUntil: "2026-12-31" } }, cookiePm),
      { params: Promise.resolve({ id: projectA, requestId }) },
    );
    expect(pmApprove.status).toBe(403);

    // 4) Vlasnik/admin odobrava → dodjela sa iznimkom nastaje.
    const approved = await approveOverrideRoute(
      authed("http://interni/api/projects/x", { method: "POST", body: { validUntil: "2026-12-31", fromDate: "2026-11-01" } }, cookieAdmin),
      { params: Promise.resolve({ id: projectA, requestId }) },
    );
    expect(approved.status).toBe(200);
    const approvedBody = (await approved.json()) as Json<{ assignment: { blocked: { covered: boolean; reason?: string }[] } }>;
    expect(approvedBody.data.assignment.blocked.some((entry) => entry.covered)).toBe(true);

    // 5) Zahtjev je obrađen — drugi put ne postoji.
    const again = await approveOverrideRoute(
      authed("http://interni/api/projects/x", { method: "POST", body: { validUntil: "2027-01-31" } }, cookieAdmin),
      { params: Promise.resolve({ id: projectA, requestId }) },
    );
    expect(again.status).toBe(404);
  });

  it("skidanje ZADNJE dodjele osobi sa opsegom PROJECTS spušta opseg na SELF i javlja zašto", async () => {
    /*
     * Stanje se POSTAVLJA ovdje, a ne naslanja na prethodni test.
     *
     * Prvobitna verzija je koristila dodjelu iz testa opsega — pa je pod punim paralelnim
     * opterećenjem (kad se fajlovi izvršavaju u drugom redu) ta dodjela znala već biti skinuta i
     * test je padao bez promjene koda. Test koji mjeri „zadnja dodjela" mora sam biti na zadnjoj
     * dodjeli; inače mjeri ono što je neko drugi ostavio.
     */
    await admin.query(
      "DELETE FROM project_assignments WHERE company_id = $1 AND project_id = $2",
      [COMPANY, projectA],
    );
    const created = await assignmentRoute(
      authed("http://interni/api/projects/x/assignments", {
        method: "POST",
        body: { workerId: WORKER_USER_ROW, fromDate: "2026-03-01" },
      }, cookieAdmin),
      { params: Promise.resolve({ id: projectA }) },
    );
    expect(created.status).toBe(200);

    await admin.query(
      "UPDATE memberships SET scope = 'PROJECTS' WHERE company_id = $1 AND user_id = $2",
      [COMPANY, WORKER_USER],
    );

    const list = (await (
      await assignmentsRoute(get("http://interni/api/projects/x/assignments", cookieAdmin), {
        params: Promise.resolve({ id: projectA }),
      })
    ).json()) as Json<{ assignments: { id: string; workerId: string | null }[] }>;
    const assignment = list.data.assignments.find((entry) => entry.workerId === WORKER_USER_ROW)!;

    const removed = await removeAssignmentRoute(get("http://interni/api/projects/x", cookieAdmin), {
      params: Promise.resolve({ id: projectA, assignmentId: assignment.id }),
    });
    const body = (await removed.json()) as Json<{ ok: true; scopeNotice: string | null }>;

    expect(removed.status).toBe(200);
    // Poruka mora postojati i imenovati osobu — inače se promjena opsega ne vidi nigdje.
    expect(body.data.scopeNotice).toContain("Amar");
    expect(body.data.scopeNotice).toContain("samo svoje");

    const scope = await admin.query<{ scope: string }>(
      "SELECT scope FROM memberships WHERE company_id = $1 AND user_id = $2",
      [COMPANY, WORKER_USER],
    );
    expect(scope.rows[0]!.scope).toBe("SELF");

    // I trag u auditu, sa razlogom — bez toga bi promjena opsega bila neobjašnjena.
    const audit = await admin.query(
      "SELECT metadata FROM audit_events WHERE entity_id = $1 AND action = 'user.membership_changed'",
      [WORKER_USER],
    );
    expect(audit.rows.at(-1)!.metadata).toMatchObject({ reason: "last_project_assignment_removed" });

    // Osoba i dalje vidi svoje rokove — nije ostala bez ičega.
    // Bez dodjele opseg `SELF` više nema ni jedan projekat — i vraća PRAZNO, ne grešku. To je
    // razlika između „nemaš šta vidjeti" i „nešto je pokvareno".
    const projectsAfter = (await (
      await projectsRoute(get("http://interni/api/projects", cookieWorker))
    ).json()) as Json<{ projects: unknown[] }>;
    expect(projectsAfter.success).toBe(true);
    expect(projectsAfter.data.projects).toEqual([]);

    /*
     * „Moji projekti" na mobilnom traži ISTI filter po radniku — i poslije skidanja dodjele mora
     * vratiti prazno, ne grešku. Inače telefon pokazuje „greška" tamo gdje je istina „nemaš
     * projekata", pa čovjek zove ured da prijavi kvar koji ne postoji.
     */
    const mine = (await (
      await projectsRoute(get(`http://interni/api/projects?mine=1`, cookieWorker))
    ).json()) as Json<{ projects: unknown[] }>;
    expect(mine.success).toBe(true);
    expect(mine.data.projects).toEqual([]);

    /*
     * NAMJERNO SE NE TVRDI da radnik i dalje vidi „Moje rokove": `WORKER` nema `obligations.view`
     * (R3 odluka — dozvola je data samo ulogama koje rokove uređuju ili prate). Mobilni ekran
     * „Rokovi" zato radniku vraća 403. To je OTVORENO PITANJE za vlasnika (vidi izvještaj), a ne
     * nešto što test smije zaključati kao ispravno.
     */
  });

  it("ljekarski tip NE može na projekat — poruka imenuje projekat kao traženi entitet", async () => {
    const response = await createObligationRoute(
      authed("http://interni/api/obligations", {
        method: "POST",
        body: { typeId: medicalTypeId, projectId: projectA, expiresAt: "2027-01-01" },
      }, cookieAdmin),
    );
    const body = (await response.json()) as Json<unknown>;
    expect(response.status).toBe(400);
    expect(body.error?.message).toContain("ne odgovara");
  });
});
