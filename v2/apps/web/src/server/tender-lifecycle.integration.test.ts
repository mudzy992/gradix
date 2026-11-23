import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { convertTenderToProject } from "./tender-convert";
import { createTender, patchTender } from "./tender-service";
import { createTenderWorld } from "./tender-lifecycle-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

describeDb("R7 tender rules (PostgreSQL)", () => {
  const world = createTenderWorld();
  const { owner, accountant, worker, otherCompany, partnerA, companyA, companyB } = world;
  const RUN = world.run;
  const app = new Pool({ connectionString: appUrl, max: 4 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(() => world.seed(admin));
  afterAll(async () => {
    await world.teardown(admin);
    await app.end();
    await admin.end();
  });

  it("submitted_at se postavlja samo na DRAFT→SUBMITTED", async () => {
    const created = await createTender(app, owner, {
      title: `Most ${RUN}`, partnerId: partnerA, submittedValueAmount: "10.00", currencyCode: "BAM",
    });
    expect(created.outcome).toBe("OK");
    const id = created.outcome === "OK" ? created.id : "";
    const draft = await admin.query<{ submitted_at: string | null }>(
      `SELECT submitted_at::text FROM public.tenders WHERE id = $1`,
      [id],
    );
    expect(draft.rows[0]?.submitted_at).toBeNull();
    expect((await patchTender(app, owner, id!, { status: "SUBMITTED" })).outcome).toBe("OK");
    const submitted = await admin.query<{ status: string; submitted_at: string | null }>(
      `SELECT status, submitted_at::text FROM public.tenders WHERE id = $1`,
      [id],
    );
    expect(submitted.rows[0]?.status).toBe("SUBMITTED");
    expect(submitted.rows[0]?.submitted_at).toBeTruthy();
  });

  it("nedozvoljen prelaz ne mijenja status", async () => {
    const created = await createTender(app, owner, {
      title: `Skok ${RUN}`, partnerId: partnerA, submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    const id = created.outcome === "OK" ? created.id! : "";
    expect(await patchTender(app, owner, id, { status: "WON" })).toMatchObject({
      outcome: "CONFLICT",
      code: "TENDER_INVALID_STATUS",
    });
    const row = await admin.query<{ status: string }>(`SELECT status FROM public.tenders WHERE id = $1`, [id]);
    expect(row.rows[0]?.status).toBe("DRAFT");
  });

  it("negativan iznos ne pravi tender", async () => {
    const before = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.tenders WHERE company_id = $1`,
      [companyA],
    );
    const denied = await createTender(app, owner, {
      title: `Minus ${RUN}`, partnerId: partnerA, submittedValueAmount: "-1.00", currencyCode: "BAM",
    });
    expect(denied.outcome).toBe("VALIDATION_FAILED");
    const after = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.tenders WHERE company_id = $1`,
      [companyA],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("nepoznat partner se odbija", async () => {
    const denied = await createTender(app, owner, {
      title: `Nema ${RUN}`, partnerId: `ptr_missing_${RUN}`, submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    expect(denied.outcome).toBe("VALIDATION_FAILED");
  });

  it("ACCOUNTANT i WORKER ne smiju manage", async () => {
    expect(await createTender(app, accountant, {
      title: `Zabrana ${RUN}`, partnerId: partnerA, submittedValueAmount: "1.00", currencyCode: "BAM",
    })).toMatchObject({ outcome: "FORBIDDEN", code: "ROLE" });
    const draft = await createTender(app, owner, {
      title: `Tuđi ${RUN}`, partnerId: partnerA, submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    const id = draft.outcome === "OK" ? draft.id! : "";
    expect((await patchTender(app, worker, id, { status: "SUBMITTED" })).outcome).toBe("FORBIDDEN");
    expect((await convertTenderToProject(app, accountant, id)).outcome).toBe("FORBIDDEN");
    const status = await admin.query<{ status: string }>(`SELECT status FROM public.tenders WHERE id = $1`, [id]);
    expect(status.rows[0]?.status).toBe("DRAFT");
  });

  it("firma B ne vidi tender firme A", async () => {
    const foreign = await withCompany(app, companyId(companyB), async (client) => {
      const seen = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.tenders WHERE company_id = $1`,
        [companyA],
      );
      return seen.rows[0]?.n;
    });
    expect(foreign).toBe(0);
    const created = await createTender(app, otherCompany, {
      title: `B ${RUN}`, partnerId: partnerA, submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    expect(created.outcome).toBe("VALIDATION_FAILED");
  });
});
