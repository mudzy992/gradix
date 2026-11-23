import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convertTenderToProject } from "./tender-convert";
import { createTender, patchTender } from "./tender-service";
import { createTenderWorld } from "./tender-lifecycle-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

describeDb("R7 tender convert atomicity (PostgreSQL)", () => {
  const world = createTenderWorld();
  const { owner, partnerA, companyA } = world;
  const RUN = world.run;
  const app = new Pool({ connectionString: appUrl, max: 4 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(() => world.seed(admin));
  afterAll(async () => {
    await world.teardown(admin);
    await app.end();
    await admin.end();
  });

  async function wonTender(title: string): Promise<string> {
    const created = await createTender(app, owner, {
      title, partnerId: partnerA, submittedValueAmount: "20.00", currencyCode: "BAM",
    });
    const id = created.outcome === "OK" ? created.id! : "";
    expect((await patchTender(app, owner, id, { status: "SUBMITTED" })).outcome).toBe("OK");
    expect((await patchTender(app, owner, id, { status: "WON" })).outcome).toBe("OK");
    return id;
  }

  async function projectCount(): Promise<number> {
    const rows = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.projects WHERE company_id = $1`,
      [companyA],
    );
    return rows.rows[0]?.n ?? 0;
  }

  it("dva istovremena convert-a ostavljaju tačno jedan projekat", async () => {
    const id = await wonTender(`Utrka ${RUN}`);
    const before = await projectCount();
    const [first, second] = await Promise.all([
      convertTenderToProject(app, owner, id),
      convertTenderToProject(app, owner, id),
    ]);
    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["CONFLICT", "OK"]);
    expect(await projectCount()).toBe(before + 1);
    const linked = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.tenders WHERE id = $1 AND converted_project_id IS NOT NULL`,
      [id],
    );
    expect(linked.rows[0]?.n).toBe(1);
  });

  it("izgubljen claim poništava projekat", async () => {
    const id = await wonTender(`Gubitak ${RUN}`);
    const before = await projectCount();
    if (!/^cmp_tnd_a_[a-z0-9]+$/.test(companyA)) throw new Error("company id");
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.gradix_test_lose_claim() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.company_id = '${companyA}' THEN
          UPDATE public.tenders
             SET status = 'LOST'
           WHERE company_id = NEW.company_id AND status = 'WON' AND converted_project_id IS NULL;
        END IF;
        RETURN NEW;
      END
      $fn$`);
    await admin.query(`
      CREATE TRIGGER gradix_test_lose_claim
      AFTER INSERT ON public.projects
      FOR EACH ROW EXECUTE FUNCTION public.gradix_test_lose_claim()`);
    try {
      const lost = await convertTenderToProject(app, owner, id);
      expect(lost).toMatchObject({ outcome: "CONFLICT", code: "ALREADY_CONVERTED" });
      expect(await projectCount()).toBe(before);
      const tender = await admin.query<{ status: string; converted_project_id: string | null }>(
        `SELECT status, converted_project_id FROM public.tenders WHERE id = $1`,
        [id],
      );
      expect(tender.rows[0]?.status).toBe("WON");
      expect(tender.rows[0]?.converted_project_id).toBeNull();
    } finally {
      await admin.query(`DROP TRIGGER IF EXISTS gradix_test_lose_claim ON public.projects`);
      await admin.query(`DROP FUNCTION IF EXISTS public.gradix_test_lose_claim()`);
    }
  });

  it("neuspjela konverzija ne blokira kasniji uspjeh", async () => {
    const created = await createTender(app, owner, {
      title: `Ponovo ${RUN}`, partnerId: partnerA, submittedValueAmount: "3.00", currencyCode: "BAM",
    });
    const id = created.outcome === "OK" ? created.id! : "";
    const before = await projectCount();
    expect((await convertTenderToProject(app, owner, id)).outcome).toBe("CONFLICT");
    expect(await projectCount()).toBe(before);
    expect((await patchTender(app, owner, id, { status: "SUBMITTED" })).outcome).toBe("OK");
    expect((await patchTender(app, owner, id, { status: "WON" })).outcome).toBe("OK");
    expect((await convertTenderToProject(app, owner, id)).outcome).toBe("OK");
    expect(await projectCount()).toBe(before + 1);
  });
});
