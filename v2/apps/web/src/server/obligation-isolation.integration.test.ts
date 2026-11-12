/**
 * Popravka nepopravljene stavke 1: lista i detalj rokova NE smiju zavisiti
 * samo od RLS-a. Test pokreće `listObligations`/`getObligation` ADMINISTRATORSKOM
 * rolom (DATABASE_ADMIN_URL, koja zaobilazi RLS) za demo firmu, sa identičnim
 * redovima u drugoj firmi, i dokazuje:
 *  - lista ne vraća rokove druge firme,
 *  - detalj tuđeg roka je NOT_FOUND (isti odgovor kao za nepostojeći),
 *  - vlastiti rok i dalje dolazi (filter ne prešiše).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId } from "@gradix/db";
import type { Actor } from "./access-service";
import {
  createObligation,
  createObligationType,
  deleteObligation,
  getObligation,
  isServiceError,
  listObligations,
  renewObligation,
  registerAttachment,
  updateObligation,
} from "./obligation-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

const STAMP = Date.now().toString(36);

describeDb("rokovi pod admin rolom ne vraćaju drugu firmu (popravka stavke 1)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const demo = companyId("cmp_demo");
  const demoObligation = `obl_isodemo_${STAMP}`;
  const drugaObligation = `obl_isodruga_${STAMP}`;
  const drugaWorker = `wrk_isodruga_${STAMP}`;
  const demoWorkerType = `obt_isow_demo_${STAMP}`;
  // Oznaka tipa koja postoji SAMO u drugoj firmi (identične oznake iz fiksture
  // su u objema firmama, pa ne dokazuju „tuđa oznaka je slobodna“).
  const drugaOnlyTypeCode = `ISX${STAMP.slice(-6)}`.toUpperCase();

  beforeAll(async () => {
    const run = promisify(execFile);
    const webDir = fileURLToPath(new URL("../..", import.meta.url));
    await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
      cwd: webDir,
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
      timeout: 120_000,
    });

    // Isti tip u objema firmama i po jedna obaveza firme — identičan sadržaj,
    // različita `company_id`. Pod admin rolom RLS NE razdvaja ove redove;
    // razdvaja ih samo izričiti `company_id` u WHERE-u servisa.
    for (const [company, obligation] of [
      ["cmp_demo", demoObligation],
      ["cmp_druga", drugaObligation],
    ] as const) {
      await admin.query(
        `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind)
         VALUES ($1, $2, $3, 'Izolacija test', 'COMPANY')`,
        [`obt_iso_${company}_${STAMP}`, company, `ISO${STAMP.slice(-6)}`.toUpperCase()],
      );
      await admin.query(
        `INSERT INTO public.obligations (id, company_id, type_id, scope_company, expires_at, note)
         VALUES ($1, $2, $3, true, current_date + 5, 'izolacija')`,
        [obligation, company, `obt_iso_${company}_${STAMP}`],
      );
      await admin.query(
        `INSERT INTO public.obligation_versions (id, company_id, obligation_id, version, expires_at)
         VALUES ($1, $2, $3, 1, current_date + 5)`,
        [`obv_iso_${company}_${STAMP}`, company, obligation],
      );
    }

    // Radnik druge firme i tip na radnika u demo firmi — za provjeru opsega obaveze.
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, 'cmp_druga', 'Omer', 'Tuđa', '2024-02-01')`,
      [drugaWorker],
    );
    await admin.query(
      `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind)
       VALUES ($1, 'cmp_demo', $2, 'Ljekarski demo firme', 'WORKER')`,
      [demoWorkerType, `ISOW${STAMP.slice(-5)}`.toUpperCase()],
    );
    await admin.query(
      `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind)
       VALUES ($1, 'cmp_druga', $2, 'Tip samo druge firme', 'COMPANY')`,
      [`obt_isoonly_druga_${STAMP}`, drugaOnlyTypeCode],
    );
  }, 180_000);

  afterAll(async () => {
    await admin.end();
  });

  it("lista rokova demo firme ne sadrži rok druge firme", async () => {
    const page = await listObligations(admin, demo);
    const ids = page.obligations.map((row) => row.id);
    expect(ids).toContain(demoObligation);
    expect(ids).not.toContain(drugaObligation);
  });

  it("detalj tuđeg roka je NOT_FOUND, vlastiti dolazi", async () => {
    const tuđi = await getObligation(admin, demo, drugaObligation);
    expect(isServiceError(tuđi)).toBe(true);
    if (isServiceError(tuđi)) expect(tuđi.code).toBe("NOT_FOUND");

    const svoj = await getObligation(admin, demo, demoObligation);
    expect(isServiceError(svoj)).toBe(false);
    if (!isServiceError(svoj)) {
      expect(svoj.obligation.id).toBe(demoObligation);
      expect(svoj.versions.map((version) => version.version)).toContain(1);
    }
  });

  /*
   * Stavka 2 (pokrivenost): ostale izmijenjene funkcije obaveza — tipovi, opseg,
   * izmjena, obnova, brisanje, prilog — sve pod admin rolom, sve NOT_FOUND na
   * tuđe redove i bez lažnih sukoba na tuđe oznake.
   */
  it("tip obaveze: oznaka druge firme je slobodna; tuđi tip nije vidljiv", async () => {
    const actor: Actor = { userId: "usr_vlasnik", roles: ["OWNER"] };

    const istaOznaka = await createObligationType(admin, demo, actor, {
      code: drugaOnlyTypeCode,
      label: "Ista oznaka, druga firma",
      entityKind: "COMPANY",
    });
    expect(isServiceError(istaOznaka)).toBe(false);

    const tuđiTip = await createObligation(admin, demo, actor, {
      typeId: `obt_iso_cmp_druga_${STAMP}`,
      scopeCompany: true,
      expiresAt: "2027-02-01",
    });
    expect(isServiceError(tuđiTip) && tuđiTip.code).toBe("NOT_FOUND");
  });

  it("opseg obaveze: radnik druge firme nije vidljiv", async () => {
    const actor: Actor = { userId: "usr_vlasnik", roles: ["OWNER"] };
    const tuđiRadnik = await createObligation(admin, demo, actor, {
      typeId: demoWorkerType,
      workerId: drugaWorker,
      expiresAt: "2027-02-01",
    });
    expect(isServiceError(tuđiRadnik) && tuđiRadnik.code).toBe("NOT_FOUND");
  });

  it("izmjena, obnova, brisanje i prilog tuđe obaveze su NOT_FOUND", async () => {
    const actor: Actor = { userId: "usr_vlasnik", roles: ["OWNER"] };

    const izmjena = await updateObligation(admin, demo, actor, drugaObligation, {
      typeId: `obt_iso_cmp_demo_${STAMP}`,
      scopeCompany: true,
    });
    expect(isServiceError(izmjena) && izmjena.code).toBe("NOT_FOUND");

    const obnova = await renewObligation(admin, demo, actor, drugaObligation, { expiresAt: "2027-03-01" });
    expect(isServiceError(obnova) && obnova.code).toBe("NOT_FOUND");

    const brisanje = await deleteObligation(admin, demo, actor, drugaObligation);
    expect(isServiceError(brisanje) && brisanje.code).toBe("NOT_FOUND");

    const prilog = await registerAttachment(admin, demo, actor, drugaObligation, {
      fileName: "ljekarski.pdf",
      sizeBytes: 2048,
      sha256: "a".repeat(64),
      head: new Uint8Array(32),
    });
    expect(isServiceError(prilog) && prilog.code).toBe("NOT_FOUND");
  });
});
