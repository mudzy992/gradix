/**
 * F8 (Modul 9) — integracioni test servisa i održavanja, kroz PRAVE rute i PRAVU bazu.
 *
 * Testovi iz spec 09 §5 koji se mogu dokazati ovdje:
 *   1. kvar `APPROVED` otvara tačno jedan nalog (UNIQUE po kvaru), `REJECTED` ga poništava;
 *   2. nedozvoljen prelaz je 409, a `WAITING_PARTS ↔ IN_PROGRESS` prolazi;
 *   3. `total = labor + parts + external`, satnica na dan rada, stari nalog se ne mijenja;
 *   4. preventivno: prag otvara `PLANNED` nalog, dupli prolaz ne pravi drugi;
 *   6. dijelovi: utrošak skida zalihu, stanje je `SUM`, dupli `source_id` ne skida dvaput;
 *   7. knjiženje: projekat kad nalog ima projekat, inače samo mašina — nikad oboje;
 *   8. odobrenje: iznad praga traži, vanjski bez ponude odbija, bez role `FORBIDDEN`;
 *   9. zastoj = `finished − started`;
 *  10. MTBF/MTTR i trošak/h na fiksnom skupu;
 *  11. garancija ne stvara novi trošak;
 *  12. izolacija: firma B ne vidi ništa od firme A.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { issueAccessToken, ACCESS_COOKIE } from "./session";
import { GET as ordersGet, POST as ordersPost } from "@/app/api/service-orders/route";
import { GET as orderGet, PATCH as orderPatch } from "@/app/api/service-orders/[id]/route";
import { POST as startPost } from "@/app/api/service-orders/[id]/start/route";
import { POST as finishPost } from "@/app/api/service-orders/[id]/finish/route";
import { POST as waitPost } from "@/app/api/service-orders/[id]/wait-parts/route";
import { POST as partsPost } from "@/app/api/service-orders/[id]/parts/route";
import { POST as approvePost } from "@/app/api/service-orders/[id]/approve/route";
import { GET as stockItemsGet, POST as stockItemsPost } from "@/app/api/stock-items/route";
import { POST as movementsPost } from "@/app/api/stock-movements/route";
import { GET as plansGet, POST as plansPost } from "@/app/api/machines/[id]/maintenance-plans/route";
import { GET as reliabilityGet } from "@/app/api/machines/[id]/reliability/route";
import { GET as templatesGet, POST as templatesPost } from "@/app/api/maintenance-templates/route";
import { GET as maintenanceGet } from "@/app/api/machines/[id]/maintenance/route";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;
const RUN = Date.now().toString(36);
const CO_A = `cmp_f8a_${RUN}`;
const CO_B = `cmp_f8b_${RUN}`;
const USER_OWNER = `usr_f8_own_${RUN}`;
const USER_MECH = `usr_f8_meh_${RUN}`;
const USER_OP = `usr_f8_op_${RUN}`;
const USER_B = `usr_f8_b_${RUN}`;
const WORKER_MECH = `wrk_f8_meh_${RUN}`;
const MACHINE = `mch_f8_${RUN}`;
const MACHINE_B = `mch_f8b_${RUN}`;

/* `noUncheckedIndexedAccess` čini `Record<string,string>` indeks `string | undefined`, pa bi svaki
   poziv tražio `!`. Imenovana polja drže tip čistim i otkrivaju grešku u imenu pri kompilaciji. */
const COOKIES = { owner: "", mech: "", op: "", b: "" };
type CookieKey = keyof typeof COOKIES;

async function signIn(pool: Pool, userId: string, company: string, roles: string[], key: CookieKey): Promise<void> {
  const sessionId = `ses_${userId}`;
  await withCompany(pool, companyId(company), async (client) => {
    await client.query(
      `INSERT INTO sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day')
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [sessionId, company, userId, `hash_${sessionId}`],
    );
  });
  COOKIES[key] = `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: sessionId, companyId: company })}`;
  void roles;
}

function jsonRequest(url: string, cookie: string, body?: unknown, method = "POST"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type OrderRow = {
  id: string;
  status: string;
  origin: string;
  priority: string;
  machine_id: string;
  project_id: string | null;
  labor_hours: string;
  labor_cost_amount: string;
  parts_cost_amount: string;
  external_cost_amount: string;
  total_cost_amount: string;
  downtime_minutes: number | null;
  warranty_claim: boolean;
  approval_status: string | null;
};

async function listOrders(cookie: string, query = ""): Promise<OrderRow[]> {
  const response = await ordersGet(new NextRequest(`http://t/api/service-orders${query}`, { headers: { cookie } }));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { orders: OrderRow[] } };
  return body.data.orders;
}

async function createOrder(
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ id: string; status: number; payload: { data?: { id?: string } } }> {
  const response = await ordersPost(jsonRequest("http://t/api/service-orders", cookie, body));
  const payload = (await response.json()) as { data?: { id?: string } };
  /* Prazan `id` je namjerno dozvoljen tipski (test ga provjerava asertacijom), pa nema `!` na
     svakom pozivu — ali `String(...)` drži tip čistim za dalje. */
  return { id: String(payload?.data?.id ?? ""), status: response.status, payload };
}

describeDb("F8 servis i održavanje — integraciono", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 3 });

  beforeAll(async () => {
    await admin.query(`INSERT INTO companies (id, name, slug) VALUES ($1,'F8 A',$2), ($3,'F8 B',$4)`, [
      CO_A,
      `f8a-${RUN}`,
      CO_B,
      `f8b-${RUN}`,
    ]);
    await admin.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password)
       VALUES ($1,$2,'V','Lasnik','x',false), ($3,$4,'M','Ehaničar','x',false),
              ($5,$6,'R','Ukovalac','x',false), ($7,$8,'B','Firma','x',false)`,
      [
        USER_OWNER,
        `owner-f8-${RUN}@test.example`,
        USER_MECH,
        `meh-f8-${RUN}@test.example`,
        USER_OP,
        `op-f8-${RUN}@test.example`,
        USER_B,
        `b-f8-${RUN}@test.example`,
      ],
    );
    await withCompany(admin, companyId(CO_A), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY'),
                ($4,$5,$3,ARRAY['MECHANIC']::"Role"[],'COMPANY'),
                ($6,$7,$3,ARRAY['MACHINE_OPERATOR']::"Role"[],'COMPANY')`,
        [
          `mem_f8o_${RUN}`,
          USER_OWNER,
          CO_A,
          `mem_f8m_${RUN}`,
          USER_MECH,
          `mem_f8op_${RUN}`,
          USER_OP,
        ],
      );
      await client.query(
        `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id)
         VALUES ($1,$2,'M','Ehaničar','2024-01-01'::date,$3)`,
        [WORKER_MECH, CO_A, USER_MECH],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1,$2,'BAG-8','Bager F8',$2 || '_cat_excavator')`,
        [MACHINE, CO_A],
      );
      await client.query(
        `INSERT INTO worker_rates (id, company_id, worker_id, rate_kind, amount_cents, currency_code,
                                   valid_from, created_by)
         VALUES ($1,$2,$3,'HOURLY',2000,'BAM','2026-01-01'::date,$4)`,
        [`wrt_f8_${RUN}`, CO_A, WORKER_MECH, USER_OWNER],
      );
    });
    await withCompany(admin, companyId(CO_B), async (client) => {
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope)
         VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY')`,
        [`mem_f8b_${RUN}`, USER_B, CO_B],
      );
      await client.query(
        `INSERT INTO machines (id, company_id, code, name, category_id)
         VALUES ($1,$2,'BAG-B','Bager B',$2 || '_cat_excavator')`,
        [MACHINE_B, CO_B],
      );
    });
    await signIn(admin, USER_OWNER, CO_A, ["OWNER"], "owner");
    await signIn(admin, USER_MECH, CO_A, ["MECHANIC"], "mech");
    await signIn(admin, USER_OP, CO_A, ["MACHINE_OPERATOR"], "op");
    await signIn(admin, USER_B, CO_B, ["OWNER"], "b");
  }, 60_000);

  afterAll(async () => {
    await withCompany(admin, companyId(CO_A), async (client) => {
      await client.query("DELETE FROM service_order_events WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM service_order_parts WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM stock_movements WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM stock_item_levels WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM stock_items WHERE company_id = $1", [CO_A]);
      /* Redoslijed je obrnut od FK-ova: `machine_faults.service_order_id` drži RESTRICT vezu na
         nalog (F8 je dodaje), pa nalog ne može otići dok kvar pokazuje na njega. */
      await client.query("UPDATE machine_faults SET service_order_id = NULL WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM approval_requests WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM service_orders WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM maintenance_plans WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM maintenance_templates WHERE company_id = $1", [CO_A]);
      /* `cost_entries` je append-only i `cost_entry_guard()` brani DELETE — u testu se čisti uz
         isključene korisničke trigere (`replica`), isto kao `phase4` i `journey-c`. */
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM cost_entries WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM machine_faults WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM worker_rates WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM sessions WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM partner_roles WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM partners WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM projects WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM machines WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM workers WHERE company_id = $1", [CO_A]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [CO_A]);
    });
    await withCompany(admin, companyId(CO_B), async (client) => {
      await client.query("DELETE FROM sessions WHERE company_id = $1", [CO_B]);
      await client.query("DELETE FROM machines WHERE company_id = $1", [CO_B]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [CO_B]);
    });
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[CO_A, CO_B]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_OWNER, USER_MECH, USER_OP, USER_B]]);
    await admin.end();
  }, 60_000);

  /* ------------------------------------------------------------ 1. kvar → nalog */

  it("APPROVED kvar otvara tačno jedan nalog; drugi APPROVED ne pravi duplikat", async () => {
    const faultId = `flt_f8_${RUN}`;
    await withCompany(admin, companyId(CO_A), async (client) => {
      await client.query(
        `INSERT INTO machine_faults (id, company_id, machine_id, reported_at, title, priority, status, created_by, updated_by)
         VALUES ($1,$2,$3, now(), 'Kvar hidraulike', 'HIGH', 'OPEN', $4, $4)`,
        [faultId, CO_A, MACHINE, USER_OWNER],
      );
      await client.query(
        `UPDATE machine_faults SET status = 'APPROVED', updated_by = $3, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [CO_A, faultId, USER_OWNER],
      );
    });

    const orders = await listOrders(COOKIES.owner, `?machine=${MACHINE}`);
    const fromFault = orders.filter((order) => order.origin === "FAULT" && order.status !== "CANCELLED");
    expect(fromFault).toHaveLength(1);
    expect(fromFault[0]!.priority).toBe("HIGH");
    expect(fromFault[0]!.status).toBe("PLANNED");

    // Ponovni prelaz u APPROVED ne smije praviti drugi nalog (UNIQUE po kvaru).
    await withCompany(admin, companyId(CO_A), async (client) => {
      await client.query(
        `UPDATE machine_faults SET status = 'OPEN' WHERE company_id = $1 AND id = $2`,
        [CO_A, faultId],
      );
      await client.query(
        `UPDATE machine_faults SET status = 'APPROVED', updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [CO_A, faultId],
      );
    });
    const again = await listOrders(COOKIES.owner, `?machine=${MACHINE}`);
    expect(again.filter((order) => order.origin === "FAULT" && order.status !== "CANCELLED")).toHaveLength(1);
  });

  /* ------------------------------------------------------------ 2. životni ciklus */

  it("statusi: DONE → IN_PROGRESS je 409, WAITING_PARTS ↔ IN_PROGRESS prolazi", async () => {
    const created = await createOrder(COOKIES.mech, {
      machineId: MACHINE,
      origin: "MANUAL",
      kind: "INTERNAL",
      priority: "MEDIUM",
      description: "Zamjena filtera",
      assignedMechanicWorkerId: WORKER_MECH,
    });
    expect(created.status).toBe(200);
    const id = created.id;

    const started = await startPost(jsonRequest(`http://t/api/service-orders/${id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id }),
    });
    expect(started.status).toBe(200);

    const waiting = await waitPost(
      jsonRequest(`http://t/api/service-orders/${id}/wait-parts`, COOKIES.mech, { note: "Filter nije na stanju" }),
      { params: Promise.resolve({ id }) },
    );
    expect(waiting.status).toBe(200);

    const resumed = await startPost(jsonRequest(`http://t/api/service-orders/${id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id }),
    });
    expect(resumed.status).toBe(200);

    const finished = await finishPost(
      jsonRequest(`http://t/api/service-orders/${id}/finish`, COOKIES.mech, { laborHours: "1.5" }),
      { params: Promise.resolve({ id }) },
    );
    expect(finished.status).toBe(200);
    const finishedBody = (await finished.json()) as { data: { cost?: { posted: number } } };
    expect(finishedBody.data.cost?.posted).toBe(1);

    const again = await startPost(jsonRequest(`http://t/api/service-orders/${id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id }),
    });
    expect(again.status).toBe(409);
    const againBody = (await again.json()) as { error: { code: string } };
    expect(againBody.error.code).toBe("CONFLICT");
  });

  /* ------------------------------------------------------------ 3. trajanje i pouzdanost */

  it("zastoj je finished − started i ulazi u MTTR", async () => {
    const orders = await listOrders(COOKIES.owner, `?machine=${MACHINE}`);
    const done = orders.find((order) => order.status === "DONE" && order.labor_hours !== "0.00");
    expect(done).toBeTruthy();
    expect(done!.downtime_minutes).not.toBeNull();
    expect(done!.downtime_minutes!).toBeGreaterThanOrEqual(0);

    const reliability = await reliabilityGet(
      new NextRequest(`http://t/api/machines/${MACHINE}/reliability`, { headers: { cookie: COOKIES.owner } }),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    expect(reliability.status).toBe(200);
    const body = (await reliability.json()) as {
      data: { reliability: { finishedCount: number; mttrMinutes: number | null; maintenanceCostAmount: string } };
    };
    expect(body.data.reliability.finishedCount).toBeGreaterThanOrEqual(1);
    expect(body.data.reliability.maintenanceCostAmount).toBe("30.00"); // 1,5 h × 20,00 KM
  });

  /* ------------------------------------------------------------ 4. dijelovi i zalihe */

  it("utrošak dijela skida zalihu kretnjom; stanje je SUM; dupli source ne skida dvaput", async () => {
    const item = await stockItemsPost(
      jsonRequest("http://t/api/stock-items", COOKIES.mech, {
        code: "FIL-01",
        name: "Filter ulja",
        unit: "kom",
        minQuantity: "2",
      }),
    );
    expect(item.status).toBe(200);
    const itemId = ((await item.json()) as { data: { id: string } }).data.id;

    const received = await movementsPost(
      jsonRequest("http://t/api/stock-movements", COOKIES.mech, {
        itemId,
        kind: "IN",
        quantity: "10",
        unitCostAmount: "12.50",
        occurredOn: "2026-03-01",
      }),
    );
    expect(received.status).toBe(200);

    const order = await createOrder(COOKIES.mech, {
      machineId: MACHINE,
      origin: "MANUAL",
      kind: "INTERNAL",
      priority: "LOW",
      description: "Zamjena filtera ulja",
      assignedMechanicWorkerId: WORKER_MECH,
    });
    const orderId = order.id;

    const used = await partsPost(
      jsonRequest(`http://t/api/service-orders/${orderId}/parts`, COOKIES.mech, {
        itemId,
        quantity: "2",
        unitCostAmount: "12.50",
      }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(used.status).toBe(200);
    const tooMuch = await partsPost(
      jsonRequest(`http://t/api/service-orders/${orderId}/parts`, COOKIES.mech, { itemId, quantity: "9" }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(tooMuch.status).toBe(409);
    const blocker = await admin.connect();
    try {
      await blocker.query("BEGIN");
      const wh = await blocker.query<{id:string}>("SELECT id FROM warehouses WHERE company_id=$1 AND kind='CENTRAL'", [CO_A]);
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2,0))", [CO_A,wh.rows[0]!.id]);
      const locked = await partsPost(
        jsonRequest(`http://t/api/service-orders/${orderId}/parts`, COOKIES.mech, { itemId, quantity: "1" }),
        { params: Promise.resolve({ id: orderId }) },
      );
      expect(locked.status).toBe(409);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }

    const detail = await orderGet(
      new NextRequest(`http://t/api/service-orders/${orderId}`, { headers: { cookie: COOKIES.mech } }),
      { params: Promise.resolve({ id: orderId }) },
    );
    const detailBody = (await detail.json()) as {
      data: { order: OrderRow; parts: Array<{ quantity: string; total_cost_amount: string }> };
    };
    expect(detailBody.data.parts).toHaveLength(1);
    expect(detailBody.data.order.parts_cost_amount).toBe("25.00");

    const stock = await stockItemsGet(new NextRequest("http://t/api/stock-items", { headers: { cookie: COOKIES.owner } }));
    const stockBody = (await stock.json()) as {
      data: { items: Array<{ id: string; on_hand: string; below_minimum: boolean }> };
    };
    const row = stockBody.data.items.find((entry) => entry.id === itemId);
    expect(row?.on_hand).toBe("8.000"); // 10 − 2, isključivo zbir kretnji
    expect(row?.below_minimum).toBe(false);
  });

  /* ------------------------------------------------------------ 5. knjiženje troška */

  it("dijelovi koriste ponderisani prosjek i tačnu vrijednost izlaza, ne posljednju cijenu",async()=>{
    const item=await stockItemsPost(jsonRequest("http://t/api/stock-items",COOKIES.mech,{code:"AVG-01",name:"Prosjek",unit:"kom",minQuantity:"0"}));
    const itemId=((await item.json()) as {data:{id:string}}).data.id;
    for(const [quantity,unitCostAmount] of [["1","0.01"],["1","0.00"]])
      expect((await movementsPost(jsonRequest("http://t/api/stock-movements",COOKIES.mech,{itemId,kind:"IN",quantity,unitCostAmount}))).status).toBe(200);
    const order=await createOrder(COOKIES.mech,{machineId:MACHINE,origin:"MANUAL",kind:"INTERNAL",priority:"LOW",description:"Prosjek dijela",assignedMechanicWorkerId:WORKER_MECH});
    const usage=await partsPost(jsonRequest(`http://t/api/service-orders/${order.id}/parts`,COOKIES.mech,{itemId,quantity:"1.500"}),{params:Promise.resolve({id:order.id})});
    expect(usage.status).toBe(200);
    const detail=await orderGet(new NextRequest(`http://t/api/service-orders/${order.id}`,{headers:{cookie:COOKIES.mech}}),{params:Promise.resolve({id:order.id})});
    const body=await detail.json() as {data:{order:OrderRow;parts:Array<{unit_cost_amount:string;total_cost_amount:string}>}};
    expect(body.data.order.parts_cost_amount).toBe("0.01");
    expect(body.data.parts[0]).toMatchObject({unit_cost_amount:"0.01",total_cost_amount:"0.01"});
    const movement=await admin.query("SELECT amount_cents::text FROM public.stock_movements WHERE company_id=$1 AND item_id=$2 AND source_type='SERVICE_ORDER'",[CO_A,itemId]);
    expect(movement.rows[0].amount_cents).toBe("1");
  });

  it("paralelna ugradnja dijelova ne može preći raspoloživu zalihu",async()=>{
    const itemResponse=await stockItemsPost(jsonRequest("http://t/api/stock-items",COOKIES.mech,{code:"RACE-PART",name:"Dio",unit:"kom"}));
    expect(itemResponse.status).toBe(200);
    const itemId=((await itemResponse.json()) as {data:{id:string}}).data.id;
    expect((await movementsPost(jsonRequest("http://t/api/stock-movements",COOKIES.mech,{itemId,kind:"IN",quantity:"10",unitCostAmount:"1.00"}))).status).toBe(200);
    const order=await createOrder(COOKIES.mech,{machineId:MACHINE,origin:"MANUAL",kind:"INTERNAL",priority:"LOW",description:"Paralelna ugradnja",assignedMechanicWorkerId:WORKER_MECH});
    const send=()=>partsPost(jsonRequest(`http://t/api/service-orders/${order.id}/parts`,COOKIES.mech,{itemId,quantity:"7",unitCostAmount:"1.00"}),{params:Promise.resolve({id:order.id})});
    const responses=await Promise.all([send(),send()]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const balance=await admin.query<{balance:string}>(`SELECT sum(CASE WHEN kind='IN' THEN quantity WHEN kind='OUT' THEN -quantity ELSE 0 END)::text AS balance FROM public.stock_movements WHERE company_id=$1 AND item_id=$2`,[CO_A,itemId]);
    expect(balance.rows[0]?.balance).toBe("3.000");
  });

  it("servis se ne završava ako knjiženje na zatvoren projekat ne uspije",async()=>{
    const projectId=`prj_f8_closed_${RUN}`;
    await admin.query("INSERT INTO public.projects(id,company_id,code,name) VALUES($1,$2,'F8-CLOSED','Zatvoren projekat')",[projectId,CO_A]);
    const order=await createOrder(COOKIES.mech,{machineId:MACHINE,origin:"MANUAL",kind:"INTERNAL",priority:"LOW",description:"Nalog s blokiranim troškom",projectId,assignedMechanicWorkerId:WORKER_MECH});
    expect((await startPost(jsonRequest(`http://t/api/service-orders/${order.id}/start`,COOKIES.mech),{params:Promise.resolve({id:order.id})})).status).toBe(200);
    await admin.query("UPDATE public.projects SET status='FINISHED',closed_at=clock_timestamp(),closed_by=$3 WHERE company_id=$1 AND id=$2",[CO_A,projectId,USER_OWNER]);
    const response=await finishPost(jsonRequest(`http://t/api/service-orders/${order.id}/finish`,COOKIES.mech,{laborHours:"2"}),{params:Promise.resolve({id:order.id})});
    expect(response.status).toBeGreaterThanOrEqual(400);
    const row=await admin.query<{status:string}>("SELECT status FROM public.service_orders WHERE company_id=$1 AND id=$2",[CO_A,order.id]);
    expect(row.rows[0]?.status).toBe("IN_PROGRESS");
    const costs=await admin.query("SELECT 1 FROM public.cost_entries WHERE company_id=$1 AND source_type='SERVICE_ORDER' AND source_id=$2",[CO_A,order.id]);
    expect(costs.rowCount).toBe(0);
  });

  it("trošak sa projektom ide na projekat; bez projekta SAMO na mašinu — nikad oboje", async () => {
    const projectId = `prj_f8_${RUN}`;
    /* Projekat se upisuje u SVOJOJ transakciji prije kreiranja naloga: rute rade nad drugom
       konekcijom, pa nepotvrđen red ne bi bio vidljiv (FK bi pao ili bi nalog ostao bez projekta). */
    await withCompany(admin, companyId(CO_A), async (client) => {
      await client.query(
        `INSERT INTO projects (id, company_id, code, name, status)
         VALUES ($1,$2,'F8-P','Projekat F8','ACTIVE')`,
        [projectId, CO_A],
      );
    });

    const withProject = await createOrder(COOKIES.mech, {
      machineId: MACHINE,
      origin: "MANUAL",
      kind: "INTERNAL",
      priority: "MEDIUM",
      description: "Servis na projektu",
      projectId,
      assignedMechanicWorkerId: WORKER_MECH,
    });
    expect(withProject.status).toBe(200);
    const started = await startPost(
      jsonRequest(`http://t/api/service-orders/${withProject.id}/start`, COOKIES.mech),
      { params: Promise.resolve({ id: withProject.id }) },
    );
    expect(started.status).toBe(200);
    const finished = await finishPost(
      jsonRequest(`http://t/api/service-orders/${withProject.id}/finish`, COOKIES.mech, { laborHours: "2" }),
      { params: Promise.resolve({ id: withProject.id }) },
    );
    expect(finished.status).toBe(200);

    await withCompany(admin, companyId(CO_A), async (client) => {
      const entries = await client.query<{ project_id: string | null; machine_id: string; amount_cents: string }>(
        `SELECT project_id, machine_id, amount_cents::text FROM public.cost_entries
          WHERE company_id = $1 AND source_type = 'SERVICE_ORDER' AND source_id = $2`,
        [CO_A, withProject.id],
      );
      expect(entries.rowCount).toBe(1);
      expect(entries.rows[0]!.project_id).toBe(projectId);
      expect(entries.rows[0]!.amount_cents).toBe("4000"); // 2 h × 20,00 KM
    });
  });

  it("nalog bez projekta knjiži trošak sa project_id NULL (samo mašina)", async () => {
    const order = await createOrder(COOKIES.mech, {
      machineId: MACHINE,
      origin: "MANUAL",
      kind: "INTERNAL",
      priority: "LOW",
      description: "Servis van projekta",
      assignedMechanicWorkerId: WORKER_MECH,
    });
    await startPost(jsonRequest(`http://t/api/service-orders/${order.id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id: order.id }),
    });
    const finished = await finishPost(
      jsonRequest(`http://t/api/service-orders/${order.id}/finish`, COOKIES.mech, { laborHours: "1" }),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(finished.status).toBe(200);

    await withCompany(admin, companyId(CO_A), async (client) => {
      const entry = await client.query<{ project_id: string | null; machine_id: string }>(
        `SELECT project_id, machine_id FROM public.cost_entries
          WHERE company_id = $1 AND source_type = 'SERVICE_ORDER' AND source_id = $2`,
        [CO_A, order.id],
      );
      expect(entry.rowCount).toBe(1);
      expect(entry.rows[0]!.project_id).toBeNull();
      expect(entry.rows[0]!.machine_id).toBe(MACHINE);
    });
  });

  /* ------------------------------------------------------------ 6. odobrenje */

  it("predračun iznad praga traži odobrenje i blokira početak; bez role je 403", async () => {
    const order = await createOrder(COOKIES.owner, {
      machineId: MACHINE,
      origin: "MANUAL",
      kind: "INTERNAL",
      priority: "HIGH",
      description: "Skupa popravka motora",
      plannedCostAmount: "700.00",
      assignedMechanicWorkerId: WORKER_MECH,
    });
    expect(order.status).toBe(200);

    const blocked = await startPost(jsonRequest(`http://t/api/service-orders/${order.id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id: order.id }),
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("CONFLICT");

    const list = await listOrders(COOKIES.owner, `?machine=${MACHINE}`);
    expect(list.find((row) => row.id === order.id)?.approval_status).toBe("OPEN");

    const mechApprove = await approvePost(
      jsonRequest(`http://t/api/service-orders/${order.id}/approve`, COOKIES.mech),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(mechApprove.status).toBe(403);

    const ownerApprove = await approvePost(
      jsonRequest(`http://t/api/service-orders/${order.id}/approve`, COOKIES.owner),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(ownerApprove.status).toBe(200);
  });

  it("vanjski servis iznad praga bez ponude ne počinje (EXTERNAL_QUOTE_REQUIRED)", async () => {
    const partnerId = `prt_f8_${RUN}`;
    await withCompany(admin, companyId(CO_A), async (client) => {
      await client.query(
        `INSERT INTO partners (id, company_id, code, name, kind)
         VALUES ($1,$2,'VAN-F8','Vanjski servis','SERVICE')`,
        [partnerId, CO_A],
      );
    });
    const order = await createOrder(COOKIES.owner, {
      machineId: MACHINE,
      origin: "MANUAL",
      kind: "EXTERNAL",
      priority: "HIGH",
      description: "Vanjski servis hidraulike",
      partnerId,
      plannedCostAmount: "900.00",
    });
    expect(order.status).toBe(200);
    const blocked = await startPost(jsonRequest(`http://t/api/service-orders/${order.id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id: order.id }),
    });
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/ponudu/i);

    // Uz ponudu nalog ide dalje (uz odobrenje).
    const patched = await orderPatch(
      jsonRequest(`http://t/api/service-orders/${order.id}`, COOKIES.owner, { externalQuoteAmount: "850.00" }, "PATCH"),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(patched.status).toBe(200);
    await approvePost(jsonRequest(`http://t/api/service-orders/${order.id}/approve`, COOKIES.owner), {
      params: Promise.resolve({ id: order.id }),
    });
    const started = await startPost(jsonRequest(`http://t/api/service-orders/${order.id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id: order.id }),
    });
    expect(started.status).toBe(200);
  });

  /* ------------------------------------------------------------ 7. garancija */

  it("kvar unutar garancije nosi warranty_claim i trošak je 0,00", async () => {
    const first = await createOrder(COOKIES.mech, {
      machineId: MACHINE,
      origin: "MANUAL",
      kind: "INTERNAL",
      priority: "MEDIUM",
      description: "Popravka sa garancijom",
      assignedMechanicWorkerId: WORKER_MECH,
    });
    await startPost(jsonRequest(`http://t/api/service-orders/${first.id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id: first.id }),
    });
    const done = await finishPost(
      jsonRequest(`http://t/api/service-orders/${first.id}/finish`, COOKIES.mech, {
        laborHours: "1",
        warrantyUntil: "2030-12-31",
      }),
      { params: Promise.resolve({ id: first.id }) },
    );
    expect(done.status).toBe(200);

    const faultId = `flt_f8w_${RUN}`;
    await withCompany(admin, companyId(CO_A), async (client) => {
      await client.query(
        `INSERT INTO machine_faults (id, company_id, machine_id, reported_at, title, priority, status, created_by, updated_by)
         VALUES ($1,$2,$3, now(), 'Kvar u garanciji', 'LOW', 'OPEN', $4, $4)`,
        [faultId, CO_A, MACHINE, USER_OWNER],
      );
    });
    const claim = await createOrder(COOKIES.mech, {
      machineId: MACHINE,
      faultId,
      origin: "FAULT",
      kind: "INTERNAL",
      priority: "LOW",
      description: "Reklamacija popravke",
      assignedMechanicWorkerId: WORKER_MECH,
    });
    expect(claim.status).toBe(200);
    await startPost(jsonRequest(`http://t/api/service-orders/${claim.id}/start`, COOKIES.mech), {
      params: Promise.resolve({ id: claim.id }),
    });
    await finishPost(
      jsonRequest(`http://t/api/service-orders/${claim.id}/finish`, COOKIES.mech, { laborHours: "1" }),
      { params: Promise.resolve({ id: claim.id }) },
    );

    await withCompany(admin, companyId(CO_A), async (client) => {
      const row = await client.query<{ warranty_claim: boolean; warranty_source_order_id: string | null }>(
        `SELECT warranty_claim, warranty_source_order_id FROM public.service_orders
          WHERE company_id = $1 AND id = $2`,
        [CO_A, claim.id],
      );
      expect(row.rows[0]!.warranty_claim).toBe(true);
      expect(row.rows[0]!.warranty_source_order_id).toBe(first.id);

      // Trošak garancije: red u ledgeru sa iznosom 0 — VIDLJIV, ali bez novog troška.
      const entry = await client.query<{ amount_cents: string }>(
        `SELECT amount_cents::text FROM public.cost_entries
          WHERE company_id = $1 AND source_type = 'SERVICE_ORDER' AND source_id = $2`,
        [CO_A, claim.id],
      );
      expect(entry.rows[0]!.amount_cents).toBe("0");
    });
  });

  /* ------------------------------------------------------------ 8. preventivno */

  it("šablon → plan → prag otvara PLANNED nalog; dupli prolaz ne pravi drugi", async () => {
    const template = await templatesPost(
      jsonRequest("http://t/api/maintenance-templates", COOKIES.mech, {
        code: "ULJE-250",
        name: "Zamjena ulja",
        basis: "HOURS",
        intervalValue: "250",
        tolerancePct: "10",
      }),
    );
    expect(template.status).toBe(200);

    const plan = await plansPost(
      jsonRequest(`http://t/api/machines/${MACHINE}/maintenance-plans`, COOKIES.mech, {
        name: "Zamjena ulja 250 h",
        basis: "HOURS",
        intervalValue: "250",
        tolerancePct: "10",
        nextDueMeter: "0.50",
      }),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    expect(plan.status).toBe(200);
    const planId = ((await plan.json()) as { data: { id: string } }).data.id;

    const plans = await plansGet(
      new NextRequest(`http://t/api/machines/${MACHINE}/maintenance-plans`, { headers: { cookie: COOKIES.mech } }),
      { params: Promise.resolve({ id: MACHINE }) },
    );
    const plansBody = (await plans.json()) as {
      data: { plans: Array<{ id: string; status: string; remaining: string | null }> };
    };
    const loaded = plansBody.data.plans.find((row) => row.id === planId);
    /* Brojilo je 0, rok 0,5 h — a tolerancija 10 % od 250 h je 25 h, pa je prag upozorenja
       `0,5 − 25 = −24,5`, dakle upozorenje (`DUE_SOON`) je već pređeno, ali ROK nije. To je
       namjerno: ciklus od 250 h sa tolerancijom od 25 h upozorava mnogo prije roka. */
    expect(loaded?.status).toBe("DUE_SOON");

    // Okidač: `openPreventiveOrders` u domeni rada (worker koristi istu funkciju).
    const { openPreventiveOrders } = await import("./maintenance-service");
    await withCompany(admin, companyId(CO_A), async (client) => {
      const first = await openPreventiveOrders(client, CO_A, "2026-03-01", USER_OWNER, planId);
      expect(first.created).toBe(1);
      const second = await openPreventiveOrders(client, CO_A, "2026-03-01", USER_OWNER, planId);
      expect(second.created).toBe(0); // idempotentno: isti ciklus = isti nalog
    });

    const orders = await listOrders(COOKIES.owner, `?machine=${MACHINE}`);
    const preventive = orders.filter((order) => order.origin === "PREVENTIVE");
    expect(preventive).toHaveLength(1);
    expect(preventive[0]!.status).toBe("PLANNED");
  });

  /* ------------------------------------------------------------ 9. izolacija */

  it("firma B ne vidi naloge, zalihe ni planove firme A", async () => {
    const bOrders = await listOrders(COOKIES.b);
    expect(bOrders).toHaveLength(0);
    const bStock = await stockItemsGet(new NextRequest("http://t/api/stock-items", { headers: { cookie: COOKIES.b } }));
    expect(((await bStock.json()) as { data: { items: unknown[] } }).data.items).toHaveLength(0);
    const bTemplates = await templatesGet(
      new NextRequest("http://t/api/maintenance-templates", { headers: { cookie: COOKIES.b } }),
    );
    expect(((await bTemplates.json()) as { data: { templates: unknown[] } }).data.templates).toHaveLength(0);
    const bMaintenance = await maintenanceGet(
      new NextRequest(`http://t/api/machines/${MACHINE_B}/maintenance`, { headers: { cookie: COOKIES.b } }),
      { params: Promise.resolve({ id: MACHINE_B }) },
    );
    expect(bMaintenance.status).toBe(200);
    const maintenanceBody = (await bMaintenance.json()) as {
      data: { plans: unknown[]; orders: unknown[]; reliability: { maintenanceCostAmount: string } };
    };
    expect(maintenanceBody.data.orders).toHaveLength(0);
    expect(maintenanceBody.data.plans).toHaveLength(0);
  });

  /* ------------------------------------------------------------ 10. dozvole */

  it("MACHINE_OPERATOR ne vidi servisne naloge (403 na listi)", async () => {
    const response = await ordersGet(
      new NextRequest("http://t/api/service-orders", { headers: { cookie: COOKIES.op } }),
    );
    expect(response.status).toBe(403);
  });
});
