/**
 * F8 — izolacija servisnih tabela pod ADMIN rolom (koja ZAOBILAZI RLS).
 *
 * Zašto ovako: RLS štiti aplikaciju, ali ne dokazuje da servisni sloj sam filtrira firmu. Pod
 * admin rolom svi redovi su vidljivi, pa test dokazuje da `listServiceOrders`, `getServiceOrder`,
 * `listStockItems` i `stockOnHand` ne vraćaju tuđe redove ni kad im baza to dozvoli.
 *
 * Fikstura je namjerno IDENTIČNA u obje firme (isti kodovi, isti opisi): razlika u sadržaju bi
 * sakrila grešku — test bi prošao i da filter ne postoji, jer bi red druge firme izgledao drukčije.
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import type { Role } from "./permissions";
import { listServiceOrders } from "./service-order-service";
import { getServiceOrder } from "./service-order-service";
import { listStockItems, currentOnHand } from "./stock-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const CO_A = `cmp_f8iso_a_${RUN}`;
const CO_B = `cmp_f8iso_b_${RUN}`;
const USER_A = `usr_f8iso_a_${RUN}`;
const USER_B = `usr_f8iso_b_${RUN}`;
const MACHINE_A = `mch_f8iso_a_${RUN}`;
const MACHINE_B = `mch_f8iso_b_${RUN}`;
const ORDER_A = `so_f8iso_a_${RUN}`;
const ORDER_B = `so_f8iso_b_${RUN}`;
const ITEM_A = `stk_f8iso_a_${RUN}`;
const ITEM_B = `stk_f8iso_b_${RUN}`;

const actorA = { userId: USER_A, companyId: CO_A, roles: ["OWNER"] as Role[], scope: "COMPANY" as const, projectIds: null };

describeDb("F8 izolacija: servis i zalihe ne prelaze granicu firme", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 3 });

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1,'ISO A',$2), ($3,'ISO B',$4)`, [
      CO_A, `f8iso-a-${RUN}`, CO_B, `f8iso-b-${RUN}`,
    ]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1,$2,'A','A','x',false), ($3,$4,'B','B','x',false)`,
      [USER_A, `a-${RUN}@iso.example`, USER_B, `b-${RUN}@iso.example`],
    );
    for (const [company, user, machine, order, item] of [
      [CO_A, USER_A, MACHINE_A, ORDER_A, ITEM_A],
      [CO_B, USER_B, MACHINE_B, ORDER_B, ITEM_B],
    ] as const) {
      await withCompany(admin, companyId(company), async (client) => {
        await client.query(
          `INSERT INTO memberships (id, user_id, company_id, roles, scope)
           VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY')`,
          [`mem_${user}`, user, company],
        );
        await client.query(
          `INSERT INTO machines (id, company_id, code, name, category_id)
           VALUES ($1,$2,'BAG-ISO','Bager ISO',$2 || '_cat_excavator')`,
          [machine, company],
        );
        /* Isti opis i isti iznos u obje firme — vidi uvodni komentar. */
        await client.query(
          `INSERT INTO service_orders (id, company_id, machine_id, origin, kind, priority, status,
                                      description, opened_at, currency_code, amount_cents, created_by)
           VALUES ($1,$2,$3,'MANUAL','INTERNAL','MEDIUM','APPROVED','Isti opis rada',
                   now(), 'BAM', 0, $4)`,
          [order, company, machine, user],
        );
        await client.query(
          `INSERT INTO stock_items (id, company_id, code, name, unit, min_quantity, created_by, updated_by)
           VALUES ($1,$2,'DIO-ISO','Isti dio','kom',5,$3,$3)`,
          [item, company, user],
        );
        await client.query(
          `INSERT INTO stock_movements (id, company_id, item_id, kind, quantity, occurred_on, created_by)
           VALUES ($1,$2,$3,'IN',3,'2026-11-01'::date,$4)`,
          [`stm_${order}`, company, item, user],
        );
      });
    }
  }, 90_000);

  afterAll(async () => {
    for (const [company, user, machine, order, item] of [
      [CO_A, USER_A, MACHINE_A, ORDER_A, ITEM_A],
      [CO_B, USER_B, MACHINE_B, ORDER_B, ITEM_B],
    ] as const) {
      await withCompany(admin, companyId(company), async (client) => {
        await client.query("DELETE FROM stock_movements WHERE company_id = $1", [company]);
        await client.query("DELETE FROM stock_items WHERE company_id = $1", [company]);
        await client.query("DELETE FROM service_order_events WHERE company_id = $1", [company]);
        await client.query("DELETE FROM service_orders WHERE company_id = $1", [company]);
        await client.query("DELETE FROM machines WHERE company_id = $1", [company]);
        await client.query("DELETE FROM memberships WHERE company_id = $1", [company]);
        void machine;
        void order;
        void item;
        void user;
      });
    }
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[CO_A, CO_B]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_A, USER_B]]);
    await admin.end();
  }, 90_000);

  it("lista naloga vraća samo naloge SVOJE firme, iako ih admin rola vidi oba", async () => {
    const adminSees = await withCompany(admin, companyId(CO_A), async (client) =>
      client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM service_orders WHERE id = ANY($1) AND company_id = $2",
        [[ORDER_A, ORDER_B], CO_A],
      ),
    );
    /* Dokaz da fikstura stvarno postoji: bez toga test ne bi dokazao ništa. */
    expect(adminSees.rows[0]?.n).toBe("1");
    const obje = await withCompany(admin, companyId(CO_A), async (client) =>
      client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM service_orders WHERE id = ANY($1)",
        [[ORDER_A, ORDER_B]],
      ),
    );
    expect(obje.rows[0]?.n).toBe("2");

    const orders = await listServiceOrders(admin, actorA, {});
    expect(orders.map((order) => order.id)).toEqual([ORDER_A]);
  });

  it("detalj tuđeg naloga je null (isti ishod kao nepostojeći)", async () => {
    expect(await getServiceOrder(admin, actorA, ORDER_B)).toBeNull();
    expect(await getServiceOrder(admin, actorA, ORDER_A)).not.toBeNull();
  });

  it("zalihe: tuđi artikal nije na listi, a stanje se ne može pročitati kroz tuđi ID", async () => {
    const items = await listStockItems(admin, actorA, {});
    expect(items.map((item) => item.id)).toEqual([ITEM_A]);

    const tuđe = await withCompany(admin, companyId(CO_A), async (client) =>
      currentOnHand(client, CO_A, ITEM_B),
    );
    /* `currentOnHand` vraća `numeric` bez skale kad redova nema (`0`), pa se poredi broj, ne tekst. */
    expect(Number(tuđe)).toBe(0);
    const svoje = await withCompany(admin, companyId(CO_A), async (client) =>
      currentOnHand(client, CO_A, ITEM_A),
    );
    expect(Number(svoje)).toBe(3);
  });
});
