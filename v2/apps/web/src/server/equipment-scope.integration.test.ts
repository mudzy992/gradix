import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { listServiceOrders, getServiceOrder, createServiceOrder } from "./service-order-service";
import { startServiceOrder, waitServiceOrderParts, finishServiceOrder, addServiceOrderPart, approveServiceOrder, rejectServiceOrder } from "./service-order-actions";
import { updateServiceOrder } from "./service-order-patch";
import { listMachineFaults, createMachineFault } from "./machine-fault-service";
import { createDailyCheck } from "./daily-check-service";
import { checkUse, checkUseBatch, meBlockers, withMessages } from "./usage-service";
import { reviseMachineFault } from "./machine-fault-revise";
import { approveMachineFault, rejectMachineFault } from "./machine-fault-decide";
import { POST as syncPush } from "@/app/api/sync/push/route";
import { GET as syncPull } from "@/app/api/sync/pull/route";
import { GET as ordersGet } from "@/app/api/service-orders/route";
import { GET as orderGet } from "@/app/api/service-orders/[id]/route";
import { GET as faultsGet } from "@/app/api/machine-faults/route";
import type { EquipmentActor } from "./equipment-scope";

const describeDb = process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL ? describe : describe.skip;
const suffix = Date.now().toString(36);
const co = `cmp_eq_${suffix}`, user = `usr_eq_${suffix}`, worker = `wrk_eq_${suffix}`, otherWorker = `wrk_eq_o_${suffix}`;
const p1 = `prj_eq_1_${suffix}`, p2 = `prj_eq_2_${suffix}`;
const m1 = `mch_eq_1_${suffix}`, m2 = `mch_eq_2_${suffix}`;
const company: EquipmentActor = { companyId: co, userId: user, roles: ["OWNER", "MECHANIC"], scope: "COMPANY", projectIds: null };
const projects: EquipmentActor = { ...company, scope: "PROJECTS", projectIds: [p1] };
const self: EquipmentActor = { ...company, scope: "SELF", projectIds: [] };

describeDb("equipment PROJECTS/SELF boundaries", () => {
  const admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  let ownOrder = "", foreignOrder = "", peerOrder = "", ownFault = "", foreignFault = "", peerFault = "", cookie = "";
  beforeAll(async () => {
    await admin.query("INSERT INTO companies(id,name,slug) VALUES ($1,'Equipment scope',$2)", [co, `eq-${suffix}`]);
    await admin.query("INSERT INTO users(id,email,first_name,last_name,password_hash,must_change_password) VALUES ($1,$2,'Test','Scope','x',false)", [user, `eq-${suffix}@test.example`]);
    await withCompany(admin, companyId(co), async (c) => {
      await c.query(`INSERT INTO memberships(id,company_id,user_id,roles,scope) VALUES ($1,$2,$3,ARRAY['OWNER','MECHANIC']::"Role"[],'COMPANY')`, [`mem_${suffix}`,co,user]);
      await c.query("INSERT INTO workers(id,company_id,user_id,first_name,last_name,hired_at) VALUES ($1,$2,$3,'Own','Worker','2020-01-01'),($4,$2,NULL,'Other','Worker','2020-01-01')", [worker,co,user,otherWorker]);
      await c.query("INSERT INTO projects(id,company_id,code,name) VALUES ($1,$3,'P1','Own'),($2,$3,'P2','Other')", [p1,p2,co]);
      await c.query("INSERT INTO machines(id,company_id,code,name,category_id) VALUES ($1,$3,'M1','One',$3 || '_cat_excavator'),($2,$3,'M2','Two',$3 || '_cat_excavator')", [m1,m2,co]);
      await c.query(`INSERT INTO project_assignments(id,company_id,project_id,worker_id,machine_id,from_date) VALUES
        ($1,$4,$5,$7,NULL,'2020-01-01'),($2,$4,$5,NULL,$8,'2020-01-01'),($3,$4,$6,NULL,$9,'2020-01-01')`,
        [`pa_w_${suffix}`,`pa_m1_${suffix}`,`pa_m2_${suffix}`,co,p1,p2,worker,m1,m2]);
      await c.query("INSERT INTO sessions(id,company_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')", [`ses_${suffix}`,co,user,`hash_${suffix}`]);
    });
    cookie = `${ACCESS_COOKIE}=${issueAccessToken({sub:user,sid:`ses_${suffix}`,companyId:co})}`;
    const orderInput = { origin: "MANUAL" as const, kind: "INTERNAL" as const, priority: "LOW" as const, description: "Test" };
    const a = await createServiceOrder(app, company, { ...orderInput, machineId:m1, projectId:p1, assignedMechanicWorkerId:worker });
    const b = await createServiceOrder(app, company, { ...orderInput, machineId:m2, projectId:p2, assignedMechanicWorkerId:otherWorker });
    if (a.outcome !== "OK" || b.outcome !== "OK") throw new Error("order fixture failed");
    ownOrder = a.id; foreignOrder = b.id;
    const peer = await createServiceOrder(app, company, { ...orderInput, machineId:m1, projectId:p1, assignedMechanicWorkerId:otherWorker });
    if (peer.outcome !== "OK") throw new Error("peer order fixture failed");
    peerOrder = peer.id;
    const faultInput = { reportedAt:"2026-11-20T08:00:00Z",title:"Scope kvar",priority:"LOW" as const };
    const f1 = await createMachineFault(app, company, { ...faultInput, machineId:m1, projectId:p1, reporterWorkerId:worker });
    const f2 = await createMachineFault(app, company, { ...faultInput, machineId:m2, projectId:p2, reporterWorkerId:otherWorker });
    if (f1.outcome !== "OK" || f2.outcome !== "OK") throw new Error("fault fixture failed");
    ownFault=f1.id; foreignFault=f2.id;
    const pf = await createMachineFault(app, company, { ...faultInput, machineId:m1, projectId:p1, reporterWorkerId:otherWorker });
    if (pf.outcome !== "OK") throw new Error("peer fault fixture failed");
    peerFault = pf.id;
  }, 60_000);
  afterAll(async () => {
    await withCompany(admin, companyId(co), async (c) => {
      await c.query("SET LOCAL session_replication_role = replica");
      for (const table of ["sync_receipts","sync_conflicts","sync_change_log","sync_cursor_slots","sync_cursor_allocators","service_order_events","service_order_parts","approval_requests","service_orders","machine_fault_revisions","machine_faults","machine_daily_checks","check_templates","audit_events","project_assignments","sessions","projects","machines","workers","memberships"]) {
        await c.query(`DELETE FROM public.${table} WHERE company_id=$1`, [co]);
      }
    });
    await admin.query("DELETE FROM companies WHERE id=$1", [co]);
    await admin.query("DELETE FROM users WHERE id=$1", [user]);
    await app.end(); await admin.end();
  }, 60_000);

  it("PROJECTS i SELF filtriraju liste, detalje, kreiranje i sve izmjene naloga i kvarova", async () => {
    for (const actor of [projects, self]) {
      expect((await listServiceOrders(app, actor, {})).map(x => x.id)).toContain(ownOrder);
      expect((await listServiceOrders(app, actor, {})).map(x => x.id)).not.toContain(foreignOrder);
      expect(await getServiceOrder(app, actor, foreignOrder)).toBeNull();
      expect(await getServiceOrder(app, actor, ownOrder)).not.toBeNull();
      expect((await listMachineFaults(app, actor, {})).map(x => x.id)).toContain(ownFault);
      expect((await listMachineFaults(app, actor, {})).map(x => x.id)).not.toContain(foreignFault);
      const order = { machineId:m2, projectId:p2, origin:"MANUAL" as const, kind:"INTERNAL" as const, priority:"LOW" as const, description:"Bad", assignedMechanicWorkerId:worker };
      expect((await createServiceOrder(app, actor, order)).outcome).toBe("NOT_FOUND");
      expect((await createServiceOrder(app, actor, { ...order, machineId:m2, projectId:p1 })).outcome).toBe("NOT_FOUND");
      expect((await updateServiceOrder(app, actor, foreignOrder, {description:"bad"})).outcome).toBe("NOT_FOUND");
      expect((await updateServiceOrder(app, actor, ownOrder, {projectId:p2})).outcome).toBe("NOT_FOUND");
      expect((await startServiceOrder(app, actor, foreignOrder)).outcome).toBe("NOT_FOUND");
      expect((await waitServiceOrderParts(app, actor, foreignOrder)).outcome).toBe("NOT_FOUND");
      expect((await finishServiceOrder(app, actor, foreignOrder, {})).outcome).toBe("NOT_FOUND");
      expect((await addServiceOrderPart(app, actor, foreignOrder, {itemId:"missing",quantity:"1"})).outcome).toBe("NOT_FOUND");
      expect((await approveServiceOrder(app, actor, foreignOrder)).outcome).toBe("NOT_FOUND");
      expect((await rejectServiceOrder(app, actor, foreignOrder, "Dovoljno dug razlog")).outcome).toBe("NOT_FOUND");
      expect((await createMachineFault(app, actor, {machineId:m2,projectId:p2,reportedAt:"2026-11-20T08:00:00Z",title:"Bad",priority:"LOW"})).outcome).toBe("FORBIDDEN");
      expect((await reviseMachineFault(app, actor, foreignFault, {reason:"Dovoljno dug razlog",payload:{status:"DONE"}})).outcome).toBe("FORBIDDEN");
      expect((await approveMachineFault(app, actor, foreignFault)).outcome).toBe("FORBIDDEN");
      expect((await rejectMachineFault(app, actor, foreignFault)).outcome).toBe("FORBIDDEN");
    }
    expect((await listServiceOrders(app, projects, {})).map(x => x.id)).toContain(peerOrder);
    expect((await listServiceOrders(app, self, {})).map(x => x.id)).not.toContain(peerOrder);
    expect((await listMachineFaults(app, projects, {})).map(x => x.id)).toContain(peerFault);
    expect((await listMachineFaults(app, self, {})).map(x => x.id)).not.toContain(peerFault);
    expect((await reviseMachineFault(app, self, peerFault, {reason:"Dovoljno dug razlog",payload:{}})).outcome).toBe("FORBIDDEN");
    expect(await getServiceOrder(app, {...projects, projectIds: []}, ownOrder)).toBeNull();
    expect((await updateServiceOrder(app, self, ownOrder, {assignedMechanicWorkerId:otherWorker})).outcome).toBe("NOT_FOUND");
    expect((await updateServiceOrder(app, projects, ownOrder, {description:"allowed"})).outcome).toBe("OK");
    await withCompany(admin, companyId(co), c => c.query("UPDATE service_orders SET fault_id=$3 WHERE company_id=$1 AND id=$2", [co,ownOrder,foreignFault]));
    const detail = await getServiceOrder(app, self, ownOrder);
    expect(detail?.order.fault_id).toBeNull();
    expect(detail?.order.fault_title).toBeNull();
    expect((await finishServiceOrder(app, self, ownOrder, {})).outcome).toBe("NOT_FOUND");
    await withCompany(admin, companyId(co), c => c.query("UPDATE service_orders SET fault_id=NULL WHERE company_id=$1 AND id=$2", [co,ownOrder]));
    expect((await reviseMachineFault(app, self, ownFault, {reason:"Dovoljno dug razlog",payload:{}})).outcome).toBe("OK");
  });

  it("usage računa sve kvarove i iznimke, ali ne otkriva tuđe detalje", async () => {
    const secret = `TAJNI-KVAR-${suffix}`;
    const created = await createMachineFault(app, company, { machineId:m1, projectId:p2,
      reporterWorkerId:otherWorker, reportedAt:"2026-11-20T08:00:00Z", title:secret, priority:"LOW" });
    if (created.outcome !== "OK") throw new Error("fault fixture failed");
    const today = "2026-11-23";
    const override = `uo_eq_${suffix}`;
    const obligationType = `ot_eq_${suffix}`, obligation = `ob_eq_${suffix}`;
    await admin.query(`INSERT INTO obligation_types (id,company_id,code,label,entity_kind,blocks_assignment)
      VALUES ($1,$2,'TESTUSAGE','Istekla obaveza','MACHINE',true)`, [obligationType,co]);
    await admin.query(`INSERT INTO obligations (id,company_id,type_id,machine_id,expires_at,created_by)
      VALUES ($1,$2,$3,$4,'2000-01-01',$5)`, [obligation,co,obligationType,m1,user]);
    await admin.query(`INSERT INTO usage_overrides
      (id,company_id,subject_kind,subject_id,action,reference_id,reason,valid_from,valid_to,approved_by,approved_at)
      VALUES ($1,$2,'MACHINE',$3,'haul',$4,'Tajna iznimka odobrena', '2020-01-01','2099-01-01',$5,now())`,
      [override,co,m1,created.id,user]);
    try {
      const input = { entityKind:"MACHINE" as const, entityId:m1, action:"haul" as const, today };
      const full = await checkUse(app, co, {...input, viewer:company});
      const scoped = await checkUse(app, co, {...input, viewer:projects});
      expect(JSON.stringify(full)).toContain(secret);
      expect(JSON.stringify(scoped)).not.toContain(secret);
      expect(JSON.stringify(scoped)).not.toContain("Tajna iznimka");
      expect(full.allowed).toBe(false);
      expect(scoped.allowed).toBe(full.allowed);
      expect(scoped.overrideAvailable).toBe(full.overrideAvailable);
      expect(scoped.warns.find(w => w.label === "Kvar izvan vašeg opsega")).toMatchObject({overridden:true});
      expect(JSON.stringify(withMessages(scoped))).not.toContain(secret);
      const batch = await checkUseBatch(app, co, { entityKind:"MACHINE", entityIds:[m1], action:"haul", today, viewer:projects });
      expect(batch.get(m1)).toEqual(scoped);
      const result = await meBlockers(app, {...projects, permissions:["machines.view"]});
      expect(result.machines.map(m => m.id)).toContain(m1);
      expect(result.machines.map(m => m.id)).not.toContain(m2);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(await meBlockers(app, {...projects, projectIds:[], permissions:["machines.view"]}))).not.toContain(m1);
    } finally {
      await admin.query("DELETE FROM usage_overrides WHERE id=$1", [override]);
      await admin.query("DELETE FROM obligations WHERE id=$1", [obligation]);
      await admin.query("DELETE FROM obligation_types WHERE id=$1", [obligationType]);
    }
  });

  it("kritičan dnevni pregled ne smije zaobići scope pri automatskom otvaranju kvara", async () => {
    const templateId = `ckt_${suffix}`;
    await withCompany(admin, companyId(co), c => c.query(
      "INSERT INTO check_templates(id,company_id,name,items,created_by) VALUES ($1,$2,'Test',$3::jsonb,$4)",
      [templateId,co,JSON.stringify([{key:"x",label:"Critical",required:true,critical:true}]),user]));
    const base = {machineId:m2,projectId:p2,workerId:worker,templateId,checkedAt:"2026-11-20T08:00:00Z",result:"FAIL" as const,checklistJson:{x:"FAIL"}};
    expect((await createDailyCheck(app, projects, base)).outcome).toBe("FORBIDDEN");
    expect((await createDailyCheck(app, self, base)).outcome).toBe("FORBIDDEN");
    expect((await createDailyCheck(app, self, {...base,machineId:m1,projectId:p1})).outcome).toBe("OK");
  });

  it("sync odbija tuđe naloge i kvarove, ali prihvata vlastite", async () => {
    async function send(item: unknown) {
      const response = await syncPush(new NextRequest("http://t/api/sync/push", { method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({items:[item]}) }));
      expect(response.status).toBe(200);
      return ((await response.json()) as {data:{results:{status:string}[]}}).data.results[0]!.status;
    }
    const action = (orderId:string) => ({localId:randomUUID(),entityType:"service_order_action",actionId:randomUUID(),serviceOrderId:orderId,deviceSentAt:"2026-11-20T08:00:00Z",action:{kind:"START",laborHours:null,externalCostAmount:null,warrantyUntil:null,note:null,part:null}});
    const fault = (machineId:string,projectId:string) => ({localId:randomUUID(),entityType:"machine_fault",faultId:randomUUID(),deviceSentAt:"2026-11-20T08:00:00Z",fault:{machineId,projectId,partnerId:null,reportedAt:"2026-11-20T08:00:00Z",title:"Offline",description:null,priority:"LOW",estimatedCostAmount:null,currencyCode:null,downtimeMinutes:null}});
    const foreignEvent = fault(m2,p2);
    expect(await send(foreignEvent)).toBe("APPLIED");
    for (const scope of ["PROJECTS","SELF"]) {
      await withCompany(admin, companyId(co), c => c.query("UPDATE memberships SET scope=$3 WHERE company_id=$1 AND user_id=$2", [co,user,scope]));
      const orderList = await ordersGet(new NextRequest("http://t/api/service-orders", { headers: {cookie} }));
      const orderBody = await orderList.json() as {data:{orders:{id:string}[]}};
      expect(orderBody.data.orders.map(x => x.id)).not.toContain(foreignOrder);
      expect((await orderGet(new NextRequest(`http://t/api/service-orders/${foreignOrder}`, {headers:{cookie}}), {params:Promise.resolve({id:foreignOrder})})).status).toBe(404);
      const faultList = await faultsGet(new NextRequest("http://t/api/machine-faults", { headers:{cookie} }));
      const faultBody = await faultList.json() as {data:{faults:{id:string}[]}};
      expect(faultBody.data.faults.map(x => x.id)).not.toContain(foreignFault);
      expect(await send(foreignEvent)).toBe("REJECTED"); // prior receipt no longer authorizes access
      const pulled = await syncPull(new NextRequest("http://t/api/sync/pull?limit=200", {headers:{cookie}}));
      expect(pulled.status).toBe(200);
      const pullBody = await pulled.json() as {data:{events:{entityType:string;entityId:string}[]}};
      expect(pullBody.data.events.some(x => x.entityType === "machine_fault" && x.entityId === foreignEvent.faultId)).toBe(scope === "SELF"); // SELF can see its own historical report
      expect(await send(action(foreignOrder))).toBe("REJECTED");
      expect(await send(fault(m2,p2))).toBe("REJECTED");
      expect(await send(fault(m1,p1))).toBe("APPLIED");
    }
    const ownAction = action(ownOrder);
    expect(await send(ownAction)).toBe("APPLIED");
    await withCompany(admin, companyId(co), c => c.query("UPDATE service_orders SET assigned_mechanic_worker_id=$3 WHERE company_id=$1 AND id=$2", [co,ownOrder,otherWorker]));
    expect(await send(ownAction)).toBe("REJECTED");
  });
});
