/**
 * R4a-2 korak 2b: razrješenje sukoba na pravoj bazi.
 * Jedna transakcija (zaključavanje reda), idempotentnost, paralelnost dvije
 * konekcije, očuvanje odbačenog unosa, audit + change-log u istoj transakciji,
 * interna napomena nikad u payload-u za uređaj, zabrana strane u sukobu
 * (OWNER izuzetak s oznakom), opseg i tenant izolacija.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { resolveWorkdayConflict, countOpenConflicts, type ResolveActor } from "./workday-resolve";
import { workdayResolveScopeFor } from "./workday-review";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_rsv_${RUN}`;
const OTHER = `cmp_rsvx_${RUN}`;
const HASH = "a".repeat(64);
const INTERNAL = `INTERNA-NAPOMENA-${RUN}`;

const owner: ResolveActor = { userId: `usr_rsv_owner_${RUN}`, companyId: companyId(CO), roles: ["OWNER"], email: "owner@test.example" };
const adminActor: ResolveActor = { userId: `usr_rsv_admin_${RUN}`, companyId: companyId(CO), roles: ["ADMIN"], email: "admin@test.example" };
const pmOut: ResolveActor = { userId: `usr_rsv_pmout_${RUN}`, companyId: companyId(CO), roles: ["PROJECT_MANAGER"], email: "pmout@test.example" };
const reason = "Dupli unos istog segmenta s telefona";

const DATES: Record<string, string> = {
  acc: "2026-11-10", short: "2026-11-17", rej: "2026-11-11", recv: "2026-11-12",
  corr: "2026-11-13", race: "2026-11-14", party: "2026-11-15", scope: "2026-11-16",
};

async function seedConflict(admin: Pool, suffix: string): Promise<string> {
  const conflictId = `cnf_rsv_${suffix}_${RUN}`;
  const entryId = `we_rsv_${suffix}_${RUN}`;
  const date = DATES[suffix] ?? "2026-11-10";
  const serverEnd = suffix === "corr" ? "10:00" : "15:30";
  await admin.query(
    `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
     VALUES ($1, $2, 'wrk_rsv_worker_${RUN}', $3::date, 'DRAFT', 'usr_rsv_worker_${RUN}', 'usr_rsv_worker_${RUN}')
     ON CONFLICT DO NOTHING`,
    [`wd_rsv_${suffix}_${RUN}`, CO, date],
  );
  await admin.query(
    `INSERT INTO public.work_entries
       (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
     VALUES ($1, $2, $3, 'wrk_rsv_worker_${RUN}', 'WORK',
             ($4 || 'T08:00:00Z')::timestamptz, ($4 || 'T${serverEnd}:00Z')::timestamptz, 'KNOWN_END', 'prj_rsv_a_${RUN}',
             'usr_rsv_worker_${RUN}', 'usr_rsv_worker_${RUN}')`,
    [entryId, CO, `wd_rsv_${suffix}_${RUN}`, date],
  );
  await admin.query(
    `INSERT INTO public.sync_conflicts
       (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version)
     VALUES ($1, $2, 'usr_rsv_worker_${RUN}', 'local-${suffix}-${RUN}', $3,
             $4::jsonb, $5, 1)`,
    [conflictId, CO, entryId,
      JSON.stringify({ kind: "WORK", startedAt: `${date}T08:05:00Z`, endedAt: `${date}T15:30:00Z`, endState: "KNOWN_END", projectId: `prj_rsv_a_${RUN}`, machineId: null, note: null }), HASH],
  );
  return conflictId;
}

describeDb("R4a-2 resolve (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 4 });

  beforeAll(async () => {
    for (const [id, slug] of [[CO, `rsv-${RUN}`], [OTHER, `rsvx-${RUN}`]] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'RSV test', $2)", [id, slug]);
    }
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ('usr_rsv_owner_${RUN}', 'owner-${RUN}@test.example', 'x', 'Vlasnik', 'Test', false),
              ('usr_rsv_admin_${RUN}', 'admin-${RUN}@test.example', 'x', 'Admin', 'Test', false),
              ('usr_rsv_worker_${RUN}', 'worker-${RUN}@test.example', 'x', 'Radnik', 'Test', false),
              ('usr_rsv_pmout_${RUN}', 'pmout-${RUN}@test.example', 'x', 'PM', 'Izvan', false)`,
    );
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, user_id, hired_at)
       VALUES ('wrk_rsv_owner_${RUN}', $1, 'Vlasnik', 'Radnik', 'usr_rsv_owner_${RUN}', '2024-01-01'),
              ('wrk_rsv_worker_${RUN}', $1, 'Radnik', 'Autor', 'usr_rsv_worker_${RUN}', '2024-01-01'),
              ('wrk_rsv_pmout_${RUN}', $1, 'PM', 'IzvanOpsega', 'usr_rsv_pmout_${RUN}', '2024-01-01')`,
      [CO],
    );
    await admin.query(
      `INSERT INTO public.projects (id, company_id, code, name) VALUES ('prj_rsv_a_${RUN}', $1, 'A-${RUN}', 'Projekat A')`,
      [CO],
    );
    await admin.query(
      `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
       VALUES ('wd_rsv_1_${RUN}', $1, 'wrk_rsv_worker_${RUN}', '2026-11-10', 'DRAFT', 'usr_rsv_worker_${RUN}', 'usr_rsv_worker_${RUN}')`,
      [CO],
    );
  }, 60_000);

  afterAll(async () => { await admin.end(); await app.end(); });

  it("migracija: nova constraint imena postoje tačno jednom u šemi", async () => {
    const rows = await admin.query<{ conname: string; n: string }>(
      `SELECT conname, count(*)::text AS n FROM pg_constraint
        WHERE conname IN ('companies_conflict_reminder_days_check', 'sync_conflicts_resolution_kind_check',
                          'sync_conflicts_internal_note_check', 'sync_conflicts_resolution_key_unique',
                          'work_entries_resolution_state_check', 'work_entries_rejected_by_fk')
        GROUP BY conname`,
    );
    expect(rows.rows).toHaveLength(6);
    for (const row of rows.rows) expect(row.n).toBe("1");
  });

  it("ACCEPT_SERVER: transakcija, audit i change-log bez interne napomene; redovi se ne gube", async () => {
    const conflictId = await seedConflict(admin, "acc");
    const before = await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM public.work_entries WHERE company_id = $1", [CO]);
    const result = await resolveWorkdayConflict(app, adminActor, {
      conflictId, kind: "ACCEPT_SERVER", reason, internalNote: INTERNAL, idempotencyKey: `key-acc-${RUN}`,
    });
    expect(result.outcome).toBe("RESOLVED");
    expect(result.resolvedBy).toBe(adminActor.userId);
    const after = await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM public.work_entries WHERE company_id = $1", [CO]);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);

    const conflict = await admin.query<{ status: string; internal_note: string; resolution_reason: string; resolved_by_party: boolean; resolution_payload: unknown }>(
      "SELECT status, internal_note, resolution_reason, resolved_by_party, resolution_payload FROM public.sync_conflicts WHERE id = $1", [conflictId]);
    expect(conflict.rows[0]!.status).toBe("RESOLVED");
    expect(conflict.rows[0]!.internal_note).toBe(INTERNAL); // baza smije držati internu napomenu
    expect(JSON.stringify(conflict.rows[0]!.resolution_payload)).not.toContain(INTERNAL); // uređaj ne

    const audit = await admin.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM public.audit_events WHERE company_id = $1 AND entity_id = $2 AND action = 'workday.conflict_resolved'", [CO, conflictId]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toContain(INTERNAL);
    expect(audit.rows[0]!.metadata.resolvedByParty).toBe(false);
    expect(audit.rows[0]!.metadata.oldTimes).toBeTruthy();

    const events = await admin.query<{ payload: unknown }>(
      "SELECT payload FROM public.sync_change_log WHERE company_id = $1 AND entity_type = 'sync_conflict' AND entity_id = $2", [CO, conflictId]);
    expect(events.rows).toHaveLength(1);
    expect(JSON.stringify(events.rows[0]!.payload)).not.toContain(INTERNAL);
  });

  it("kratak razlog odbija server (i baza), sukob ostaje OPEN", async () => {
    const conflictId = await seedConflict(admin, "short");
    const result = await resolveWorkdayConflict(app, adminActor, {
      conflictId, kind: "ACCEPT_SERVER", reason: "kratko", idempotencyKey: `key-short-${RUN}`,
    });
    expect(result).toMatchObject({ outcome: "VALIDATION_FAILED", code: "RESOLUTION_REASON_TOO_SHORT" });
    const row = await admin.query<{ status: string }>("SELECT status FROM public.sync_conflicts WHERE id = $1", [conflictId]);
    expect(row.rows[0]!.status).toBe("OPEN");
  });

  it("REJECTED: odbačen unos ostaje red s razlogom i autorom odluke", async () => {
    const conflictId = await seedConflict(admin, "rej");
    const entryId = `we_rsv_rej_${RUN}`;
    const result = await resolveWorkdayConflict(app, adminActor, {
      conflictId, kind: "REJECTED", reason, idempotencyKey: `key-rej-${RUN}`,
    });
    expect(result.outcome).toBe("RESOLVED");
    expect(result.rejectedEntryId).toBe(entryId);
    const entry = await admin.query<{ resolution_state: string; rejection_reason: string; rejected_by: string }>(
      "SELECT resolution_state, rejection_reason, rejected_by FROM public.work_entries WHERE id = $1", [entryId]);
    expect(entry.rows).toHaveLength(1); // red nije obrisan
    expect(entry.rows[0]).toMatchObject({ resolution_state: "REJECTED", rejection_reason: reason, rejected_by: adminActor.userId });
  });

  it("ACCEPT_RECEIVED: server unos odbačen (ostaje), primljeni se upisuje", async () => {
    const conflictId = await seedConflict(admin, "recv");
    const result = await resolveWorkdayConflict(app, adminActor, {
      conflictId, kind: "ACCEPT_RECEIVED", reason, idempotencyKey: `key-recv-${RUN}`,
    });
    expect(result.outcome).toBe("RESOLVED");
    expect(result.acceptedEntryId).toBeTruthy();
    const server = await admin.query<{ resolution_state: string }>(
      "SELECT resolution_state FROM public.work_entries WHERE id = $1", [`we_rsv_recv_${RUN}`]);
    expect(server.rows[0]!.resolution_state).toBe("REJECTED");
    const accepted = await admin.query<{ started_at: Date; created_by: string }>(
      "SELECT started_at, created_by FROM public.work_entries WHERE id = $1", [result.acceptedEntryId]);
    expect(accepted.rows[0]!.created_by).toBe(`usr_rsv_worker_${RUN}`); // autor primljenog unosa ostaje autor
  });

  it("CORRECTED_TIMES: preklapanje daje jasan ishod i sukob ostaje OPEN; ispravna ispravka prolazi i označena je kao uredska", async () => {
    const conflictId = await seedConflict(admin, "corr");
    // Drugi, nepovezani segment istog radnika 12:00–13:00 da ispravka na njega naleti
    // (server unos je 08:00–10:00, pa se s njim ne preklapa).
    await admin.query(
      `INSERT INTO public.work_entries
         (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
       VALUES ('we_rsv_block_${RUN}', $1, 'wd_rsv_corr_${RUN}', 'wrk_rsv_worker_${RUN}', 'WORK',
               '2026-11-13T12:00:00Z', '2026-11-13T13:00:00Z', 'KNOWN_END', 'prj_rsv_a_${RUN}',
               'usr_rsv_worker_${RUN}', 'usr_rsv_worker_${RUN}')`,
      [CO],
    );
    const bad = await resolveWorkdayConflict(app, adminActor, {
      conflictId, kind: "CORRECTED_TIMES", reason, idempotencyKey: `key-corr-bad-${RUN}`,
      correctedTimes: { startedAt: "2026-11-13T11:00:00Z", endedAt: "2026-11-13T12:30:00Z", endState: "KNOWN_END" },
      correctedTarget: "SERVER",
    });
    // server unos je 08:00–15:30 i sam preklapa blocker; ispravka 11:00–12:30 i dalje dira blocker
    expect(bad.outcome).toBe("VALIDATION_FAILED");
    expect(bad.code).toMatch(/OVERLAP|OPEN_EXISTS|NOT_APPLICABLE/);
    let row = await admin.query<{ status: string }>("SELECT status FROM public.sync_conflicts WHERE id = $1", [conflictId]);
    expect(row.rows[0]!.status).toBe("OPEN");

    const good = await resolveWorkdayConflict(app, adminActor, {
      conflictId, kind: "CORRECTED_TIMES", reason, idempotencyKey: `key-corr-${RUN}`,
      correctedTimes: { startedAt: "2026-11-10T13:00:00Z", endedAt: "2026-11-10T15:30:00Z", endState: "KNOWN_END" },
      correctedTarget: "SERVER",
    });
    // 13:00–15:30 i dalje preklapa vlastiti original? Ne: ispravlja se isti red; ali
    // originalni red je taj isti, pa je jedini sudar blocker 12:00–13:00 (dodir na 13:00 je dozvoljen).
    expect(good.outcome).toBe("RESOLVED");
    expect(good.oldTimes?.startedAt).toContain("08:00");
    expect(good.newTimes?.startedAt).toContain("13:00");
    const entry = await admin.query<{ office_corrected: boolean }>(
      "SELECT office_corrected FROM public.work_entries WHERE id = $1", [`we_rsv_corr_${RUN}`]);
    expect(entry.rows[0]!.office_corrected).toBe(true);
    row = await admin.query<{ status: string }>("SELECT status FROM public.sync_conflicts WHERE id = $1", [conflictId]);
    expect(row.rows[0]!.status).toBe("RESOLVED");
  });

  it("idempotentnost i paralelnost: dvije istovremene konekcije — tačno jedna primijeni", async () => {
    const conflictId = await seedConflict(admin, "race");
    const input = { conflictId, kind: "ACCEPT_SERVER" as const, reason, idempotencyKey: `key-race-${RUN}` };
    const [a, b] = await Promise.all([
      resolveWorkdayConflict(app, adminActor, input),
      resolveWorkdayConflict(app, owner, { ...input, idempotencyKey: `key-race-2-${RUN}` }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_RESOLVED", "RESOLVED"]);
    const again = await resolveWorkdayConflict(app, adminActor, input);
    expect(again.outcome).toBe("ALREADY_RESOLVED");
    expect(again.resolvedBy).toBeTruthy();
    expect(again.resolvedAt).toBeTruthy();
    const events = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.sync_change_log WHERE company_id = $1 AND entity_type = 'sync_conflict' AND entity_id = $2", [CO, conflictId]);
    expect(events.rows[0]!.n).toBe("1"); // događaj tačno jednom
    const audits = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.audit_events WHERE company_id = $1 AND entity_id = $2", [CO, conflictId]);
    expect(audits.rows[0]!.n).toBe("1");
  });

  it("strana u sukobu: ADMIN-strana ne smije; OWNER-strana smije uz oznaku resolved_by_party", async () => {
    // server unos je autorov (worker), pa napravimo razrješavača-admina čiji je
    // radnički zapis upravo taj worker — privremeno preveži admina na worker zapis.
    const conflictId = await seedConflict(admin, "party");
    const partyAdmin: ResolveActor = { userId: `usr_rsv_worker_${RUN}`, companyId: companyId(CO), roles: ["ADMIN"], email: "w@test.example" };
    const denied = await resolveWorkdayConflict(app, partyAdmin, {
      conflictId, kind: "ACCEPT_SERVER", reason, idempotencyKey: `key-party-no-${RUN}`,
    });
    expect(denied).toMatchObject({ outcome: "FORBIDDEN", code: "RESOLVER_IS_PARTY" });

    const partyOwner: ResolveActor = { userId: `usr_rsv_worker_${RUN}`, companyId: companyId(CO), roles: ["OWNER"], email: "w@test.example" };
    const allowed = await resolveWorkdayConflict(app, partyOwner, {
      conflictId, kind: "ACCEPT_SERVER", reason, idempotencyKey: `key-party-owner-${RUN}`,
    });
    expect(allowed.outcome).toBe("RESOLVED");
    expect(allowed.resolvedByParty).toBe(true);
    const row = await admin.query<{ resolved_by_party: boolean }>(
      "SELECT resolved_by_party FROM public.sync_conflicts WHERE id = $1", [conflictId]);
    expect(row.rows[0]!.resolved_by_party).toBe(true);
    const audit = await admin.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM public.audit_events WHERE company_id = $1 AND entity_id = $2", [CO, conflictId]);
    expect(audit.rows[0]!.metadata.resolvedByParty).toBe(true);
  });

  it("opseg: PM izvan opsega ne razrješava; tenant izolacija krije tuđi sukob", async () => {
    const conflictId = await seedConflict(admin, "scope");
    const denied = await resolveWorkdayConflict(app, pmOut, {
      conflictId, kind: "ACCEPT_SERVER", reason, idempotencyKey: `key-scope-${RUN}`,
    });
    expect(denied.outcome).toBe("FORBIDDEN");

    const otherActor: ResolveActor = { userId: owner.userId, companyId: companyId(OTHER), roles: ["OWNER"], email: "o@test.example" };
    const hidden = await resolveWorkdayConflict(app, otherActor, {
      conflictId, kind: "ACCEPT_SERVER", reason, idempotencyKey: `key-tenant-${RUN}`,
    });
    expect(hidden.outcome).toBe("NOT_FOUND");
  });

  it("podsjetnik: broji samo nerazriješene; prag iz firme", async () => {
    const counts = await withCompany(app, companyId(CO), (client) =>
      countOpenConflicts(client, CO, workdayResolveScopeFor(["OWNER"], null)));
    expect(counts.thresholdDays).toBe(3);
    expect(counts.open).toBeGreaterThanOrEqual(1); // "short" i "scope" su ostali OPEN
    const none = await withCompany(app, companyId(CO), (client) =>
      countOpenConflicts(client, CO, workdayResolveScopeFor(["ACCOUNTANT"], null)));
    expect(none.open).toBe(0);
  });
});
