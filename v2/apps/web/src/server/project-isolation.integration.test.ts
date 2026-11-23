/**
 * Stavka 2 (pokrivenost izolacije): svaka izmijenjena funkcija project-service
 * ima test pod ADMIN rolom (DATABASE_ADMIN_URL zaobilazi RLS). Fiksture su u
 * drugoj firmi; demo firma ne smije ni da ih vidi (NOT_FOUND / prazna lista)
 * ni da ih promijeni, a podaci druge firme (šifra projekta) ne smije da tretira
 * kao zauzete.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId } from "@gradix/db";
import {
  approveOverride,
  changeAssignment,
  createAssignment,
  createProject,
  getProject,
  isServiceError,
  listAssignments,
  listOverrideRequests,
  listProjects,
  requestOverride,
  updateProject,
  type ProjectActor,
} from "./project-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

const STAMP = Date.now().toString(36);
const DRUGA_PROJETK = `prj_piso_${STAMP}`;
const DRUGA_RADNIK = `wrk_piso_${STAMP}`;
const DRUGA_OBAVEZA = `obl_piso_${STAMP}`;
const DRUGA_TIP = `obt_piso_${STAMP}`;
const DRUGA_ZAHTJEV = `paor_piso_${STAMP}`;
const DRUGA_DODELA = `pas_piso_${STAMP}`;
// Žigosane oznake: seed je upsert i NE briše tragove prethodnog prolaza, pa
// fiksne oznake ne smiju postojati prije ovog prolaza nijednoj firmi.
const DRUGA_SIFRA = `PISO-${STAMP.slice(-4)}`.toUpperCase();
const DRUGA_SIFRA_2 = `PIS2-${STAMP.slice(-4)}`.toUpperCase();

describeDb("projekti pod admin rolom ne vide i ne diraju drugu firmu (pokrivenost)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const demo = companyId("cmp_demo");
  const owner: ProjectActor = { userId: "usr_vlasnik", roles: ["OWNER"], scope: "COMPANY", projectIds: null };

  beforeAll(async () => {
    const run = promisify(execFile);
    const webDir = fileURLToPath(new URL("../..", import.meta.url));
    await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
      cwd: webDir,
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
      timeout: 120_000,
    });

    // Sve fiksture u DRUGOJ firmi: projekat, radnik, tip + rok, zahtjev za
    // iznimku u čekanju i aktivna dodjela. Pod admin rolom RLS ih ne krije.
    await admin.query(
      `INSERT INTO public.projects (id, company_id, code, name) VALUES ($1, 'cmp_druga', $2, 'Projekat druge firme')`,
      [DRUGA_PROJETK, DRUGA_SIFRA],
    );
    await admin.query(
      `INSERT INTO public.projects (id, company_id, code, name) VALUES ($1, 'cmp_druga', $2, 'Drugi projekat druge firme')`,
      [`prj_pis2_${STAMP}`, DRUGA_SIFRA_2],
    );
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, 'cmp_druga', 'Dragan', 'Drugi', '2024-01-01')`,
      [DRUGA_RADNIK],
    );
    await admin.query(
      `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind)
       VALUES ($1, 'cmp_druga', $2, 'Ljekarski druge firme', 'WORKER')`,
      [DRUGA_TIP, `PISOW${STAMP.slice(-4)}`.toUpperCase()],
    );
    await admin.query(
      `INSERT INTO public.obligations (id, company_id, type_id, worker_id, expires_at)
       VALUES ($1, 'cmp_druga', $2, $3, current_date + 10)`,
      [DRUGA_OBAVEZA, DRUGA_TIP, DRUGA_RADNIK],
    );
    await admin.query(
      `INSERT INTO public.obligation_versions (id, company_id, obligation_id, version, expires_at)
       VALUES ($1, 'cmp_druga', $2, 1, current_date + 10)`,
      [`obv_piso_${STAMP}`, DRUGA_OBAVEZA],
    );
    await admin.query(
      `INSERT INTO public.project_assignment_overrides (id, company_id, project_id, obligation_id, worker_id, reason, requested_by)
       VALUES ($1, 'cmp_druga', $2, $3, $4, 'Treba nam taj radnik odmah', 'usr_stranac')`,
      [DRUGA_ZAHTJEV, DRUGA_PROJETK, DRUGA_OBAVEZA, DRUGA_RADNIK],
    );
    await admin.query(
      `INSERT INTO public.project_assignments (id, company_id, project_id, worker_id, from_date)
       VALUES ($1, 'cmp_druga', $2, $3, current_date - 5)`,
      [DRUGA_DODELA, DRUGA_PROJETK, DRUGA_RADNIK],
    );
  }, 180_000);

  afterAll(async () => {
    await admin.end();
  });

  it("lista i detalj ne vide projekat druge firme; tuđa šifra nije zauzeta", async () => {
    const list = await listProjects(admin, demo, owner);
    const ids = list.map((row) => row.id);
    expect(ids).toContain("prj_dionica");
    expect(ids).not.toContain(DRUGA_PROJETK);

    const tuđi = await getProject(admin, demo, owner, DRUGA_PROJETK);
    expect(isServiceError(tuđi) && tuđi.code).toBe("NOT_FOUND");

    // Šifra postoji SAMO u drugoj firmi — za demo firmu je slobodna.
    const created = await createProject(admin, demo, owner, {
      code: DRUGA_SIFRA,
      name: "Demo projekat sa istom šifrom",
    });
    expect(isServiceError(created)).toBe(false);
    if (isServiceError(created)) throw new Error("nije uspjelo");

    // Ista provjera u izmjeni: šifra druge firme ne blokira preimenovanje svog
    // (svježe napravljenog projekta, da seed redovi ostaju netaknuti).
    const updated = await updateProject(admin, demo, owner, created.id, { code: DRUGA_SIFRA_2 });
    expect(isServiceError(updated)).toBe(false);

    // Izmjena tuđeg projekta je NOT_FOUND.
    const tuđaIzmjena = await updateProject(admin, demo, owner, DRUGA_PROJETK, { name: "Hakovanje" });
    expect(isServiceError(tuđaIzmjena) && tuđaIzmjena.code).toBe("NOT_FOUND");
  });

  it("dodjela ne prihvata projekat, radnika ni mašinu druge firme", async () => {
    const tuđiProjekat = await createAssignment(admin, demo, owner, DRUGA_PROJETK, {
      workerId: DRUGA_RADNIK,
      fromDate: "2027-01-01",
    });
    expect(isServiceError(tuđiProjekat) && tuđiProjekat.code).toBe("NOT_FOUND");

    const tuđiRadnik = await createAssignment(admin, demo, owner, "prj_most", {
      workerId: DRUGA_RADNIK,
      fromDate: "2027-01-01",
    });
    expect(isServiceError(tuđiRadnik) && tuđiRadnik.code).toBe("NOT_FOUND");

    // mch_tudji (BAG-77) je mašina druge firme iz seeda.
    const tuđaMašina = await createAssignment(admin, demo, owner, "prj_most", {
      machineId: "mch_tudji",
      fromDate: "2027-01-01",
    });
    expect(isServiceError(tuđaMašina) && tuđaMašina.code).toBe("NOT_FOUND");

    // Liste dodjela po tuđem projektu nema — filter je na firmi, ne samo na RLS-u.
    const page = await listAssignments(admin, demo, owner, DRUGA_PROJETK);
    expect(isServiceError(page)).toBe(false);
    if (!isServiceError(page)) expect(page.assignments).toEqual([]);
  });

  it("zahtjev za iznimku, odobrenje i poništavanje ne diraju drugu firmu", async () => {
    const tuđiRok = await requestOverride(admin, demo, owner, "prj_most", {
      obligationId: DRUGA_OBAVEZA,
      workerId: DRUGA_RADNIK,
      reason: "Treba nam radnik odmah na terenu",
      fromDate: "2027-01-01",
    });
    expect(isServiceError(tuđiRok) && tuđiRok.code).toBe("NOT_FOUND");

    const tuđiProjekat = await requestOverride(admin, demo, owner, DRUGA_PROJETK, {
      obligationId: DRUGA_OBAVEZA,
      workerId: DRUGA_RADNIK,
      reason: "Treba nam radnik odmah na terenu",
      fromDate: "2027-01-01",
    });
    expect(isServiceError(tuđiProjekat) && tuđiProjekat.code).toBe("NOT_FOUND");

    const odobrenje = await approveOverride(admin, demo, owner, DRUGA_ZAHTJEV, { validUntil: "2027-06-30" });
    expect(isServiceError(odobrenje) && odobrenje.code).toBe("NOT_FOUND");

    const zahtjevi = await listOverrideRequests(admin, demo, owner);
    expect(zahtjevi.map((row) => row.id)).not.toContain(DRUGA_ZAHTJEV);

    const poništavanje = await changeAssignment(admin, demo, owner, DRUGA_PROJETK, DRUGA_DODELA, {
      action: "VOID",
      reason: "Pogrešno unesena dodjela",
    });
    expect(isServiceError(poništavanje) && poništavanje.code).toBe("NOT_FOUND");
  });
});
