/**
 * Stavka 2 (pokrivenost izolacije): svaka izmijenjena funkcija equipment-service
 * ima test pod ADMIN rolom (DATABASE_ADMIN_URL zaobilazi RLS). Fiksture su u
 * drugoj firmi; demo firma ne smije ni da ih vidi (NOT_FOUND) niti da tretira
 * tuđe oznake (radnika, mašine, kategorije) kao svoje duplikate.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId } from "@gradix/db";
import type { Actor } from "./access-service";
import {
  createCategory,
  createMachine,
  createWorker,
  isServiceError,
  linkWorkerUser,
  setMeterValue,
  setWorkerActive,
  updateMachine,
  updateWorker,
} from "./equipment-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

const STAMP = Date.now().toString(36);
const DRUGA_RADNIK = `wrk_eiso_${STAMP}`;
const DRUGA_KATEGORIJA = `eqc_eiso_${STAMP}`;
// Oznaka kategorije koja postoji SAMO u drugoj firmi.
const DRUGA_KATEGORIJA_KOD = `EISO${STAMP.slice(-5)}`.toUpperCase();
// Oznaka mašine koja postoji SAMO u drugoj firmi (BAG-77 iz seeda se u prvom
// prolazu testa stvori i u demo firmi, pa nije ponovljiv dokaz).
const DRUGA_MAŠINA_KOD = `EM${STAMP.slice(-5)}`.toUpperCase();
const DRUGA_MAŠINA = `mch_eiso_${STAMP}`;

describeDb("oprema i radnici pod admin rolom ne vide i ne diraju drugu firmu (pokrivenost)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const demo = companyId("cmp_demo");
  const actor: Actor = { userId: "usr_vlasnik", roles: ["OWNER"] };

  beforeAll(async () => {
    const run = promisify(execFile);
    const webDir = fileURLToPath(new URL("../..", import.meta.url));
    await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
      cwd: webDir,
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
      timeout: 120_000,
    });

    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, 'cmp_druga', 'Emina', 'Tuđa', '2024-05-01')`,
      [DRUGA_RADNIK],
    );
    await admin.query(
      `INSERT INTO public.equipment_categories (id, company_id, code, name, meter)
       VALUES ($1, 'cmp_druga', $2, 'Kategorija druge firme', 'KM')`,
      [DRUGA_KATEGORIJA, DRUGA_KATEGORIJA_KOD],
    );
    await admin.query(
      `INSERT INTO public.machines (id, company_id, code, name, category_id)
       VALUES ($1, 'cmp_druga', $2, 'Mašina druge firme', 'cmp_druga_cat_excavator')`,
      [DRUGA_MAŠINA, DRUGA_MAŠINA_KOD],
    );
  }, 180_000);

  afterAll(async () => {
    await admin.end();
  });

  it("radnik: nadređeni, dohvat, aktivacija i veza sa nalogom ostaju u firmi", async () => {
    // Nadređeni iz druge firme nije nadređeni ove firme.
    const tuđiNadređeni = await createWorker(admin, demo, actor, {
      firstName: "Kenan",
      lastName: "Kenjić",
      hiredAt: "2026-01-05",
      supervisorId: DRUGA_RADNIK,
    });
    expect(isServiceError(tuđiNadređeni) && tuđiNadređeni.code).toBe("NOT_FOUND");

    // Izmjena tuđeg radnika je NOT_FOUND...
    const tuđaIzmjena = await updateWorker(admin, demo, actor, DRUGA_RADNIK, {
      firstName: "Emina",
      lastName: "Tuđa",
      hiredAt: "2024-05-01",
    });
    expect(isServiceError(tuđaIzmjena) && tuđaIzmjena.code).toBe("NOT_FOUND");

    // ...a ni svoj radnik ne može dobiti tuđeg nadređenog.
    const svojTuđiNadređeni = await updateWorker(admin, demo, actor, "wrk_demo_nedim", {
      firstName: "Nedim",
      lastName: "Softić",
      hiredAt: "2025-01-20",
      supervisorId: DRUGA_RADNIK,
    });
    expect(isServiceError(svojTuđiNadređeni) && svojTuđiNadređeni.code).toBe("NOT_FOUND");

    const aktivacija = await setWorkerActive(admin, demo, actor, DRUGA_RADNIK, false);
    expect(isServiceError(aktivacija) && aktivacija.code).toBe("NOT_FOUND");

    // Tuđi radnik se ne može povezati s nalogom preko demo firme...
    const vezaTuđi = await linkWorkerUser(admin, demo, actor, DRUGA_RADNIK, "usr_radnik");
    expect(isServiceError(vezaTuđi) && vezaTuđi.code).toBe("NOT_FOUND");

    // ...niti svoj radnik s nalogom koji nije član demo firme (usr_stranac je vlasnik druge).
    const vezaTuđiNalog = await linkWorkerUser(admin, demo, actor, "wrk_demo_nedim", "usr_stranac");
    expect(isServiceError(vezaTuđiNalog) && vezaTuđiNalog.code).toBe("NOT_FOUND");
  });

  it("mašina: duplikat, kategorija, dohvat i brojilo ostaju u firmi", async () => {
    // Oznaka postoji SAMO u drugoj firmi — za demo firmu nije duplikat.
    const istaOznaka = await createMachine(admin, demo, actor, {
      code: DRUGA_MAŠINA_KOD,
      name: "Bager demo firme",
      categoryId: "cmp_demo_cat_excavator",
    });
    expect(isServiceError(istaOznaka)).toBe(false);

    // Kategorija druge firme ne postoji za demo firmu.
    const tuđaKategorija = await createMachine(admin, demo, actor, {
      code: `EISO-${STAMP.slice(-4)}`.toUpperCase(),
      name: "Mašina sa tuđom kategorijom",
      categoryId: DRUGA_KATEGORIJA,
    });
    expect(isServiceError(tuđaKategorija) && tuđaKategorija.code).toBe("NOT_FOUND");

    // Izmjena tuđe mašine je NOT_FOUND...
    const tuđaIzmjena = await updateMachine(admin, demo, actor, DRUGA_MAŠINA, {
      code: DRUGA_MAŠINA_KOD,
      name: "Bager druge firme",
      categoryId: DRUGA_KATEGORIJA,
    });
    expect(isServiceError(tuđaIzmjena) && tuđaIzmjena.code).toBe("NOT_FOUND");

    // ...a ni svoja mašina ne može preći u tuđu kategoriju.
    const svojaTuđaKategorija = await updateMachine(admin, demo, actor, "mch_bager", {
      code: "BAG-01",
      name: "Bager CAT 320",
      categoryId: DRUGA_KATEGORIJA,
    });
    expect(isServiceError(svojaTuđaKategorija) && svojaTuđaKategorija.code).toBe("NOT_FOUND");

    const brojilo = await setMeterValue(admin, demo, actor, DRUGA_MAŠINA, 1234);
    expect(isServiceError(brojilo) && brojilo.code).toBe("NOT_FOUND");
  });

  it("kategorija: oznaka druge firme je slobodna", async () => {
    const istaOznaka = await createCategory(admin, demo, actor, {
      code: DRUGA_KATEGORIJA_KOD,
      name: "Ista oznaka, druga firma",
      meter: "KM",
    });
    expect(isServiceError(istaOznaka)).toBe(false);
  });
});
