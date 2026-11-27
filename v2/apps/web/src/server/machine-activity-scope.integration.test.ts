import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { createMachineWorkLog, listMachineWorkLogs } from "./machine-work-log-service";
import { reviseMachineWorkLog } from "./machine-work-log-revise";
import { createFuelEntry, listFuelEntries } from "./fuel-entry-service";
import { reviseFuelEntry } from "./fuel-entry-revise";
import { listFuelDeviations, explainFuelDeviation } from "./fuel-price-service";
import { setFuelAmount } from "./fuel-entry-price-set";
import { POST as push } from "@/app/api/sync/push/route";
import { GET as pull } from "@/app/api/sync/pull/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import type { MachineActivityActor } from "./machine-activity-scope";

const describeDb = process.env.DATABASE_URL && process.env.DATABASE_ADMIN_URL ? describe : describe.skip;
const run = randomUUID().slice(0,8), co=`cmp_act_${run}`, user=`usr_act_${run}`, worker=`wrk_act_${run}`, other=`wrk_other_${run}`, p1=`prj_a_${run}`, p2=`prj_b_${run}`, machine=`mch_${run}`;
const company: MachineActivityActor = { companyId:co,userId:user,roles:["OWNER","MACHINE_OPERATOR","DRIVER"],scope:"COMPANY",projectIds:null };
const projects: MachineActivityActor = {...company,scope:"PROJECTS",projectIds:[p1]};
const self: MachineActivityActor = {...company,scope:"SELF",projectIds:null};

describeDb("machine hours and fuel session scope", () => {
  const app=new Pool({connectionString:process.env.DATABASE_URL}), admin=new Pool({connectionString:process.env.DATABASE_ADMIN_URL});
  let cookie:string;
  const logs=[`log1_${run}`,`log2_${run}`,`log3_${run}`], fuels=[`fuel1_${run}`,`fuel2_${run}`,`fuel3_${run}`];
  beforeAll(async () => {
    await admin.query("INSERT INTO companies(id,name,slug) VALUES ($1,'Activity',$2)",[co,co]);
    await admin.query("INSERT INTO users(id,email,first_name,last_name,password_hash,must_change_password) VALUES ($1,$2,'Own','User','x',false)",[user,`${user}@example.test`]);
    await withCompany(admin,companyId(co),async c => {
      await c.query(`INSERT INTO memberships(id,company_id,user_id,roles,scope) VALUES ($1,$2,$3,ARRAY['OWNER','MACHINE_OPERATOR','DRIVER']::"Role"[],'PROJECTS')`,[`mem_${run}`,co,user]);
      await c.query("INSERT INTO workers(id,company_id,user_id,first_name,last_name,hired_at) VALUES ($1,$3,$4,'Own','Worker','2020-01-01'),($2,$3,NULL,'Other','Worker','2020-01-01')",[worker,other,co,user]);
      await c.query("INSERT INTO projects(id,company_id,code,name) VALUES ($1,$3,'P1','One'),($2,$3,'P2','Two')",[p1,p2,co]);
      await c.query("INSERT INTO machines(id,company_id,code,name,category_id) VALUES ($1,$2,'M','Machine',$2 || '_cat_excavator')",[machine,co]);
      await c.query("INSERT INTO project_assignments(id,company_id,project_id,worker_id,from_date) VALUES ($1,$2,$3,$4,'2020-01-01')",[`pa_${run}`,co,p1,worker]);
      await c.query("INSERT INTO sessions(id,company_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')",[`ses_${run}`,co,user,`hash_${run}`]);
      for (let i=0;i<3;i++) {
        await c.query(`INSERT INTO machine_work_logs(id,company_id,machine_id,worker_id,project_id,started_at,ended_at,mode,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz+interval '1 hour','IDLE',$7,$7)`,[logs[i],co,machine,i===0?worker:other,i===2?p2:p1,`2025-01-0${i+1}T08:00:00Z`,user]);
        await c.query(`INSERT INTO fuel_entries(id,company_id,machine_id,driver_worker_id,project_id,filled_at,liters,amount_cents,currency_code,deviation_status,created_by,updated_by)
          VALUES ($1,$2,$3,$4,$5,'2025-01-01T08:00:00Z',10,1000,'BAM','OPEN',$6,$6)`,[fuels[i],co,machine,i===0?worker:other,i===2?p2:p1,user]);
      }
    });
    cookie=`${ACCESS_COOKIE}=${issueAccessToken({sub:user,sid:`ses_${run}`,companyId:co})}`;
  },60_000);
  afterAll(async () => {
    await withCompany(admin,companyId(co),async c => {
      await c.query("SET LOCAL session_replication_role = replica");
      for (const table of ["sync_receipts","sync_conflicts","sync_change_log","sync_cursor_slots","sync_cursor_allocators","cost_entries","machine_work_log_revisions","fuel_entry_revisions","machine_meter_readings","fuel_entries","machine_work_logs","audit_events","project_assignments","sessions","projects","machines","workers","memberships"]) await c.query(`DELETE FROM public.${table} WHERE company_id=$1`,[co]);
    });
    await admin.query("DELETE FROM companies WHERE id=$1",[co]); await admin.query("DELETE FROM users WHERE id=$1",[user]);
    await app.end(); await admin.end();
  },60_000);
  it("PROJECTS i SELF filtriraju liste, odstupanja i izmjene",async () => {
    for (const [actor,allowed] of [[projects,[0,1]],[self,[0]]] as const) {
      const expectedLogs=allowed.map(i=>logs[i]); const expectedFuel=allowed.map(i=>fuels[i]);
      expect((await listMachineWorkLogs(app,actor,{})).map(x=>x.id).sort()).toEqual([...expectedLogs].sort());
      expect((await listFuelEntries(app,actor,{})).map(x=>x.id).sort()).toEqual([...expectedFuel].sort());
      const deviations=await listFuelDeviations(app,actor); expect(deviations.open_count).toBe(allowed.length);
      expect(deviations.deviations.map(x=>x.id).sort()).toEqual([...expectedFuel].sort());
      expect(await reviseMachineWorkLog(app,actor,logs[2]!,{reason:"Test ispravke razloga",payload:{}})).toMatchObject({code:"NOT_FOUND"});
      expect(await reviseFuelEntry(app,actor,fuels[2]!,{reason:"Test ispravke razloga",payload:{}})).toMatchObject({code:"NOT_FOUND"});
      expect(await explainFuelDeviation(app,actor,fuels[2]!,{status:"EXPLAINED",reason:"OTHER",note:"Dovoljno objašnjenje"})).toMatchObject({code:"NOT_FOUND"});
      expect(await setFuelAmount(app,actor,fuels[2]!,"10.00")).toMatchObject({code:"NOT_FOUND"});
    }
    expect((await listMachineWorkLogs(app,{...self,userId:"no-worker"},{}))).toEqual([]);
  });
  it("unos provjerava projekt odnosno vlastitog radnika",async () => {
    const log={machineId:machine,workerId:other,projectId:p2,startedAt:"2024-01-01T08:00:00Z",endedAt:"2024-01-01T09:00:00Z",mode:"IDLE"};
    const fuel={machineId:machine,driverWorkerId:other,projectId:p2,filledAt:"2024-01-01T08:00:00Z",liters:5,totalAmount:"10.00"};
    expect(await createMachineWorkLog(app,projects,log)).toMatchObject({outcome:"FORBIDDEN",code:"SCOPE"});
    expect(await createFuelEntry(app,projects,fuel)).toMatchObject({outcome:"FORBIDDEN",code:"SCOPE"});
    expect(await createMachineWorkLog(app,self,{...log,projectId:p1})).toMatchObject({outcome:"FORBIDDEN",code:"SCOPE"});
    expect(await createFuelEntry(app,self,{...fuel,projectId:p1})).toMatchObject({outcome:"FORBIDDEN",code:"SCOPE"});
    expect((await createMachineWorkLog(app,projects,{...log,projectId:p1})).outcome).toBe("OK");
    expect((await createFuelEntry(app,self,{...fuel,driverWorkerId:worker})).outcome).toBe("OK");
  });
  it("offline push, pull i replay nakon opoziva PROJECTS, pa SELF",async () => {
    const now=new Date().toISOString();
    const log={localId:randomUUID(),entityType:"machine_work_log",workLogId:randomUUID(),deviceSentAt:now,log:{machineId:machine,projectId:p1,startedAt:"2024-03-01T08:00:00Z",endedAt:"2024-03-01T09:00:00Z",mode:"IDLE",meterEnd:null,note:null}};
    const fuel={localId:randomUUID(),entityType:"fuel_entry",fuelEntryId:randomUUID(),deviceSentAt:now,entry:{machineId:machine,projectId:p1,filledAt:"2024-03-01T08:00:00Z",liters:10,totalAmount:"20.00",currencyCode:"BAM",unitPriceAmount:null,meterReading:null,note:null}};
    const send=async (items:unknown[]) => {const r=await push(new NextRequest("http://local/api/sync/push",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({items})})); expect(r.status).toBe(200); return (await r.json()).data.results;};
    const events=async () => {const r=await pull(new NextRequest("http://local/api/sync/pull",{headers:{cookie}}));expect(r.status).toBe(200);return (await r.json()).data.events as Array<{entityId:string;payload:Record<string,unknown>}>;};
    expect((await send([log,fuel])).map((x:{status:string})=>x.status)).toEqual(["APPLIED","APPLIED"]);
    expect((await events()).some(x=>x.entityId===log.workLogId)).toBe(true);
    expect((await events()).some(x=>x.entityId===fuel.fuelEntryId)).toBe(true);
    const denied = await send([{...log,localId:randomUUID(),workLogId:randomUUID(),log:{...log.log,projectId:p2}},
      {...fuel,localId:randomUUID(),fuelEntryId:randomUUID(),entry:{...fuel.entry,projectId:p2}}]);
    expect(denied.map((x:{status:string})=>x.status)).toEqual(["REJECTED","REJECTED"]);
    const collision = await send([{...log,localId:randomUUID(),workLogId:logs[2]}, {...fuel,localId:randomUUID(),fuelEntryId:fuels[2]}]);
    expect(collision).toEqual(expect.arrayContaining([expect.objectContaining({status:"REJECTED",entityId:null,version:null})]));
    expect(collision.every((x:{status:string;entityId:string|null;version:number|null})=>x.status==="REJECTED" && x.entityId===null && x.version===null)).toBe(true);
    await withCompany(admin,companyId(co),async c=>{await c.query("SET LOCAL session_replication_role=replica");await c.query("UPDATE project_assignments SET to_date='2020-01-02' WHERE id=$1",[`pa_${run}`]);});
    expect((await send([log,fuel])).map((x:{status:string})=>x.status)).toEqual(["REJECTED","REJECTED"]);
    expect((await events()).some(x=>x.entityId===fuel.fuelEntryId || x.entityId===log.workLogId)).toBe(false);
    await admin.query("UPDATE memberships SET scope='SELF',roles=ARRAY['DRIVER','MACHINE_OPERATOR']::\"Role\"[] WHERE id=$1",[`mem_${run}`]);
    const selfEvents=await events();
    expect(selfEvents.some(x=>x.entityId===log.workLogId)).toBe(true);
    expect(selfEvents.find(x=>x.entityId===fuel.fuelEntryId)?.payload.amount).toBeNull();
    const foreign={...fuel,localId:randomUUID(),fuelEntryId:fuels[1],entry:{...fuel.entry,totalAmount:null}};
    expect((await send([foreign]))[0]).toMatchObject({status:"REJECTED",entityId:null,version:null});
    const selfLog={...log,localId:randomUUID(),workLogId:randomUUID(),log:{...log.log,projectId:p2,startedAt:"2024-03-02T08:00:00Z",endedAt:"2024-03-02T09:00:00Z"}};
    const selfFuel={...fuel,localId:randomUUID(),fuelEntryId:randomUUID(),entry:{...fuel.entry,projectId:p2,totalAmount:null}};
    expect((await send([selfLog,selfFuel])).map((x:{status:string})=>x.status)).toEqual(["APPLIED","APPLIED"]);
    expect((await events()).some(x=>x.entityId===selfFuel.fuelEntryId)).toBe(true);
  });
});
