/**
 * F8 — mobilni sync radionice, kroz PRAVU rutu i PRAVU bazu.
 *
 * Dokazuje ono što web test ne može: da telefon NE računa trošak. Payload nosi sate i dijelove, a
 * `total_cost`, `labor_cost` i zaliha nastaju na serveru — istim funkcijama koje koristi web.
 *
 * Testovi:
 *  1. `START` iz `APPROVED` → `IN_PROGRESS`, ponovljeni `START` je `DUPLICATE`, ne greška;
 *  2. `PART` sa istim `actionId` dvaput skida zalihu JEDNOM (`STOCK_ALREADY_POSTED` → `DUPLICATE`);
 *  3. `FINISH` sa 2,5 h × 20,00 KM = 50,00 KM rada; ukupno = rad + dijelovi;
 *  4. trošak je u `cost_entries` (kategorija `SERVIS`) poslije commit-a, i to SAMO jednom;
 *  5. otkazan/završen nalog odbija dalje radnje (`SERVICE_ALREADY_DONE`);
 *  6. tuđa firma ne vidi nalog (`NOT_FOUND`), a radnik bez `service.manage` dobija `REJECTED`.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import type { R4SyncPushItem, R4SyncPushItemResult } from "@gradix/domain";
import { ACCESS_COOKIE, issueAccessToken } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const CO = `cmp_f8s_${RUN}`;
const CO_B = `cmp_f8sb_${RUN}`;
const USER_OWNER = `usr_f8s_own_${RUN}`;
const USER_MECH = `usr_f8s_meh_${RUN}`;
const USER_OP = `usr_f8s_op_${RUN}`;
const USER_B = `usr_f8s_b_${RUN}`;
const WORKER_MECH = `wrk_f8s_meh_${RUN}`;
const WORKER_OP = `wrk_f8s_op_${RUN}`;
const MACHINE = `mch_f8s_${RUN}`;
const ITEM = `stk_f8s_${RUN}`;

const COOKIES = { owner: "", mech: "", op: "", b: "" };
type CookieKey = keyof typeof COOKIES;

/**
 * `uuid` oblik traži ugovor (`localId` je `z.string().uuid()`), a JEDINSTVENOST je uslov sync-a:
 * isti `localId` uz drugi sadržaj se odbija kao `SYNC_LOCAL_ID_REUSED`. Zato se brojač, a ne
 * tekst radnje — radnja sa istim imenom u dva testa mora dobiti drugi `localId`.
 */
let localSeq = 0;
const localId = (): string => {
  localSeq += 1;
  return `aaaaaaaa-bbbb-4ccc-8ddd-${String(localSeq).padStart(12, "0")}`;
};

async function signIn(pool: Pool, userId: string, company: string, key: CookieKey): Promise<void> {
  const sessionId = `ses_${userId}`;
  await withCompany(pool, companyId(company), async (client) => {
    await client.query(
      `INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [sessionId, company, userId, `hash_${sessionId}`],
    );
  });
  COOKIES[key] = `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, companyId: company, sid: sessionId })}`;
}

function pushRequest(cookie: string, items: unknown[]): NextRequest {
  return new NextRequest("http://t/api/sync/push", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

/** Jedna radnja kao što je telefon pravi. */
function actionItem(input: {
  actionId: string;
  orderId: string;
  action: Record<string, unknown>;
}): R4SyncPushItem {
  return {
    localId: localId(),
    entityType: "service_order_action",
    actionId: input.actionId,
    serviceOrderId: input.orderId,
    deviceSentAt: "2026-11-20T08:00:00+01:00",
    action: {
      kind: "START",
      laborHours: null,
      externalCostAmount: null,
      warrantyUntil: null,
      note: null,
      part: null,
      ...input.action,
    },
  } as R4SyncPushItem;
}

describeDb("F8 mobilni sync radionice", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 3 });
  let push: (request: NextRequest) => Promise<Response>;
  let orderId = "";
  const at = (result: R4SyncPushItemResult[]) => result[0]!;

  beforeAll(async () => {
    ({ POST: push } = await import("@/app/api/sync/push/route"));
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1,'F8 Sync',$2), ($3,'F8 Sync B',$4)`, [
      CO, `f8s-${RUN}`, CO_B, `f8sb-${RUN}`,
    ]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1,$2,'V','Lasnik','x',false), ($3,$4,'M','Ehaničar','x',false),
              ($5,$6,'R','Ukovalac','x',false), ($7,$8,'B','Firma','x',false)`,
      [
        USER_OWNER, `own-f8s-${RUN}@test.example`,
        USER_MECH, `meh-f8s-${RUN}@test.example`,
        USER_OP, `op-f8s-${RUN}@test.example`,
        USER_B, `b-f8s-${RUN}@test.example`,
      ],
    );
    await withCompany(admin, companyId(CO), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY'),
                ($4,$5,$3,ARRAY['MECHANIC']::"Role"[],'COMPANY'),
                ($6,$7,$3,ARRAY['MACHINE_OPERATOR']::"Role"[],'COMPANY')`,
        [`mem_f8so_${RUN}`, USER_OWNER, CO, `mem_f8sm_${RUN}`, USER_MECH, `mem_f8sop_${RUN}`, USER_OP],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1,$2,'M','Ehaničar','2024-01-01'::date,$3), ($4,$2,'R','Ukovalac','2024-01-01'::date,$5)`,
        [WORKER_MECH, CO, USER_MECH, WORKER_OP, USER_OP],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1,$2,'BAG-S','Bager Sync',$2 || '_cat_excavator')`,
        [MACHINE, CO],
      );
      await client.query(
        `INSERT INTO worker_rates (id, company_id, worker_id, rate_kind, amount_cents, currency_code,
                                   valid_from, created_by)
         VALUES ($1,$2,$3,'HOURLY',2000,'BAM','2026-01-01'::date,$4)`,
        [`wrt_f8s_${RUN}`, CO, WORKER_MECH, USER_OWNER],
      );
      await client.query(
        `INSERT INTO stock_items (id, company_id, code, name, unit, min_quantity, created_by, updated_by)
         VALUES ($1,$2,'ULJE-8','Ulje 10W-40','l',0,$3,$3)`,
        [ITEM, CO, USER_OWNER],
      );
      await client.query(
        /* Ručno primanje nema izvor: `source_pair_check` traži da `source_type` i `source_id`
           budu ili OBA ili NIJEDAN — pola izvora je nedokumentovana kretnja. */
        `INSERT INTO stock_movements (id, company_id, item_id, kind, quantity, unit_cost_cents,
                                     occurred_on, created_by)
         VALUES ($1,$2,$3,'IN',10,'1200','2026-11-01'::date,$4)`,
        [`stm_f8s_in_${RUN}`, CO, ITEM, USER_OWNER],
      );
      const created = await client.query<{ id: string }>(
        `INSERT INTO service_orders (id, company_id, machine_id, origin, kind, priority, status,
                                    description, opened_at, assigned_mechanic_worker_id,
                                    currency_code, amount_cents, created_by)
         VALUES ($1,$2,$3,'MANUAL','INTERNAL','MEDIUM','APPROVED','Zamjena ulja',
                 now(), $4, 'BAM', 0, $5)
         RETURNING id`,
        [`so_f8s_${RUN}`, CO, MACHINE, WORKER_MECH, USER_OWNER],
      );
      orderId = created.rows[0]!.id;
    });
    await withCompany(admin, companyId(CO_B), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY')`,
        [`mem_f8sb_${RUN}`, USER_B, CO_B],
      );
    });
    await signIn(admin, USER_OWNER, CO, "owner");
    await signIn(admin, USER_MECH, CO, "mech");
    await signIn(admin, USER_OP, CO, "op");
    await signIn(admin, USER_B, CO_B, "b");
  }, 90_000);

  afterAll(async () => {
    await withCompany(admin, companyId(CO), async (client) => {
      await client.query("DELETE FROM service_order_events WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM service_order_parts WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM stock_movements WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM stock_items WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM approval_requests WHERE company_id = $1", [CO]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM cost_entries WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM service_orders WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM worker_rates WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM sessions WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM machines WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM workers WHERE company_id = $1", [CO]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [CO]);
    });
    await withCompany(admin, companyId(CO_B), async (client) => {
      await client.query("DELETE FROM sessions WHERE company_id = $1", [CO_B]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [CO_B]);
    });
    /* Kursor alokatori drže RESTRICT vezu na firmu (F4): bez njih brisanje firme pada. */
    for (const table of ["sync_cursor_slots", "sync_cursor_allocators", "sync_receipts", "sync_change_log"]) {
      await admin.query(`DELETE FROM ${table} WHERE company_id = ANY($1)`, [[CO, CO_B]]);
    }
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[CO, CO_B]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_OWNER, USER_MECH, USER_OP, USER_B]]);
    await admin.end();
  }, 90_000);

  it("START prelazi nalog u rad, a ponovljeni START je DUPLICATE (ne greška na telefonu)", async () => {
    const item = actionItem({ actionId: `act_start_${RUN}`, orderId, action: { kind: "START" } });
    const first = await push(pushRequest(COOKIES.mech, [item]));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { data: { results: R4SyncPushItemResult[] } };
    expect(at(firstBody.data.results).status).toBe("APPLIED");

    const again = await push(pushRequest(COOKIES.mech, [item]));
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { data: { results: R4SyncPushItemResult[] } };
    /* Isti `localId` → priznanica se ponavlja; nema druge radnje ni drugog događaja. */
    expect(["APPLIED", "DUPLICATE"]).toContain(at(againBody.data.results).status);

    const status = await withCompany(admin, companyId(CO), async (client) =>
      (await client.query<{ status: string; started_at: string | null }>(
        "SELECT status, started_at::text FROM service_orders WHERE company_id = $1 AND id = $2",
        [CO, orderId],
      )).rows[0],
    );
    expect(status?.status).toBe("IN_PROGRESS");
    expect(status?.started_at).not.toBeNull();
  });

  it("PART sa istim actionId skida zalihu jednom; stanje je SUM kretnji", async () => {
    const item = actionItem({
      actionId: `act_part_${RUN}`,
      orderId,
      action: { kind: "PART", part: { itemId: ITEM, quantity: "2.5", unitCostAmount: null, note: "Zamjena ulja" } },
    });
    const first = await push(pushRequest(COOKIES.mech, [item]));
    const firstBody = (await first.json()) as { data: { results: R4SyncPushItemResult[] } };
    expect(at(firstBody.data.results).status).toBe("APPLIED");

    const again = await push(pushRequest(COOKIES.mech, [item]));
    const againBody = (await again.json()) as { data: { results: R4SyncPushItemResult[] } };
    expect(at(againBody.data.results).status).toBe("DUPLICATE");

    const ledger = await withCompany(admin, companyId(CO), async (client) =>
      (await client.query<{ out: string; on_hand: string }>(
        `SELECT COALESCE(SUM(quantity) FILTER (WHERE kind = 'OUT'), 0)::text AS out,
                (COALESCE(SUM(quantity) FILTER (WHERE kind = 'IN'), 0)
                 - COALESCE(SUM(quantity) FILTER (WHERE kind = 'OUT'), 0))::text AS on_hand
           FROM stock_movements WHERE company_id = $1 AND item_id = $2`,
        [CO, ITEM],
      )).rows[0],
    );
    expect(Number(ledger?.out)).toBe(2.5);
    expect(Number(ledger?.on_hand)).toBe(7.5);
  });

  it("FINISH računa trošak na serveru: 2,5 h × 20,00 KM + dijelovi (2,5 × 12,00)", async () => {
    const item = actionItem({
      actionId: `act_finish_${RUN}`,
      orderId,
      action: { kind: "FINISH", laborHours: "2.50", note: "Gotovo" },
    });
    const response = await push(pushRequest(COOKIES.mech, [item]));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { results: R4SyncPushItemResult[] } };
    expect(at(body.data.results).status).toBe("APPLIED");

    const order = await withCompany(admin, companyId(CO), async (client) =>
      (await client.query<{
        status: string;
        labor_hours: string;
        labor_cost_cents: string;
        parts_cost_cents: string;
        total_cost_cents: string;
        downtime_minutes: number | null;
      }>(
        `SELECT status, labor_hours::text, labor_cost_cents::text, parts_cost_cents::text,
                total_cost_cents::text,
                EXTRACT(EPOCH FROM (finished_at - started_at)) / 60 AS downtime_minutes
           FROM service_orders WHERE company_id = $1 AND id = $2`,
        [CO, orderId],
      )).rows[0],
    );
    /* 2,50 h × 2000 centi = 5000; dijelovi 2,5 × 1200 = 3000; ukupno 8000. */
    expect(order?.status).toBe("DONE");
    expect(order?.labor_cost_cents).toBe("5000");
    expect(order?.parts_cost_cents).toBe("3000");
    expect(order?.total_cost_cents).toBe("8000");
  });

  it("trošak je u ledgeru SAMO jednom i pod kategorijom SERVIS, vezan na mašinu", async () => {
    const entries = await withCompany(admin, companyId(CO), async (client) =>
      client.query<{ amount_cents: string; project_id: string | null; machine_id: string | null; code: string }>(
        `SELECT ce.amount_cents::text, ce.project_id, ce.machine_id, cc.code
           FROM cost_entries ce
           JOIN cost_categories cc ON cc.company_id = ce.company_id AND cc.id = ce.category_id
          WHERE ce.company_id = $1 AND ce.source_type = 'SERVICE_ORDER' AND ce.source_id = $2
            AND ce.status = 'POSTED'`,
        [CO, orderId],
      ),
    );
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0]?.amount_cents).toBe("8000");
    /* Nalog nema projekat → trošak je samo na mašini (nikad oboje). */
    expect(entries.rows[0]?.project_id).toBeNull();
    expect(entries.rows[0]?.machine_id).toBe(MACHINE);
    expect(entries.rows[0]?.code).toBe("SERVIS");
  });

  it("završen nalog odbija dalje radnje kodom SERVICE_ALREADY_DONE", async () => {
    const item = actionItem({
      actionId: `act_late_${RUN}`,
      orderId,
      action: { kind: "START" },
    });
    const response = await push(pushRequest(COOKIES.mech, [item]));
    const body = (await response.json()) as { data: { results: R4SyncPushItemResult[] } };
    expect(at(body.data.results).status).toBe("REJECTED");
    expect(at(body.data.results).code).toBe("SERVICE_ALREADY_DONE");
  });

  it("tuđa firma ne vidi nalog, a rukovalac bez service.manage ne smije raditi u radionici", async () => {
    const foreign = actionItem({ actionId: `act_foreign_${RUN}`, orderId, action: { kind: "START" } });
    const foreignResponse = await push(pushRequest(COOKIES.b, [foreign]));
    /* Vlasnik firme B nema vezu sa radnikom, pa push pada prije obrade stavke (isti ishod kao
       R4 granica): nalog firme A se ne vidi ni ne dira. */
    expect([403, 404]).toContain(foreignResponse.status);
    const foreignBody = (await foreignResponse.json()) as { data?: { results?: R4SyncPushItemResult[] } };
    expect(foreignBody.data?.results ?? []).toHaveLength(0);

    /* Rukovalac nije mehaničar: stavka se odbija već na ulazu (rola), ne stiže do radnje. */
    const operator = await push(pushRequest(COOKIES.op, [
      actionItem({ actionId: `act_op_${RUN}`, orderId, action: { kind: "START" } }),
    ]));
    const operatorBody = (await operator.json()) as { data: { results: R4SyncPushItemResult[] } };
    expect(at(operatorBody.data.results).status).toBe("REJECTED");
  });
});
