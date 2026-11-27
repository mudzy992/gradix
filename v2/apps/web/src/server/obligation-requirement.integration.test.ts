/**
 * F2 — obaveze s rokom na PRAVOJ bazi: pravila, „nedostaje“, kreiranje, grupna obnova,
 * potvrda dokumenta i retencija.
 *
 * Zašto integracioni a ne samo jedinični: domenski test dokazuje formulu, a ovaj dokazuje da
 * baza i servis daju ISTI odgovor — da `missing` stvarno nestane kad se obaveza upiše, da
 * `review_at` CHECK ne pušta trajnu obavezu bez provjere i da trajna obaveza ne ulazi u
 * `missing` preko pogrešnog JOIN-a.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMissingObligations,
  createRequirement,
  deleteRequirement,
  listMissing,
  listRequirements,
  updateRequirement,
} from "./obligation-requirement-service";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_f2_${RUN}`;
const OTHER = `cmp_f2x_${RUN}`;
const USER = `usr_f2_${RUN}`;
const WORKER_A = `wrk_f2a_${RUN}`;
const WORKER_B = `wrk_f2b_${RUN}`;
const MEDICAL = `obt_f2m_${RUN}`;
const SAFETY = `obt_f2s_${RUN}`;
const ACTOR = { userId: USER, roles: ["OWNER"] as never, scope: "COMPANY" as const, projectIds: null };

describeDb("F2 — pravila, nedostajuće obaveze i grupne radnje (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    for (const [id, slug] of [
      [CO, `f2-${RUN}`],
      [OTHER, `f2x-${RUN}`],
    ] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'F2', $2)", [id, slug]);
    }
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'f2-${RUN}@test.example', 'x', 'F', 'Two', false)`,
      [USER],
    );
    await admin.query(
      // `memberships.roles` je niz (F1): osoba može imati više rola u istoj firmi.
      `INSERT INTO public.memberships (id, user_id, company_id, roles, is_active)
       VALUES ($1, $2, $3, ARRAY['OWNER']::"Role"[], true)`,
      [`mem_f2_${RUN}`, USER, CO],
    );
    for (const [id, first] of [
      [WORKER_A, "Amar"],
      [WORKER_B, "Beha"],
    ] as const) {
      await admin.query(
        `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at, is_active)
         VALUES ($1, $2, $3, 'Radic', '2025-01-01', true)`,
        [id, CO, first],
      );
    }
    // `MEDICAL` traži prilog i osjetljiv je; `SAFETY` je običan.
    await admin.query(
      `INSERT INTO public.obligation_types
         (id, company_id, code, label, entity_kind, default_reminder_days, requires_attachment, sensitive)
       VALUES ($1, $2, $3, 'Ljekarski pregled', 'WORKER', '{30,15,7}', true, true),
              ($4, $2, $5, 'Obuka ZNR', 'WORKER', '{15,7}', false, false)`,
      [MEDICAL, CO, `F2MED${RUN}`.toUpperCase().slice(0, 40), SAFETY, `F2SAF${RUN}`.toUpperCase().slice(0, 40)],
    );
  }, 60_000);

  afterAll(async () => {
    // Redoslijed brisanja prati FK-ove: obaveze i verzije prije tipova, sve prije firme.
    await admin.query("DELETE FROM public.attachments WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.obligations WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.obligation_requirements WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.obligation_types WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.workers WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.memberships WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [USER]);
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[CO, OTHER]]);
    await admin.end();
    await app.end();
  }, 60_000);

  it("pravilo ALL se čuva, a duplikat se odbija sa jasnom greškom", async () => {
    const created = await createRequirement(
      app,
      CO as never,
      { entityKind: "WORKER", typeId: MEDICAL, appliesScope: "ALL" },
      ACTOR,
    );
    expect(created.ok).toBe(true);

    const duplicate = await createRequirement(
      app,
      CO as never,
      { entityKind: "WORKER", typeId: MEDICAL, appliesScope: "ALL" },
      ACTOR,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe("REQUIREMENT_EXISTS");
  });

  it("opseg bez vrijednosti i vrijednost bez opsega se odbijaju prije baze", async () => {
    const noValue = await createRequirement(
      app,
      CO as never,
      { entityKind: "WORKER", typeId: SAFETY, appliesScope: "ENGAGEMENT" },
      ACTOR,
    );
    expect(noValue.ok).toBe(false);

    const allWithValue = await createRequirement(
      app,
      CO as never,
      { entityKind: "WORKER", typeId: SAFETY, appliesScope: "ALL", appliesValue: "EMPLOYMENT" },
      ACTOR,
    );
    expect(allWithValue.ok).toBe(false);
  });

  it("tip drugog roda se ne može vezati na radnika", async () => {
    await admin.query(
      `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind)
       VALUES ($1, $2, $3, 'Registracija', 'MACHINE')`,
      [`obt_f2r_${RUN}`, CO, `F2REG${RUN}`.toUpperCase().slice(0, 40)],
    );
    const wrong = await createRequirement(
      app,
      CO as never,
      { entityKind: "WORKER", typeId: `obt_f2r_${RUN}`, appliesScope: "ALL" },
      ACTOR,
    );
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("ENTITY_KIND_MISMATCH");
  });

  it("„Nedostaje“ vraća oba radnika, a poslije upisa samo onog bez obaveze", async () => {
    // Drugo pravilo se pravi ovdje, a ne u `beforeAll`: prethodni testovi namjerno provjeravaju
    // da neispravno pravilo NE nastane, pa bi njihov uspjeh ovisio o redoslijedu.
    const safetyRule = await createRequirement(
      app,
      CO as never,
      { entityKind: "WORKER", typeId: SAFETY, appliesScope: "ALL" },
      ACTOR,
    );
    expect(safetyRule.ok).toBe(true);
    // Filtrira se na SOPSTVENE tipove: svaka nova firma dobija i standardna pravila
    // (MEDICAL, SAFETY_TRAINING), pa bi apsolutan broj zavisio od seeda, a ne od logike.
    const own = { typeId: MEDICAL };
    const before = await listMissing(app, CO as never, own, ACTOR);
    expect(before.items).toHaveLength(2);
    expect(before.items.every((item) => item.state === "missing")).toBe(true);
    expect(before.items.every((item) => item.typeId === MEDICAL)).toBe(true);

    await admin.query(
      `INSERT INTO public.obligations (id, company_id, type_id, worker_id, expires_at, created_by)
       VALUES ($1, $2, $3, $4, '2026-12-31', $5)`,
      [`obl_f2_${RUN}`, CO, MEDICAL, WORKER_A, USER],
    );

    const after = await listMissing(app, CO as never, own, ACTOR);
    // Amar ima ljekarski — nedostatak ostaje samo za Behu.
    expect(after.items).toHaveLength(1);
    expect(after.items[0]!.entityId).toBe(WORKER_B);

    // A obuka nedostaje obojici — obaveza jednog tipa ne pokriva drugi.
    const safety = await listMissing(app, CO as never, { typeId: SAFETY }, ACTOR);
    expect(safety.items.map((item) => item.entityId).sort()).toEqual([WORKER_A, WORKER_B].sort());
  });

  it("deaktivirano pravilo izlazi iz liste, a deaktiviran radnik takođe", async () => {
    const requirements = await listRequirements(app, CO as never, { entityKind: "WORKER" });
    const safetyRule = requirements.find((rule) => rule.typeId === SAFETY)!;

    const deactivated = await updateRequirement(
      app,
      CO as never,
      safetyRule.id,
      { isActive: false },
      ACTOR,
    );
    expect(deactivated.ok).toBe(true);

    const afterRule = await listMissing(app, CO as never, { typeId: SAFETY }, ACTOR);
    expect(afterRule.items).toEqual([]);

    await admin.query("UPDATE public.workers SET is_active = false WHERE id = $1", [WORKER_B]);
    const afterWorker = await listMissing(app, CO as never, { typeId: MEDICAL }, ACTOR);
    expect(afterWorker.items.some((item) => item.entityId === WORKER_B)).toBe(false);

    // Vraćanje stanja za sljedeći test.
    await admin.query("UPDATE public.workers SET is_active = true WHERE id = $1", [WORKER_B]);
    await updateRequirement(app, CO as never, safetyRule.id, { isActive: true }, ACTOR);
  });

  it("„Kreiraj sve nedostajuće“ upisuje obaveze bez roka, sa datumom provjere", async () => {
    const result = await createMissingObligations(
      app,
      CO as never,
      { reviewAt: "2027-06-01" },
      ACTOR,
    );
    expect(result.created).toBeGreaterThan(0);
    expect(result.skipped).toEqual([]);

    const rows = await admin.query<{ expires_at: string | null; review_at: string | null }>(
      "SELECT to_char(expires_at, 'YYYY-MM-DD') AS expires_at, to_char(review_at, 'YYYY-MM-DD') AS review_at FROM public.obligations WHERE company_id = $1 AND id = ANY($2)",
      [CO, result.ids],
    );
    // „Nedostaje“ se rješava unosom, ne izmišljanjem roka: obaveza je trajna dok se ne unese.
    expect(rows.rows.every((row) => row.expires_at === null)).toBe(true);
    expect(rows.rows.every((row) => row.review_at === "2027-06-01")).toBe(true);

    // Sopstveni tipovi su pokriveni; standardna pravila su i dalje nedostatak jer za njih
    // obaveze nisu unesene — to je tačno, a ne propust.
    for (const typeId of [MEDICAL, SAFETY]) {
      const final = await listMissing(app, CO as never, { typeId }, ACTOR);
      expect(final.items).toEqual([]);
    }
  });

  it("trajna obaveza bez datuma provjere se odbija na nivou baze", async () => {
    // Treći radnik postoji samo za ovaj test: `obligations_active_worker_type_unique` bi na
    // radniku koji već ima obuku pao PRIJE constraint triggera, pa test ne bi dokazao ništa.
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at, is_active)
       VALUES ($1, $2, 'Cvijo', 'Radic', '2025-01-01', true)`,
      [`wrk_f2c_${RUN}`, CO],
    );
    await expect(
      admin.query(
        `INSERT INTO public.obligations (id, company_id, type_id, worker_id, expires_at, created_by)
         VALUES ($1, $2, $3, $4, NULL, $5)`,
        [`obl_f2_bad_${RUN}`, CO, SAFETY, `wrk_f2c_${RUN}`, USER],
      ),
      // Poruka dolazi iz odgođenog constraint triggera (CHECK ne može: `expires_at` je keš
      // koji se puni poslije INSERT-a), pa se traži SMISAO, ne ime constrainta.
    ).rejects.toThrow(/datum provjere/);
  });

  it("odbijeno bez razloga se odbija; sa razlogom prolazi", async () => {
    // Sopstveni tip: `obligations_active_worker_type_unique` dozvoljava JEDNU aktivnu obavezu
    // po tipu i radniku, pa ovaj test ne smije da se osloni na tip koji već ima red.
    const rejectedType = `obt_f2j_${RUN}`;
    await admin.query(
      `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind)
       VALUES ($1, $2, $3, 'Ovlastenje za masinu', 'WORKER')
       ON CONFLICT DO NOTHING`,
      [rejectedType, CO, `F2OVL${RUN}`.toUpperCase().slice(0, 40)],
    );
    const id = `obl_f2_rej_${RUN}`;
    await expect(
      admin.query(
        `INSERT INTO public.obligations (id, company_id, type_id, worker_id, expires_at, review_state, created_by)
         VALUES ($1, $2, $3, $4, '2027-01-01', 'rejected', $5)`,
        [id, CO, rejectedType, WORKER_A, USER],
      ),
    ).rejects.toThrow(/obligations_review_note_required/);

    await admin.query(
      `INSERT INTO public.obligations (id, company_id, type_id, worker_id, expires_at, review_state, review_note, created_by)
       VALUES ($1, $2, $3, $4, '2027-01-01', 'rejected', 'Skeniran je pogrešan dokument', $5)`,
      [id, CO, rejectedType, WORKER_A, USER],
    );
    // `rejected` je ispred `expired`/`valid` — odbijanje blokira (§15).
    const state = await admin.query<{ state: string }>(
      `SELECT obligation_state(expires_at, '{7}'::int[], '2026-11-23'::date, superseded_by IS NOT NULL,
              review_at, review_state) AS state
         FROM public.obligations WHERE id = $1`,
      [id],
    );
    expect(state.rows[0]!.state).toBe("rejected");
  });

  it("tuđa firma ne vidi pravila ni nedostatke ove firme", async () => {
    // `OTHER` ima svoja (seedovana) pravila, ali NIJEDNO od `CO` — ni po id-u tipa, ni po
    // radniku. Ovo je test RLS-a i eksplicitnog `company_id` filtera zajedno.
    const requirements = await listRequirements(app, OTHER as never);
    expect(requirements.every((rule) => rule.typeId !== MEDICAL && rule.typeId !== SAFETY)).toBe(true);

    const missing = await listMissing(app, OTHER as never, {}, ACTOR);
    expect(missing.items).toEqual([]);
    expect(missing.counts.workers).toBe(0);
  });

  it("brisanje pravila je dozvoljeno za pogrešno unesen red", async () => {
    const created = await createRequirement(
      app,
      CO as never,
      { entityKind: "WORKER", typeId: SAFETY, appliesScope: "ENGAGEMENT", appliesValue: "CONTRACT" },
      ACTOR,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const deleted = await deleteRequirement(app, CO as never, created.requirement.id, ACTOR);
    expect(deleted.ok).toBe(true);
    const missing = await deleteRequirement(app, CO as never, created.requirement.id, ACTOR);
    expect(missing.ok).toBe(false);
  });
});
