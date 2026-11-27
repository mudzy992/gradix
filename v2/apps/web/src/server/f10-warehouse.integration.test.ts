import { Pool } from "pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as balancesGet } from "@/app/api/stock/balance/route";
import { POST as countPost } from "@/app/api/stock-counts/route";
import { GET as countGet } from "@/app/api/stock-counts/[id]/route";
import { POST as countApply } from "@/app/api/stock-counts/[id]/apply/route";
import { POST as transferPost } from "@/app/api/stock-transfers/route";
import { GET as warehousesGet, POST as warehousesPost } from "@/app/api/warehouses/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { companyId, withCompany } from "@gradix/db";
import { applyStockCount, createStockCount } from "./stock-count-service";
import { createWarehouse, setStockLevel, stockBalance, transferStock } from "./warehouse-service";
import { createFuelTank, listFuelTanks } from "./fuel-price-service";
import { listStockItems, recordStockMovement, saveStockItem } from "./stock-service";
import { createFuelEntry } from "./fuel-entry-service";
import type { Role } from "./permissions";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const describeDb = adminUrl && appUrl ? describe : describe.skip;
const run = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const company = `f10wh_${run}`;
const other = `f10wo_${run}`;
const user = `f10wu_${run}`;
const item = `f10wi_${run}`;
const project = `f10wp_${run}`;
const actor = { companyId: company, userId: user, roles: ["OWNER"] as Role[] };

describeDb("F10A-1 skladišni ledger", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const app = new Pool({ connectionString: appUrl });
  let central = "";
  let site = "";
  let cookie = "";
  beforeAll(async () => {
    await admin.query("INSERT INTO companies(id,name,slug) VALUES ($1,'A',$1),($2,'B',$2)",[company,other]);
    await admin.query("INSERT INTO users(id,email,first_name,last_name,password_hash,must_change_password) VALUES ($1,$2,'A','B','x',false)",[user,`${user}@test.example`]);
    await withCompany(admin, companyId(company), async (client) => {
      await client.query(`INSERT INTO memberships(id,company_id,user_id,roles,scope) VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY')`,[`mem_${run}`,company,user]);
      await client.query("INSERT INTO sessions(id,company_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now() + interval '1 day')",[`ses_${run}`,company,user,`hash_${run}`]);
      const w = await client.query<{id:string}>("SELECT id FROM warehouses WHERE company_id=$1 AND kind='CENTRAL'",[company]); central=w.rows[0]!.id;
      await client.query("INSERT INTO projects(id,company_id,code,name,status) VALUES ($1,$2,'P','Test','ACTIVE')",[project,company]);
      await client.query("INSERT INTO stock_items(id,company_id,code,name,unit,created_by,updated_by) VALUES ($1,$2,'I','Artikal','kom',$3,$3)",[item,company,user]);
      await client.query("INSERT INTO stock_movements(id,company_id,item_id,kind,quantity,unit_cost_cents,occurred_on,created_by) VALUES ($1,$2,$3,'IN',10,1000,current_date,$4)",[`open_${run}`,company,item,user]);
    });
    cookie = `${ACCESS_COOKIE}=${issueAccessToken({sub:user,sid:`ses_${run}`,companyId:company})}`;
    const created=await createWarehouse(app,actor,{code:"SITE",name:"Gradilište",kind:"SITE",projectId:project});
    if (created.outcome!=="OK") throw new Error(created.message);
    site=created.data.id;
  });
  afterAll(async () => {
    await withCompany(admin, companyId(company), async (client) => {
      await client.query("SET LOCAL session_replication_role=replica");
      for (const table of ["cost_entries","fuel_entries","stock_count_items","stock_counts","stock_item_levels","stock_movements","fuel_tanks","stock_items","warehouses","machines","workers","projects","audit_events","sessions","memberships"]) await client.query(`DELETE FROM ${table} WHERE company_id=$1`,[company]);
    });
    await admin.query("DELETE FROM companies WHERE id=ANY($1::text[])",[[company,other]]);
    await admin.query("DELETE FROM users WHERE id=$1",[user]);
    await admin.end(); await app.end();
  });
  it("API provjerava sesiju, validira unos i vraća stanje", async () => {
    const unauthenticated = await warehousesGet(new NextRequest("http://t/api/warehouses"));
    expect(unauthenticated.status).toBe(401);
    const list = await warehousesGet(new NextRequest("http://t/api/warehouses",{headers:{cookie}}));
    expect(list.status).toBe(200);
    const data=await list.json() as {data:{warehouses:{id:string}[]}};
    expect(data.data.warehouses.map((row)=>row.id)).toContain(site);
    const invalid=await warehousesPost(new NextRequest("http://t/api/warehouses",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({code:"",name:"X",kind:"SITE",projectId:project})}));
    expect(invalid.status).toBe(400);
    const balance=await balancesGet(new NextRequest(`http://t/api/stock/balance?warehouse=${central}&item=${item}`,{headers:{cookie}}));
    expect(balance.status).toBe(200);
    const created=await countPost(new NextRequest("http://t/api/stock-counts",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({warehouseId:site,items:[{itemId:item,countedQuantity:"0"}]})}));
    expect(created.status).toBe(200);
    const payload=await created.json() as {data:{id:string}};
    const ctx={params:Promise.resolve({id:payload.data.id})};
    expect((await countGet(new NextRequest("http://t/api/stock-counts/id",{headers:{cookie}}),ctx)).status).toBe(200);
    expect((await countApply(new NextRequest("http://t/api/stock-counts/id/apply",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({reason:"Provjereno"})}),ctx)).status).toBe(200);
    const badTransfer=await transferPost(new NextRequest("http://t/api/stock-transfers",{method:"POST",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({fromWarehouseId:central,toWarehouseId:site,itemId:item,quantity:"1",occurredOn:"2026-02-30"})}));
    expect(badTransfer.status).toBe(400);
  });
  it("konkurentni izlaz i transfer ne mogu potrošiti istu zalihu",async()=>{
    const raceItem=`race_${run}`;
    await withCompany(admin,companyId(company),async client=>{
      await client.query("INSERT INTO stock_items(id,company_id,code,name,unit,created_by,updated_by) VALUES($1,$2,'RACE','Race','kom',$3,$3)",[raceItem,company,user]);
      await client.query("INSERT INTO stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,unit_cost_cents,occurred_on,created_by) VALUES($1,$2,$3,$4,'IN',10,100,current_date,$5)",[`race_in_${run}`,company,raceItem,central,user]);
    });
    const [out,transfer]=await Promise.all([
      recordStockMovement(app,actor,{itemId:raceItem,warehouseId:central,kind:"OUT",quantity:"7"}),
      transferStock(app,actor,{itemId:raceItem,fromWarehouseId:central,toWarehouseId:site,quantity:"7",occurredOn:"2026-11-23"}),
    ]);
    expect([out,transfer].filter(r=>r.outcome==="OK")).toHaveLength(1);
    const balances=await stockBalance(app,actor,{itemId:raceItem});
    if(balances.outcome!=="OK") throw Error(balances.message);
    expect((balances.data as {warehouse_id:string;on_hand:string}[]).find(r=>r.warehouse_id===central)?.on_hand).toBe("3.000");
    await expect(withCompany(app,companyId(company),client=>client.query("INSERT INTO public.stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,occurred_on,created_by) VALUES($1,$2,$3,$4,'OUT',4,current_date,$5)",[`race_invalid_${run}`,company,raceItem,central,user]))).rejects.toThrow(/STOCK_INSUFFICIENT/);
  });
  it("transfer pravi dvije kretnje i ne mijenja zbir", async () => {
    const result=await transferStock(app,actor,{fromWarehouseId:central,toWarehouseId:site,itemId:item,quantity:"3.000",occurredOn:"2026-11-23"});
    expect(result.outcome).toBe("OK"); if(result.outcome!=="OK") return;
    const moves=await withCompany(admin,companyId(company),(client)=>client.query<{kind:string;quantity:string;unit_cost_cents:string}>("SELECT kind,quantity::text,unit_cost_cents::text FROM stock_movements WHERE company_id=$1 AND transfer_id=$2 ORDER BY kind",[company,result.data.transferId]));
    expect(moves.rows).toEqual([{kind:"IN",quantity:"3.000",unit_cost_cents:"1000"},{kind:"OUT",quantity:"3.000",unit_cost_cents:"1000"}]);
    const balances=await stockBalance(app,actor,{itemId:item});
    if(balances.outcome!=="OK") throw Error(balances.message);
    expect((balances.data as {on_hand:string}[]).reduce((sum,row)=>sum+Number(row.on_hand),0)).toBe(10);
  });
  it("transfer prenosi zbirnu vrijednost i kad je prosječna cijena pola feninga", async () => {
    const fractional = `frac_${run}`;
    await withCompany(admin,companyId(company),async (client) => {
      await client.query("INSERT INTO stock_items(id,company_id,code,name,unit,created_by,updated_by) VALUES ($1,$2,'FRAC','Cijena','kom',$3,$3)",[fractional,company,user]);
      for (const [index,cost] of [[1,1],[2,2]] as const) await client.query(
        "INSERT INTO stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,unit_cost_cents,occurred_on,created_by) VALUES ($1,$2,$3,$4,'IN',1,$5,current_date,$6)",
        [`fi_${index}_${run}`,company,fractional,central,cost,user],
      );
    });
    const result=await transferStock(app,actor,{fromWarehouseId:central,toWarehouseId:site,itemId:fractional,quantity:"2",occurredOn:"2026-11-23"});
    expect(result.outcome).toBe("OK"); if(result.outcome!=="OK") return;
    const rows=await withCompany(admin,companyId(company),(client)=>client.query<{ amount_cents:string }>(
      "SELECT amount_cents::text FROM stock_movements WHERE company_id=$1 AND transfer_id=$2 ORDER BY kind",[company,result.data.transferId],
    ));
    expect(rows.rows).toEqual([{amount_cents:"3"},{amount_cents:"3"}]);
  });
  it("minimum je upozorenje, a nedostatak blokira transfer", async () => {
    expect((await setStockLevel(app,actor,item,{warehouseId:central,minQuantity:"6"})).outcome).toBe("OK");
    const transfer=await transferStock(app,actor,{fromWarehouseId:central,toWarehouseId:site,itemId:item,quantity:"2",occurredOn:"2026-11-23"});
    expect(transfer.outcome).toBe("OK"); if(transfer.outcome==="OK") expect(transfer.data.belowMinimum).toBe(true);
    const rejected=await transferStock(app,actor,{fromWarehouseId:central,toWarehouseId:site,itemId:item,quantity:"99",occurredOn:"2026-11-23"});
    expect(rejected.outcome).toBe("CONFLICT");
  });
  it("popis bilježi potpisanu razliku jednom i traži razlog iznad tolerancije", async () => {
    const draft=await createStockCount(app,actor,{warehouseId:central,items:[{itemId:item,countedQuantity:"1"}]});
    expect(draft.outcome).toBe("OK"); if(draft.outcome!=="OK") return;
    // 4 komada × 10 KM = 40 KM, default tolerancija 200 KM: prolazi bez razloga.
    const applied=await applyStockCount(app,actor,draft.data.id);
    expect(applied.outcome).toBe("OK");
    expect(await applyStockCount(app,actor,draft.data.id)).toEqual({outcome:"OK",data:{id:draft.data.id,alreadyApplied:true}});
    const moves=await withCompany(admin,companyId(company),(client)=>client.query<{quantity:string}>("SELECT quantity::text FROM stock_movements WHERE company_id=$1 AND source_type='COUNT' AND source_id=$2",[company,draft.data.id]));
    expect(moves.rows).toEqual([{quantity:"-4.000"}]);
    await expect(withCompany(app,companyId(company),async (client) => client.query(
      "INSERT INTO stock_count_items(id,company_id,count_id,item_id,counted_quantity) VALUES ($1,$2,$3,$4,1)",
      [`extra_${run}`,company,draft.data.id,item],
    ))).rejects.toThrow("STOCK_COUNT_IMMUTABLE");
    const high=await createStockCount(app,actor,{warehouseId:central,items:[{itemId:item,countedQuantity:"50"}]});
    if(high.outcome!=="OK") throw Error(high.message);
    expect((await applyStockCount(app,actor,high.data.id)).outcome).toBe("VALIDATION_FAILED");
    expect((await applyStockCount(app,actor,high.data.id,"Popis nakon oštećenja")).outcome).toBe("OK");
  });
  it("tuđa firma i rola bez ovlasti nemaju pristup", async () => {
    expect((await transferStock(admin,{...actor,companyId:other},{fromWarehouseId:central,toWarehouseId:site,itemId:item,quantity:"1",occurredOn:"2026-11-23"})).outcome).toBe("NOT_FOUND");
    expect((await createStockCount(app,{...actor,roles:["WORKER"]},{warehouseId:central,items:[{itemId:item,countedQuantity:"1"}]})).outcome).toBe("FORBIDDEN");
  });
  it("TANK popisan kroz skladište mijenja isti izvod koji čita F4", async () => {
    const created=await createFuelTank(app,actor,{name:"Cisterna",capacityL:200,currentL:100});
    expect(created.outcome).toBe("OK"); if(created.outcome!=="OK") return;
    const tank=await withCompany(admin,companyId(company),(client)=>client.query<{warehouse_id:string;fuel_item_id:string}>("SELECT warehouse_id,fuel_item_id FROM fuel_tanks WHERE company_id=$1 AND id=$2",[company,created.data.id]));
    const row=tank.rows[0]!;
    expect((await setStockLevel(app,actor,item,{warehouseId:row.warehouse_id,minQuantity:"1"})).outcome).toBe("NOT_FOUND");
    const draft=await createStockCount(app,actor,{warehouseId:row.warehouse_id,items:[{itemId:row.fuel_item_id,countedQuantity:"80"}]});
    if(draft.outcome!=="OK") throw Error(draft.message);
    expect((await applyStockCount(app,actor,draft.data.id)).outcome).toBe("VALIDATION_FAILED");
    expect((await applyStockCount(app,actor,draft.data.id,"Očitano stanje cisterne")).outcome).toBe("OK");
    const tanks=await listFuelTanks(app,actor);
    expect(tanks.find((entry)=>entry.id===created.data.id)).toMatchObject({current_l:80});
    expect(tanks.find((entry)=>entry.id===created.data.id)?.last_count_at).toBeTruthy();
    const amount=await withCompany(admin,companyId(company),(client)=>client.query<{quantity:string}>("SELECT quantity::text FROM stock_movements WHERE company_id=$1 AND source_id=$2 AND kind='COUNT'",[company,draft.data.id]));
    expect(amount.rows).toEqual([{quantity:"-20.000"}]);
  });
  it("dva paralelna točenja ne mogu isprazniti cisternu ispod nule",async()=>{
    const worker=`race_worker_${run}`,machine=`race_machine_${run}`;
    await admin.query("UPDATE public.companies SET fuel_tank_enabled=true WHERE id=$1",[company]);
    await withCompany(admin,companyId(company),async client=>{
      await client.query("INSERT INTO public.workers(id,company_id,first_name,last_name,hired_at) VALUES($1,$2,'Test','Driver','2020-01-01')",[worker,company]);
      await client.query("INSERT INTO public.machines(id,company_id,code,name,category_id) VALUES($1,$2,'TANK-RACE','Bager',$2 || '_cat_excavator')",[machine,company]);
    });
    const tank=await createFuelTank(app,actor,{name:"Race tank",capacityL:20,currentL:10});
    if(tank.outcome!=="OK") throw Error("tank creation failed");
    const scopedActor={...actor,scope:"COMPANY" as const,projectIds:null};
    const input={machineId:machine,driverWorkerId:worker,projectId:project,filledAt:"2026-11-23T12:00:00Z",liters:7,totalAmount:"7.00",tankId:tank.data.id};
    const results=await Promise.all([createFuelEntry(app,scopedActor,input),createFuelEntry(app,scopedActor,input)]);
    expect(results.filter(r=>r.outcome==="OK")).toHaveLength(1);
    expect((await listFuelTanks(app,actor)).find(t=>t.id===tank.data.id)?.current_l).toBe(3);
    const costs=await admin.query("SELECT id FROM public.cost_entries WHERE company_id=$1 AND source_type='FUEL_ENTRY' AND status='POSTED'",[company]);
    expect(costs.rowCount).toBe(1);
  });
  it("baza na kraju transakcije odbija nepotpun transfer", async () => {
    await expect(withCompany(app,companyId(company),async (client) => {
      await client.query(`INSERT INTO stock_movements(id,company_id,item_id,warehouse_id,kind,quantity,occurred_on,transfer_id,created_by)
        VALUES ($1,$2,$3,$4,'OUT',1,current_date,$5,$6)`,[`bad_${run}`,company,item,central,`bad_trf_${run}`,user]);
    })).rejects.toThrow("STOCK_TRANSFER_INCOMPLETE");
    const result=await withCompany(admin,companyId(company),(client)=>client.query("SELECT id FROM stock_movements WHERE company_id=$1 AND transfer_id=$2",[company,`bad_trf_${run}`]));
    expect(result.rowCount).toBe(0);
  });
  it("F8 lista i uređivanje minimuma koriste centralno skladište", async () => {
    expect((await setStockLevel(app,actor,item,{warehouseId:central,minQuantity:"55",maxQuantity:"70"})).outcome).toBe("OK");
    const legacy=(await listStockItems(app,actor)).find((row)=>row.id===item);
    expect(legacy).toMatchObject({on_hand:"50.000",min_quantity:"55.000",below_minimum:true});
    expect((await saveStockItem(app,actor,item,{minQuantity:"75"})).outcome).toBe("VALIDATION_FAILED");
    expect((await saveStockItem(app,actor,item,{minQuantity:"40"})).outcome).toBe("OK");
    const balance=await stockBalance(app,actor,{warehouseId:central,itemId:item});
    expect(balance.outcome).toBe("OK");
    if(balance.outcome==="OK") expect(balance.data[0]).toMatchObject({on_hand:"50.000",min_quantity:"40.000",below_minimum:false});
  });
  it("kretnja je odbijena dok druga transakcija drži bravu popisa", async () => {
    const blocker=await admin.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2,0))",[company,central]);
      const result=await transferStock(app,actor,{fromWarehouseId:central,toWarehouseId:site,itemId:item,quantity:"1",occurredOn:"2026-11-23"});
      expect(result).toMatchObject({outcome:"CONFLICT",code:"STOCK_COUNT_IN_PROGRESS"});
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });
});
