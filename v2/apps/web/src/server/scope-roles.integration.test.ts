/**
 * A2.4: Pregled/Projekti/Rokovi opseg po rolama na pravoj bazi.
 * WORKER i DRIVER (SELF): samo projekti svojih dodjela i samo svoji rokovi.
 * ACCOUNTANT (COMPANY): ono što matrica daje — projekti i rokovi cijele firme.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { GET as projectsRoute } from "@/app/api/projects/route";
import { GET as obligationsRoute, POST as createObligationRoute } from "@/app/api/obligations/route";
import { GET as obligationTypesRoute } from "@/app/api/obligation-types/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_scr_${RUN}`;
const PA = `prj_scr_a_${RUN}`;
const PB = `prj_scr_b_${RUN}`;

const USERS = {
  owner: `usr_scr_owner_${RUN}`,
  driver: `usr_scr_driver_${RUN}`,
  worker: `usr_scr_worker_${RUN}`,
  accountant: `usr_scr_acc_${RUN}`,
} as const;
const WRK_DRIVER = `wrk_scr_driver_${RUN}`;
const WRK_WORKER = `wrk_scr_worker_${RUN}`;
const WRK_OTHER = `wrk_scr_other_${RUN}`;

function cookieFor(userId: string): string {
  return `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: `ses_${userId}`, companyId: CO })}`;
}
function get(url: string, cookie: string): NextRequest {
  return new NextRequest(url, { headers: { cookie } });
}

describeDb("scope po rolama: projekti i rokovi (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 4 });
  const cookies = { owner: "", driver: "", worker: "", accountant: "" };

  beforeAll(async () => {
    await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'Scope test', $2)", [CO, `scr-${RUN}`]);
    for (const [key, id] of Object.entries(USERS)) {
      await admin.query(
        "INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password) VALUES ($1, $2, 'x', $3, 'Test', false)",
        [id, `${key}@test.example`, key],
      );
    }
    await withCompany(app, companyId(CO), async (client) => {
      await client.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope) VALUES
           ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY'),
           ($4, $5, $3, ARRAY['DRIVER']::"Role"[], 'SELF'),
           ($6, $7, $3, ARRAY['WORKER']::"Role"[], 'SELF'),
           ($8, $9, $3, ARRAY['ACCOUNTANT']::"Role"[], 'COMPANY')`,
        [`m1_${RUN}`, USERS.owner, CO, `m2_${RUN}`, USERS.driver, `m3_${RUN}`, USERS.worker, `m4_${RUN}`, USERS.accountant],
      );
      for (const [key, userId] of Object.entries(USERS)) {
        await client.query(
          "INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, clock_timestamp() + interval '1 day')",
          [`ses_${userId}`, CO, userId, `hash_${userId}`],
        );
        void key;
      }
      await client.query(
        `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id) VALUES
           ($1, $4, 'Vozac', 'Test', $5), ($2, $4, 'Radnik', 'Test', $6), ($3, $4, 'Drugi', 'Radnik', NULL)`,
        [WRK_DRIVER, WRK_WORKER, WRK_OTHER, CO, USERS.driver, USERS.worker],
      );
      await client.query(
        "INSERT INTO public.projects (id, company_id, code, name) VALUES ($1, $3, $4, 'A'), ($2, $3, $5, 'B')",
        [PA, PB, CO, `SA-${RUN}`, `SB-${RUN}`],
      );
      await client.query(
        `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date) VALUES
           ('pa1_${RUN}', $1, $2, $3, '2026-01-01'), ('pa2_${RUN}', $1, $2, $4, '2026-01-01')`,
        [CO, PA, WRK_DRIVER, WRK_WORKER],
      );
    });
    cookies.owner = cookieFor(USERS.owner);
    cookies.driver = cookieFor(USERS.driver);
    cookies.worker = cookieFor(USERS.worker);
    cookies.accountant = cookieFor(USERS.accountant);

    // Rokovi: po jedan vozaču/radniku i drugom radniku, kao OWNER.
    const types = (await (await obligationTypesRoute(get("http://interni/api/obligation-types", cookies.owner))).json()) as {
      data: { types: { id: string; code: string }[] };
    };
    const medical = types.data.types.find((type) => type.code === "MEDICAL")!.id;
    for (const [wrk, number] of [[WRK_DRIVER, "LK-D"], [WRK_OTHER, "LK-O"]] as const) {
      const created = await createObligationRoute(new NextRequest("http://interni/api/obligations", {
        method: "POST",
        headers: { cookie: cookies.owner, "content-type": "application/json" },
        body: JSON.stringify({ typeId: medical, workerId: wrk, number, expiresAt: "2027-06-30" }),
      }));
      expect(created.status).toBe(200);
    }
  }, 60_000);

  afterAll(async () => {
    await admin.query("DELETE FROM public.obligations WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.project_assignments WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.projects WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.workers WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.sessions WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.memberships WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.users WHERE id = ANY($1)", [Object.values(USERS)]);
    await admin.query("DELETE FROM public.companies WHERE id = $1", [CO]);
    await admin.end();
    await app.end();
  });

  it("WORKER i DRIVER vide samo projekat svoje dodjele; ACCOUNTANT sve projekte firme", async () => {
    for (const cookie of [cookies.driver, cookies.worker]) {
      const body = (await (await projectsRoute(get("http://interni/api/projects", cookie))).json()) as { data: { projects: { id: string }[] } };
      expect(body.data.projects.map((p) => p.id)).toEqual([PA]);
    }
    const acc = (await (await projectsRoute(get("http://interni/api/projects", cookies.accountant))).json()) as { data: { projects: { id: string }[] } };
    expect(acc.data.projects.map((p) => p.id).sort()).toEqual([PA, PB].sort());
  });

  it("DRIVER vidi samo svoj rok; ACCOUNTANT sve rokove firme", async () => {
    const mine = (await (await obligationsRoute(get("http://interni/api/obligations?mine=1", cookies.driver))).json()) as { data: { obligations: { number: string | null }[] } };
    expect(mine.data.obligations.map((o) => o.number)).toEqual(["LK-D"]);
    const all = (await (await obligationsRoute(get("http://interni/api/obligations", cookies.accountant))).json()) as { data: { obligations: { number: string | null }[] } };
    expect(all.data.obligations.map((o) => o.number).sort()).toEqual(["LK-D", "LK-O"]);
  });
});
