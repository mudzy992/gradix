import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updatePartner } from "./partner-service";
import { registerTenderAttachment } from "./tender-attachment-service";
import { convertTenderToProject } from "./tender-convert";
import { createTender, patchTender } from "./tender-service";
import { createTenderWorld } from "./tender-lifecycle-fixtures";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

describeDb("R7 tender convert (PostgreSQL)", () => {
  const world = createTenderWorld();
  const { owner, accountant, partnerA, companyA } = world;
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

  it("WON convert upisuje jedan projekat i converted_project_id", async () => {
    const id = await wonTender(`Konverzija ${RUN}`);
    const converted = await convertTenderToProject(app, owner, id);
    expect(converted.outcome).toBe("OK");
    const projectId = converted.outcome === "OK" ? converted.projectId : "";
    const tender = await admin.query<{ converted_project_id: string; name: string }>(
      `SELECT t.converted_project_id, p.name FROM public.tenders t
         JOIN public.projects p ON p.id = t.converted_project_id WHERE t.id = $1`,
      [id],
    );
    expect(tender.rows[0]?.converted_project_id).toBe(projectId);
    expect(tender.rows[0]?.name).toBe(`Konverzija ${RUN}`);
    const audit = await admin.query(
      `SELECT action FROM public.audit_events WHERE company_id = $1 AND entity_id = $2 AND action = 'tender.converted'`,
      [companyA, id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("drugi convert je ALREADY_CONVERTED i ne pravi drugi projekat", async () => {
    const row = await admin.query<{ id: string }>(
      `SELECT id FROM public.tenders WHERE company_id = $1 AND converted_project_id IS NOT NULL LIMIT 1`,
      [companyA],
    );
    const before = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.projects WHERE company_id = $1`,
      [companyA],
    );
    expect(await convertTenderToProject(app, owner, row.rows[0]!.id)).toMatchObject({
      outcome: "CONFLICT",
      code: "ALREADY_CONVERTED",
    });
    const after = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.projects WHERE company_id = $1`,
      [companyA],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("convert iz DRAFT je TENDER_INVALID_STATUS", async () => {
    const created = await createTender(app, owner, {
      title: `Rano ${RUN}`, partnerId: partnerA, submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    const id = created.outcome === "OK" ? created.id! : "";
    expect(await convertTenderToProject(app, owner, id)).toMatchObject({
      outcome: "CONFLICT",
      code: "TENDER_INVALID_STATUS",
    });
    const linked = await admin.query(`SELECT converted_project_id FROM public.tenders WHERE id = $1`, [id]);
    expect(linked.rows[0]?.converted_project_id).toBeNull();
  });

  it("ACCOUNTANT ne smije convert", async () => {
    const created = await createTender(app, owner, {
      title: `Čita ${RUN}`, partnerId: partnerA, submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    const id = created.outcome === "OK" ? created.id! : "";
    expect((await convertTenderToProject(app, accountant, id)).outcome).toBe("FORBIDDEN");
  });

  it("prilog bez skladišta ne upisuje red", async () => {
    const created = await createTender(app, owner, {
      title: `Prilog ${RUN}`, partnerId: partnerA, submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    const id = created.outcome === "OK" ? created.id! : "";
    const registered = await registerTenderAttachment(app, owner, id, {
      fileName: "dok.pdf",
      sizeBytes: 100,
      sha256: "a".repeat(64),
      head: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
    });
    expect(registered).toMatchObject({ code: "CONFLICT" });
    const rows = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.attachments WHERE entity_type = 'TENDER' AND entity_id = $1`,
      [id],
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("convert ne prebacuje prilog na projekat", async () => {
    const id = await wonTender(`Ostaje ${RUN}`);
    await admin.query(
      `INSERT INTO public.attachments
         (id, company_id, entity_type, entity_id, object_key, file_name, content_type, size_bytes, sha256, status)
       VALUES ($1, $2, 'TENDER', $3, $4, 'dok.pdf', 'application/pdf', 10, $5, 'pending')`,
      [`tat_${RUN}`, companyA, id, `key/${RUN}`, "b".repeat(64)],
    );
    expect((await convertTenderToProject(app, owner, id)).outcome).toBe("OK");
    const still = await admin.query<{ entity_id: string }>(
      `SELECT entity_id FROM public.attachments WHERE id = $1`,
      [`tat_${RUN}`],
    );
    expect(still.rows[0]?.entity_id).toBe(id);
  });

  it("obaveza na tenderu ima jedan opseg; dva opsega padaju", async () => {
    const tender = await admin.query<{ id: string }>(
      `SELECT id FROM public.tenders WHERE company_id = $1 LIMIT 1`,
      [companyA],
    );
    const project = await admin.query<{ id: string }>(
      `SELECT id FROM public.projects WHERE company_id = $1 LIMIT 1`,
      [companyA],
    );
    const typeId = `${companyA}_obt_tender_docs`;
    await admin.query(
      // Trajna obaveza (bez roka) mora imati datum provjere — F2 pravilo.
      `INSERT INTO public.obligations (id, company_id, type_id, tender_id, review_at)
       VALUES ($1, $2, $3, $4, '2027-06-01')`,
      [`ob_${RUN}`, companyA, typeId, tender.rows[0]!.id],
    );
    const saved = await admin.query(`SELECT tender_id FROM public.obligations WHERE id = $1`, [`ob_${RUN}`]);
    expect(saved.rows[0]?.tender_id).toBe(tender.rows[0]!.id);
    await expect(admin.query(
      `INSERT INTO public.obligations (id, company_id, type_id, tender_id, project_id, review_at)
       VALUES ($1, $2, $3, $4, $5, '2027-06-01')`,
      [`ob_bad_${RUN}`, companyA, typeId, tender.rows[0]!.id, project.rows[0]!.id],
    )).rejects.toThrow(/obligations_one_scope/);
  });

  it("deaktiviran partner ne može na novi tender", async () => {
    expect((await updatePartner(app, owner, partnerA, { active: false })).outcome).toBe("OK");
    const denied = await createTender(app, owner, {
      title: `Mrtav ${RUN}`, partnerId: partnerA, submittedValueAmount: "1.00", currencyCode: "BAM",
    });
    expect(denied.outcome).toBe("VALIDATION_FAILED");
    const active = await admin.query<{ active: boolean }>(
      `SELECT active FROM public.partners WHERE id = $1`,
      [partnerA],
    );
    expect(active.rows[0]?.active).toBe(false);
  });
});
