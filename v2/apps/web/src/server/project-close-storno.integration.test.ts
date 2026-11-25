/**
 * F5/Korak 0 (odluka vlasnika): **zatvoren projekat ne prima ni storno ni novo knjiženje.**
 *
 * Pravilo je namjerno strogo: `FINISHED` projekat je zaključan dokaz (snapshot + potpisi), pa se
 * knjiga ne „popravlja u mjestu“. Ispravka ide tako što se projekat PONOVNO OTVORI uz razlog
 * (≥10 znakova) koji ostaje u auditu — i tek tada storno prolazi.
 *
 * Test čuva TRI stvari koje se lako tiho izgube:
 *  1. `cost_entry_guard()` odbija `INSERT` na `FINISHED` projekat (`PROJECT_CLOSED`),
 *  2. `reverseSourceCost` tada vraća `{reversed:false}` — revizija izvora ne pada zbog knjige,
 *  3. poslije ponovnog otvaranja storno PROLAZI, a razlog je u auditu.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withCompany, companyId } from "@gradix/db";
import { POST as reopenRoute } from "@/app/api/projects/[id]/reopen/route";
import { issueAccessToken, ACCESS_COOKIE } from "./session";
import { POST as reverseRoute } from "@/app/api/costs/[id]/reverse/route";
import { postCost, reverseSourceCost } from "./cost-entry-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const RUN = Date.now().toString(36);
const COMPANY = `cmp_r61c_${RUN}`;
const USER = `usr_r61c_${RUN}`;
const PROJECT = `prj_r61c_${RUN}`;
const WORKER = `wrk_r61c_${RUN}`;

const admin = new Pool({ connectionString: adminUrl, max: 2 });

async function signIn(): Promise<string> {
  const sessionId = `ses_${USER}`;
  await admin.query(
    `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
    [sessionId, COMPANY, USER, `hash_${sessionId}`],
  );
  return `${ACCESS_COOKIE}=${issueAccessToken({ sub: USER, sid: sessionId, companyId: COMPANY })}`;
}

describeDb("F5 zatvaranje projekta — knjiga se ne dira dok se projekat ne otvori", () => {
  let cookie = "";

  beforeAll(async () => {
    await admin.query(`INSERT INTO public.companies (id, name, slug) VALUES ($1, 'R61 Close', $2)`, [
      COMPANY,
      `r61c-${RUN}`,
    ]);
    await admin.query(
      `INSERT INTO public.users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $2, 'O', 'wner', 'x', false)`,
      [USER, `owner-r61c-${RUN}@test.example`],
    );
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], 'COMPANY')`,
        [`mem_r61c_${RUN}`, USER, COMPANY],
      );
      await client.query(
        `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
         VALUES ($1, $2, 'R', 'Adnik', '2024-01-01'::date)`,
        [WORKER, COMPANY],
      );
      await client.query(
        `INSERT INTO public.projects (id, company_id, code, name)
         VALUES ($1, $2, 'R61C', 'Projekat za storno')`,
        [PROJECT, COMPANY],
      );
    });
    // Zadani set kategorija traži člana firme — isti redoslijed kao u stvarnom onboardingu.
    await admin.query("SELECT public.seed_cost_categories($1)", [COMPANY]);
    cookie = await signIn();
  }, 60_000);

  /*
   * Svaki test počinje od OTVORENOG projekta i prazne knjige: testovi dijele jednu bazu, a pad u
   * prvom bi ostavio `FINISHED` status i učinio drugi test besmislenim (ne bi bilo šta otvoriti).
   */
  beforeEach(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM public.cost_entries WHERE company_id = $1", [COMPANY]);
      await client.query(
        `UPDATE public.projects
            SET status = 'ACTIVE', closed_at = NULL, closed_by = NULL,
                reopened_at = NULL, reopen_reason = NULL
          WHERE company_id = $1 AND id = $2`,
        [COMPANY, PROJECT],
      );
    });
  });

  afterAll(async () => {
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM public.cost_entries WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM public.cost_categories WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM public.projects WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM public.workers WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM public.sessions WHERE company_id = $1", [COMPANY]);
      await client.query("DELETE FROM public.memberships WHERE company_id = $1", [COMPANY]);
    });
    await admin.query("DELETE FROM public.users WHERE id = $1", [USER]);
    await admin.query("DELETE FROM public.companies WHERE id = $1", [COMPANY]);
    await admin.end();
  });

  it("knjiženje na zatvoren projekat je odbijeno, storno vraća reversed=false", async () => {
    /* Svaki korak u SVOJOJ transakciji: očekivani pad ostavlja transakciju abortiranom, pa bi
       nastavak u istoj transakciji padao na `25P02` umjesto da provjeri ono što test traži. */
    let entryId = "";
    await withCompany(admin, companyId(COMPANY), async (client) => {
      const posted = await postCost(client, {
        companyId: COMPANY,
        projectId: PROJECT,
        sourceType: "MANUAL",
        sourceId: `src_open_${RUN}`,
        occurredOn: "2026-11-19",
        amountCents: 20000n,
        currency: "BAM",
        actorId: USER,
      });
      entryId = posted.id;
    });

    // Zatvaranje: status + closed_at (CHECK traži oboje).
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `UPDATE public.projects
            SET status = 'FINISHED', closed_at = clock_timestamp(), closed_by = $2
          WHERE company_id = $1 AND id = $3`,
        [COMPANY, USER, PROJECT],
      );
    });

    // Zatvaranje: status + closed_at (CHECK traži oboje). U SVOJOJ transakciji, kao i svi ostali
    // koraci — inače bi očekivani pad guarda abortirao transakciju i sakrio pravi ishod.
    await withCompany(admin, companyId(COMPANY), async (client) => {
      const updated = await client.query(
        `UPDATE public.projects
            SET status = 'FINISHED', closed_at = clock_timestamp(), closed_by = $2
          WHERE company_id = $1 AND id = $3`,
        [COMPANY, USER, PROJECT],
      );
      expect(updated.rowCount).toBe(1);
    });

    // 1. Novo knjiženje pada na guardu — poruka je imenovana, ne generička.
    await expect(
      withCompany(admin, companyId(COMPANY), (client) =>
        postCost(client, {
          companyId: COMPANY,
          projectId: PROJECT,
          sourceType: "MANUAL",
          sourceId: `src_closed_${RUN}`,
          occurredOn: "2026-11-20",
          amountCents: 1000n,
          currency: "BAM",
          actorId: USER,
        }),
      ),
    ).rejects.toThrow(/PROJECT_CLOSED/);

    // 2. Storno iz revizije izvora NE baca — revizija izvora ne smije pasti zbog knjige.
    const reversed = await withCompany(admin, companyId(COMPANY), (client) =>
      reverseSourceCost(client, {
        companyId: COMPANY,
        actorId: USER,
        sourceType: "MANUAL",
        sourceId: `src_open_${RUN}`,
        reason: "Pogrešan iznos na terenu.",
      }),
    );
    expect(reversed.reversed).toBe(false);

    // 3. Ni storno kroz API ne prolazi: guard brani `INSERT` zamjenskog reda. Storno NIJE tiho
    //    preskočen — korisnik dobija 409, a original ostaje `POSTED`.
    const storno = await reverseRoute(
      new NextRequest(`http://t/api/costs/${entryId}/reverse`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ reason: "Ispravka poslije zatvaranja projekta." }),
      }),
      { params: Promise.resolve({ id: entryId }) },
    );
    expect(storno.status).toBe(422);

    // Original ostaje `POSTED` i netaknut — knjiga nije „popravljena u mjestu“.
    await withCompany(admin, companyId(COMPANY), async (client) => {
      const still = await client.query<{ status: string; amount_cents: string }>(
        "SELECT status, amount_cents::text FROM public.cost_entries WHERE company_id = $1 AND id = $2",
        [COMPANY, entryId],
      );
      expect(still.rows[0]).toMatchObject({ status: "POSTED", amount_cents: "20000" });
    });
  });

  it("ponovno otvaranje traži razlog ≥10 znakova, upisuje audit i vraća storno", async () => {
    /*
     * Test ne nasljeđuje stanje iz prethodnog (ne zavisi od redoslijeda): sam knjiži trošak i sam
     * zatvori projekat. Time je i tvrdnja „storno poslije otvaranja prolazi“ dokaz, a ne posljedica.
     */
    const entrySource = `src_reopen_${RUN}`;
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await postCost(client, {
        companyId: COMPANY,
        projectId: PROJECT,
        sourceType: "MANUAL",
        sourceId: entrySource,
        occurredOn: "2026-11-18",
        amountCents: 15000n,
        currency: "BAM",
        actorId: USER,
      });
    });
    await withCompany(admin, companyId(COMPANY), async (client) => {
      await client.query(
        `UPDATE public.projects
            SET status = 'FINISHED', closed_at = clock_timestamp(), closed_by = $2
          WHERE company_id = $1 AND id = $3`,
        [COMPANY, USER, PROJECT],
      );
    });

    const short = await reopenRoute(
      new NextRequest(`http://t/api/projects/${PROJECT}/reopen`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ reason: "kratko" }),
      }),
      { params: Promise.resolve({ id: PROJECT }) },
    );
    expect(short.status).toBe(400);

    const ok = await reopenRoute(
      new NextRequest(`http://t/api/projects/${PROJECT}/reopen`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ reason: "Naknadna faktura za transport — knjiženje je propušteno." }),
      }),
      { params: Promise.resolve({ id: PROJECT }) },
    );
    expect(ok.status).toBe(200);

    const audit = await admin.query<{ metadata: { reason?: string } }>(
      `SELECT metadata FROM public.audit_events
        WHERE company_id = $1 AND action = 'project.reopened' AND entity_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [COMPANY, PROJECT],
    );
    expect(audit.rows[0]?.metadata.reason).toContain("Naknadna faktura");

    await withCompany(admin, companyId(COMPANY), async (client) => {
      const reversed = await reverseSourceCost(client, {
        companyId: COMPANY,
        actorId: USER,
        sourceType: "MANUAL",
        sourceId: entrySource,
        reason: "Pogrešan iznos na terenu.",
      });
      expect(reversed.reversed).toBe(true);
    });
  });
});
