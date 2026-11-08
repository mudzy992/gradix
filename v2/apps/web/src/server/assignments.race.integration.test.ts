/**
 * R3 — preklapanje dodjela pod ISTOVREMENIM zahtjevima.
 *
 * Zašto ovaj test postoji: triger koji provjerava „postoji li već" pa upiše, bez brave, propušta
 * duplikat kad dva zahtjeva uđu u isto vrijeme — oba pročitaju „nema", pa se oba upišu. Takva greška
 * se ne vidi u običnom testu (jedna konekcija, jedna po redu stvar), nego samo u paraleli.
 *
 * Zato test otvara DVIJE PRAVE konekcije i pušta ih istovremeno:
 *   - prva drži transakciju otvorenu (upisala je, još nije commit),
 *   - druga pokušava isti period za isti entitet.
 * Jedna od dvije MORA pasti. Ako padne nijedna, brava ne postoji — i to je bug u bazi, ne u testu.
 *
 * Mjeri se i da brava NE pretjeruje: drugi RADNIK u istom periodu mora proći (inače bi firma mogla
 * imati jednog čovjeka na projektu u datom trenutku).
 *
 * Traži `DATABASE_URL` i `DATABASE_ADMIN_URL`; bez njih se PRESKAČE.
 */
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_r3_race";
const PROJECT = "prj_r3_race";
const WORKER_A = "wrk_r3_race_a";
const WORKER_B = "wrk_r3_race_b";
const MACHINE = "mch_r3_race";

describeDb("R3 — preklapanje pod paralelnim zahtjevima", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 4 });
  let app: Pool;

  /** Konekcija sa postavljenim tenant scope-om, kao što to radi `withCompany`. */
  async function tenantClient(): Promise<PoolClient> {
    const client = await app.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [COMPANY]);
    return client;
  }

  const assignment = (client: PoolClient, values: {
    id: string;
    workerId?: string;
    machineId?: string;
    from: string;
    to?: string;
  }) =>
    client.query(
      `INSERT INTO project_assignments (id, company_id, project_id, worker_id, machine_id, from_date, to_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        values.id,
        COMPANY,
        PROJECT,
        values.workerId ?? null,
        values.machineId ?? null,
        values.from,
        values.to ?? null,
      ],
    );

  beforeAll(async () => {
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.query("INSERT INTO companies (id, name, slug) VALUES ($1, 'R3 Race', 'r3-race')", [
      COMPANY,
    ]);

    const { withCompany, companyId } = await import("@gradix/db");
    const seed = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await withCompany(seed, companyId(COMPANY), async (client) => {
      await client.query(
        `INSERT INTO projects (id, company_id, code, name) VALUES ($1, $2, 'RACE-1', 'Test trke')`,
        [PROJECT, COMPANY],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at)
         VALUES ($1, $2, 'Prvi', 'Radnik', '2025-01-01'), ($3, $2, 'Drugi', 'Radnik', '2025-01-01')`,
        [WORKER_A, COMPANY, WORKER_B],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1, $2, 'RACE-M', 'Mašina za trku', $2 || '_cat_excavator')`,
        [MACHINE, COMPANY],
      );
    });
    await seed.end();

    app = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.end();
  });

  /**
   * Koji mehanizam je aktivan na OVOJ bazi.
   *
   * Ispisuje se u log jer se put bira pri migraciji (ima li `btree_gist`) i razlikuje se između
   * lokalne baze i CI slike. Testovi ispod NE tvrde koji je — tvrde da preklapanje pada, što mora
   * važiti za oba.
   */
  async function mehanizam(): Promise<"EXCLUDE" | "triger"> {
    const constraints = await admin.query(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'project_assignments'::regclass AND contype = 'x'",
    );
    const trigger = await admin.query(
      "SELECT tgname FROM pg_trigger WHERE tgrelid = 'project_assignments'::regclass AND NOT tgisinternal",
    );
    const hasGist = constraints.rowCount === 2;
    const hasTrigger = trigger.rowCount === 1;

    console.log(
      `MEHANIZAM: ${hasGist ? "EXCLUDE USING gist (btree_gist dostupan)" : "triger + pg_advisory_xact_lock"} ` +
        `[constraints=${constraints.rowCount}, triggers=${trigger.rowCount}]`,
    );

    // Nijedan ili oba = greška: prvo znači da preklapanje nije zaštićeno, drugo da postoje dva
    // mjesta za isto pravilo (i da će se razići).
    expect(hasGist !== hasTrigger, "mora biti tačno jedan mehanizam").toBe(true);
    return hasGist ? "EXCLUDE" : "triger";
  }

  it("aktivan je TAČNO JEDAN mehanizam: EXCLUDE (btree_gist) ili triger sa bravom", async () => {
    await mehanizam();
  });

  it("dvije paralelne dodjele ISTOG radnika u istom periodu: tačno jedna pada", async () => {
    const first = await tenantClient();
    const second = await tenantClient();
    try {
      // Prva upisuje i NE commituje — red postoji, ali ga druga transakcija još ne smije vidjeti
      // bez brave. Bez `FOR UPDATE`/advisory brave druga bi prošla provjeru i obje bi se upisale.
      await assignment(first, { id: "pas_race_1", workerId: WORKER_A, from: "2026-05-01", to: "2026-05-31" });

      // Druga ide u paraleli. Ako brava radi, ona ČEKA prvu; pošto prva ne commit-uje u ovom
      // trenutku, čekanje se rješava tek kad prva završi — zato puštamo obje i gledamo ishod.
      const secondRun = assignment(second, {
        id: "pas_race_2",
        workerId: WORKER_A,
        from: "2026-05-15",
        to: "2026-06-15",
      }).then(
        () => "uspjela" as const,
        (error: unknown) => `pala: ${String((error as { message?: string }).message)}` as const,
      );

      // Kratka pauza da druga stigne do provjere i (ako ima brave) stane na njoj.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await first.query("COMMIT");

      const outcome = await secondRun;
      if (outcome === "uspjela") {
        await second.query("COMMIT");
      } else {
        await second.query("ROLLBACK");
      }

      expect(outcome, "bez brave bi obje prošle — to je greška u bazi").toContain("pala");
      /*
       * Poruka zavisi od mehanizma: triger baca našu `ASSIGNMENT_OVERLAP`, a `EXCLUDE` constraint
       * SQLSTATE 23P01. Test zato traži ZNAK preklapanja, a ne tačan tekst — inače bi prolazio samo
       * na jednoj od dvije podržane baze (i to je bila greška koju je uhvatio CI).
       */
      expect(outcome).toMatch(/ASSIGNMENT_OVERLAP|no_overlap|23P01/);

      // Na kraju u bazi smije biti TAČNO JEDAN red za taj period.
      const rows = await admin.query(
        "SELECT id FROM project_assignments WHERE company_id = $1 AND worker_id = $2",
        [COMPANY, WORKER_A],
      );
      expect(rows.rowCount).toBe(1);
    } finally {
      first.release();
      second.release();
    }
  }, 30_000);

  it("dvije paralelne dodjele ISTE mašine u istom periodu: tačno jedna pada", async () => {
    const first = await tenantClient();
    const second = await tenantClient();
    try {
      await assignment(first, { id: "pas_race_m1", machineId: MACHINE, from: "2026-07-01", to: "2026-07-31" });

      const secondRun = assignment(second, {
        id: "pas_race_m2",
        machineId: MACHINE,
        from: "2026-07-10",
      }).then(
        () => "uspjela" as const,
        (error: unknown) => `pala: ${String((error as { message?: string }).message)}` as const,
      );

      await new Promise((resolve) => setTimeout(resolve, 150));
      await first.query("COMMIT");

      const outcome = await secondRun;
      if (outcome === "uspjela") await second.query("COMMIT");
      else await second.query("ROLLBACK");

      expect(outcome).toMatch(/ASSIGNMENT_OVERLAP|no_overlap|23P01/);
      const rows = await admin.query(
        "SELECT id FROM project_assignments WHERE company_id = $1 AND machine_id = $2",
        [COMPANY, MACHINE],
      );
      expect(rows.rowCount).toBe(1);
    } finally {
      first.release();
      second.release();
    }
  }, 30_000);

  it("brava NE pretjeruje: drugi radnik u istom periodu prolazi bez čekanja", async () => {
    const first = await tenantClient();
    const second = await tenantClient();
    try {
      await assignment(first, { id: "pas_race_3", workerId: WORKER_B, from: "2026-09-01", to: "2026-09-30" });

      // Različit entitet → druga brava → ne čeka prvu. Ako ovo padne ili visi, brava je presiroka.
      const started = Date.now();
      await assignment(second, { id: "pas_race_4", workerId: WORKER_A, from: "2026-09-01", to: "2026-09-30" });
      await second.query("COMMIT");
      await first.query("COMMIT");

      expect(Date.now() - started).toBeLessThan(2000);
      const rows = await admin.query(
        "SELECT count(*)::int AS n FROM project_assignments WHERE company_id = $1 AND from_date = '2026-09-01'",
        [COMPANY],
      );
      expect(rows.rows[0]!.n).toBe(2);
    } finally {
      first.release();
      second.release();
    }
  }, 30_000);

  it("servis prevodi grešku baze u čitljiv 409 — za OBA mehanizma, ne samo za triger", async () => {
    // Ovo je mjesto gdje je CI pao: sa `EXCLUDE` mehanizmom greška je 23P01, a ne `ASSIGNMENT_OVERLAP`,
    // pa je provjera tekstualnog prefiksa propuštala grešku do korisnika kao „Došlo je do greške" (500).
    const { createAssignment } = await import("./project-service");
    const { getVerifiedPool } = await import("./db");
    const pool = await getVerifiedPool();

    // Nalog mora postojati: dodjela piše audit, a audit nosi FK na korisnika.
    await admin.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'race@example.test', 'x', 'Trka', 'Test', false)
       ON CONFLICT (id) DO NOTHING`,
      ["usr_r3_race"],
    );
    const actor = { userId: "usr_r3_race", roles: ["OWNER" as const], scope: "COMPANY" as const, projectIds: null };
    const first = await createAssignment(
      pool,
      COMPANY as never,
      actor,
      PROJECT,
      { workerId: WORKER_A, fromDate: "2027-01-01", toDate: "2027-01-31" } as never,
    );
    expect("code" in first, `prva dodjela mora proći: ${JSON.stringify(first)}`).toBe(false);

    const second = await createAssignment(
      pool,
      COMPANY as never,
      actor,
      PROJECT,
      { workerId: WORKER_A, fromDate: "2027-01-15", toDate: "2027-02-15" } as never,
    );

    expect("code" in second).toBe(true);
    if ("code" in second) {
      expect(second.code).toBe("CONFLICT");
      // Poruka je za čovjeka, ne za bazu: bez imena constraint-a i bez SQLSTATE.
      expect(second.message).toContain("preklapa");
      expect(second.message).not.toContain("constraint");
    }
  }, 30_000);
});
