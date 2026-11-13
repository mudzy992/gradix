/**
 * B4 — `scripts/demo-pregled.ts`: demo podaci za Pregled. Dokazuje kroz pravi
 * servis i pravu bazu (RLS, aplikacijska rola):
 *  (1) naredba odbija firmu koja nije demo PRIJE bilo kakvog upisa;
 *  (2) pravi tačno JEDNU blokiranu dodjelu (istekla registracija mašine) —
 *      vidi se kroz `listAssignments`, ne samo kroz red u bazi;
 *  (3) dan za provjeru sa segmentom nepoznatog kraja, dan sa redovnim
 *      segmentima i današnji dan u toku sa otvorenim segmentom;
 *  (4) zadnju sinhronizaciju po korisniku i neuspjele stavke (OPEN sukobi);
 *  (5) ponovni poziv je idempotentan (isti broj redova, ista blokada).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemoPregled } from "../../scripts/demo-pregled";
import { listAssignments } from "../server/project-service";
import { companyId } from "@gradix/db";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const describeDb = adminUrl && appUrl ? describe : describe.skip;

const countPrg = async (admin: Pool, table: string, column: "id" | "local_id" = "id") => {
  const like = column === "local_id" ? "prg-sync-%" : "prg_%";
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.${table} WHERE company_id = 'cmp_demo' AND ${column} LIKE $1`,
    [like],
  );
  return Number(result.rows[0]?.n ?? "0");
};

describeDb("demo-pregled naredba (B4)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  // Čitanje kroz servis ide aplikacijskom rolom — isto kao runtime.
  const app = new Pool({ connectionString: appUrl, max: 2 });
  let ownerUserId = "";

  beforeAll(async () => {
    // Demo firma, radnici, mašine, projekti i dodjele dolaze iz seeda (idempotentan).
    const run = promisify(execFile);
    const webDir = fileURLToPath(new URL("../..", import.meta.url));
    await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
      cwd: webDir,
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
      timeout: 120_000,
    });
    const owner = await admin.query<{ user_id: string }>(
      "SELECT user_id FROM public.memberships WHERE company_id = 'cmp_demo' AND is_active AND 'OWNER' = ANY(roles) LIMIT 1",
    );
    ownerUserId = owner.rows[0]?.user_id ?? "";
  }, 180_000);

  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it("odbija firmu koja nije demo i ništa ne upisuje", async () => {
    const before = await countPrg(admin, "workdays");
    await expect(seedDemoPregled(admin, "druga-firma")).rejects.toThrow(/samo za demo firmu/);
    expect(await countPrg(admin, "workdays")).toBe(before);
  });

  it("pravi jednu blokiranu dodjelu, dane za provjeru i podatke sinhronizacije", async () => {
    const report = await seedDemoPregled(admin);

    // (2) Blokirana dodjela — kroz servis, s opsegom vlasnika.
    expect(report.blockedAssignment).not.toBeNull();
    expect(report.blockedAssignment!.typeLabel).toBe("Registracija (demo)");
    const todayRow = await admin.query<{ today: string }>(
      "SELECT (clock_timestamp() AT TIME ZONE timezone)::date::text AS today FROM public.companies WHERE id = 'cmp_demo'",
    );
    expect(report.blockedAssignment!.expiresAt < todayRow.rows[0]!.today).toBe(true);

    const assignments = await listAssignments(
      app,
      companyId("cmp_demo"),
      { userId: ownerUserId, roles: ["OWNER"], scope: "COMPANY", projectIds: null },
      // Projekat blokirane dodjele se čita iz baze — test ne pretpostavlja šta je seed odabrao.
      (
        await admin.query<{ project_id: string }>(
          "SELECT project_id FROM public.project_assignments WHERE company_id = 'cmp_demo' AND id = $1",
          [report.blockedAssignment!.assignmentId],
        )
      ).rows[0]!.project_id,
    );
    expect("code" in assignments).toBe(false);
    if (!("code" in assignments)) {
      const blocked = assignments.assignments.filter((row) => row.blocked.length > 0);
      expect(blocked).toHaveLength(1);
      expect(blocked[0]!.id).toBe(report.blockedAssignment!.assignmentId);
      expect(blocked[0]!.blocked[0]!.typeLabel).toBe("Registracija (demo)");
      expect(blocked[0]!.blocked[0]!.covered).toBe(false);
    }

    // (3) Dani: jedan SUBMITTED s UNKNOWN_END, jedan SUBMITTED redovan, jedan DRAFT s OPEN.
    expect(report.workdays).toHaveLength(3);
    const submitted = report.workdays.filter((day) => day.status === "SUBMITTED");
    expect(submitted.length).toBeGreaterThanOrEqual(2);
    expect(submitted.some((day) => day.segments.includes("UNKNOWN_END"))).toBe(true);
    const inProgress = report.workdays.find((day) => day.status === "DRAFT");
    expect(inProgress).toBeDefined();
    expect(inProgress!.segments).toContain("OPEN");
    expect(inProgress!.workDate).toBe(todayRow.rows[0]!.today);
    expect(report.workdays.some((day) => day.status === "SUBMITTED" && day.segments.includes("KNOWN_END"))).toBe(true);

    // (4) Sinhronizacija: zadnja po korisniku (radnik novije od šefa), neuspjele stavke OPEN.
    expect(report.sync.length).toBe(2);
    const byActor = new Map(report.sync.map((row) => [row.actorId, row]));
    expect(byActor.get("usr_radnik")!.receipts).toBe(2);
    expect(byActor.get("usr_sef")!.receipts).toBe(1);
    expect(new Date(byActor.get("usr_radnik")!.lastSyncAt).getTime()).toBeGreaterThan(
      new Date(byActor.get("usr_sef")!.lastSyncAt).getTime(),
    );
    expect(report.failedItems).toHaveLength(3);
    const openConflicts = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.sync_conflicts WHERE company_id = 'cmp_demo' AND id LIKE 'prg_cnf_%' AND status = 'OPEN'",
    );
    expect(Number(openConflicts.rows[0]?.n)).toBe(3);

    // (5) Idempotentnost: isti broj svojih redova, i dalje tačno jedna blokada.
    const counts = {
      workdays: await countPrg(admin, "workdays"),
      entries: await countPrg(admin, "work_entries"),
      conflicts: await countPrg(admin, "sync_conflicts"),
      receipts: await countPrg(admin, "sync_receipts", "local_id"),
      obligations: await countPrg(admin, "obligations"),
      types: await countPrg(admin, "obligation_types"),
    };
    const again = await seedDemoPregled(admin);
    expect(await countPrg(admin, "workdays")).toBe(counts.workdays);
    expect(await countPrg(admin, "work_entries")).toBe(counts.entries);
    expect(await countPrg(admin, "sync_conflicts")).toBe(counts.conflicts);
    expect(await countPrg(admin, "sync_receipts", "local_id")).toBe(counts.receipts);
    expect(await countPrg(admin, "obligations")).toBe(counts.obligations);
    expect(await countPrg(admin, "obligation_types")).toBe(counts.types);
    expect(again.failedItems).toHaveLength(3);
    expect(again.blockedAssignment!.assignmentId).toBe(report.blockedAssignment!.assignmentId);
  }, 240_000);
});
