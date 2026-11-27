/**
 * F0.3 — blokade na pravoj bazi, kroz IZU servisa (ne kroz domenu).
 *
 * Provjerava da `usage-service` stvarno čita `obligations`/`usage_overrides` i da ista odluka
 * važi u svim putevima:
 *   1. istekao tehnički blokira turu i radne sate mašine, ali NE blokira gorivo;
 *   2. iznimka važi samo za svoju radnju i samo dok ne istekne;
 *   3. tuđa firma ne vidi ni signale ni iznimke.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUse, checkUseBatch } from "./usage-service";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_us_${RUN}`;
const OTHER = `cmp_usx_${RUN}`;
const USER = `usr_us_${RUN}`;
const MACHINE = `mac_us_${RUN}`;
const TYPE = `obt_us_${RUN}`;
const OBL = `obl_us_${RUN}`;
const OVERRIDE = `uo_us_${RUN}`;
const TODAY = "2026-11-23";

describeDb("F0.3 canUseEntity kroz usage-service (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    for (const [id, slug] of [[CO, `us-${RUN}`], [OTHER, `usx-${RUN}`]] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'US', $2)", [id, slug]);
    }
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'us-${RUN}@test.example', 'x', 'U', 'S', false)`,
      [USER],
    );
    await admin.query(
      `INSERT INTO public.machines (id, company_id, code, name, category_id)
       VALUES ($1, $2, $3, 'Bager US', (SELECT id FROM public.equipment_categories WHERE company_id = $2 LIMIT 1))`,
      [MACHINE, CO, `US${RUN}`.slice(0, 12)],
    );
    await admin.query(
      `INSERT INTO public.obligation_types (id, company_id, code, label, entity_kind, blocks_assignment)
       VALUES ($1, $2, $3, 'Tehnički pregled', 'MACHINE', true)`,
      [TYPE, CO, `USTR${RUN}`.toUpperCase().slice(0, 40)],
    );
    // IsteKaO juče: dan isteka NIJE istekao, dan poslije jeste.
    await admin.query(
      `INSERT INTO public.obligations (id, company_id, type_id, machine_id, expires_at, created_by)
       VALUES ($1, $2, $3, $4, '2026-11-22', $5)`,
      [OBL, CO, TYPE, MACHINE, USER],
    );
  }, 60_000);

  afterAll(async () => {
    await admin.query("DELETE FROM public.usage_overrides WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.obligations WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.obligation_types WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.machines WHERE company_id = $1", [CO]);
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [USER]);
    await admin.end();
    await app.end();
  });

  it("istekla obaveza blokira turu i sate, ali ne gorivo", async () => {
    for (const action of ["haul", "machine_hours"] as const) {
      const decision = await checkUse(app, CO, {
        entityKind: "MACHINE",
        entityId: MACHINE,
        action,
        today: TODAY,
      });
      expect(decision.allowed, action).toBe(false);
      expect(decision.blockers[0]?.label).toContain("Tehnički pregled");
      expect(decision.overrideAvailable).toBe(true);
    }

    const fuel = await checkUse(app, CO, {
      entityKind: "MACHINE",
      entityId: MACHINE,
      action: "fuel",
      today: TODAY,
    });
    expect(fuel.allowed).toBe(true);
    expect(fuel.warns).toHaveLength(1);
  });

  it("iznimka pušta samo svoju radnju i samo dok traje", async () => {
    await admin.query(
      `INSERT INTO public.usage_overrides
         (id, company_id, subject_kind, subject_id, action, reference_id, reason, valid_from, valid_to, approved_by, approved_at)
       VALUES ($1, $2, 'MACHINE', $3, 'haul', $4, 'Hitna tura za sanaciju klizišta.', $5::date, $6::date, $7, now())`,
      [OVERRIDE, CO, MACHINE, OBL, TODAY, "2026-11-30", USER],
    );

    const haul = await checkUse(app, CO, {
      entityKind: "MACHINE",
      entityId: MACHINE,
      action: "haul",
      today: TODAY,
    });
    expect(haul.allowed).toBe(true);
    expect(haul.warns[0]).toMatchObject({ overridden: true });

    // Radni sati NISU pokriveni istom iznimkom — iznimka nikad nije „sve“.
    const hours = await checkUse(app, CO, {
      entityKind: "MACHINE",
      entityId: MACHINE,
      action: "machine_hours",
      today: TODAY,
    });
    expect(hours.allowed).toBe(false);

    // Poslije `valid_to` iznimka više ne važi.
    const later = await checkUse(app, CO, {
      entityKind: "MACHINE",
      entityId: MACHINE,
      action: "haul",
      today: "2026-12-01",
    });
    expect(later.allowed).toBe(false);

    await admin.query("DELETE FROM public.usage_overrides WHERE id = $1", [OVERRIDE]);
  });

  it("tuđa firma ne vidi ni signale ni iznimke", async () => {
    const foreign = await checkUse(app, OTHER, {
      entityKind: "MACHINE",
      entityId: MACHINE,
      action: "haul",
      today: TODAY,
    });
    expect(foreign.allowed).toBe(true);
    expect(foreign.warns).toHaveLength(0);
  });

  it("batch daje istu odluku kao pojedinačni poziv", async () => {
    const batch = await checkUseBatch(app, CO, {
      entityKind: "MACHINE",
      entityIds: [MACHINE, "mac_nepostojeca"],
      action: "haul",
      today: TODAY,
    });
    const single = await checkUse(app, CO, {
      entityKind: "MACHINE",
      entityId: MACHINE,
      action: "haul",
      today: TODAY,
    });
    expect(batch.get(MACHINE)?.allowed).toBe(single.allowed);
    expect(batch.get("mac_nepostojeca")?.allowed).toBe(true);
  });

  it("iznimka bez odobrenja pada na CHECK u bazi, ne prolazi tiho", async () => {
    await expect(
      admin.query(
        `INSERT INTO public.usage_overrides
           (id, company_id, subject_kind, subject_id, action, reference_id, reason, approved_by)
         VALUES ($1, $2, 'MACHINE', $3, 'haul', $4, 'Razlog je dovoljno dugačak.', $5)`,
        [`uo_bad_${RUN}`, CO, MACHINE, OBL, USER],
      ),
    ).rejects.toThrow(/usage_overrides_approval_check/);
  });
});
