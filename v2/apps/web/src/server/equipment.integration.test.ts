/**
 * R2a na PRAVOJ bazi: radnici, kategorije mašina, mašine i vozila.
 *
 * Dokazuje ono što se ne vidi iz koda:
 *  1. **kompozitni FK** — mašina ne može dobiti kategoriju druge firme, čak i kad se zaobiđe
 *     aplikacija (direktan SQL). To je razlog zašto `UNIQUE (company_id, id)` postoji.
 *  2. **veza nalog↔radnik** — jedan nalog, najviše jedan radnik; veza ne daje dozvole.
 *  3. **brojilo** — jednosmjerno, osim izričite ispravke; vrsta brojila se ne mijenja kad
 *     brojilo ima vrijednost.
 *  4. **kategorije su podaci** — nova firma dobija 13 zadanih bez ijednog koraka u kodu, a
 *     nepoznata kategorija pri uvozu se ne stvara tiho (mapiranje je u `import-service.ts`).
 *
 * Traži `DATABASE_URL` (gradix_app) i `DATABASE_ADMIN_URL` (vlasnik šeme). Bez njih se testovi
 * PRESKAČU — nikad ne prolaze lažno.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { PATCH as meterRoute } from "@/app/api/equipment/[id]/meter/route";
import { GET as equipmentRoute, POST as createEquipmentRoute } from "@/app/api/equipment/route";
import { GET as categoriesRoute } from "@/app/api/equipment-categories/route";
import { PATCH as linkUserRoute } from "@/app/api/workers/[id]/link-user/route";
import { GET as workersRoute, POST as createWorkerRoute } from "@/app/api/workers/route";
import { getVerifiedPool } from "./db";
import { issueAccessToken, ACCESS_COOKIE } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_r2a_a";
const OTHER = "cmp_r2a_b";
const USER = "usr_r2a_admin";
const USER_OTHER = "usr_r2a_other";

const json = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });

const get = (url: string, cookie?: string) => new NextRequest(url, { headers: cookie ? { cookie } : {} });
const patch = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(url, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", cookie: cookie ?? "" } });

/** Sesija se ne pravi prijavom (to pokriva `api.integration.test.ts`), nego direktnim tokenom. */
async function signIn(userId: string, companyId: string): Promise<string> {
  const { withCompany, companyId: cid } = await import("@gradix/db");
  const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const sessionId = `ses_${userId}`;
  await withCompany(app, cid(companyId), async (client) => {
    await client.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    // `token_hash` je SHA-256 refresh tokena; za test je dovoljan bilo koji jedinstven hash.
    await client.query(
      "INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + interval '1 day')",
      [sessionId, companyId, userId, `hash_${sessionId}`],
    );
  });
  await app.end();
  const token = issueAccessToken({ sub: userId, sid: sessionId, companyId });
  return `${ACCESS_COOKIE}=${token}`;
}

describeDb("R2a (integracija na pravoj bazi)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  let cookieA = "";
  let cookieB = "";

  beforeAll(async () => {
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[COMPANY, OTHER]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER, USER_OTHER]]);
    await admin.query(
      "INSERT INTO companies (id, name, slug) VALUES ($1, 'R2a Firma A', 'r2a-firma-a'), ($2, 'R2a Firma B', 'r2a-firma-b')",
      [COMPANY, OTHER],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'r2a-admin@test.example', 'x', 'Admin', 'A', false),
              ($2, 'r2a-other@test.example', 'x', 'Admin', 'B', false)`,
      [USER, USER_OTHER],
    );
    const { withCompany, companyId } = await import("@gradix/db");
    const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    for (const [company, memberId, userId, role] of [
      [COMPANY, "mem_r2a_a", USER, "ADMIN"],
      [OTHER, "mem_r2a_b", USER_OTHER, "OWNER"],
    ] as const) {
      await withCompany(app, companyId(company), async (client) => {
        await client.query(
          "INSERT INTO memberships (id, user_id, company_id, roles, scope) VALUES ($1, $2, $3, ARRAY[$4]::\"Role\"[], 'COMPANY')",
          [memberId, userId, company, role],
        );
      });
    }
    await app.end();

    cookieA = await signIn(USER, COMPANY);
    cookieB = await signIn(USER_OTHER, OTHER);
  });

  it("nova firma dobija 13 zadanih kategorija bez ijednog koraka u kodu", async () => {
    const response = await categoriesRoute(get("http://interni/api/equipment-categories", cookieA));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { categories: { code: string; meter: string }[] } };
    expect(body.data.categories).toHaveLength(13);
    expect(body.data.categories.map((category) => category.code)).toContain("EXCAVATOR");
    // Kamion i putničko vozilo mjere kilometre, bager sate — zadano po kategoriji.
    expect(body.data.categories.find((category) => category.code === "TRUCK")?.meter).toBe("KM");
    expect(body.data.categories.find((category) => category.code === "EXCAVATOR")?.meter).toBe("HOURS");
  });

  it("radnik se dodaje bez naloga i vidi se u listi", async () => {
    const response = await createWorkerRoute(
      json(
        "http://interni/api/workers",
        { firstName: "Amina", lastName: "Karić", hiredAt: "2025-03-01", engagement: "SEASONAL" },
        cookieA,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { worker: { id: string; userId: string | null; userEmail: string | null } } };
    expect(body.data.worker.userId).toBeNull();

    const list = await workersRoute(get("http://interni/api/workers", cookieA));
    const listed = (await list.json()) as { data: { workers: { lastName: string }[] } };
    expect(listed.data.workers.some((worker) => worker.lastName === "Karić")).toBe(true);
  });

  it("datum prestanka prije početka se odbija", async () => {
    const response = await createWorkerRoute(
      json(
        "http://interni/api/workers",
        { firstName: "X", lastName: "Y", hiredAt: "2025-03-01", endedAt: "2025-02-01" },
        cookieA,
      ),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toContain("prije početka");
  });

  it("mašina dobija zadano brojilo iz kategorije", async () => {
    const categories = (await (await categoriesRoute(get("http://interni/api/equipment-categories", cookieA))).json()) as {
      data: { categories: { id: string; code: string }[] };
    };
    const truck = categories.data.categories.find((category) => category.code === "TRUCK")!;

    const response = await createEquipmentRoute(
      json(
        "http://interni/api/equipment",
        { code: "R2A-KAM-1", name: "Kamion test", categoryId: truck.id },
        cookieA,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { machine: { meter: string; meterValue: number | null } } };
    expect(body.data.machine.meter).toBe("KM");
    expect(body.data.machine.meterValue).toBeNull();
  });

  it("ista oznaka mašine u istoj firmi se odbija", async () => {
    const categories = (await (await categoriesRoute(get("http://interni/api/equipment-categories", cookieA))).json()) as {
      data: { categories: { id: string }[] };
    };
    const response = await createEquipmentRoute(
      json(
        "http://interni/api/equipment",
        { code: "R2A-KAM-1", name: "Duplikat", categoryId: categories.data.categories[0]!.id },
        cookieA,
      ),
    );
    expect(response.status).toBe(409);
  });

  it("kompozitni FK: mašina ne može dobiti kategoriju druge firme (direktan SQL)", async () => {
    const categoriesB = (await (await categoriesRoute(get("http://interni/api/equipment-categories", cookieB))).json()) as {
      data: { categories: { id: string }[] };
    };
    // Idemo mimo aplikacije: kao da je neko poslao categoryId iz druge firme.
    const app = await getVerifiedPool();
    const { withCompany, companyId } = await import("@gradix/db");
    await expect(
      withCompany(app, companyId(COMPANY), async (client) => {
        await client.query(
          "INSERT INTO machines (id, company_id, code, name, category_id) VALUES ('mch_x', $1, 'XX-1', 'X', $2)",
          [COMPANY, categoriesB.data.categories[0]!.id],
        );
      }),
    ).rejects.toThrow(/machines_category_fk|foreign key/i);
  });

  it("mašine druge firme se ne vide", async () => {
    const response = await equipmentRoute(get("http://interni/api/equipment", cookieB));
    const body = (await response.json()) as { data: { machines: { code: string }[] } };
    expect(body.data.machines.some((machine) => machine.code === "R2A-KAM-1")).toBe(false);
  });

  it("brojilo je jednosmjerno, a ispravka ide kroz izričitu potvrdu", async () => {
    const machines = (await (await equipmentRoute(get("http://interni/api/equipment", cookieA))).json()) as {
      data: { machines: { id: string; code: string }[] };
    };
    const machine = machines.data.machines.find((entry) => entry.code === "R2A-KAM-1")!;

    const first = await meterRoute(patch(`http://interni/api/equipment/${machine.id}/meter`, { value: 1200 }, cookieA), {
      params: Promise.resolve({ id: machine.id }),
    });
    expect(first.status).toBe(200);

    const backward = await meterRoute(patch(`http://interni/api/equipment/${machine.id}/meter`, { value: 900 }, cookieA), {
      params: Promise.resolve({ id: machine.id }),
    });
    expect(backward.status).toBe(409);
    const body = (await backward.json()) as { error: { message: string } };
    expect(body.error.message).toContain("manja od upisane");

    const corrected = await meterRoute(
      patch(`http://interni/api/equipment/${machine.id}/meter`, { value: 900, correct: true }, cookieA),
      { params: Promise.resolve({ id: machine.id }) },
    );
    expect(corrected.status).toBe(200);
    const after = (await corrected.json()) as { data: { machine: { meterValue: number } } };
    expect(after.data.machine.meterValue).toBe(900);

    // Ispravka je u tragu sa starom i novom vrijednošću.
    const trail = await admin.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events WHERE entity_id = $1 AND action = 'equipment.meter_corrected'",
      [machine.id],
    );
    expect(trail.rowCount).toBe(1);
    expect(trail.rows[0]!.metadata).toMatchObject({ from: 1200, to: 900 });
  });

  it("vrsta brojila se ne mijenja kad brojilo ima vrijednost", async () => {
    const machines = (await (await equipmentRoute(get("http://interni/api/equipment", cookieA))).json()) as {
      data: { machines: { id: string; code: string; categoryId: string }[] };
    };
    const machine = machines.data.machines.find((entry) => entry.code === "R2A-KAM-1")!;
    const { PATCH: updateRoute } = await import("@/app/api/equipment/[id]/route");
    const response = await updateRoute(
      patch(`http://interni/api/equipment/${machine.id}`, { name: "Kamion test", categoryId: machine.categoryId, meter: "HOURS" }, cookieA),
      { params: Promise.resolve({ id: machine.id }) },
    );
    expect(response.status).toBe(409);
  });

  it("veza radnik↔nalog: jedan nalog, najviše jedan radnik", async () => {
    const list = (await (await workersRoute(get("http://interni/api/workers", cookieA))).json()) as {
      data: { workers: { id: string; lastName: string }[] };
    };
    const worker = list.data.workers.find((entry) => entry.lastName === "Karić")!;

    const linked = await linkUserRoute(
      patch(`http://interni/api/workers/${worker.id}/link-user`, { userId: USER }, cookieA),
      { params: Promise.resolve({ id: worker.id }) },
    );
    expect(linked.status).toBe(200);
    const body = (await linked.json()) as { data: { worker: { userId: string; userEmail: string } } };
    expect(body.data.worker.userId).toBe(USER);
    expect(body.data.worker.userEmail).toBe("r2a-admin@test.example");

    // Nalog ne dobija dozvole vezom: role ostaju ADMIN, ne mijenjaju se.
    const roles = await admin.query<{ roles: string[] }>("SELECT roles::text[] AS roles FROM memberships WHERE user_id = $1 AND company_id = $2", [
      USER,
      COMPANY,
    ]);
    expect(roles.rows[0]!.roles).toEqual(["ADMIN"]);

    // Drugi radnik na isti nalog — odbijeno.
    const second = await createWorkerRoute(
      json("http://interni/api/workers", { firstName: "Drugi", lastName: "Radnik", hiredAt: "2025-05-01" }, cookieA),
    );
    const secondId = ((await second.json()) as { data: { worker: { id: string } } }).data.worker.id;
    const conflict = await linkUserRoute(
      patch(`http://interni/api/workers/${secondId}/link-user`, { userId: USER }, cookieA),
      { params: Promise.resolve({ id: secondId }) },
    );
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { message: string } }).error.message).toContain("već povezan");

    // Odvezivanje vraća radnika na „bez naloga“.
    const unlinked = await linkUserRoute(
      patch(`http://interni/api/workers/${worker.id}/link-user`, { userId: null }, cookieA),
      { params: Promise.resolve({ id: worker.id }) },
    );
    expect(unlinked.status).toBe(200);
    expect(((await unlinked.json()) as { data: { worker: { userId: string | null } } }).data.worker.userId).toBeNull();
  });

  it("nalog koji nije član firme se ne može povezati", async () => {
    const list = (await (await workersRoute(get("http://interni/api/workers", cookieA))).json()) as {
      data: { workers: { id: string }[] };
    };
    const response = await linkUserRoute(
      patch(`http://interni/api/workers/${list.data.workers[0]!.id}/link-user`, { userId: USER_OTHER }, cookieA),
      { params: Promise.resolve({ id: list.data.workers[0]!.id }) },
    );
    expect(response.status).toBe(404);
  });
});
