import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, setTenant, withCompany } from "./tenant";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const COMPANY_A = `cmp_cursor_a_${RUN}`;
const COMPANY_B = `cmp_cursor_b_${RUN}`;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function publish(
  client: PoolClient,
  company: string,
  seq: number,
  token: string,
  requestHash: string,
  entityId: string,
): Promise<string> {
  const result = await client.query<{ event_id: string }>(
    `SELECT public.sync_cursor_publish(
       $1, $2, $3, $4, 'workday', $5, 1, $6::jsonb, false
     ) AS event_id`,
    [company, seq, token, requestHash, entityId, JSON.stringify({ workDate: "2026-11-07" })],
  );
  return result.rows[0]!.event_id;
}

async function beginTenant(client: PoolClient, company: string): Promise<void> {
  await client.query("BEGIN");
  await setTenant(client, companyId(company));
}

describeDb("R4 cursor alokacija i change log (PostgreSQL)", () => {
  const app = new Pool({ connectionString: appUrl, max: 5 });
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    await admin.query(
      `INSERT INTO public.companies (id, name, slug)
       VALUES ($1, 'Cursor test A', $3), ($2, 'Cursor test B', $4)`,
      [COMPANY_A, COMPANY_B, `cursor-a-${RUN}`, `cursor-b-${RUN}`],
    );
  });

  afterAll(async () => {
    for (const company of [COMPANY_A, COMPANY_B]) {
      await withCompany(admin, companyId(company), async (client) => {
        await client.query("DELETE FROM public.sync_change_log WHERE company_id = $1", [company]);
        await client.query("DELETE FROM public.sync_cursor_slots WHERE company_id = $1", [company]);
        await client.query("DELETE FROM public.sync_cursor_allocators WHERE company_id = $1", [company]);
      });
    }
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await app.end();
    await admin.end();
  });

  it("prazan tenant dobija prazan cursor na nultom floor-u", async () => {
    const page = await withCompany(app, companyId(COMPANY_B), async (client) =>
      client.query<{ events: unknown[]; next_cursor: string; cursor_floor: string; has_more: boolean }>(
        "SELECT events, next_cursor::text, cursor_floor::text, has_more FROM public.sync_cursor_pull($1, 0, 100)",
        [COMPANY_B],
      ),
    );
    expect(page.rows[0]).toMatchObject({
      events: [],
      next_cursor: "0",
      cursor_floor: "0",
      has_more: false,
    });
  });

  it("ne preskače niži slot kad se viši poslovni upis commit-a prvi na drugoj konekciji", async () => {
    const first = await withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ seq: string }>(
        "SELECT public.sync_cursor_reserve($1, $2, 300)::text AS seq",
        [COMPANY_A, `reserve-a-${RUN}`],
      ),
    );
    const second = await withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ seq: string }>(
        "SELECT public.sync_cursor_reserve($1, $2, 300)::text AS seq",
        [COMPANY_A, `reserve-b-${RUN}`],
      ),
    );
    const seqA = Number(first.rows[0]!.seq);
    const seqB = Number(second.rows[0]!.seq);
    expect(seqB).toBe(seqA + 1);

    const clientA = await app.connect();
    const clientB = await app.connect();
    try {
      await beginTenant(clientA, COMPANY_A);
      const eventA = await publish(clientA, COMPANY_A, seqA, `reserve-a-${RUN}`, HASH_A, `wd-a-${RUN}`);
      expect(eventA).toBeTruthy();

      // A drži niži PENDING slot i change event uncommitted. B mora moći zaključati svoj slot,
      // pisati događaj i commit-ati nezavisno — nema allocator locka u poslovnoj transakciji.
      await beginTenant(clientB, COMPANY_A);
      const eventB = await publish(clientB, COMPANY_A, seqB, `reserve-b-${RUN}`, HASH_B, `wd-b-${RUN}`);
      expect(eventB).toBeTruthy();
      await clientB.query("COMMIT");

      const beforeA = await withCompany(app, companyId(COMPANY_A), async (client) =>
        client.query<{ events: unknown[]; next_cursor: string; has_more: boolean }>(
          "SELECT events, next_cursor::text, has_more FROM public.sync_cursor_pull($1, 0, 100)",
          [COMPANY_A],
        ),
      );
      expect(beforeA.rows[0]).toMatchObject({ events: [], next_cursor: "0", has_more: true });

      await clientA.query("COMMIT");

      const afterA = await withCompany(app, companyId(COMPANY_A), async (client) =>
        client.query<{ events: { id: string; cursorSeq: string }[]; next_cursor: string; has_more: boolean }>(
          "SELECT events, next_cursor::text, has_more FROM public.sync_cursor_pull($1, 0, 100)",
          [COMPANY_A],
        ),
      );
      expect(afterA.rows[0]?.events.map((event) => event.cursorSeq)).toEqual([String(seqA), String(seqB)]);
      expect(afterA.rows[0]).toMatchObject({ next_cursor: String(seqB), has_more: false });
    } catch (error) {
      await clientA.query("ROLLBACK").catch(() => undefined);
      await clientB.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      clientA.release();
      clientB.release();
    }
  }, 30_000);

  it("retry istog reservation tokena vraća isti slot i isti event samo za isti payload hash", async () => {
    const token = `retry-${RUN}`;
    const reservation = await withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ seq: string }>(
        "SELECT public.sync_cursor_reserve($1, $2, 300)::text AS seq",
        [COMPANY_A, token],
      ),
    );
    const seq = Number(reservation.rows[0]!.seq);
    const first = await withCompany(app, companyId(COMPANY_A), async (client) =>
      publish(client, COMPANY_A, seq, token, HASH_A, `wd-retry-${RUN}`),
    );
    const retrySlot = await withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ seq: string }>(
        "SELECT public.sync_cursor_reserve($1, $2, 300)::text AS seq",
        [COMPANY_A, token],
      ),
    );
    expect(Number(retrySlot.rows[0]!.seq)).toBe(seq);
    const retry = await withCompany(app, companyId(COMPANY_A), async (client) =>
      publish(client, COMPANY_A, seq, token, HASH_A, `wd-retry-${RUN}`),
    );
    expect(retry).toBe(first);
    await expect(
      withCompany(app, companyId(COMPANY_A), (client) =>
        publish(client, COMPANY_A, seq, token, HASH_B, `wd-retry-${RUN}`),
      ),
    ).rejects.toThrow(/SYNC_CURSOR_RETRY_PAYLOAD_MISMATCH/);
  });

  it("R4 item rezervacija je idempotentna, skip daje novu generaciju, committed retry vraća isti slot", async () => {
    const key = RUN.padEnd(64, "a").slice(0, 64);
    const reserveItem = () => withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ cursor_seq: string; reservation_token: string; already_committed: boolean }>(
        `SELECT cursor_seq::text, reservation_token, already_committed
           FROM public.sync_cursor_reserve_item($1, $2, 300)`,
        [COMPANY_A, key],
      ),
    );

    const first = (await reserveItem()).rows[0]!;
    const concurrentRetry = (await reserveItem()).rows[0]!;
    expect(concurrentRetry).toMatchObject({
      cursor_seq: first.cursor_seq,
      reservation_token: first.reservation_token,
      already_committed: false,
    });

    const skipped = await withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ skipped: boolean }>(
        "SELECT public.sync_cursor_skip($1, $2::bigint, $3) AS skipped",
        [COMPANY_A, first.cursor_seq, first.reservation_token],
      ),
    );
    expect(skipped.rows[0]?.skipped).toBe(true);

    const nextGeneration = (await reserveItem()).rows[0]!;
    expect(BigInt(nextGeneration.cursor_seq)).toBeGreaterThan(BigInt(first.cursor_seq));
    expect(nextGeneration.reservation_token).not.toBe(first.reservation_token);
    await withCompany(app, companyId(COMPANY_A), (client) =>
      publish(client, COMPANY_A, Number(nextGeneration.cursor_seq), nextGeneration.reservation_token,
        HASH_A, `wd-item-${RUN}`),
    );

    const committedRetry = (await reserveItem()).rows[0]!;
    expect(committedRetry).toMatchObject({
      cursor_seq: nextGeneration.cursor_seq,
      reservation_token: nextGeneration.reservation_token,
      already_committed: true,
    });
  });

  it("sweeper preskače samo istekli slot koji može zaključati i ne oživljava ga", async () => {
    const token = `expired-${RUN}`;
    const reservation = await withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ seq: string }>(
        "SELECT public.sync_cursor_reserve($1, $2, 1)::text AS seq",
        [COMPANY_A, token],
      ),
    );
    const seq = Number(reservation.rows[0]!.seq);
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const swept = await withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ count: number }>("SELECT public.sync_cursor_sweep($1, 100) AS count", [COMPANY_A]),
    );
    expect(swept.rows[0]?.count).toBe(1);

    await expect(
      withCompany(app, companyId(COMPANY_A), (client) =>
        publish(client, COMPANY_A, seq, token, HASH_A, `wd-late-${RUN}`),
      ),
    ).rejects.toThrow(/SYNC_CURSOR_RESERVATION_SKIPPED/);

    const page = await withCompany(app, companyId(COMPANY_A), async (client) =>
      client.query<{ events: unknown[]; next_cursor: string }>(
        "SELECT events, next_cursor::text FROM public.sync_cursor_pull($1, $2, 100)",
        [COMPANY_A, seq - 1],
      ),
    );
    expect(page.rows[0]).toMatchObject({ events: [], next_cursor: String(seq) });
  }, 10_000);

  it("cursor funkcije provjeravaju tenant kontekst, a interni slotovi nemaju direktan app ACL", async () => {
    await expect(
      withCompany(app, companyId(COMPANY_A), async (client) =>
        client.query("SELECT public.sync_cursor_pull($1, 0, 10)", [COMPANY_B]),
      ),
    ).rejects.toThrow(/SYNC_CURSOR_TENANT_MISMATCH/);
    await expect(
      withCompany(app, companyId(COMPANY_A), async (client) =>
        client.query("SELECT cursor_seq FROM public.sync_cursor_slots"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
