import { describe,expect,it,vi } from "vitest";
import { createNodeSqlite,openNodeSqlite } from "../test/node-sqlite";
import { migrateLocalDatabase } from "./migrations";
import { activateLocalAccount,clearLocalAccountData,pendingOutboxCount } from "./r4-outbox";
import { queueMaterialIssue,readMaterialCatalog,readMaterialIssues,writeMaterialCatalog } from "./material-issue";
import { syncMaterialIssues } from "../sync/material-issue-sync";
const account={companyId:"company",userId:"user"},other={companyId:"company",userId:"other"};
const input={clientGeneratedId:"11111111-1111-4111-8111-111111111111",warehouseId:"site",projectId:"p",phaseId:"f",issuedAt:"2026-11-23T12:00:00Z",items:[{itemId:"i",quantity:"1.250"}]};
const catalog={projects:[{id:"p",code:"P",name:"Projekat"}],warehouses:[{id:"site",name:"Skladište",project_id:"p"}],items:[{id:"i",code:"I",name:"Cement",unit:"kg"}],phases:{p:[{id:"f",name:"Faza"}]}};
async function db(){const db=createNodeSqlite();await migrateLocalDatabase(db);await activateLocalAccount(db,account);return db;}
describe("F10 offline izlaz materijala",()=>{
  it("persistira red i katalog, štiti ponovnu upotrebu ID-a i ne gubi redove pri promjeni naloga",async()=>{
    const store=await db();await writeMaterialCatalog(store,account,catalog);expect((await readMaterialCatalog(store,account))?.catalog).toEqual(catalog);
    await queueMaterialIssue(store,account,input);await queueMaterialIssue(store,account,input);expect(await pendingOutboxCount(store,account)).toBe(1);
    await expect(queueMaterialIssue(store,account,{...input,items:[{itemId:"i",quantity:"2"}]})).rejects.toMatchObject({code:"OUTBOX_LOCAL_ID_REUSED"});
    await expect(queueMaterialIssue(store,account,{...input,clientGeneratedId:"22222222-2222-4222-8222-222222222222",items:[{itemId:"i",quantity:"0"}]})).rejects.toMatchObject({code:"MATERIAL_INVALID"});
    const switched=await activateLocalAccount(store,other);expect(switched.pendingForOtherAccounts).toBe(1);
    expect(await readMaterialIssues(store,other)).toEqual([]);expect(await readMaterialCatalog(store,other)).toBeNull();
    await expect(readMaterialIssues(store,account)).rejects.toMatchObject({code:"LOCAL_ACCOUNT_SCOPE_MISMATCH"});
    await activateLocalAccount(store,account);expect((await readMaterialIssues(store,account))[0]).toMatchObject({status:"pending",payload:input});store.close();
  });
  it("restart i odjava čuvaju nepotvrđeni red, a uklanjaju privatni katalog",async()=>{
    const first=await db();await writeMaterialCatalog(first,account,catalog);await queueMaterialIssue(first,account,input);
    const path=first.path;first.close();const restarted=openNodeSqlite(path);
    expect((await readMaterialIssues(restarted,account))[0]).toMatchObject({status:"pending",payload:input});
    expect(await pendingOutboxCount(restarted,account)).toBe(1);await clearLocalAccountData(restarted);
    await activateLocalAccount(restarted,account);expect(await readMaterialCatalog(restarted,account)).toBeNull();
    expect((await readMaterialIssues(restarted,account))[0]).toMatchObject({status:"pending"});restarted.close();
  });
  it("nakon prekida ponavlja isti UUID i obilježava red tek poslije potvrde",async()=>{
    const store=await db();await queueMaterialIssue(store,account,input);
    const send=vi.fn().mockRejectedValueOnce(Object.assign(new Error("offline"),{status:0,code:"NETWORK_ERROR"})).mockResolvedValueOnce({id:"server-issue"});
    expect(await syncMaterialIssues(store,account,send)).toEqual({applied:0,retry:1,rejected:0});
    expect((await readMaterialIssues(store,account))[0]).toMatchObject({status:"failed",error:"NETWORK_ERROR"});
    expect(await syncMaterialIssues(store,account,send)).toEqual({applied:1,retry:0,rejected:0});
    expect(send.mock.calls[0]![1]).toEqual(send.mock.calls[1]![1]);expect((await readMaterialIssues(store,account))[0]).toMatchObject({status:"sent",serverId:"server-issue"});
    expect(await pendingOutboxCount(store,account)).toBe(0);store.close();
  });
  it("zaključano skladište je prolazan konflikt i čeka ponovno slanje",async()=>{
    const store=await db();await queueMaterialIssue(store,account,input);
    const send=vi.fn().mockRejectedValue(Object.assign(new Error("zaključano"),{status:409,code:"STOCK_COUNT_IN_PROGRESS"}));
    expect(await syncMaterialIssues(store,account,send)).toEqual({applied:0,retry:1,rejected:0});
    expect((await readMaterialIssues(store,account))[0]).toMatchObject({status:"failed"});store.close();
  });
  it("promjena naloga tokom slanja ne mijenja red niti šalje sljedeći nalog",async()=>{
    const store=await db();await queueMaterialIssue(store,account,input);
    const send=vi.fn(async()=>{await activateLocalAccount(store,other);return {id:"server-issue"};});
    await expect(syncMaterialIssues(store,account,send)).rejects.toMatchObject({code:"LOCAL_ACCOUNT_SCOPE_MISMATCH"});
    expect(await readMaterialIssues(store,other)).toEqual([]);await activateLocalAccount(store,account);
    expect((await readMaterialIssues(store,account))[0]).toMatchObject({status:"pending"});store.close();
  });
  it("odbijanje nedovoljne zalihe čuva kao odbijen red bez tihog ponavljanja",async()=>{
    const store=await db();await queueMaterialIssue(store,account,input);
    const send=vi.fn().mockRejectedValue(Object.assign(new Error("nema"),{status:409,code:"STOCK_INSUFFICIENT"}));
    expect(await syncMaterialIssues(store,account,send)).toEqual({applied:0,retry:0,rejected:1});
    expect((await readMaterialIssues(store,account))[0]).toMatchObject({status:"rejected",error:"STOCK_INSUFFICIENT"});
    await syncMaterialIssues(store,account,send);expect(send).toHaveBeenCalledTimes(1);expect(await pendingOutboxCount(store,account)).toBe(1);store.close();
  });
});
