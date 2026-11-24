/**
 * `sync.purge` — integracioni test na stvarnoj bazi.
 *
 * Provjerava tri odluke koje se lako tiho pokvare:
 *  1. `OPEN` sukob se NE čisti, ma koliko star — otvoren problem nije star podatak,
 *  2. razriješen sukob mlađi od retencije ostaje čitljiv,
 *  3. briše se samo tijelo; red, odluka i razlog ostaju kao dokaz.
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeSyncPayloads } from "./sync-purge";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const COMPANY = `cmp_purge_${RUN}`;
const USER = `usr_purge_${RUN}`;

const logger = { info: () => undefined, warn: () => undefined };

describeDb("sync.purge", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 1 });

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1, 'Purge', $2)`, [COMPANY, `pg-${RUN}`]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1, $2, 'P', 'urge', 'x', false)`,
      [USER, `purge-${RUN}@test.example`],
    );
    /*
     * Tri sukoba: star+razriješen (čisti se), star+otvoren (ostaje), nov+razriješen (ostaje).
     *
     * Svi nastaju kao `OPEN` i tek onda se razrješavaju: baza ima trigger koji brani da sukob
     * nastane već razriješen (`SYNC_CONFLICT_MUST_START_OPEN`) — odluka se mora dogoditi, ne
     * upisati unaprijed.
     */
    await admin.query(
      `INSERT INTO sync_conflicts
         (id, company_id, actor_id, local_id, received_payload, payload_hash,
          status, created_at, entity_type, entity_id)
       VALUES
         ($1, $4, $5, 'l1', '{"a":1}'::jsonb, repeat('a', 64), 'OPEN', now() - interval '400 days', 'work_entry', 'we_1'),
         ($2, $4, $5, 'l2', '{"a":2}'::jsonb, repeat('b', 64), 'OPEN', now() - interval '400 days', 'work_entry', 'we_2'),
         ($3, $4, $5, 'l3', '{"a":3}'::jsonb, repeat('c', 64), 'OPEN', now() - interval '10 days', 'work_entry', 'we_3')`,
      [`cf_purge_old_${RUN}`, `cf_purge_open_${RUN}`, `cf_purge_new_${RUN}`, COMPANY, USER],
    );
    // Razrješenje kroz isti put kao u aplikaciji; guard brani UPDATE, pa se skida samo za fiksturu.
    await admin.query("ALTER TABLE sync_conflicts DISABLE TRIGGER sync_conflicts_history_guard");
    try {
      await admin.query(
        `UPDATE sync_conflicts SET status = 'RESOLVED', resolved_by = $2, resolution_reason = 'Stari razriješeni sukob.',
                resolution_kind = 'ACCEPT_SERVER', resolved_at = now() - interval '200 days',
                payload_purge_after = now() - interval '200 days' + interval '90 days'
          WHERE company_id = $1 AND id = $3`,
        [COMPANY, USER, `cf_purge_old_${RUN}`],
      );
      await admin.query(
        `UPDATE sync_conflicts SET status = 'RESOLVED', resolved_by = $2, resolution_reason = 'Novi razriješeni sukob.',
                resolution_kind = 'ACCEPT_SERVER', resolved_at = now() - interval '5 days',
                payload_purge_after = now() - interval '5 days' + interval '90 days'
          WHERE company_id = $1 AND id = $3`,
        [COMPANY, USER, `cf_purge_new_${RUN}`],
      );
    } finally {
      await admin.query("ALTER TABLE sync_conflicts ENABLE TRIGGER sync_conflicts_history_guard");
    }
  });

  afterAll(async () => {
    await admin.query("DELETE FROM sync_conflicts WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.query("DELETE FROM users WHERE id = $1", [USER]);
    await admin.end();
  });

  it("čisti samo tijelo starog razriješenog sukoba", async () => {
    const outcome = await purgeSyncPayloads(admin, { logger, retentionDays: 90 });
    expect(outcome.purged).toBe(1);

    const rows = await admin.query<{
      id: string;
      status: string;
      received_payload: unknown;
      payload_purged_at: Date | null;
      resolution_reason: string | null;
    }>(
      "SELECT id, status, received_payload, payload_purged_at, resolution_reason FROM sync_conflicts WHERE company_id = $1 ORDER BY id",
      [COMPANY],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));

    const cleaned = byId.get(`cf_purge_old_${RUN}`)!;
    expect(cleaned.received_payload).toBeNull();
    expect(cleaned.payload_purged_at).not.toBeNull();
    // Odluka ostaje — briše se sadržaj, ne dokaz da je odlučeno.
    expect(cleaned.resolution_reason).toContain("Stari");

    expect(byId.get(`cf_purge_open_${RUN}`)!.received_payload).not.toBeNull();
    expect(byId.get(`cf_purge_new_${RUN}`)!.received_payload).not.toBeNull();
  });

  it("drugi prolaz ne nalazi ništa — posao je idempotentan", async () => {
    const outcome = await purgeSyncPayloads(admin, { logger, retentionDays: 90 });
    expect(outcome.candidates).toBe(0);
    expect(outcome.purged).toBe(0);
  });

  it("neispravna retencija ne briše ništa", async () => {
    const outcome = await purgeSyncPayloads(admin, { logger, retentionDays: 0 });
    expect(outcome.purged).toBe(0);
  });
});
