import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listTenderChecklist, patchTenderChecklistItem, seedTenderChecklist } from "./tender-checklist-service";
import { tenderPerformance } from "./tender-outcome-service";
import {
  approveTenderPriceRevision,
  calculateTenderOffer,
  createTenderBoqItem,
  createTenderPriceRevision,
  listTenderPriceRevisions,
} from "./tender-pricing";
import { getTender, patchTender } from "./tender-service";
import { createTenderWorld, newTenderId, walkToWon } from "./tender-lifecycle-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

/**
 * Kalkulacija, revizije, kontrolna lista i uspješnost (spec 08 §1.3–1.5, §1.7).
 *
 * Ovdje se provjeravaju dva pravila koja se lako „izgube“ u kodu: prag odobrenja (>5 % ili
 * marža ispod minimuma firme) i to da ACCOUNTANT ne dobija kalkulaciju — ni brojeve, ni tab.
 */
describeDb("F7 tender pricing and outcome (PostgreSQL)", () => {
  const world = createTenderWorld();
  const { owner, accountant, partnerA, companyA } = world;
  const RUN = world.run;
  const app = new Pool({ connectionString: appUrl, max: 4 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    await world.seed(admin);
    await admin.query(
      `INSERT INTO public.tender_checklist_templates
         (id, company_id, code, label, required, sort_order, created_by, updated_by)
       VALUES ($1, $2, 'BID_BOND', 'Ponudbena garancija', true, 10, $3, $3)`,
      [`tct_${RUN}`, companyA, owner.userId],
    );
  });
  afterAll(async () => {
    await world.teardown(admin);
    await app.end();
    await admin.end();
  });

  async function tenderWithBoq(title: string): Promise<string> {
    const id = await newTenderId(app, owner, partnerA, title);
    const item = await createTenderBoqItem(app, owner, id, {
      code: "01",
      description: "Beton C25/30",
      unit: "m3",
      quantity: "10",
      unitCostAmount: "100.00",
    });
    expect(item.outcome).toBe("OK");
    return id;
  }

  it("kalkulacija sabira predmjer i daje maržu", async () => {
    const id = await tenderWithBoq(`Kalkulacija ${RUN}`);
    const calculated = await calculateTenderOffer(app, owner, id);
    expect(calculated).toMatchObject({ outcome: "OK" });
    if (calculated.outcome !== "OK") return;
    // 10 m3 × 100 = 1000 direktnih troškova.
    expect(calculated.calculation.directCostAmount).toBe("1000.00");
  });

  it("ACCOUNTANT ne dobija kalkulaciju (FORBIDDEN)", async () => {
    const id = await tenderWithBoq(`Tuđa marža ${RUN}`);
    expect((await calculateTenderOffer(app, accountant, id)).outcome).toBe("FORBIDDEN");
  });

  it("prva revizija ne traži odobrenje, veliki popust traži", async () => {
    const id = await tenderWithBoq(`Prag ${RUN}`);
    const first = await createTenderPriceRevision(app, owner, id, {
      markupPct: "20", riskReservePct: "5", discountPct: "0", reason: "Početna",
    });
    expect(first).toMatchObject({ outcome: "OK", needsApproval: false });
    const second = await createTenderPriceRevision(app, owner, id, {
      markupPct: "20", riskReservePct: "5", discountPct: "20", reason: "Agresivno",
    });
    expect(second).toMatchObject({ outcome: "OK", needsApproval: true });
    const revisions = await listTenderPriceRevisions(app, owner, id);
    expect(Array.isArray(revisions) && revisions.length).toBe(2);
  });

  it("revizija je append-only: UPDATE na odobrenoj reviziji pada", async () => {
    const id = await tenderWithBoq(`Imutabilno ${RUN}`);
    await createTenderPriceRevision(app, owner, id, {
      markupPct: "15", riskReservePct: "0", discountPct: "0", reason: "Prva",
    });
    await expect(
      admin.query(
        `UPDATE public.tender_price_revisions SET markup_pct = 99 WHERE company_id = $1 AND tender_id = $2`,
        [companyA, id],
      ),
    ).rejects.toThrow(/TENDER_PRICE_REVISION_IMMUTABLE/);
  });

  it("samo vlasnik odobrava reviziju", async () => {
    const id = await tenderWithBoq(`Odobrenje ${RUN}`);
    /* Prva revizija nema prethodnu vrijednost, pa prag promjene nema od čega da se mjeri —
       odobrenje se traži tek kad nova revizija odstupi od postojeće. */
    await createTenderPriceRevision(app, owner, id, {
      markupPct: "10", riskReservePct: "0", discountPct: "0", reason: "Osnova",
    });
    const created = await createTenderPriceRevision(app, owner, id, {
      markupPct: "10", riskReservePct: "0", discountPct: "12", reason: "Veliki popust",
    });
    expect(created).toMatchObject({ outcome: "OK", needsApproval: true });
    const revision = created.outcome === "OK" ? created.revision : 2;
    expect((await approveTenderPriceRevision(app, accountant, id, revision)).outcome).toBe("FORBIDDEN");
    expect((await approveTenderPriceRevision(app, owner, id, revision)).outcome).toBe("OK");
    expect(await approveTenderPriceRevision(app, owner, id, revision)).toMatchObject({ outcome: "CONFLICT" });
  });

  it("kontrolna lista blokira predaju dok stavke nijesu riješene", async () => {
    const id = await newTenderId(app, owner, partnerA, `Blokada ${RUN}`);
    const walk = await walkToWon(app, owner, id, { leaveMissing: true });
    expect(walk).toMatchObject({ ok: false, code: "TENDER_CHECKLIST_INCOMPLETE" });
    const listed = await listTenderChecklist(app, owner, id);
    expect("items" in listed && listed.blocking.length > 0).toBe(true);
    if ("items" in listed) {
      for (const item of listed.items) {
        if (item.guaranteeType) continue;
        await patchTenderChecklistItem(app, owner, id, item.id, {
          status: "NOT_APPLICABLE",
          note: "Nije primjenjivo na ovaj tender",
        });
      }
    }
    expect((await patchTender(app, owner, id, { status: "SUBMITTED" })).outcome).toBe("OK");
    expect((await getTender(app, owner, id))?.status).toBe("SUBMITTED");
  });

  it("seed kontrole liste je idempotentan", async () => {
    const id = await newTenderId(app, owner, partnerA, `Idempotent ${RUN}`);
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyA]);
      await seedTenderChecklist(client, owner, id);
      await seedTenderChecklist(client, owner, id);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const rows = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.tender_checklist_items WHERE company_id = $1 AND tender_id = $2`,
      [companyA, id],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it("uspješnost broji dobijene i marže samo uz pravo cijene", async () => {
    const id = await tenderWithBoq(`Uspjeh ${RUN}`);
    expect(await walkToWon(app, owner, id)).toMatchObject({ ok: true });
    const withMargin = await tenderPerformance(app, owner, {});
    expect("totalCount" in withMargin && withMargin.wonCount).toBeGreaterThanOrEqual(1);
    const withoutMargin = await tenderPerformance(app, accountant, {});
    expect("totalCount" in withoutMargin && withoutMargin.avgMarginWonPct).toBeNull();
    const denied = await tenderPerformance(app, world.worker, {});
    expect("outcome" in denied).toBe(true);
  });
});
