import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTender, getTender, patchTender } from "./tender-service";
import { createTenderWorld, newTenderId } from "./tender-lifecycle-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

/**
 * Pravila tendera na nivou baze (F7, spec 08 §1.1/7 i §1.2/6).
 *
 * F2 je imao jedno stanje `DRAFT`; zaključani tok ima devet statusa i kapije između njih, pa
 * testovi provjeravaju KAPIJE, a ne pojedinačne prelaske: bez odluke nema pripreme, bez roka i
 * kontrolne liste nema predaje.
 */
describeDb("F7 tender rules (PostgreSQL)", () => {
  const world = createTenderWorld();
  const { owner, accountant, partnerA, companyA, companyB, otherCompany } = world;
  const RUN = world.run;
  const app = new Pool({ connectionString: appUrl, max: 4 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(() => world.seed(admin));
  afterAll(async () => {
    await world.teardown(admin);
    await app.end();
    await admin.end();
  });

  it("novi tender je OPPORTUNITY, a ne DRAFT", async () => {
    const id = await newTenderId(app, owner, partnerA, `Novi ${RUN}`);
    const row = await admin.query<{ status: string; submitted_at: string | null }>(
      `SELECT status, submitted_at::text FROM public.tenders WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.status).toBe("OPPORTUNITY");
    expect(row.rows[0]?.submitted_at).toBeNull();
  });

  it("submitted_at se postavlja tek na prelasku u SUBMITTED", async () => {
    const id = await newTenderId(app, owner, partnerA, `Most ${RUN}`);
    expect((await patchTender(app, owner, id, { status: "GO_NO_GO" })).outcome).toBe("OK");
    expect((await patchTender(app, owner, id, { status: "PREPARATION" })).outcome).toBe("CONFLICT");
    expect((await patchTender(app, owner, id, { status: "WON" })).outcome).toBe("CONFLICT");
    const row = await admin.query<{ status: string; submitted_at: string | null }>(
      `SELECT status, submitted_at::text FROM public.tenders WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]?.status).toBe("GO_NO_GO");
    expect(row.rows[0]?.submitted_at).toBeNull();
  });

  it("nedozvoljen prelaz ne mijenja status", async () => {
    const id = await newTenderId(app, owner, partnerA, `Skok ${RUN}`);
    expect(await patchTender(app, owner, id, { status: "WON" })).toMatchObject({
      outcome: "CONFLICT",
      code: "TENDER_INVALID_STATUS",
    });
    const row = await admin.query<{ status: string }>(`SELECT status FROM public.tenders WHERE id = $1`, [id]);
    expect(row.rows[0]?.status).toBe("OPPORTUNITY");
  });

  it("priprema bez odluke o učešću je TENDER_DECISION_REQUIRED", async () => {
    const id = await newTenderId(app, owner, partnerA, `Bez odluke ${RUN}`);
    await patchTender(app, owner, id, { status: "GO_NO_GO" });
    expect(await patchTender(app, owner, id, { status: "PREPARATION", deadlineAt: "2027-01-15T12:00:00.000Z" }))
      .toMatchObject({ outcome: "CONFLICT", code: "TENDER_DECISION_REQUIRED" });
  });

  it("negativan iznos ne pravi tender", async () => {
    const before = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.tenders WHERE company_id = $1`,
      [companyA],
    );
    const denied = await createTender(app, owner, {
      title: `Negativan ${RUN}`, partnerId: partnerA, submittedValueAmount: "-5.00", currencyCode: "BAM",
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
      title: `Tuđi ${RUN}`, partnerId: "ptr_nepostoji", submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    expect(denied.outcome).toBe("VALIDATION_FAILED");
  });

  it("ACCOUNTANT i WORKER ne smiju manage", async () => {
    const id = await newTenderId(app, owner, partnerA, `Prava ${RUN}`);
    // Obje role bez `tenders.manage` dobijaju istu grešku — nema djelimičnog prava.
    expect((await patchTender(app, accountant, id, { title: "Prepisano" })).outcome).toBe("FORBIDDEN");
    expect((await patchTender(app, world.worker, id, { title: "Prepisano" })).outcome).toBe("FORBIDDEN");
    const tender = await getTender(app, owner, id);
    expect(tender?.title).toBe(`Prava ${RUN}`);
  });

  it("firma B ne vidi tender firme A", async () => {
    const id = await newTenderId(app, owner, partnerA, `Tajna ${RUN}`);
    expect(await getTender(app, otherCompany, id)).toBeNull();
    const rows = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.tenders WHERE id = $1 AND company_id = $2`,
      [id, companyB],
    );
    expect(rows.rows[0]?.n).toBe(0);
  });
});
